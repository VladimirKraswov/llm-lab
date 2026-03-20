from __future__ import annotations

import logging
import tarfile
from pathlib import Path
from typing import Dict, Iterable, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


def build_retry_session(total_retries: int = 3) -> requests.Session:
    retry = Retry(
        total=total_retries,
        connect=total_retries,
        read=total_retries,
        status=total_retries,
        other=total_retries,
        backoff_factor=1.0,
        allowed_methods=None,
        status_forcelist=[408, 425, 429, 500, 502, 503, 504],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


class Archiver:
    def __init__(self, session: Optional[requests.Session] = None, retries: int = 3):
        self.session = session or build_retry_session(retries)

    def make_archive(
        self,
        source_dir: str,
        output_filename: str,
        exclude_names: Optional[Iterable[str]] = None,
    ) -> str:
        source_path = Path(source_dir).resolve()
        output_path = Path(output_filename).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)

        excluded = set(exclude_names or set())
        excluded.update({"downloads", "__pycache__"})

        if output_path.parent == source_path:
            excluded.add(output_path.name)

        print(f"==> creating archive {output_path} from {source_path}")
        with tarfile.open(output_path, "w:gz", compresslevel=1) as tar:
            for item in source_path.iterdir():
                if item.name in excluded:
                    continue
                if item.is_file() and item.name.endswith((".tar", ".tar.gz", ".tgz")):
                    continue
                tar.add(item, arcname=item.name)

        return str(output_path)

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
            response = self.session.post(
                upload_url,
                files=files,
                data=form_data or {},
                headers=headers or {},
                timeout=(10, timeout_sec),
            )
            response.raise_for_status()
        print("==> upload successful")