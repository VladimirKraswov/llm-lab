import json
import os
import sys
import torch
from llmcompressor.transformers import SparseAutoModelForCausalLM, oneshot
from transformers import AutoTokenizer


def report(p):
    print(f"__PROGRESS__:{p}", flush=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: quantize_llm_compressor.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    model_path = cfg["modelPath"]
    output_dir = cfg["outputDir"]
    method = cfg.get("method", "awq")  # awq, fp8, int8
    dataset_path = cfg.get("datasetPath")
    num_samples = cfg.get("numSamples", 128)
    max_seq_len = cfg.get("maxSeqLen", 2048)
    bits = cfg.get("bits", 4)
    group_size = cfg.get("groupSize", 128)
    sym = cfg.get("sym", True)
    trust_remote_code = bool(cfg.get("trustRemoteCode", True))

    os.makedirs(output_dir, exist_ok=True)
    report(5)

    # Resolve quantization scheme based on method
    if method == "awq":
        scheme = f"W{bits}A16"
    elif method == "fp8":
        scheme = "FP8"
    elif method == "int8":
        scheme = "W8A8"
    else:
        scheme = method

    report(10)

    device_map = "auto" if torch.cuda.is_available() else "cpu"

    report(15)
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=trust_remote_code)
    model = SparseAutoModelForCausalLM.from_pretrained(
        model_path,
        device_map=device_map,
        torch_dtype="auto",
        trust_remote_code=trust_remote_code
    )
    report(40)

    dataset = None
    if dataset_path and os.path.exists(dataset_path):
        with open(dataset_path, "r", encoding="utf-8") as f:
            data = [json.loads(line) for line in f]

        dataset = []
        for item in data[:num_samples]:
            if "text" in item:
                dataset.append(item["text"])
            elif "instruction" in item and "output" in item:
                dataset.append(f"{item['instruction']}\n\n{item['output']}")
            else:
                dataset.append(str(item))

    report(50)

    oneshot(
        model=model,
        tokenizer=tokenizer,
        dataset=dataset if dataset else "open-platypus",
        recipe={
            "quantization": {
                "scheme": scheme,
                "group_size": group_size,
                "symmetric": sym,
            }
        },
        num_samples=num_samples,
        max_seq_len=max_seq_len,
        output_dir=output_dir,
    )
    report(95)

    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    report(100)
    print(f"__RESULT__:{output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(str(e), file=sys.stderr)
        sys.exit(1)
