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


def collect_parameter_health(model) -> dict[str, Any]:
    bad_tensors: list[dict[str, Any]] = []
    scanned = 0
    global_absmax = 0.0

    for name, param in model.named_parameters():
        if param is None:
            continue

        scanned += 1
        data = param.detach()

        has_nan = torch.isnan(data).any().item()
        has_inf = torch.isinf(data).any().item()

        finite_mask = torch.isfinite(data)
        finite_count = int(finite_mask.sum().item())
        total_count = data.numel()

        absmax = None
        min_val = None
        max_val = None

        if finite_count > 0:
          finite_vals = data[finite_mask]
          absmax = float(finite_vals.abs().max().item())
          min_val = float(finite_vals.min().item())
          max_val = float(finite_vals.max().item())
          global_absmax = max(global_absmax, absmax)

        if has_nan or has_inf:
            bad_tensors.append(
                {
                    "name": name,
                    "shape": list(data.shape),
                    "dtype": str(data.dtype),
                    "hasNaN": bool(has_nan),
                    "hasInf": bool(has_inf),
                    "finiteCount": finite_count,
                    "totalCount": total_count,
                    "min": min_val,
                    "max": max_val,
                    "absmax": absmax,
                }
            )

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


def safe_tensor_stats(t: torch.Tensor) -> dict[str, Any]:
    finite_mask = torch.isfinite(t)
    finite_count = int(finite_mask.sum().item())
    total_count = t.numel()

    if finite_count == 0:
        return {
            "shape": list(t.shape),
            "dtype": str(t.dtype),
            "finiteCount": finite_count,
            "totalCount": total_count,
            "min": None,
            "max": None,
            "absmax": None,
            "hasNaN": bool(torch.isnan(t).any().item()),
            "hasInf": bool(torch.isinf(t).any().item()),
        }

    finite_vals = t[finite_mask]
    return {
        "shape": list(t.shape),
        "dtype": str(t.dtype),
        "finiteCount": finite_count,
        "totalCount": total_count,
        "min": float(finite_vals.min().item()),
        "max": float(finite_vals.max().item()),
        "absmax": float(finite_vals.abs().max().item()),
        "hasNaN": bool(torch.isnan(t).any().item()),
        "hasInf": bool(torch.isinf(t).any().item()),
    }


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
                )

            logits = out.logits.detach()
            logits_stats = safe_tensor_stats(logits)

            hidden_summaries = []
            hidden_bad = False

            hidden_states = getattr(out, "hidden_states", None)
            if hidden_states:
                for h_idx, hs in enumerate(hidden_states[: min(len(hidden_states), 6)]):
                    hs_detached = hs.detach()
                    hs_stats = safe_tensor_stats(hs_detached)
                    hidden_summaries.append(
                        {
                            "index": h_idx,
                            "shape": hs_stats["shape"],
                            "absmax": hs_stats["absmax"],
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


def detect_device(model) -> torch.device:
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cpu")


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
            "in the merged model. Check logs: model_weight_health and forward_precheck."
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