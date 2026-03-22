import json
import math
import os
import sys
import traceback
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from llmcompressor import oneshot
from llmcompressor.modifiers.awq import AWQModifier


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


def resolve_dtype(dtype_value):
    value = str(dtype_value or "float16").strip().lower()
    if value in ("float16", "half", "fp16", "torch.float16"):
        return torch.float16
    if value in ("bfloat16", "bf16", "torch.bfloat16"):
        return torch.bfloat16
    if value in ("float32", "float", "fp32", "torch.float32"):
        return torch.float32
    if value == "auto":
        return "auto"
    raise ValueError(f"Unsupported dtype: {dtype_value}")


def dtype_name(dtype_value: Any) -> str:
    if dtype_value == "auto":
        return "auto"
    if dtype_value is torch.float16:
        return "float16"
    if dtype_value is torch.bfloat16:
        return "bfloat16"
    if dtype_value is torch.float32:
        return "float32"
    return str(dtype_value)


def _clean_text(value: str, max_chars: int = 12000) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    if not text:
        return ""
    if len(text) > max_chars:
        text = text[:max_chars].strip()
    return text


def build_local_text_dataset(dataset_path: str | None, num_samples: int, calibration_mode: str):
    if not dataset_path or not os.path.exists(dataset_path):
        return "open_platypus"

    mode = str(calibration_mode or "text_only").strip().lower()
    rows: list[str] = []

    with open(dataset_path, "r", encoding="utf-8") as f:
        for line in f:
            if len(rows) >= num_samples:
                break

            line = line.strip()
            if not line:
                continue

            try:
                item = json.loads(line)
            except Exception:
                continue

            if not isinstance(item, dict):
                text = _clean_text(str(item))
                if text:
                    rows.append(text)
                continue

            text = item.get("text")
            if isinstance(text, str):
                text = _clean_text(text)
                if text:
                    rows.append(text)
                    continue

            if mode == "text_only":
                continue

            messages = item.get("messages")
            if isinstance(messages, list):
                parts = []
                for msg in messages:
                    if not isinstance(msg, dict):
                        continue
                    content = _clean_text(msg.get("content", ""))
                    if content:
                        parts.append(content)
                joined = _clean_text("\n".join(parts))
                if joined:
                    rows.append(joined)
                    continue

            if "instruction" in item and "output" in item:
                joined = _clean_text(f"{item.get('instruction', '')}\n\n{item.get('output', '')}")
                if joined:
                    rows.append(joined)
                    continue

            if "prompt" in item and "completion" in item:
                joined = _clean_text(f"{item.get('prompt', '')}\n\n{item.get('completion', '')}")
                if joined:
                    rows.append(joined)
                    continue

    return rows if rows else "open_platypus"


def validate_awq_params(bits: int, group_size: int):
    if bits != 4:
        raise ValueError("Current AWQ implementation supports 4-bit only")
    if group_size <= 0:
        raise ValueError("group_size must be > 0")


def build_awq_recipe(bits: int, group_size: int, sym: bool):
    return [
        AWQModifier(
            ignore=["lm_head"],
            config_groups={
                "group_0": {
                    "targets": ["Linear"],
                    "weights": {
                        "num_bits": bits,
                        "type": "int",
                        "symmetric": sym,
                        "strategy": "group",
                        "group_size": group_size,
                    },
                    "input_activations": None,
                    "output_activations": None,
                }
            },
        )
    ]


def summarize_dataset_for_logs(dataset: Any):
    if isinstance(dataset, list):
        lengths = [len(x) for x in dataset if isinstance(x, str)]
        return {
            "datasetKind": "local_list",
            "count": len(dataset),
            "emptyCount": sum(1 for x in dataset if not str(x).strip()),
            "minChars": min(lengths) if lengths else 0,
            "maxChars": max(lengths) if lengths else 0,
            "avgChars": round(sum(lengths) / len(lengths), 2) if lengths else 0,
            "preview": [str(x)[:200] for x in dataset[:3]],
        }
    return {
        "datasetKind": str(dataset),
        "count": None,
        "emptyCount": None,
        "minChars": None,
        "maxChars": None,
        "avgChars": None,
        "preview": [],
    }


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

    for name, param in model.named_parameters():
        if param is None:
            continue

        scanned += 1
        data = param.detach()
        stats = tensor_stats(data)

        if stats["absmax"] is not None:
            global_absmax = max(global_absmax, float(stats["absmax"]))

        if stats["hasNaN"] or stats["hasInf"]:
            bad_tensors.append({"name": name, **stats})

    return {
        "scannedParameters": scanned,
        "badTensorCount": len(bad_tensors),
        "globalAbsMax": global_absmax,
        "badTensors": bad_tensors[:50],
    }


def choose_sanity_texts(dataset: Any, fallback_count: int = 3) -> list[str]:
    if isinstance(dataset, list):
        texts = [x for x in dataset if isinstance(x, str) and x.strip()]
        return texts[:fallback_count]
    return [
        "Hello",
        "Write a short explanation of transformers.",
        "2 + 2 =",
    ]


def detect_device(model) -> torch.device:
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cpu")


def run_pre_quant_forward_checks(
    model,
    tokenizer,
    texts: list[str],
    max_seq_len: int,
    device: torch.device,
):
    problems: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []

    model.eval()

    for idx, text in enumerate(texts):
        try:
            encoded = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=max_seq_len,
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

            logits = out.logits.detach()
            logits_stats = tensor_stats(logits)

            hidden_summaries = []
            hidden_bad = False

            hidden_states = getattr(out, "hidden_states", None)
            if hidden_states:
                for h_idx, hs in enumerate(hidden_states[: min(len(hidden_states), 8)]):
                    hs_detached = hs.detach()
                    hs_stats = tensor_stats(hs_detached)
                    hidden_summaries.append(
                        {
                            "index": h_idx,
                            "shape": hs_stats["shape"],
                            "absmax": hs_stats["absmax"],
                            "min": hs_stats["min"],
                            "max": hs_stats["max"],
                            "hasNaN": hs_stats["hasNaN"],
                            "hasInf": hs_stats["hasInf"],
                        }
                    )
                    if hs_stats["hasNaN"] or hs_stats["hasInf"]:
                        hidden_bad = True

            item = {
                "sampleIndex": idx,
                "textPreview": text[:300],
                "tokenCount": int(encoded["input_ids"].shape[-1]),
                "logits": {
                    "shape": logits_stats["shape"],
                    "absmax": logits_stats["absmax"],
                    "min": logits_stats["min"],
                    "max": logits_stats["max"],
                    "hasNaN": logits_stats["hasNaN"],
                    "hasInf": logits_stats["hasInf"],
                },
                "hiddenStates": hidden_summaries,
            }
            checks.append(item)

            if logits_stats["hasNaN"] or logits_stats["hasInf"] or hidden_bad:
                problems.append(item)

        except Exception as exc:
            err_item = {
                "sampleIndex": idx,
                "textPreview": text[:300],
                "error": str(exc),
            }
            checks.append(err_item)
            problems.append(err_item)

    return {
        "checkedSamples": len(checks),
        "problemCount": len(problems),
        "checks": checks,
        "problems": problems,
    }


def get_target_module_names(model) -> list[str]:
    names = []
    for name, module in model.named_modules():
        if (
            name.endswith("input_layernorm")
            or name.endswith("post_attention_layernorm")
            or name.endswith("self_attn.q_proj")
            or name.endswith("self_attn.k_proj")
            or name.endswith("self_attn.v_proj")
            or name.endswith("self_attn.o_proj")
            or name.endswith("mlp.gate_proj")
            or name.endswith("mlp.up_proj")
            or name.endswith("mlp.down_proj")
        ):
            names.append(name)
    return names


def run_hooked_layer_diagnostics(
    model,
    tokenizer,
    texts: list[str],
    max_seq_len: int,
    device: torch.device,
):
    target_names = set(get_target_module_names(model))
    captured: dict[str, list[dict[str, Any]]] = {}

    hooks = []

    def make_hook(name: str):
        def hook(_module, inputs, output):
            try:
                value = None
                if isinstance(output, tuple) and output:
                    value = output[0]
                else:
                    value = output

                if not torch.is_tensor(value):
                    return

                stats = tensor_stats(value.detach())
                entry = {
                    "absmax": stats["absmax"],
                    "min": stats["min"],
                    "max": stats["max"],
                    "hasNaN": stats["hasNaN"],
                    "hasInf": stats["hasInf"],
                    "shape": stats["shape"],
                }
                captured.setdefault(name, []).append(entry)
            except Exception as exc:
                captured.setdefault(name, []).append({"error": str(exc)})

        return hook

    for name, module in model.named_modules():
        if name in target_names:
            hooks.append(module.register_forward_hook(make_hook(name)))

    sample_results = []

    try:
        model.eval()
        for idx, text in enumerate(texts):
            encoded = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=max_seq_len,
                padding=False,
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}

            with torch.no_grad():
                _ = model(
                    **encoded,
                    output_hidden_states=False,
                    use_cache=False,
                    return_dict=True,
                )

            sample_results.append(
                {
                    "sampleIndex": idx,
                    "textPreview": text[:200],
                    "tokenCount": int(encoded["input_ids"].shape[-1]),
                }
            )
    finally:
        for h in hooks:
            h.remove()

    summarized = []
    problem_modules = []

    for name, entries in captured.items():
        bad = False
        last = entries[-1] if entries else {}
        for e in entries:
            if e.get("hasNaN") or e.get("hasInf") or e.get("error"):
                bad = True
                break

        row = {
            "name": name,
            "calls": len(entries),
            "last": last,
            "bad": bad,
        }
        summarized.append(row)
        if bad:
            problem_modules.append(row)

    summarized.sort(key=lambda x: x["name"])
    return {
        "checkedSamples": len(sample_results),
        "moduleCount": len(summarized),
        "problemModuleCount": len(problem_modules),
        "modules": summarized,
        "problemModules": problem_modules[:100],
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: quantize_llm_compressor.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    model_path = cfg["modelPath"]
    output_dir = cfg["outputDir"]
    method = str(cfg.get("method", "awq")).lower()
    dataset_path = cfg.get("datasetPath")
    num_samples = int(cfg.get("numSamples", 32))
    max_seq_len = int(cfg.get("maxSeqLen", 1024))
    bits = int(cfg.get("bits", 4))
    group_size = int(cfg.get("groupSize", 128))
    sym = bool(cfg.get("sym", False))
    trust_remote_code = bool(cfg.get("trustRemoteCode", True))
    dtype = resolve_dtype(cfg.get("dtype", "float16"))
    calibration_mode = str(cfg.get("calibrationMode", "text_only")).strip().lower()

    if method != "awq":
        raise ValueError(
            f"quantize_llm_compressor.py currently supports only method='awq', got: {method}"
        )

    validate_awq_params(bits, group_size)

    os.makedirs(output_dir, exist_ok=True)
    report(5)

    log_event(
        "quant_config",
        modelPath=model_path,
        outputDir=output_dir,
        datasetPath=dataset_path,
        numSamples=num_samples,
        maxSeqLen=max_seq_len,
        bits=bits,
        groupSize=group_size,
        sym=sym,
        dtype=dtype_name(dtype),
        calibrationMode=calibration_mode,
        trustRemoteCode=trust_remote_code,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        model_path,
        trust_remote_code=trust_remote_code,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    report(15)

    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=dtype,
        trust_remote_code=trust_remote_code,
    )

    device = detect_device(model)

    report(30)

    dataset = build_local_text_dataset(
        dataset_path=dataset_path,
        num_samples=num_samples,
        calibration_mode=calibration_mode,
    )

    if isinstance(dataset, list):
        dataset = [x for x in dataset if x and x.strip()]
        dataset = dataset[:num_samples]

    dataset_summary = summarize_dataset_for_logs(dataset)
    log_event("dataset_summary", **dataset_summary)

    if isinstance(dataset, list) and not dataset:
        raise RuntimeError("Resolved calibration dataset is empty after preprocessing")

    report(40)

    weight_health = collect_parameter_health(model)
    log_event("model_weight_health", **weight_health)

    if weight_health["badTensorCount"] > 0:
        raise RuntimeError(
            "Merged/base model contains NaN or Inf in weights before quantization. "
            "Check LoRA training and merge pipeline."
        )

    if not math.isfinite(weight_health["globalAbsMax"]) or weight_health["globalAbsMax"] == 0:
        raise RuntimeError(
            f"Model weight statistics look invalid before quantization: globalAbsMax={weight_health['globalAbsMax']}"
        )

    report(50)

    sanity_texts = choose_sanity_texts(dataset)
    preflight = run_pre_quant_forward_checks(
        model=model,
        tokenizer=tokenizer,
        texts=sanity_texts,
        max_seq_len=min(max_seq_len, 1024),
        device=device,
    )
    log_event("forward_precheck", **preflight)

    if preflight["problemCount"] > 0:
        raise RuntimeError(
            "Pre-quantization forward check failed: model produced non-finite values "
            "or errored on sanity samples. See `forward_precheck` logs."
        )

    report(60)

    layer_diag = run_hooked_layer_diagnostics(
        model=model,
        tokenizer=tokenizer,
        texts=sanity_texts[:1],
        max_seq_len=min(max_seq_len, 512),
        device=device,
    )
    log_event("hooked_layer_diagnostics", **layer_diag)

    if layer_diag["problemModuleCount"] > 0:
        raise RuntimeError(
            "Layer diagnostics found non-finite activations before AWQ. "
            "See `hooked_layer_diagnostics` logs."
        )

    recipe = build_awq_recipe(bits=bits, group_size=group_size, sym=sym)
    log_event(
        "awq_recipe_ready",
        modifierCount=len(recipe),
        bits=bits,
        groupSize=group_size,
        symmetric=sym,
    )

    report(65)

    try:
        oneshot(
            model=model,
            dataset=dataset,
            recipe=recipe,
            output_dir=output_dir,
            max_seq_length=max_seq_len,
            num_calibration_samples=num_samples,
        )
    except Exception as exc:
        log_event(
            "awq_failure",
            error=str(exc),
            hint=(
                "AWQ failed during smoothing/calibration. "
                "If base model quantizes but merged model fails, the most likely cause is "
                "numerical instability introduced by LoRA training or merge."
            ),
        )
        raise RuntimeError(
            "AWQ failed during smoothing because the model produced non-finite values "
            "on one of the smoothing targets. This usually points to numerical instability "
            "in the merged model. Check logs: model_weight_health, forward_precheck, hooked_layer_diagnostics."
        ) from exc

    report(95)

    tokenizer.save_pretrained(output_dir)

    report(100)
    log_event("quantization_success", outputDir=output_dir)
    print(f"__RESULT__:{output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)