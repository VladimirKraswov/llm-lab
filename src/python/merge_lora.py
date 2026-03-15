import json
import os
import sys

def report(p):
    print(f"__PROGRESS__:{p}", flush=True)

def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: merge_lora.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    adapter_path = cfg["adapterPath"]
    output_dir = cfg["outputDir"]

    os.makedirs(output_dir, exist_ok=True)
    report(10)

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    report(15)

    from peft import AutoPeftModelForCausalLM
    from transformers import AutoTokenizer
    report(20)

    model = AutoPeftModelForCausalLM.from_pretrained(
        adapter_path,
        torch_dtype="auto",
        device_map=device,
    )
    report(50)

    merged = model.merge_and_unload()
    report(70)

    merged.save_pretrained(output_dir, safe_serialization=True)
    report(90)

    try:
        tokenizer = AutoTokenizer.from_pretrained(adapter_path, fix_mistral_regex=True)
    except TypeError:
        tokenizer = AutoTokenizer.from_pretrained(adapter_path)

    tokenizer.save_pretrained(output_dir)
    report(100)
    print(f"__RESULT__:{output_dir}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)