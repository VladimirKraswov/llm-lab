import json
import os
import sys
import traceback

from transformers import AutoModelForCausalLM, AutoTokenizer
from llmcompressor import oneshot
from llmcompressor.modifiers.awq import AWQModifier


def report(p: int):
    print(f"__PROGRESS__:{p}", flush=True)


def build_local_text_dataset(dataset_path: str | None, num_samples: int):
    if not dataset_path or not os.path.exists(dataset_path):
        return "open_platypus"

    rows: list[str] = []
    with open(dataset_path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= num_samples:
                break

            line = line.strip()
            if not line:
                continue

            item = json.loads(line)

            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    rows.append(text)
                    continue

                messages = item.get("messages")
                if isinstance(messages, list):
                    parts = []
                    for msg in messages:
                        if not isinstance(msg, dict):
                            continue
                        role = str(msg.get("role", "")).strip()
                        content = str(msg.get("content", "")).strip()
                        if content:
                            parts.append(f"{role}: {content}" if role else content)
                    if parts:
                        rows.append("\n".join(parts))
                        continue

                if "instruction" in item and "output" in item:
                    rows.append(f"{item.get('instruction', '')}\n\n{item.get('output', '')}")
                    continue

                if "prompt" in item and "completion" in item:
                    rows.append(f"{item.get('prompt', '')}\n\n{item.get('completion', '')}")
                    continue

            rows.append(str(item))

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


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: quantize_llm_compressor.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    model_path = cfg["modelPath"]
    output_dir = cfg["outputDir"]
    method = str(cfg.get("method", "awq")).lower()
    dataset_path = cfg.get("datasetPath")
    num_samples = int(cfg.get("numSamples", 128))
    max_seq_len = int(cfg.get("maxSeqLen", 2048))
    bits = int(cfg.get("bits", 4))
    group_size = int(cfg.get("groupSize", 128))
    sym = bool(cfg.get("sym", False))
    trust_remote_code = bool(cfg.get("trustRemoteCode", True))

    if method != "awq":
        raise ValueError(
            f"quantize_llm_compressor.py currently supports only method='awq', got: {method}"
        )

    validate_awq_params(bits, group_size)

    os.makedirs(output_dir, exist_ok=True)
    report(5)

    tokenizer = AutoTokenizer.from_pretrained(
        model_path,
        trust_remote_code=trust_remote_code,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    report(15)

    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        dtype="auto",
        trust_remote_code=trust_remote_code,
    )

    report(35)

    dataset = build_local_text_dataset(dataset_path, num_samples)

    report(50)

    recipe = build_awq_recipe(bits=bits, group_size=group_size, sym=sym)

    report(65)

    oneshot(
        model=model,
        dataset=dataset,
        recipe=recipe,
        output_dir=output_dir,
        max_seq_length=max_seq_len,
        num_calibration_samples=num_samples,
    )

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