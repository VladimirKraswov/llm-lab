import json
import requests
from pathlib import Path
from schemas import JobConfig


def load_config(path: str) -> JobConfig:
    if path.startswith("http://") or path.startswith("https://"):
        print(f"==> loading remote config from {path}")
        response = requests.get(path)
        response.raise_for_status()
        raw = response.json()
    else:
        config_path = Path(path)
        if not config_path.exists():
            raise FileNotFoundError(f"Config not found: {path}")

        with config_path.open("r", encoding="utf-8") as f:
            raw = json.load(f)

    return JobConfig.model_validate(raw)
