from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from huggingface_hub import HfApi

from archiver import Archiver
from hf_utils import build_hf_api, get_hf_token
from schemas import JobConfig

logger = logging.getLogger(__name__)


class ArtifactUploader:
    def __init__(self, cfg: JobConfig):
        self.cfg = cfg
        self.archiver = Archiver()
        self.session = self.archiver.session

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
            response = self.session.post(
                upload_url,
                files=files,
                data=data,
                headers=self._headers(),
                timeout=(10, self.cfg.upload.timeout_sec),
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

    def _safe_upload(
        self,
        key: str,
        operation: Callable[[], Dict[str, str]],
        uploaded: Dict[str, Dict[str, str]],
        errors: Dict[str, str],
    ) -> None:
        try:
            result = operation()
            if result:
                uploaded[key] = result
        except Exception as exc:
            logger.exception("upload step failed: %s", key)
            errors[key] = str(exc)

    def upload_non_summary_artifacts(
        self,
        log_file: str,
        effective_config_path: str,
        training_result: Dict,
        eval_result: Optional[Dict] = None,
    ) -> tuple[Dict[str, Dict[str, str]], Dict[str, str]]:
        uploaded: Dict[str, Dict[str, str]] = {}
        errors: Dict[str, str] = {}

        if self.cfg.upload.enabled and self.cfg.upload.target == "url":
            targets = self.cfg.upload.url_targets

            if targets.logs_url:
                self._safe_upload(
                    "logs",
                    lambda: self._upload_file(log_file, targets.logs_url, "logs"),
                    uploaded,
                    errors,
                )

            if targets.effective_config_url:
                self._safe_upload(
                    "effective_config",
                    lambda: self._upload_file(
                        effective_config_path,
                        targets.effective_config_url,
                        "config",
                    ),
                    uploaded,
                    errors,
                )

            metrics_path = training_result.get("metrics_path")
            if targets.train_metrics_url and metrics_path:
                self._safe_upload(
                    "train_metrics",
                    lambda: self._upload_file(
                        metrics_path,
                        targets.train_metrics_url,
                        "train_metrics",
                    ),
                    uploaded,
                    errors,
                )

            history_path = training_result.get("history_path")
            if targets.train_history_url and history_path:
                self._safe_upload(
                    "train_history",
                    lambda: self._upload_file(
                        history_path,
                        targets.train_history_url,
                        "train_history",
                    ),
                    uploaded,
                    errors,
                )

            lora_dir = training_result.get("lora_dir")
            if targets.lora_archive_url and lora_dir:
                self._safe_upload(
                    "lora_archive",
                    lambda: self._archive_and_upload_dir(
                        lora_dir,
                        targets.lora_archive_url,
                        f"{self.cfg.job_name}.lora.tar.gz",
                        "lora_archive",
                    ),
                    uploaded,
                    errors,
                )

            merged_dir = training_result.get("merged_dir")
            if targets.merged_archive_url and merged_dir and Path(merged_dir).exists():
                self._safe_upload(
                    "merged_archive",
                    lambda: self._archive_and_upload_dir(
                        merged_dir,
                        targets.merged_archive_url,
                        f"{self.cfg.job_name}.merged.tar.gz",
                        "merged_archive",
                    ),
                    uploaded,
                    errors,
                )

            if targets.full_archive_url:
                self._safe_upload(
                    "full_archive",
                    lambda: self._archive_and_upload_dir(
                        self.cfg.outputs.base_dir,
                        targets.full_archive_url,
                        f"{self.cfg.job_name}.full.tar.gz",
                        "full_archive",
                    ),
                    uploaded,
                    errors,
                )

            if eval_result:
                if targets.eval_summary_url and eval_result.get("summary_json_path"):
                    self._safe_upload(
                        "eval_summary",
                        lambda: self._upload_file(
                            eval_result["summary_json_path"],
                            targets.eval_summary_url,
                            "evaluation_summary",
                        ),
                        uploaded,
                        errors,
                    )

                if targets.eval_details_url and eval_result.get("detailed_csv_path"):
                    self._safe_upload(
                        "eval_details",
                        lambda: self._upload_file(
                            eval_result["detailed_csv_path"],
                            targets.eval_details_url,
                            "evaluation_details",
                        ),
                        uploaded,
                        errors,
                    )

        return uploaded, errors

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

    def _hf_plan(self) -> Dict[str, Any]:
        lora_repo = self.cfg.huggingface.repo_id_lora or self.cfg.upload.repo_id_lora
        merged_repo = self.cfg.huggingface.repo_id_merged or self.cfg.upload.repo_id_merged
        metadata_repo = (
            self.cfg.huggingface.repo_id_metadata
            or self.cfg.upload.repo_id_metadata
            or lora_repo
            or merged_repo
        )

        request_lora = bool(
            lora_repo and (
                self.cfg.huggingface.push_lora
                or self.cfg.upload.target == "huggingface"
            )
        )
        request_merged = bool(
            merged_repo and (
                self.cfg.huggingface.push_merged
                or self.cfg.upload.target == "huggingface"
            )
        )
        request_metadata = bool(
            metadata_repo and (
                self.cfg.huggingface.enabled
                or self.cfg.upload.target == "huggingface"
                or request_lora
                or request_merged
            )
        )

        private = (
            self.cfg.huggingface.private
            if self.cfg.huggingface.enabled
            else self.cfg.upload.private
        )
        commit_message = (
            self.cfg.huggingface.commit_message
            if self.cfg.huggingface.enabled
            else self.cfg.upload.commit_message
        )
        revision = self.cfg.huggingface.revision

        return {
            "request_lora": request_lora,
            "request_merged": request_merged,
            "request_metadata": request_metadata,
            "lora_repo": lora_repo,
            "merged_repo": merged_repo,
            "metadata_repo": metadata_repo,
            "private": private,
            "commit_message": commit_message,
            "revision": revision,
        }

    def ensure_hf_ready(self) -> Dict[str, Any]:
        plan = self._hf_plan()

        if not plan["request_lora"] and not plan["request_merged"] and not plan["request_metadata"]:
            return plan

        if not get_hf_token():
            raise RuntimeError("Hugging Face upload is requested, but HF_TOKEN is missing")

        if plan["request_lora"] and not plan["lora_repo"]:
            raise RuntimeError("LoRA upload is requested, but repo_id_lora is missing")

        if plan["request_merged"] and not plan["merged_repo"]:
            raise RuntimeError("Merged upload is requested, but repo_id_merged is missing")

        if plan["request_metadata"] and not plan["metadata_repo"]:
            raise RuntimeError("Metadata upload is requested, but metadata repo cannot be resolved")

        api = build_hf_api()
        whoami = api.whoami()
        logger.info("==> Hugging Face upload ready for account: %s", whoami.get("name") or "unknown")
        return plan

    def upload_to_huggingface(self, training_result: Dict) -> Dict[str, Dict[str, str]]:
        uploaded: Dict[str, Dict[str, str]] = {}
        plan = self._hf_plan()

        if not plan["request_lora"] and not plan["request_merged"]:
            return uploaded

        api = build_hf_api()

        if plan["request_lora"]:
            lora_dir = training_result.get("lora_dir")
            if not lora_dir or not Path(lora_dir).exists():
                raise RuntimeError("LoRA upload requested but lora_dir is missing")

            api.create_repo(
                repo_id=plan["lora_repo"],
                repo_type="model",
                private=plan["private"],
                exist_ok=True,
            )
            api.upload_folder(
                repo_id=plan["lora_repo"],
                repo_type="model",
                folder_path=lora_dir,
                commit_message=plan["commit_message"],
                revision=plan["revision"],
                ignore_patterns=["__pycache__/**", "*.tmp", "*.log"],
            )
            uploaded["hf_lora"] = {"repo_id": plan["lora_repo"], "path": lora_dir}

        if plan["request_merged"]:
            merged_dir = training_result.get("merged_dir")
            if not merged_dir or not Path(merged_dir).exists():
                raise RuntimeError("Merged upload requested but merged_dir is missing")

            api.create_repo(
                repo_id=plan["merged_repo"],
                repo_type="model",
                private=plan["private"],
                exist_ok=True,
            )
            api.upload_folder(
                repo_id=plan["merged_repo"],
                repo_type="model",
                folder_path=merged_dir,
                commit_message=plan["commit_message"],
                revision=plan["revision"],
                ignore_patterns=["__pycache__/**", "*.tmp", "*.log"],
            )
            uploaded["hf_merged"] = {"repo_id": plan["merged_repo"], "path": merged_dir}

        return uploaded

    def _upload_file_to_hf(
        self,
        api: HfApi,
        repo_id: str,
        file_path: str,
        path_in_repo: str,
        commit_message: str,
        revision: Optional[str] = None,
    ) -> Optional[str]:
        path = Path(file_path)
        if not path.exists():
            return None

        api.upload_file(
            path_or_fileobj=str(path),
            path_in_repo=path_in_repo,
            repo_id=repo_id,
            repo_type="model",
            commit_message=commit_message,
            revision=revision,
        )
        return path_in_repo

    def upload_hf_metadata(
        self,
        log_file: str,
        effective_config_path: str,
        result_path: str,
        training_result: Dict,
        eval_result: Optional[Dict] = None,
    ) -> Dict[str, Dict[str, Any]]:
        uploaded: Dict[str, Dict[str, Any]] = {}
        plan = self._hf_plan()

        if not plan["request_metadata"]:
            return uploaded

        repo_id = plan["metadata_repo"]
        if not repo_id:
            return uploaded

        api = build_hf_api()
        api.create_repo(
            repo_id=repo_id,
            repo_type="model",
            private=plan["private"],
            exist_ok=True,
        )

        commit_message = f"{plan['commit_message']} (metadata)"
        revision = plan["revision"]

        uploaded_files: list[str] = []

        file_specs = [
            (log_file, "artifacts/logs/trainer.log"),
            (effective_config_path, "artifacts/config/effective-job.json"),
            (result_path, "artifacts/result/job-result.json"),
        ]

        if training_result.get("metrics_path"):
            file_specs.append(
                (training_result["metrics_path"], "artifacts/train/train_metrics.json")
            )
        if training_result.get("history_path"):
            file_specs.append(
                (training_result["history_path"], "artifacts/train/train_history.json")
            )
        if training_result.get("train_summary_path"):
            file_specs.append(
                (training_result["train_summary_path"], "artifacts/train/train_summary.json")
            )

        if eval_result:
            if eval_result.get("summary_json_path"):
                file_specs.append(
                    (eval_result["summary_json_path"], "artifacts/evaluation/summary.json")
                )
            if eval_result.get("result_json_path"):
                file_specs.append(
                    (eval_result["result_json_path"], "artifacts/evaluation/result.json")
                )
            if eval_result.get("summary_csv_path"):
                file_specs.append(
                    (eval_result["summary_csv_path"], "artifacts/evaluation/summary.csv")
                )
            if eval_result.get("detailed_csv_path"):
                file_specs.append(
                    (eval_result["detailed_csv_path"], "artifacts/evaluation/detailed.csv")
                )

        for local_path, path_in_repo in file_specs:
            uploaded_path = self._upload_file_to_hf(
                api=api,
                repo_id=repo_id,
                file_path=local_path,
                path_in_repo=path_in_repo,
                commit_message=commit_message,
                revision=revision,
            )
            if uploaded_path:
                uploaded_files.append(uploaded_path)

        uploaded["hf_metadata"] = {
            "repo_id": repo_id,
            "files": uploaded_files,
        }
        return uploaded