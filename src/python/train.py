import json
import math
import os
import sys
import time
import traceback
from datetime import timedelta
from typing import Any

# Важно: ставим до инициализации CUDA / загрузки модели
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import torch
import unsloth
from datasets import load_dataset
from unsloth import FastLanguageModel
from transformers import TrainingArguments, TrainerCallback
from trl import SFTTrainer


def report(p: int):
    print(f"__PROGRESS__:{p}", flush=True)


def log_event(kind: str, **payload: Any):
    print(
        json.dumps(
            {"event": kind, **payload},
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )


def safe_float(v: Any):
    try:
        x = float(v)
        if math.isfinite(x):
            return x
        return None
    except Exception:
        return None


def clean_text(value: Any, max_chars: int = 5000) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    if len(text) > max_chars:
        text = text[:max_chars].strip()
    return text


def summarize_texts(texts: list[str]) -> dict[str, Any]:
    lengths = [len(x) for x in texts if isinstance(x, str)]
    return {
        "count": len(texts),
        "minChars": min(lengths) if lengths else 0,
        "maxChars": max(lengths) if lengths else 0,
        "avgChars": round(sum(lengths) / len(lengths), 2) if lengths else 0,
        "preview": [x[:300] for x in texts[:3]],
    }


def resolve_dtype_name(use_bf16: bool) -> str:
    return "bfloat16" if use_bf16 else "float16"


def tensor_stats(t: torch.Tensor) -> dict[str, Any]:
    finite_mask = torch.isfinite(t)
    finite_count = int(finite_mask.sum().item())
    total_count = t.numel()

    result = {
        "shape": list(t.shape),
        "dtype": str(t.dtype),
        "finiteCount": finite_count,
        "totalCount": total_count,
        "hasNaN": bool(torch.isnan(t).any().item()),
        "hasInf": bool(torch.isinf(t).any().item()),
        "min": None,
        "max": None,
        "absmax": None,
        "mean": None,
        "std": None,
    }

    if finite_count > 0:
        vals = t[finite_mask].float()
        result["min"] = float(vals.min().item())
        result["max"] = float(vals.max().item())
        result["absmax"] = float(vals.abs().max().item())
        result["mean"] = float(vals.mean().item())
        result["std"] = float(vals.std().item()) if vals.numel() > 1 else 0.0

    return result


def collect_parameter_health(model) -> dict[str, Any]:
    bad_tensors: list[dict[str, Any]] = []
    scanned = 0
    global_absmax = 0.0
    trainable_count = 0
    total_param_count = 0
    trainable_param_count = 0

    for name, param in model.named_parameters():
        if param is None:
            continue

        scanned += 1
        total_param_count += int(param.numel())
        if param.requires_grad:
            trainable_count += 1
            trainable_param_count += int(param.numel())

        data = param.detach()
        stats = tensor_stats(data)

        if stats["absmax"] is not None:
            global_absmax = max(global_absmax, float(stats["absmax"]))

        if stats["hasNaN"] or stats["hasInf"]:
            bad_tensors.append(
                {
                    "name": name,
                    **stats,
                }
            )

    return {
        "scannedParameters": scanned,
        "trainableTensorCount": trainable_count,
        "totalParamCount": total_param_count,
        "trainableParamCount": trainable_param_count,
        "badTensorCount": len(bad_tensors),
        "globalAbsMax": global_absmax,
        "badTensors": bad_tensors[:50],
    }


def collect_module_weight_summary(model) -> dict[str, Any]:
    interesting_suffixes = [
        "input_layernorm.weight",
        "post_attention_layernorm.weight",
        "self_attn.q_proj.weight",
        "self_attn.k_proj.weight",
        "self_attn.v_proj.weight",
        "self_attn.o_proj.weight",
        "mlp.gate_proj.weight",
        "mlp.up_proj.weight",
        "mlp.down_proj.weight",
    ]

    rows = []
    for name, param in model.named_parameters():
        if not any(name.endswith(s) for s in interesting_suffixes):
            continue
        stats = tensor_stats(param.detach())
        rows.append(
            {
                "name": name,
                "shape": stats["shape"],
                "dtype": stats["dtype"],
                "absmax": stats["absmax"],
                "min": stats["min"],
                "max": stats["max"],
                "hasNaN": stats["hasNaN"],
                "hasInf": stats["hasInf"],
            }
        )

    return {
        "count": len(rows),
        "rows": rows[:200],
    }


def run_forward_smoke(
    model,
    tokenizer,
    texts: list[str],
    max_seq_length: int,
    device: torch.device,
) -> dict[str, Any]:
    model.eval()
    checks = []
    problems = []

    for idx, text in enumerate(texts):
        try:
            encoded = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=min(max_seq_length, 1024),
                padding=False,
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}

            with torch.no_grad():
                out = model(
                    **encoded,
                    output_hidden_states=True,
                    use_cache=False,
                    return_dict=True,
                )

            logits_stats = tensor_stats(out.logits.detach())
            hidden_rows = []
            hidden_states = getattr(out, "hidden_states", None)

            if hidden_states:
                for h_idx, hs in enumerate(hidden_states[: min(len(hidden_states), 6)]):
                    hs_stats = tensor_stats(hs.detach())
                    hidden_rows.append(
                        {
                            "index": h_idx,
                            "absmax": hs_stats["absmax"],
                            "hasNaN": hs_stats["hasNaN"],
                            "hasInf": hs_stats["hasInf"],
                            "shape": hs_stats["shape"],
                        }
                    )

            row = {
                "sampleIndex": idx,
                "textPreview": text[:300],
                "tokenCount": int(encoded["input_ids"].shape[-1]),
                "logits": {
                    "absmax": logits_stats["absmax"],
                    "min": logits_stats["min"],
                    "max": logits_stats["max"],
                    "hasNaN": logits_stats["hasNaN"],
                    "hasInf": logits_stats["hasInf"],
                    "shape": logits_stats["shape"],
                },
                "hiddenStates": hidden_rows,
            }
            checks.append(row)

            if logits_stats["hasNaN"] or logits_stats["hasInf"] or any(
                x["hasNaN"] or x["hasInf"] for x in hidden_rows
            ):
                problems.append(row)

        except Exception as exc:
            err = {
                "sampleIndex": idx,
                "textPreview": text[:300],
                "error": str(exc),
            }
            checks.append(err)
            problems.append(err)

    return {
        "checkedSamples": len(checks),
        "problemCount": len(problems),
        "checks": checks,
        "problems": problems,
    }


def choose_sanity_texts(dataset, fallback_count: int = 3) -> list[str]:
    texts = []
    for item in dataset.select(range(min(len(dataset), 20))):
        text = clean_text(item.get("text", ""))
        if text:
            texts.append(text)
        if len(texts) >= fallback_count:
            break

    if texts:
        return texts

    return [
        "Hello",
        "Write a short explanation of transformers.",
        "2 + 2 =",
    ]


class JsonMetricsCallback(TrainerCallback):
    def on_log(self, args, state, control, logs=None, **kwargs):
        if not logs:
            return
        payload = {"step": int(state.global_step), "epoch": safe_float(state.epoch)}
        payload.update({k: v for k, v in logs.items()})
        log_event("train_log", **payload)

    def on_save(self, args, state, control, **kwargs):
        log_event("train_save", step=int(state.global_step), epoch=safe_float(state.epoch))

    def on_train_begin(self, args, state, control, **kwargs):
        log_event("train_begin", maxSteps=int(state.max_steps))

    def on_train_end(self, args, state, control, **kwargs):
        log_event("train_end", step=int(state.global_step), epoch=safe_float(state.epoch))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: train.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    output_dir = cfg["outputDir"]
    os.makedirs(output_dir, exist_ok=True)

    qlora_cfg = cfg.get("qlora", {}) or {}
    wandb_cfg = cfg.get("wandb", {}) or {}

    wandb_enabled = bool(wandb_cfg.get("enabled")) and wandb_cfg.get("mode", "online") != "disabled"

    if wandb_cfg.get("mode") == "offline":
        os.environ["WANDB_MODE"] = "offline"

    if wandb_cfg.get("baseUrl"):
        os.environ["WANDB_BASE_URL"] = wandb_cfg["baseUrl"]

    if wandb_enabled:
        import wandb

        if wandb_cfg.get("apiKey"):
            wandb.login(key=wandb_cfg["apiKey"])

        wandb.init(
            project=wandb_cfg.get("project", "llm-lab"),
            entity=wandb_cfg.get("entity"),
            name=os.path.basename(output_dir),
            config=cfg,
            dir=output_dir,
            mode=wandb_cfg.get("mode", "online"),
        )

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available, but this script expects GPU training.")

    gpu_name = torch.cuda.get_device_name(0)
    total_vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
    use_bf16 = torch.cuda.is_bf16_supported()
    trust_remote_code = bool(cfg.get("trustRemoteCode", False))

    log_event(
        "train_config",
        outputDir=output_dir,
        baseModel=cfg["baseModel"],
        datasetPath=cfg["datasetPath"],
        trustRemoteCode=trust_remote_code,
        gpuName=gpu_name,
        gpuVramGb=round(total_vram_gb, 2),
        qlora=qlora_cfg,
        wandbEnabled=wandb_enabled,
        wandbMode=wandb_cfg.get("mode", "online"),
        trainDtype=resolve_dtype_name(use_bf16),
    )

    report(5)

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg["baseModel"],
        max_seq_length=qlora_cfg["maxSeqLength"],
        dtype=None,
        load_in_4bit=bool(qlora_cfg.get("loadIn4bit", True)),
        trust_remote_code=trust_remote_code,
        device_map={"": 0},
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    if getattr(model.config, "pad_token_id", None) is None and tokenizer.pad_token_id is not None:
        model.config.pad_token_id = tokenizer.pad_token_id

    base_health_before = collect_parameter_health(model)
    log_event("base_model_health_before_lora", **base_health_before)
    log_event("base_model_weights_before_lora", **collect_module_weight_summary(model))

    report(15)

    use_lora = bool(qlora_cfg.get("useLora", True))

    if use_lora:
        model = FastLanguageModel.get_peft_model(
            model,
            r=qlora_cfg["loraR"],
            target_modules=qlora_cfg["targetModules"],
            lora_alpha=qlora_cfg["loraAlpha"],
            lora_dropout=qlora_cfg["loraDropout"],
            bias="none",
            use_gradient_checkpointing="unsloth",
        )

    post_attach_health = collect_parameter_health(model)
    log_event("model_health_after_lora_attach", **post_attach_health)

    report(20)

    dataset = load_dataset("json", data_files=cfg["datasetPath"], split="train")

    def format_row(row):
        messages = row.get("messages", [])
        if not isinstance(messages, list) or len(messages) < 2:
            return {"text": ""}

        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    dataset = dataset.map(format_row, desc="Formatting dataset")
    dataset = dataset.filter(lambda x: bool(x["text"] and x["text"].strip()), desc="Filtering empty rows")

    if len(dataset) == 0:
        raise ValueError("Dataset is empty after formatting/filtering")

    sample_texts = [clean_text(x["text"]) for x in dataset.select(range(min(len(dataset), 5)))]
    log_event("dataset_summary", rows=len(dataset), **summarize_texts(sample_texts))

    report(30)

    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=qlora_cfg["perDeviceTrainBatchSize"],
        gradient_accumulation_steps=qlora_cfg["gradientAccumulationSteps"],
        learning_rate=qlora_cfg["learningRate"],
        num_train_epochs=qlora_cfg["numTrainEpochs"],
        warmup_ratio=qlora_cfg["warmupRatio"],
        logging_steps=1,
        save_strategy="epoch",
        save_safetensors=True,
        bf16=use_bf16,
        fp16=not use_bf16,
        report_to=["wandb"] if wandb_enabled else [],
        remove_unused_columns=False,
        group_by_length=False,
        optim="paged_adamw_8bit",
        lr_scheduler_type=qlora_cfg.get("lrSchedulerType", "cosine"),
        weight_decay=qlora_cfg.get("weightDecay", 0.01),
        max_grad_norm=qlora_cfg.get("maxGradNorm", 1.0),
        gradient_checkpointing=False,
        dataloader_pin_memory=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=training_args,
        dataset_text_field="text",
        packing=False,
        dataset_num_proc=1,
    )
    trainer.add_callback(JsonMetricsCallback())

    report(40)

    pre_train_smoke = run_forward_smoke(
        model=model,
        tokenizer=tokenizer,
        texts=choose_sanity_texts(dataset),
        max_seq_length=qlora_cfg["maxSeqLength"],
        device=torch.device("cuda:0"),
    )
    log_event("forward_smoke_before_train", **pre_train_smoke)

    if pre_train_smoke["problemCount"] > 0:
        raise RuntimeError("Model failed smoke forward before training. See forward_smoke_before_train logs.")

    report(50)

    start_time = time.time()
    train_result = trainer.train()
    end_time = time.time()

    report(80)

    after_train_health = collect_parameter_health(model)
    log_event("model_health_after_train", **after_train_health)
    log_event("model_weights_after_train", **collect_module_weight_summary(model))

    post_train_smoke = run_forward_smoke(
        model=model,
        tokenizer=tokenizer,
        texts=choose_sanity_texts(dataset),
        max_seq_length=qlora_cfg["maxSeqLength"],
        device=torch.device("cuda:0"),
    )
    log_event("forward_smoke_after_train", **post_train_smoke)

    if use_lora:
        model.save_pretrained(output_dir)
    else:
        trainer.save_model(output_dir)

    tokenizer.save_pretrained(output_dir)

    report(92)

    duration = end_time - start_time
    metrics = train_result.metrics

    final_loss = None
    if trainer.state.log_history:
        for entry in reversed(trainer.state.log_history):
            if "loss" in entry:
                final_loss = entry["loss"]
                break

    wandb_run_id = None
    if wandb_enabled:
        try:
            import wandb
            if wandb.run:
                wandb_run_id = wandb.run.id
        except Exception:
            pass

    summary = {
        "duration": duration,
        "duration_human": str(timedelta(seconds=int(duration))),
        "final_loss": final_loss,
        "train_runtime": metrics.get("train_runtime"),
        "train_samples_per_second": metrics.get("train_samples_per_second"),
        "train_steps_per_second": metrics.get("train_steps_per_second"),
        "total_flos": metrics.get("total_flos"),
        "train_loss": metrics.get("train_loss"),
        "rows": len(dataset),
        "bf16": use_bf16,
        "fp16": not use_bf16,
        "wandb_run_id": wandb_run_id,
        "gpu_name": gpu_name,
        "gpu_vram_gb": round(total_vram_gb, 2),
        "trust_remote_code": trust_remote_code,
        "preTrainForwardProblems": pre_train_smoke["problemCount"],
        "postTrainForwardProblems": post_train_smoke["problemCount"],
        "postTrainBadTensorCount": after_train_health["badTensorCount"],
        "postTrainGlobalAbsMax": after_train_health["globalAbsMax"],
    }

    with open(os.path.join(output_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(trainer.state.log_history, f, indent=2, ensure_ascii=False)

    report(100)

    result = {
        "ok": True,
        "outputDir": output_dir,
        "summary": summary,
        "wandbEnabled": wandb_enabled,
        "wandbMode": wandb_cfg.get("mode", "online"),
    }

    log_event("train_success", **result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)