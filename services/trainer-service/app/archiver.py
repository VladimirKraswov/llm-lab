import os
import tarfile
import requests
from pathlib import Path

class Archiver:
    def __init__(self):
        pass

    def make_archive(self, source_dir: str, output_filename: str):
        print(f"==> creating archive {output_filename} from {source_dir}")
        source_path = Path(source_dir)
        with tarfile.open(output_filename, "w:gz") as tar:
            for item in source_path.iterdir():
                if item.name == "downloads":
                    continue
                tar.add(item, arcname=item.name)
        return output_filename

    def upload_archive(self, archive_path: str, upload_url: str):
        print(f"==> uploading archive to {upload_url}")
        with open(archive_path, 'rb') as f:
            files = {'file': f}
            response = requests.post(upload_url, files=files)
            response.raise_for_status()
        print("==> upload successful")
