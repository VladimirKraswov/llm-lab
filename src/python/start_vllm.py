import json
import os
import sys
import subprocess


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: start_vllm.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    vllm_bin = cfg["vllmBin"]
    model = cfg["model"]
    host = cfg.get("host", "0.0.0.0")
    port = int(cfg["port"])
    gpu_memory_utilization = cfg.get("gpuMemoryUtilization", 0.9)
    tensor_parallel_size = int(cfg.get("tensorParallelSize", 1))
    max_model_len = int(cfg.get("maxModelLen", 8192))
    max_num_seqs = int(cfg.get("maxNumSeqs", 256))
    swap_space = int(cfg.get("swapSpace", 4))
    dtype = cfg.get("dtype", "auto")
    quantization = cfg.get("quantization")
    trust_remote_code = bool(cfg.get("trustRemoteCode", True))
    enforce_eager = bool(cfg.get("enforceEager", False))
    kv_cache_dtype = cfg.get("kvCacheDtype", "auto")
    lora_path = cfg.get("loraPath")
    lora_name = cfg.get("loraName")
    cwd = cfg.get("cwd") or os.getcwd()

    args = [
        vllm_bin,
        "serve",
        model,
        "--host",
        host,
        "--port",
        str(port),
        "--gpu-memory-utilization",
        str(gpu_memory_utilization),
        "--tensor-parallel-size",
        str(tensor_parallel_size),
        "--max-model-len",
        str(max_model_len),
        "--max-num-seqs",
        str(max_num_seqs),
        "--swap-space",
        str(swap_space),
        "--dtype",
        str(dtype or "auto"),
    ]

    if quantization:
        args.extend(["--quantization", str(quantization)])

    if trust_remote_code:
        args.append("--trust-remote-code")

    if enforce_eager:
        args.append("--enforce-eager")

    if kv_cache_dtype and kv_cache_dtype != "auto":
        args.extend(["--kv-cache-dtype", str(kv_cache_dtype)])

    if lora_path and lora_name:
        args.extend(["--enable-lora", "--lora-modules", f"{lora_name}={lora_path}"])

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    # Замещаем текущий процесс процессом vLLM
    os.chdir(cwd)
    os.execvpe(vllm_bin, args, env)


if __name__ == "__main__":
    main()