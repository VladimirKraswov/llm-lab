import json
import math
import os
import shutil
import sys
import traceback
from typing import Any

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")


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


def read_cfg():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: merge_lora.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_dtype(dtype_value, torch):
    value = str(dtype_value or "auto").lower().strip()
    if value == "auto":
        return "auto"
    if value in ("float16", "half", "fp16"):
        return torch.float16
    if value in ("bfloat16", "bf16"):
        return torch.bfloat16
    if value in ("float32", "float", "fp32"):
        return torch.float32
    raise ValueError(f"Unsupported dtype: {dtype_value}")


def dtype_name(dtype_value) -> str:
    if dtype_value == "auto":
        return "auto"
    return str(dtype_value).replace("torch.", "")


def resolve_device_map(cfg, torch):
    strategy = str(cfg.get("deviceStrategy", "cpu")).lower().strip()

    if strategy == "cpu":
        return "cpu"

    if strategy == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA merge requested, but CUDA is not available")
        cuda_device = int(cfg.get("cudaDevice", 0))
        return {"": cuda_device}

    if strategy == "auto":
        if torch.cuda.is_available():
            cuda_device = int(cfg.get("cudaDevice", 0))
            return {"": cuda_device}
        return "cpu"

    raise ValueError(f"Unsupported deviceStrategy: {strategy}")


def maybe_clear_output_dir(output_dir: str, overwrite_output: bool):
    if os.path.exists(output_dir) and overwrite_output:
        shutil.rmtree(output_dir, ignore_errors=True)
    os.makedirs(output_dir, exist_ok=True)


def read_adapter_config(adapter_path: str) -> dict:
    adapter_cfg_path = os.path.join(adapter_path, "adapter_config.json")
    if not os.path.exists(adapter_cfg_path):
        raise FileNotFoundError(f"adapter_config.json not found in {adapter_path}")

    with open(adapter_cfg_path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_base_model_path(adapter_path: str, base_model_override: str | None = None) -> str:
    if base_model_override and str(base_model_override).strip():
        return str(base_model_override).strip()

    adapter_cfg = read_adapter_config(adapter_path)
    base_model = str(adapter_cfg.get("base_model_name_or_path") or "").strip()
    if not base_model:
        raise ValueError("base_model_name_or_path is missing in adapter_config.json")

    return base_model


def save_result(output_dir: str, payload: dict):
    with open(os.path.join(output_dir, "merge-result.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def clean_text(value: Any, max_chars: int = 5000) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    if len(text) > max_chars:
        text = text[:max_chars].strip()
    return text


def tensor_stats(t) -> dict[str, Any]:
    finite_mask = t.isfinite()
    finite_count = int(finite_mask.sum().item())
    total_count = t.numel()

    result = {
        "shape": list(t.shape),
        "dtype": str(t.dtype),
        "finiteCount": finite_count,
        "totalCount": total_count,
        "hasNaN": bool(t.isnan().any().item()),
        "hasInf": bool(t.isinf().any().item()),
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
    bad_tensors = []
    scanned = 0
    global_absmax = 0.0

    for name, param in model.named_parameters():
        if param is None:
            continue
        scanned += 1
        stats = tensor_stats(param.detach())
        if stats["absmax"] is not None:
            global_absmax = max(global_absmax, stats["absmax"])
        if stats["hasNaN"] or stats["hasInf"]:
            bad_tensors.append({"name": name, **stats})

    return {
        "scannedParameters": scanned,
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
    return {"count": len(rows), "rows": rows[:200]}


def choose_probe_texts():
    return [
        "Hello",
        "Write a short explanation of transformers.",
        "2 + 2 =",
    ]


def detect_device(model, torch):
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cpu")


def run_forward_smoke(model, tokenizer, texts, max_seq_len: int, device) -> dict[str, Any]:
    model.eval()
    checks = []
    problems = []

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


def collect_merge_delta_stats(base_model, merged_model) -> dict[str, Any]:
    base_state = dict(base_model.named_parameters())
    merged_state = dict(merged_model.named_parameters())

    rows = []
    global_delta_absmax = 0.0
    changed_count = 0

    for name, merged_param in merged_state.items():
        base_param = base_state.get(name)
        if base_param is None:
            continue
        if merged_param.shape != base_param.shape:
            continue

        delta = (merged_param.detach().float().cpu() - base_param.detach().float().cpu())
        stats = tensor_stats(delta)
        absmax = stats["absmax"] or 0.0
        global_delta_absmax = max(global_delta_absmax, absmax)

        if absmax > 0:
            changed_count += 1

        interesting = (
            name.endswith("input_layernorm.weight")
            or name.endswith("post_attention_layernorm.weight")
            or name.endswith("self_attn.q_proj.weight")
            or name.endswith("self_attn.k_proj.weight")
            or name.endswith("self_attn.v_proj.weight")
            or name.endswith("self_attn.o_proj.weight")
            or name.endswith("mlp.gate_proj.weight")
            or name.endswith("mlp.up_proj.weight")
            or name.endswith("mlp.down_proj.weight")
        )
        if interesting:
            rows.append(
                {
                    "name": name,
                    "deltaAbsMax": stats["absmax"],
                    "deltaMin": stats["min"],
                    "deltaMax": stats["max"],
                    "deltaMean": stats["mean"],
                    "deltaStd": stats["std"],
                    "hasNaN": stats["hasNaN"],
                    "hasInf": stats["hasInf"],
                }
            )

    return {
        "changedTensorCount": changed_count,
        "globalDeltaAbsMax": global_delta_absmax,
        "rows": rows[:200],
    }


def main():
    cfg = read_cfg()

    adapter_path = cfg["adapterPath"]
    output_dir = cfg["outputDir"]
    overwrite_output = bool(cfg.get("overwriteOutput", False))
    low_cpu_mem_usage = bool(cfg.get("lowCpuMemUsage", True))
    safe_serialization = bool(cfg.get("safeSerialization", True))
    max_shard_size = str(cfg.get("maxShardSize", "5GB"))
    trust_remote_code = bool(cfg.get("trustRemoteCode", False))
    offload_folder_name = str(cfg.get("offloadFolderName", "_offload")).strip() or "_offload"
    base_model_override = str(cfg.get("baseModelOverride") or "").strip() or None

    maybe_clear_output_dir(output_dir, overwrite_output)
    offload_dir = os.path.join(output_dir, offload_folder_name)
    os.makedirs(offload_dir, exist_ok=True)

    report(5)

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    report(10)

    dtype = resolve_dtype(cfg.get("dtype", "auto"), torch)
    device_map = resolve_device_map(cfg, torch)
    base_model_path = resolve_base_model_path(adapter_path, base_model_override)

    log_event(
        "merge_config",
        adapterPath=adapter_path,
        outputDir=output_dir,
        baseModelPath=base_model_path,
        baseModelOverride=base_model_override,
        deviceStrategy=cfg.get("deviceStrategy", "cpu"),
        resolvedDeviceMap=device_map,
        dtype=dtype_name(dtype),
        lowCpuMemUsage=low_cpu_mem_usage,
        safeSerialization=safe_serialization,
        maxShardSize=max_shard_size,
        trustRemoteCode=trust_remote_code,
    )

    adapter_config = read_adapter_config(adapter_path)
    log_event("adapter_config", **adapter_config)

    report(20)

    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_path,
        torch_dtype=dtype,
        device_map=device_map,
        low_cpu_mem_usage=low_cpu_mem_usage,
        offload_folder=offload_dir,
        trust_remote_code=trust_remote_code,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        base_model_path,
        trust_remote_code=trust_remote_code,
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    base_device = detect_device(base_model, torch)

    log_event("base_model_health_before_merge", **collect_parameter_health(base_model))
    log_event("base_model_weights_before_merge", **collect_module_weight_summary(base_model))
    log_event(
        "base_model_forward_before_merge",
        **run_forward_smoke(
            model=base_model,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=512,
            device=base_device,
        ),
    )

    report(40)

    model = PeftModel.from_pretrained(
        base_model,
        adapter_path,
        device_map=device_map,
        offload_folder=offload_dir,
    )

    peft_device = detect_device(model, torch)

    log_event("peft_model_health_before_merge", **collect_parameter_health(model))
    log_event("peft_model_weights_before_merge", **collect_module_weight_summary(model))
    log_event(
        "peft_forward_before_merge",
        **run_forward_smoke(
            model=model,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=512,
            device=peft_device,
        ),
    )

    report(60)

    merged = model.merge_and_unload()
    merged_device = detect_device(merged, torch)

    report(75)

    log_event("merged_model_health", **collect_parameter_health(merged))
    log_event("merged_model_weights", **collect_module_weight_summary(merged))
    log_event("merge_delta_stats", **collect_merge_delta_stats(base_model, merged))
    log_event(
        "merged_forward_after_merge",
        **run_forward_smoke(
            model=merged,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=512,
            device=merged_device,
        ),
    )

    report(85)

    merged.save_pretrained(
        output_dir,
        safe_serialization=safe_serialization,
        max_shard_size=max_shard_size,
    )
    tokenizer.save_pretrained(output_dir)

    result = {
        "ok": True,
        "adapterPath": adapter_path,
        "outputDir": output_dir,
        "baseModelPath": base_model_path,
        "baseModelOverride": base_model_override,
        "deviceStrategy": cfg.get("deviceStrategy", "cpu"),
        "resolvedDeviceMap": device_map,
        "dtype": dtype_name(dtype),
        "lowCpuMemUsage": low_cpu_mem_usage,
        "safeSerialization": safe_serialization,
        "maxShardSize": max_shard_size,
        "trustRemoteCode": trust_remote_code,
    }
    save_result(output_dir, result)

    report(100)
    log_event("merge_success", **result)
    print(f"__RESULT__:{output_dir}")
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)