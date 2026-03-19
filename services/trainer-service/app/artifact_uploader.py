from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

import requests
from huggingface_hub import HfApi

from archiver import Archiver
from hf_utils import get_hf_token
from schemas import JobConfig


class ArtifactUploader:
    def __init__(self, cfg: JobConfig):
        self.cfg = cfg
        self.archiver = Archiver()

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.cfg.upload.auth.headers:
            headers.update(self.cfg.upload.auth.headers)
        if self.cfg.upload.auth.bearer_token:
            headers["Authorization"] = f"Bearer {self.cfg.upload.auth.bearer_token}"
        return headers

    def _upload_file(self, file_path: str, upload_url: str, artifact_type: str) -> Dict[str, str]:
        path = Path(file_path)
        if not upload_url or not path.exists():
            return {}

        with path.open("rb") as f:
            files = {"file": (path.name, f, "application/octet-stream")}
            data = {
                "job_id": self.cfg.job_id or self.cfg.job_name,
                "job_name": self.cfg.job_name,
                "artifact_type": artifact_type,
            }
            response = requests.post(
                upload_url,
                files=files,
                data=data,
                headers=self._headers(),
                timeout=self.cfg.upload.timeout_sec,
            )
            response.raise_for_status()

        return {"url": upload_url, "path": str(path)}

    def _archive_and_upload_dir(
        self,
        dir_path: str,
        upload_url: str,
        archive_name: str,
        artifact_type: str,
    ) -> Dict[str, str]:
        path = Path(dir_path)
        if not upload_url or not path.exists():
            return {}

        archive_path = Path(self.cfg.outputs.base_dir) / archive_name
        self.archiver.make_archive(
            str(path),
            str(archive_path),
            exclude_names={"downloads", "__pycache__"},
        )
        self.archiver.upload_archive(
            str(archive_path),
            upload_url,
            headers=self._headers(),
            form_data={
                "job_id": self.cfg.job_id or self.cfg.job_name,
                "job_name": self.cfg.job_name,
                "artifact_type": artifact_type,
            },
            timeout_sec=self.cfg.upload.timeout_sec,
        )
        return {"url": upload_url, "archive_path": str(archive_path)}

    def upload_non_summary_artifacts(
        self,
        log_file: str,
        effective_config_path: str,
        training_result: Dict,
        eval_result: Optional[Dict] = None,
    ) -> Dict[str, Dict[str, str]]:
        uploaded: Dict[str, Dict[str, str]] = {}

        if self.cfg.upload.enabled and self.cfg.upload.target == "url":
            targets = self.cfg.upload.url_targets

            if targets.logs_url:
                uploaded["logs"] = self._upload_file(log_file, targets.logs_url, "logs")

            if targets.effective_config_url:
                uploaded["effective_config"] = self._upload_file(
                    effective_config_path,
                    targets.effective_config_url,
                    "effective_config",
                )

            metrics_path = training_result.get("metrics_path")
            if targets.train_metrics_url and metrics_path:
                uploaded["train_metrics"] = self._upload_file(
                    metrics_path,
                    targets.train_metrics_url,
                    "train_metrics",
                )

            history_path = training_result.get("history_path")
            if targets.train_history_url and history_path:
                uploaded["train_history"] = self._upload_file(
                    history_path,
                    targets.train_history_url,
                    "train_history",
                )

            lora_dir = training_result.get("lora_dir")
            if targets.lora_archive_url and lora_dir:
                uploaded["lora_archive"] = self._archive_and_upload_dir(
                    lora_dir,
                    targets.lora_archive_url,
                    f"{self.cfg.job_name}.lora.tar.gz",
                    "lora_archive",
                )

            merged_dir = training_result.get("merged_dir")
            if targets.merged_archive_url and merged_dir and Path(merged_dir).exists():
                uploaded["merged_archive"] = self._archive_and_upload_dir(
                    merged_dir,
                    targets.merged_archive_url,
                    f"{self.cfg.job_name}.merged.tar.gz",
                    "merged_archive",
                )

            if targets.full_archive_url:
                uploaded["full_archive"] = self._archive_and_upload_dir(
                    self.cfg.outputs.base_dir,
                    targets.full_archive_url,
                    f"{self.cfg.job_name}.full.tar.gz",
                    "full_archive",
                )

            if eval_result:
                if targets.eval_summary_url and eval_result.get("summary_json_path"):
                    uploaded["eval_summary"] = self._upload_file(
                        eval_result["summary_json_path"],
                        targets.eval_summary_url,
                        "evaluation_summary",
                    )

                if targets.eval_details_url and eval_result.get("detailed_csv_path"):
                    uploaded["eval_details"] = self._upload_file(
                        eval_result["detailed_csv_path"],
                        targets.eval_details_url,
                        "evaluation_details",
                    )

        return uploaded

    def upload_summary(self, summary_path: str) -> Dict[str, Dict[str, str]]:
        uploaded: Dict[str, Dict[str, str]] = {}
        if (
            self.cfg.upload.enabled
            and self.cfg.upload.target == "url"
            and self.cfg.upload.url_targets.summary_url
        ):
            uploaded["summary"] = self._upload_file(
                summary_path,
                self.cfg.upload.url_targets.summary_url,
                "job_summary",
            )
        return uploaded

    def upload_to_huggingface(self, training_result: Dict) -> Dict[str, Dict[str, str]]:
        uploaded: Dict[str, Dict[str, str]] = {}

        hf_token = get_hf_token()
        if not hf_token:
            return uploaded

        hf_enabled = (
            self.cfg.huggingface.enabled
            or self.cfg.upload.target == "huggingface"
            or bool(self.cfg.huggingface.repo_id_lora)
            or bool(self.cfg.huggingface.repo_id_merged)
            or bool(self.cfg.upload.repo_id_lora)
            or bool(self.cfg.upload.repo_id_merged)
        )

        if not hf_enabled:
            return uploaded

        api = HfApi(token=hf_token)

        lora_repo = self.cfg.huggingface.repo_id_lora or self.cfg.upload.repo_id_lora
        merged_repo = self.cfg.huggingface.repo_id_merged or self.cfg.upload.repo_id_merged
        private = self.cfg.huggingface.private if self.cfg.huggingface.enabled else self.cfg.upload.private
        commit_message = (
            self.cfg.huggingface.commit_message
            if self.cfg.huggingface.enabled
            else self.cfg.upload.commit_message
        )
        revision = self.cfg.huggingface.revision

        if lora_repo and (self.cfg.huggingface.push_lora or self.cfg.upload.target == "huggingface"):
            lora_dir = training_result.get("lora_dir")
            if lora_dir and Path(lora_dir).exists():
                api.create_repo(repo_id=lora_repo, repo_type="model", private=private, exist_ok=True)
                api.upload_folder(
                    repo_id=lora_repo,
                    repo_type="model",
                    folder_path=lora_dir,
                    commit_message=commit_message,
                    revision=revision,
                )
                uploaded["hf_lora"] = {"repo_id": lora_repo, "path": lora_dir}

        if merged_repo and (self.cfg.huggingface.push_merged or self.cfg.upload.target == "huggingface"):
            merged_dir = training_result.get("merged_dir")
            if merged_dir and Path(merged_dir).exists():
                api.create_repo(repo_id=merged_repo, repo_type="model", private=private, exist_ok=True)
                api.upload_folder(
                    repo_id=merged_repo,
                    repo_type="model",
                    folder_path=merged_dir,
                    commit_message=commit_message,
                    revision=revision,
                )
                uploaded["hf_merged"] = {"repo_id": merged_repo, "path": merged_dir}

        return uploaded