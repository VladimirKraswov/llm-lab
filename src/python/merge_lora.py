import json
import os
import shutil
import sys
import traceback
from typing import Any

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


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
        "badTensors": bad_tensors[:100],
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
        "lm_head.weight",
        "model.norm.weight",
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
                "mean": stats["mean"],
                "std": stats["std"],
                "hasNaN": stats["hasNaN"],
                "hasInf": stats["hasInf"],
            }
        )
    return {"count": len(rows), "rows": rows[:300]}


def choose_probe_texts():
    return [
        "Hello",
        "Write a short explanation of transformers.",
        "2 + 2 =",
        "Tell me three facts about the Moon.",
        "Complete: The capital of France is",
    ]


def detect_device(model, torch):
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cpu")


def count_lora_modules(model) -> dict[str, Any]:
    rows = []
    for name, module in model.named_modules():
        cls_name = module.__class__.__name__
        cls_lower = cls_name.lower()
        if "lora" in cls_lower:
            rows.append(
                {
                    "name": name,
                    "class": cls_name,
                }
            )
    return {
        "count": len(rows),
        "rows": rows[:300],
    }


def run_forward_smoke(model, tokenizer, texts, max_seq_len: int, device, torch) -> dict[str, Any]:
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

            logits = out.logits.detach()
            logits_stats = tensor_stats(logits)
            last_token_logits = logits[:, -1, :]
            last_token_stats = tensor_stats(last_token_logits)

            hidden_rows = []
            hidden_states = getattr(out, "hidden_states", None)
            if hidden_states:
                for h_idx, hs in enumerate(hidden_states[: min(len(hidden_states), 8)]):
                    hs_stats = tensor_stats(hs.detach())
                    hidden_rows.append(
                        {
                            "index": h_idx,
                            "absmax": hs_stats["absmax"],
                            "min": hs_stats["min"],
                            "max": hs_stats["max"],
                            "hasNaN": hs_stats["hasNaN"],
                            "hasInf": hs_stats["hasInf"],
                            "shape": hs_stats["shape"],
                        }
                    )

            topk_vals, topk_ids = torch.topk(last_token_logits[0].float(), k=min(5, last_token_logits.shape[-1]))
            topk_tokens = []
            for tok_id, tok_val in zip(topk_ids.tolist(), topk_vals.tolist()):
                try:
                    tok_text = tokenizer.decode([tok_id])
                except Exception:
                    tok_text = ""
                topk_tokens.append(
                    {
                        "id": int(tok_id),
                        "text": tok_text,
                        "logit": float(tok_val),
                    }
                )

            row = {
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
                "lastTokenLogits": {
                    "shape": last_token_stats["shape"],
                    "absmax": last_token_stats["absmax"],
                    "min": last_token_stats["min"],
                    "max": last_token_stats["max"],
                    "hasNaN": last_token_stats["hasNaN"],
                    "hasInf": last_token_stats["hasInf"],
                    "topTokens": topk_tokens,
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


def compare_last_token_logits(model_a, model_b, tokenizer, texts, max_seq_len, device_a, device_b, torch):
    rows = []

    model_a.eval()
    model_b.eval()

    for idx, text in enumerate(texts):
        try:
            enc_a = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=max_seq_len,
                padding=False,
            )
            enc_b = {k: v.to(device_b) for k, v in enc_a.items()}
            enc_a = {k: v.to(device_a) for k, v in enc_a.items()}

            with torch.no_grad():
                out_a = model_a(
                    **enc_a,
                    use_cache=False,
                    return_dict=True,
                )
                out_b = model_b(
                    **enc_b,
                    use_cache=False,
                    return_dict=True,
                )

            la = out_a.logits[:, -1, :].detach().float().cpu()
            lb = out_b.logits[:, -1, :].detach().float().cpu()
            delta = la - lb

            greedy_a = int(torch.argmax(la, dim=-1).item())
            greedy_b = int(torch.argmax(lb, dim=-1).item())

            rows.append(
                {
                    "sampleIndex": idx,
                    "textPreview": text[:300],
                    "greedyTokenA": greedy_a,
                    "greedyTokenB": greedy_b,
                    "greedyTokenAText": tokenizer.decode([greedy_a]),
                    "greedyTokenBText": tokenizer.decode([greedy_b]),
                    "sameGreedy": greedy_a == greedy_b,
                    "deltaAbsMax": float(delta.abs().max().item()),
                    "deltaMean": float(delta.mean().item()),
                    "deltaStd": float(delta.std().item()) if delta.numel() > 1 else 0.0,
                    "deltaL2": float(torch.norm(delta).item()),
                    "hasNaN": bool(torch.isnan(delta).any().item()),
                    "hasInf": bool(torch.isinf(delta).any().item()),
                }
            )
        except Exception as exc:
            rows.append(
                {
                    "sampleIndex": idx,
                    "textPreview": text[:300],
                    "error": str(exc),
                }
            )

    return {
        "count": len(rows),
        "rows": rows,
    }


def generate_preview(model, tokenizer, texts, device, torch, max_input_len=256, max_new_tokens=24):
    rows = []
    model.eval()

    for idx, text in enumerate(texts):
        try:
            encoded = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=max_input_len,
                padding=False,
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}

            with torch.no_grad():
                generated = model.generate(
                    **encoded,
                    do_sample=False,
                    max_new_tokens=max_new_tokens,
                    use_cache=True,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )

            decoded = tokenizer.decode(generated[0], skip_special_tokens=True)
            rows.append(
                {
                    "sampleIndex": idx,
                    "prompt": text,
                    "output": decoded,
                }
            )
        except Exception as exc:
            rows.append(
                {
                    "sampleIndex": idx,
                    "prompt": text,
                    "error": str(exc),
                }
            )

    return {
        "count": len(rows),
        "rows": rows,
    }


def collect_merge_delta_stats(base_model_clean, merged_model) -> dict[str, Any]:
    base_state = dict(base_model_clean.named_parameters())
    merged_state = dict(merged_model.named_parameters())

    rows = []
    global_delta_absmax = 0.0
    changed_count = 0
    unchanged_count = 0

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
        "lm_head.weight",
        "model.norm.weight",
    ]

    for name, merged_param in merged_state.items():
        base_param = base_state.get(name)
        if base_param is None:
            continue
        if merged_param.shape != base_param.shape:
            continue

        delta = merged_param.detach().float().cpu() - base_param.detach().float().cpu()
        stats = tensor_stats(delta)
        absmax = stats["absmax"] or 0.0
        global_delta_absmax = max(global_delta_absmax, absmax)

        if absmax > 0:
            changed_count += 1
        else:
            unchanged_count += 1

        if any(name.endswith(s) for s in interesting_suffixes):
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

    rows_sorted = sorted(rows, key=lambda x: (x["deltaAbsMax"] or 0.0), reverse=True)

    return {
        "changedTensorCount": changed_count,
        "unchangedTensorCount": unchanged_count,
        "globalDeltaAbsMax": global_delta_absmax,
        "topChangedRows": rows_sorted[:200],
        "smallestChangedRows": [r for r in reversed(rows_sorted[-50:])],
    }


def load_base_model(base_model_path, dtype, device_map, low_cpu_mem_usage, offload_dir, trust_remote_code, AutoModelForCausalLM):
    kwargs = {
        "torch_dtype": dtype,
        "device_map": device_map,
        "low_cpu_mem_usage": low_cpu_mem_usage,
        "trust_remote_code": trust_remote_code,
    }
    if offload_dir is not None and device_map != "cpu":
        kwargs["offload_folder"] = offload_dir
    return AutoModelForCausalLM.from_pretrained(base_model_path, **kwargs)


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

    # Доп. режимы диагностики
    load_clean_base_for_diff = bool(cfg.get("loadCleanBaseForDiff", True))
    clean_base_dtype_name = str(cfg.get("cleanBaseDtype", "float32")).strip()
    clean_base_on_cpu = bool(cfg.get("cleanBaseOnCpu", True))
    run_generation_checks = bool(cfg.get("runGenerationChecks", True))
    generation_max_new_tokens = int(cfg.get("generationMaxNewTokens", 24))
    smoke_max_seq_len = int(cfg.get("smokeMaxSeqLen", 512))

    maybe_clear_output_dir(output_dir, overwrite_output)
    offload_dir = os.path.join(output_dir, offload_folder_name)
    os.makedirs(offload_dir, exist_ok=True)

    report(5)

    import torch
    import transformers
    import peft

    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    try:
        import accelerate
        accelerate_version = accelerate.__version__
    except Exception:
        accelerate_version = "unknown"

    report(10)

    dtype = resolve_dtype(cfg.get("dtype", "auto"), torch)
    device_map = resolve_device_map(cfg, torch)
    base_model_path = resolve_base_model_path(adapter_path, base_model_override)

    clean_base_dtype = resolve_dtype(clean_base_dtype_name, torch)
    clean_base_device_map = "cpu" if clean_base_on_cpu else device_map

    log_event(
        "library_versions",
        torch=torch.__version__,
        transformers=transformers.__version__,
        peft=peft.__version__,
        accelerate=accelerate_version,
    )

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
        loadCleanBaseForDiff=load_clean_base_for_diff,
        cleanBaseDtype=dtype_name(clean_base_dtype),
        cleanBaseDeviceMap=clean_base_device_map,
        runGenerationChecks=run_generation_checks,
        generationMaxNewTokens=generation_max_new_tokens,
        smokeMaxSeqLen=smoke_max_seq_len,
    )

    adapter_config = read_adapter_config(adapter_path)
    log_event("adapter_config", **adapter_config)

    report(20)

    tokenizer = AutoTokenizer.from_pretrained(
        base_model_path,
        trust_remote_code=trust_remote_code,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    base_model_clean = None
    if load_clean_base_for_diff:
        log_event(
            "clean_base_load_start",
            baseModelPath=base_model_path,
            dtype=dtype_name(clean_base_dtype),
            deviceMap=clean_base_device_map,
        )
        base_model_clean = load_base_model(
            base_model_path=base_model_path,
            dtype=clean_base_dtype,
            device_map=clean_base_device_map,
            low_cpu_mem_usage=False,
            offload_dir=None,
            trust_remote_code=trust_remote_code,
            AutoModelForCausalLM=AutoModelForCausalLM,
        )
        clean_device = detect_device(base_model_clean, torch)
        log_event("clean_base_model_health", **collect_parameter_health(base_model_clean))
        log_event("clean_base_model_weights", **collect_module_weight_summary(base_model_clean))
        log_event(
            "clean_base_forward",
            **run_forward_smoke(
                model=base_model_clean,
                tokenizer=tokenizer,
                texts=choose_probe_texts(),
                max_seq_len=smoke_max_seq_len,
                device=clean_device,
                torch=torch,
            ),
        )

    report(35)

    log_event(
        "base_model_load_start",
        baseModelPath=base_model_path,
        dtype=dtype_name(dtype),
        deviceMap=device_map,
        lowCpuMemUsage=low_cpu_mem_usage,
    )

    base_model = load_base_model(
        base_model_path=base_model_path,
        dtype=dtype,
        device_map=device_map,
        low_cpu_mem_usage=low_cpu_mem_usage,
        offload_dir=offload_dir,
        trust_remote_code=trust_remote_code,
        AutoModelForCausalLM=AutoModelForCausalLM,
    )

    base_device = detect_device(base_model, torch)

    log_event("base_model_health_before_peft", **collect_parameter_health(base_model))
    log_event("base_model_weights_before_peft", **collect_module_weight_summary(base_model))
    log_event("base_model_lora_modules_before_peft", **count_lora_modules(base_model))
    log_event(
        "base_model_forward_before_peft",
        **run_forward_smoke(
            model=base_model,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=smoke_max_seq_len,
            device=base_device,
            torch=torch,
        ),
    )

    report(50)

    log_event("peft_load_start", adapterPath=adapter_path)
    model = PeftModel.from_pretrained(
        base_model,
        adapter_path,
        device_map=device_map,
        offload_folder=offload_dir,
    )

    peft_device = detect_device(model, torch)

    log_event("peft_model_health_before_merge", **collect_parameter_health(model))
    log_event("peft_model_weights_before_merge", **collect_module_weight_summary(model))
    log_event("peft_model_lora_modules_before_merge", **count_lora_modules(model))
    log_event(
        "peft_forward_before_merge",
        **run_forward_smoke(
            model=model,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=smoke_max_seq_len,
            device=peft_device,
            torch=torch,
        ),
    )

    if run_generation_checks:
        log_event(
            "peft_generation_preview_before_merge",
            **generate_preview(
                model=model,
                tokenizer=tokenizer,
                texts=[
                    "Explain what a transformer is in one sentence.",
                    "The capital of Germany is",
                    "List three colors:",
                ],
                device=peft_device,
                torch=torch,
                max_input_len=min(smoke_max_seq_len, 256),
                max_new_tokens=generation_max_new_tokens,
            ),
        )

    if base_model_clean is not None:
        clean_device = detect_device(base_model_clean, torch)
        log_event(
            "compare_clean_vs_peft_last_token_logits",
            **compare_last_token_logits(
                model_a=base_model_clean,
                model_b=model,
                tokenizer=tokenizer,
                texts=choose_probe_texts(),
                max_seq_len=smoke_max_seq_len,
                device_a=clean_device,
                device_b=peft_device,
                torch=torch,
            ),
        )

    report(65)

    log_event("merge_start")
    merged = model.merge_and_unload()
    merged_device = detect_device(merged, torch)

    report(75)

    log_event("merged_model_health", **collect_parameter_health(merged))
    log_event("merged_model_weights", **collect_module_weight_summary(merged))
    log_event("merged_model_lora_modules_after_merge", **count_lora_modules(merged))
    log_event(
        "merged_forward_after_merge",
        **run_forward_smoke(
            model=merged,
            tokenizer=tokenizer,
            texts=choose_probe_texts(),
            max_seq_len=smoke_max_seq_len,
            device=merged_device,
            torch=torch,
        ),
    )

    if run_generation_checks:
        log_event(
            "merged_generation_preview_after_merge",
            **generate_preview(
                model=merged,
                tokenizer=tokenizer,
                texts=[
                    "Explain what a transformer is in one sentence.",
                    "The capital of Germany is",
                    "List three colors:",
                ],
                device=merged_device,
                torch=torch,
                max_input_len=min(smoke_max_seq_len, 256),
                max_new_tokens=generation_max_new_tokens,
            ),
        )

    report(82)

    if base_model_clean is not None:
        clean_device = detect_device(base_model_clean, torch)

        log_event(
            "merge_delta_stats_against_clean_base",
            **collect_merge_delta_stats(base_model_clean, merged),
        )

        log_event(
            "compare_clean_vs_merged_last_token_logits",
            **compare_last_token_logits(
                model_a=base_model_clean,
                model_b=merged,
                tokenizer=tokenizer,
                texts=choose_probe_texts(),
                max_seq_len=smoke_max_seq_len,
                device_a=clean_device,
                device_b=merged_device,
                torch=torch,
            ),
        )

        log_event(
            "compare_peft_vs_merged_last_token_logits",
            **compare_last_token_logits(
                model_a=model,
                model_b=merged,
                tokenizer=tokenizer,
                texts=choose_probe_texts(),
                max_seq_len=smoke_max_seq_len,
                device_a=peft_device,
                device_b=merged_device,
                torch=torch,
            ),
        )

    report(88)

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
        "loadCleanBaseForDiff": load_clean_base_for_diff,
        "cleanBaseDtype": dtype_name(clean_base_dtype),
        "cleanBaseDeviceMap": clean_base_device_map,
        "runGenerationChecks": run_generation_checks,
        "generationMaxNewTokens": generation_max_new_tokens,
        "smokeMaxSeqLen": smoke_max_seq_len,
    }
    save_result(output_dir, result)

    report(100)
    log_event("merge_success", **result)
    print(f"__RESULT__:{output_dir}")
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        traceback.print_exc()
        log_event(
            "merge_failure",
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        sys.exit(1)