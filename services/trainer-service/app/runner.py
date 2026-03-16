import argparse
import json
from pathlib import Path

from config_loader import load_config
from hf_utils import try_hf_login
from train_runner import run_training


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    cfg = load_config(args.config)

    Path(cfg.outputs.logs_dir).mkdir(parents=True, exist_ok=True)

    effective_config_path = Path(cfg.outputs.logs_dir) / "effective-job.json"
    summary_path = Path(cfg.outputs.logs_dir) / "summary.json"

    with effective_config_path.open("w", encoding="utf-8") as f:
        f.write(cfg.model_dump_json(indent=2))

    print("==> config loaded")
    print(f"==> job_name: {cfg.job_name}")

    try_hf_login()

    result = run_training(cfg)

    with summary_path.open("w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print("==> done")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()