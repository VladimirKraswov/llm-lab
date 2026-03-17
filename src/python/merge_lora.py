import json
import os
import shutil
import sys
import traceback

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")


def report(p: int):
    print(f"__PROGRESS__:{p}", flush=True)


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
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    report(15)

    dtype = resolve_dtype(cfg.get("dtype", "auto"), torch)
    device_map = resolve_device_map(cfg, torch)
    base_model_path = resolve_base_model_path(adapter_path, base_model_override)

    print(json.dumps({
        "adapterPath": adapter_path,
        "outputDir": output_dir,
        "baseModelPath": base_model_path,
        "baseModelOverride": base_model_override,
        "deviceStrategy": cfg.get("deviceStrategy", "cpu"),
        "resolvedDeviceMap": device_map,
        "dtype": str(cfg.get("dtype", "auto")),
        "lowCpuMemUsage": low_cpu_mem_usage,
        "safeSerialization": safe_serialization,
        "maxShardSize": max_shard_size,
        "trustRemoteCode": trust_remote_code,
    }, ensure_ascii=False), flush=True)

    report(25)

    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_path,
        dtype=dtype,
        device_map=device_map,
        low_cpu_mem_usage=low_cpu_mem_usage,
        offload_folder=offload_dir,
        trust_remote_code=trust_remote_code,
    )

    report(50)

    model = PeftModel.from_pretrained(
        base_model,
        adapter_path,
        device_map=device_map,
        offload_folder=offload_dir,
    )

    report(70)

    merged = model.merge_and_unload()

    report(82)

    merged.save_pretrained(
        output_dir,
        safe_serialization=safe_serialization,
        max_shard_size=max_shard_size,
    )

    report(92)

    try:
        tokenizer = AutoTokenizer.from_pretrained(
            base_model_path,
            trust_remote_code=trust_remote_code,
            fix_mistral_regex=True,
        )
    except TypeError:
        tokenizer = AutoTokenizer.from_pretrained(
            base_model_path,
            trust_remote_code=trust_remote_code,
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
        "dtype": str(cfg.get("dtype", "auto")),
        "lowCpuMemUsage": low_cpu_mem_usage,
        "safeSerialization": safe_serialization,
        "maxShardSize": max_shard_size,
        "trustRemoteCode": trust_remote_code,
    }
    save_result(output_dir, result)

    report(100)
    print(f"__RESULT__:{output_dir}")
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)