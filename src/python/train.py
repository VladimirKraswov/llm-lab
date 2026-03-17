import json
import os
import sys
import time
from datetime import timedelta

# Важно: ставим до инициализации CUDA / загрузки модели
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import torch
import unsloth
from datasets import load_dataset
from unsloth import FastLanguageModel
from transformers import TrainingArguments
from trl import SFTTrainer


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
    print(f"Using GPU: {gpu_name} ({total_vram_gb:.2f} GB VRAM)")

    use_bf16 = torch.cuda.is_bf16_supported()

    # Делай trust_remote_code управляемым через config:
    # "trustRemoteCode": false
    trust_remote_code = bool(cfg.get("trustRemoteCode", False))

    # Ключевой фикс:
    # 1) для 4bit НЕ даём auto + cpu offload
    # 2) грузим всё на единственную GPU
    # 3) не задаём max_memory с CPU, чтобы transformers не раскидывал модули на CPU/disk
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
        gradient_checkpointing=False,  # Unsloth handles this via get_peft_model(... use_gradient_checkpointing="unsloth")
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

    start_time = time.time()
    train_result = trainer.train()
    end_time = time.time()

    if use_lora:
        model.save_pretrained(output_dir)
    else:
        trainer.save_model(output_dir)

    tokenizer.save_pretrained(output_dir)

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
    }

    with open(os.path.join(output_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(trainer.state.log_history, f, indent=2, ensure_ascii=False)

    print(json.dumps({
        "ok": True,
        "outputDir": output_dir,
        "summary": summary,
        "wandbEnabled": wandb_enabled,
        "wandbMode": wandb_cfg.get("mode", "online"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()