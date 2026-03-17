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

    maybe_clear_output_dir(output_dir, overwrite_output)
    offload_dir = os.path.join(output_dir, offload_folder_name)
    os.makedirs(offload_dir, exist_ok=True)

    report(5)

    import torch
    from peft import AutoPeftModelForCausalLM
    from transformers import AutoTokenizer

    report(15)

    dtype = resolve_dtype(cfg.get("dtype", "auto"), torch)
    device_map = resolve_device_map(cfg, torch)

    print(json.dumps({
        "adapterPath": adapter_path,
        "outputDir": output_dir,
        "deviceStrategy": cfg.get("deviceStrategy", "cpu"),
        "resolvedDeviceMap": device_map,
        "dtype": str(cfg.get("dtype", "auto")),
        "lowCpuMemUsage": low_cpu_mem_usage,
        "safeSerialization": safe_serialization,
        "maxShardSize": max_shard_size,
        "trustRemoteCode": trust_remote_code,
    }, ensure_ascii=False), flush=True)

    report(25)

    model = AutoPeftModelForCausalLM.from_pretrained(
        adapter_path,
        dtype=dtype,
        device_map=device_map,
        low_cpu_mem_usage=low_cpu_mem_usage,
        offload_folder=offload_dir,
        trust_remote_code=trust_remote_code,
    )

    report(55)

    merged = model.merge_and_unload()

    report(75)

    merged.save_pretrained(
        output_dir,
        safe_serialization=safe_serialization,
        max_shard_size=max_shard_size,
    )

    report(90)

    try:
        tokenizer = AutoTokenizer.from_pretrained(
            adapter_path,
            trust_remote_code=trust_remote_code,
            fix_mistral_regex=True,
        )
    except TypeError:
        tokenizer = AutoTokenizer.from_pretrained(
            adapter_path,
            trust_remote_code=trust_remote_code,
        )

    tokenizer.save_pretrained(output_dir)

    result = {
        "ok": True,
        "adapterPath": adapter_path,
        "outputDir": output_dir,
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
    except Exception as e:
        traceback.print_exc()
        print(str(e), file=sys.stderr)
        sys.exit(1)