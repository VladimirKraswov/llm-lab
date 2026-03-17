import json
import math
import os
import sys
import traceback

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from llmcompressor import oneshot
from llmcompressor.modifiers.awq import AWQModifier


def report(p: int):
    print(f"__PROGRESS__:{p}", flush=True)


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


def _safe_num_samples(value: int) -> int:
    return max(8, min(int(value), 128))


def _safe_max_seq_len(value: int) -> int:
    return max(256, min(int(value), 2048))


def check_model_for_invalid_values(model):
    bad = []

    for name, param in model.named_parameters():
      # noqa: E111
        if param is None:
            continue
        data = param.data
        if torch.isnan(data).any().item():
            bad.append(f"{name}: NaN")
        elif torch.isinf(data).any().item():
            bad.append(f"{name}: Inf")

        if len(bad) >= 10:
            break

    if bad:
        raise RuntimeError(
            "Model contains invalid parameter values before AWQ starts: " + "; ".join(bad)
        )


def build_awq_recipe(bits: int, group_size: int, sym: bool):
    return [
        AWQModifier(
            ignore=[
                "lm_head",
                "re:.*post_attention_layernorm$",
                "re:.*rotary_emb.*",
            ],
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


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: quantize_llm_compressor.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    model_path = cfg["modelPath"]
    output_dir = cfg["outputDir"]
    method = str(cfg.get("method", "awq")).lower()
    dataset_path = cfg.get("datasetPath")
    num_samples = _safe_num_samples(int(cfg.get("numSamples", 32)))
    max_seq_len = _safe_max_seq_len(int(cfg.get("maxSeqLen", 1024)))
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

    print(
        json.dumps(
            {
                "modelPath": model_path,
                "outputDir": output_dir,
                "datasetPath": dataset_path,
                "numSamples": num_samples,
                "maxSeqLen": max_seq_len,
                "bits": bits,
                "groupSize": group_size,
                "sym": sym,
                "dtype": str(cfg.get("dtype", "float16")),
                "calibrationMode": calibration_mode,
                "trustRemoteCode": trust_remote_code,
            },
            ensure_ascii=False,
        ),
        flush=True,
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

    model.eval()
    check_model_for_invalid_values(model)

    report(35)

    dataset = build_local_text_dataset(
        dataset_path=dataset_path,
        num_samples=num_samples,
        calibration_mode=calibration_mode,
    )

    if isinstance(dataset, list):
        dataset = [x for x in dataset if x and x.strip()]
        dataset = dataset[:num_samples]

    print(
        json.dumps(
            {
                "resolvedDatasetType": "local_list" if isinstance(dataset, list) else dataset,
                "resolvedSamples": len(dataset) if isinstance(dataset, list) else num_samples,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    report(50)

    recipe = build_awq_recipe(bits=bits, group_size=group_size, sym=sym)

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
        message = str(exc)
        if "No finite loss was found in best scalesgrid search" in message or "No finite loss was found" in message:
            raise RuntimeError(
                "AWQ failed during smoothing because the model produced non-finite values "
                "on one of the smoothing targets. This model is numerically unstable for the "
                "default AWQ smoothing path. Try safer settings: dtype=float16, "
                "calibrationMode=text_only, numSamples=16..32, maxSeqLen=512..1024, "
                "or skip AWQ for this model."
            ) from exc
        raise

    report(95)

    tokenizer.save_pretrained(output_dir)

    report(100)
    print(f"__RESULT__:{output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)