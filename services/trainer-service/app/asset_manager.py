import requests
from pathlib import Path
from schemas import JobConfig

class AssetManager:
    def __init__(self, cfg: JobConfig):
        self.cfg = cfg
        self.download_dir = Path(cfg.outputs.base_dir) / "downloads"

    def download_file(self, url: str, dest_path: Path):
        print(f"==> downloading {url} to {dest_path}")
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        with requests.get(url, stream=True) as r:
            r.raise_for_status()
            with open(dest_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
        return dest_path

    def prepare_dataset(self, cfg: JobConfig):
        if cfg.dataset.source != "url":
            return

        if cfg.dataset.train_url:
            train_path = self.download_dir / "train.json"
            self.download_file(cfg.dataset.train_url, train_path)
            cfg.dataset.train_path = str(train_path)

        if cfg.dataset.val_url:
            val_path = self.download_dir / "val.json"
            self.download_file(cfg.dataset.val_url, val_path)
            cfg.dataset.val_path = str(val_path)

        print("==> dataset prepared")
