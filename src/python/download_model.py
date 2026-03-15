import json
import os
import sys
from huggingface_hub import snapshot_download

def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: download_model.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    repo_id = cfg["repoId"]
    local_dir = cfg["localDir"]

    os.makedirs(local_dir, exist_ok=True)

    snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )
    print(local_dir)

if __name__ == "__main__":
    main()