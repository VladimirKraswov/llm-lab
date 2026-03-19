from __future__ import annotations

import tarfile
from pathlib import Path
from typing import Dict, Iterable, Optional

import requests


class Archiver:
    def __init__(self):
        pass

    def make_archive(
        self,
        source_dir: str,
        output_filename: str,
        exclude_names: Optional[Iterable[str]] = None,
    ) -> str:
        source_path = Path(source_dir)
        output_path = Path(output_filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        excluded = set(exclude_names or {"downloads", "__pycache__"})

        print(f"==> creating archive {output_filename} from {source_dir}")
        with tarfile.open(output_filename, "w:gz") as tar:
            for item in source_path.iterdir():
                if item.name in excluded:
                    continue
                tar.add(item, arcname=item.name)

        return output_filename

    def upload_archive(
        self,
        archive_path: str,
        upload_url: str,
        headers: Optional[Dict[str, str]] = None,
        form_data: Optional[Dict[str, str]] = None,
        timeout_sec: int = 120,
    ) -> None:
        print(f"==> uploading archive to {upload_url}")
        with open(archive_path, "rb") as f:
            files = {"file": (Path(archive_path).name, f, "application/gzip")}
            response = requests.post(
                upload_url,
                files=files,
                data=form_data or {},
                headers=headers or {},
                timeout=timeout_sec,
            )
            response.raise_for_status()
        print("==> upload successful")