import json
import os
import sys
import traceback
from huggingface_hub import snapshot_download


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: download_model.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    repo_id = str(cfg["repoId"]).strip()
    local_dir = str(cfg["localDir"]).strip()
    hf_token = (
        cfg.get("hfToken")
        or os.getenv("HF_TOKEN")
        or os.getenv("HUGGINGFACE_HUB_TOKEN")
        or os.getenv("HUGGINGFACE_TOKEN")
    )

    if not repo_id:
        raise ValueError("repoId is empty")

    if not local_dir:
        raise ValueError("localDir is empty")

    os.makedirs(local_dir, exist_ok=True)

    print(f"Starting HF download: repo_id={repo_id}", flush=True)
    print(f"Target dir: {local_dir}", flush=True)
    print(f"HF token provided: {'yes' if bool(hf_token) else 'no'}", flush=True)

    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=local_dir,
            token=hf_token,
            resume_download=True,
        )
        print(local_dir, flush=True)
    except Exception as exc:
        print(f"HF download failed for repo '{repo_id}': {exc}", flush=True)
        traceback.print_exc()
        raise


if __name__ == "__main__":
    main()