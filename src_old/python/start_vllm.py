#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
start_vllm.py — надёжный запуск vLLM с полной валидацией и защитой от ошибок
Исправлены все известные проблемы с локальными путями и валидацией
"""

import json
import os
import sys
import shlex
from pathlib import Path
from typing import Dict, Any, List


def eprint(*args, **kwargs):
    print("[start_vllm]", *args, file=sys.stderr, **kwargs)


def validate_and_normalize_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Валидация + нормализация конфига"""
    required = {"vllmBin", "model", "port"}
    missing = required - set(cfg)
    if missing:
        raise ValueError(f"Отсутствуют обязательные поля: {', '.join(missing)}")

    # Нормализация пути модели — всегда абсолютный
    model_path = Path(cfg["model"]).resolve()
    cfg["model"] = str(model_path)  # перезаписываем в cfg

    if not model_path.is_dir():
        raise NotADirectoryError(f"Путь к модели не является директорией: {model_path}")

    config_json = model_path / "config.json"
    if not config_json.is_file():
        raise FileNotFoundError(
            f"config.json не найден в директории модели.\n"
            f"Путь: {config_json}\n"
            f"vLLM не запустится без этого файла!"
        )

    port = cfg.get("port")
    if not isinstance(port, (int, float)) or not (1 <= port <= 65535):
        raise ValueError(f"Порт должен быть числом 1–65535, получено: {port}")

    # gpu-memory-utilization: приводим к float 0.0–1.0
    gpu_util = cfg.get("gpuMemoryUtilization", 0.9)
    if not isinstance(gpu_util, (int, float)) or not (0.01 <= gpu_util <= 1.0):
        eprint(f"Некорректный gpuMemoryUtilization {gpu_util} → исправлено на 0.90")
        cfg["gpuMemoryUtilization"] = 0.9

    # tensor-parallel-size: минимум 1
    tps = cfg.get("tensorParallelSize", 1)
    if not isinstance(tps, int) or tps < 1:
        cfg["tensorParallelSize"] = 1

    return cfg


def build_vllm_arguments(cfg: Dict[str, Any]) -> List[str]:
    """Сборка аргументов для vLLM — безопасно и явно"""
    args = [
        cfg["vllmBin"],
        "serve",
        cfg["model"],  # уже абсолютный и проверенный путь
        "--host", cfg.get("host", "0.0.0.0"),
        "--port", str(int(cfg["port"])),
        "--gpu-memory-utilization", f"{cfg.get('gpuMemoryUtilization', 0.9):.2f}",
        "--tensor-parallel-size", str(cfg.get("tensorParallelSize", 1)),
        "--max-model-len", str(cfg.get("maxModelLen", 8192)),
        "--max-num-seqs", str(cfg.get("maxNumSeqs", 256)),
        "--swap-space", str(cfg.get("swapSpace", 4)),
        "--dtype", str(cfg.get("dtype", "auto")),
    ]

    # quantization — передаём только если явно задан и не null
    if quant := cfg.get("quantization"):
        if quant and quant.lower() not in ("none", "null", ""):
            args.extend(["--quantization", str(quant)])

    if cfg.get("trustRemoteCode", True):
        args.append("--trust-remote-code")

    if cfg.get("enforceEager", False):
        args.append("--enforce-eager")

    if kv := cfg.get("kvCacheDtype"):
        if kv and kv.lower() != "auto":
            args.extend(["--kv-cache-dtype", str(kv)])

    # LoRA — только если оба параметра заданы
    if lora_path := cfg.get("loraPath"):
        if lora_name := cfg.get("loraName"):
            args.extend(["--enable-lora", "--lora-modules", f"{lora_name}={lora_path}"])
        else:
            eprint("Предупреждение: loraPath указан, но loraName отсутствует → LoRA не загружается")

    return args


def main():
    if len(sys.argv) != 2:
        eprint("Использование: start_vllm.py <путь_к_config.json>")
        sys.exit(2)

    config_file = sys.argv[1]
    if not Path(config_file).is_file():
        eprint(f"Файл конфигурации не найден: {config_file}")
        sys.exit(1)

    try:
        with open(config_file, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        eprint(f"Не удалось прочитать конфиг {config_file}: {e}")
        sys.exit(1)

    try:
        cfg = validate_and_normalize_config(cfg)
    except Exception as e:
        eprint(f"Ошибка проверки конфигурации:\n{e}")
        sys.exit(1)

    args = build_vllm_arguments(cfg)
    cwd = cfg.get("cwd") or os.getcwd()

    print("Запуск vLLM:", shlex.join(args))
    print(f"Рабочая директория: {cwd}")
    print(f"Модель (абсолютный путь): {cfg['model']}")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    try:
        os.chdir(cwd)
        os.execvpe(args[0], args, env)
    except FileNotFoundError:
        eprint(f"Исполняемый файл vLLM не найден: {args[0]}")
        sys.exit(127)
    except PermissionError:
        eprint(f"Нет прав на запуск: {args[0]}")
        sys.exit(126)
    except Exception as e:
        eprint(f"Критическая ошибка при запуске vLLM:\n{e}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        eprint("Прервано пользователем")
        sys.exit(130)
    except Exception as e:
        eprint(f"Необработанная ошибка:\n{e}")
        sys.exit(1)