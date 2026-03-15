import json
import os
import sys


def report(p):
    print(f"__PROGRESS__:{p}", flush=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: quantize_awq.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    model_path = cfg["modelPath"]
    output_dir = cfg["outputDir"]
    quant_config = cfg.get("quantConfig") or {
        "zero_point": True,
        "q_group_size": 128,
        "w_bit": 4,
        "version": "GEMM",
    }
    trust_remote_code = bool(cfg.get("trustRemoteCode", True))

    os.makedirs(output_dir, exist_ok=True)
    report(10)

    from awq import AutoAWQForCausalLM
    from transformers import AutoTokenizer
    report(30)

    model = AutoAWQForCausalLM.from_pretrained(
        model_path,
        trust_remote_code=trust_remote_code,
    )
    tokenizer = AutoTokenizer.from_pretrained(
        model_path,
        trust_remote_code=trust_remote_code,
    )
    report(55)

    model.quantize(tokenizer, quant_config=quant_config)
    report(85)

    model.save_quantized(output_dir)
    tokenizer.save_pretrained(output_dir)
    report(100)

    print(f"__RESULT__:{output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)