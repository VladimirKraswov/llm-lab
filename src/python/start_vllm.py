#!/usr/bin/env python3
"""
start_vllm.py — безопасный и надёжный запуск vLLM сервера
с валидацией конфигурации и понятным логированием.
"""

import json
import os
import sys
import subprocess
import shlex
from pathlib import Path
from typing import Dict, Any, List, Optional


def eprint(*args, **kwargs):
    """Печать в stderr с префиксом"""
    print("[start_vllm]", *args, file=sys.stderr, **kwargs)


def validate_config(cfg: Dict[str, Any]) -> None:
    """Валидация всех ключевых параметров"""
    required = {"vllmBin", "model", "port"}
    missing = required - set(cfg.keys())
    if missing:
        raise ValueError(f"Отсутствуют обязательные поля в конфиге: {', '.join(missing)}")

    model_path = Path(cfg["model"])
    if not model_path.is_dir():
        raise ValueError(f"Директория модели не существует: {model_path}")

    config_json = model_path / "config.json"
    if not config_json.is_file():
        raise FileNotFoundError(
            f"Файл config.json не найден в директории модели: {model_path}\n"
            "vLLM не сможет запуститься без этого файла."
        )

    port = cfg.get("port")
    if not isinstance(port, int) or not (1 <= port <= 65535):
        raise ValueError(f"Порт должен быть целым числом от 1 до 65535, получено: {port}")

    # Дополнительные проверки (можно расширить)
    if cfg.get("gpuMemoryUtilization", 0.9) not in {float(x) for x in range(1, 101)} / 100:
        eprint("Предупреждение: gpuMemoryUtilization вне диапазона 0.01–1.00")


def build_vllm_args(cfg: Dict[str, Any]) -> List[str]:
    """Собирает аргументы командной строки для vLLM"""
    model_path = str(Path(cfg["model"]).resolve())  # всегда абсолютный путь

    args = [
        cfg["vllmBin"],
        "serve",
        model_path,
        "--host", cfg.get("host", "0.0.0.0"),
        "--port", str(cfg["port"]),
        "--gpu-memory-utilization", str(cfg.get("gpuMemoryUtilization", 0.9)),
        "--tensor-parallel-size", str(cfg.get("tensorParallelSize", 1)),
        "--max-model-len", str(cfg.get("maxModelLen", 8192)),
        "--max-num-seqs", str(cfg.get("maxNumSeqs", 256)),
        "--swap-space", str(cfg.get("swapSpace", 4)),
        "--dtype", str(cfg.get("dtype", "auto")),
    ]

    if quantization := cfg.get("quantization"):
        args.extend(["--quantization", str(quantization)])

    if cfg.get("trustRemoteCode", True):
        args.append("--trust-remote-code")

    if cfg.get("enforceEager", False):
        args.append("--enforce-eager")

    if kv_cache_dtype := cfg.get("kvCacheDtype"):
        if kv_cache_dtype != "auto":
            args.extend(["--kv-cache-dtype", str(kv_cache_dtype)])

    if lora_path := cfg.get("loraPath"):
        if lora_name := cfg.get("loraName"):
            args.extend(["--enable-lora", "--lora-modules", f"{lora_name}={lora_path}"])
        else:
            eprint("Предупреждение: loraPath указан, но loraName отсутствует → LoRA не будет загружен")

    return args


def main():
    if len(sys.argv) != 2:
        eprint("Использование: start_vllm.py <путь_к_config.json>")
        sys.exit(2)

    config_path = sys.argv[1]
    if not os.path.isfile(config_path):
        eprint(f"Файл конфигурации не найден: {config_path}")
        sys.exit(1)

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        eprint(f"Ошибка чтения конфигурации: {e}")
        sys.exit(1)

    try:
        validate_config(cfg)
    except Exception as e:
        eprint(f"Ошибка валидации конфигурации: {e}")
        sys.exit(1)

    args = build_vllm_args(cfg)
    cwd = cfg.get("cwd") or os.getcwd()

    print("Запуск vLLM с аргументами:", shlex.join(args), flush=True)
    print(f"Рабочая директория: {cwd}", flush=True)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    try:
        os.chdir(cwd)
        # Заменяем текущий процесс → логи vLLM будут идти прямо в наш stdout/stderr
        os.execvpe(args[0], args, env)
    except Exception as e:
        eprint(f"Не удалось запустить vLLM: {e}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nПрервано пользователем", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"Критическая ошибка: {e}", file=sys.stderr)
        sys.exit(1)