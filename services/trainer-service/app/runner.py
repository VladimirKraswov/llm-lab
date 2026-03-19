from __future__ import annotations

import argparse
import json
import logging
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from archiver import Archiver
from artifact_uploader import ArtifactUploader
from asset_manager import AssetManager
from config_loader import load_config
from eval_runner import run_evaluation
from hf_utils import try_hf_login
from reporter import Reporter
from train_runner import run_training

logger = logging.getLogger(__name__)


def setup_logging(logs_dir: str):
    logs_path = Path(logs_dir)
    logs_path.mkdir(parents=True, exist_ok=True)
    log_file = logs_path / "trainer.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    return log_file


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def tail_file(file_path: Path, lines: int = 50) -> str:
    try:
        with file_path.open("r", encoding="utf-8") as f:
            return "".join(f.readlines()[-lines:])
    except Exception:
        return "Could not retrieve logs"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    try:
        cfg = load_config(args.config)
    except Exception as exc:
        print(f"ERROR: failed to load config: {exc}")
        sys.exit(1)

    Path(cfg.outputs.base_dir).mkdir(parents=True, exist_ok=True)
    log_file = setup_logging(cfg.outputs.logs_dir)

    reporter = Reporter(cfg)
    asset_manager = AssetManager(cfg)
    archiver = Archiver()
    uploader = ArtifactUploader(cfg)

    effective_config_path = Path(cfg.outputs.logs_dir) / "effective-job.json"
    result_path = Path(cfg.outputs.base_dir) / "job-result.json"

    started_at = utc_now_iso()

    try:
        reporter.report_status("started", message="Training pipeline started", stage="bootstrap", progress=0)

        write_json(effective_config_path, json.loads(cfg.model_dump_json()))
        logger.info("==> config loaded")
        logger.info("==> job_name: %s", cfg.job_name)
        logger.info("==> job_id: %s", cfg.job_id or cfg.job_name)

        reporter.report_status(
            "running",
            message="Logging in to Hugging Face if token is present",
            stage="hf_login",
            progress=2,
        )
        try_hf_login()

        logger.info("==> preparing assets")
        reporter.report_status(
            "running",
            message="Preparing datasets and remote assets",
            stage="prepare_assets",
            progress=5,
        )
        asset_manager.prepare_dataset(cfg)
        asset_manager.prepare_evaluation_dataset(cfg)

        logger.info("==> starting training")
        training_result = run_training(cfg, reporter=reporter)
        logger.info("==> training finished")

        if cfg.postprocess.run_awq_quantization:
            raise NotImplementedError("AWQ quantization stage is not implemented in this service yet")

        evaluation_result = None
        if cfg.evaluation.enabled:
            logger.info("==> starting evaluation")
            evaluation_result = run_evaluation(cfg, training_result, reporter=reporter)
            logger.info("==> evaluation finished")

        result: Dict[str, Any] = {
            "status": "success",
            "job_id": cfg.job_id or cfg.job_name,
            "job_name": cfg.job_name,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "config_source": args.config,
            "training": training_result,
            "evaluation": evaluation_result,
            "artifacts": {
                "log_file": str(log_file),
                "effective_config_path": str(effective_config_path),
                "result_path": str(result_path),
            },
            "uploads": {},
        }

        # legacy full archive upload
        if cfg.upload.enabled and cfg.upload.target == "url" and cfg.upload.upload_url:
            logger.info("==> legacy full archive upload")
            archive_path = Path(cfg.outputs.base_dir) / f"{cfg.job_name}.tar.gz"
            archiver.make_archive(cfg.outputs.base_dir, str(archive_path))
            archiver.upload_archive(
                str(archive_path),
                cfg.upload.upload_url,
                headers=uploader._headers(),
                form_data={
                    "job_id": cfg.job_id or cfg.job_name,
                    "job_name": cfg.job_name,
                    "artifact_type": "full_archive",
                },
                timeout_sec=cfg.upload.timeout_sec,
            )
            result["uploads"]["legacy_full_archive"] = {
                "url": cfg.upload.upload_url,
                "archive_path": str(archive_path),
            }

        write_json(result_path, result)

        extra_uploads = uploader.upload_non_summary_artifacts(
            log_file=str(log_file),
            effective_config_path=str(effective_config_path),
            training_result=training_result,
            eval_result=evaluation_result,
        )
        if extra_uploads:
            result["uploads"].update(extra_uploads)

        hf_uploads = uploader.upload_to_huggingface(training_result)
        if hf_uploads:
            result["uploads"].update(hf_uploads)

        write_json(result_path, result)

        summary_upload = uploader.upload_summary(str(result_path))
        if summary_upload:
            result["uploads"].update(summary_upload)
            write_json(result_path, result)

        logger.info("==> pipeline finished successfully")
        reporter.report_status(
            "finished",
            message="Training pipeline finished successfully",
            stage="finished",
            progress=100,
        )
        reporter.report_final(result, status="finished")

        print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as exc:
        error_msg = str(exc)
        stack_trace = traceback.format_exc()

        logger.error("FATAL ERROR: %s", error_msg)
        logger.error(stack_trace)

        logs_tail = tail_file(log_file, 50)

        failed_result = {
            "status": "failed",
            "job_id": cfg.job_id or cfg.job_name,
            "job_name": cfg.job_name,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "config_source": args.config,
            "error": error_msg,
            "artifacts": {
                "log_file": str(log_file),
                "effective_config_path": str(effective_config_path),
                "result_path": str(result_path),
            },
        }
        write_json(result_path, failed_result)

        reporter.report_error(error_msg, logs=logs_tail)
        reporter.report_final(failed_result, status="failed")
        sys.exit(1)


if __name__ == "__main__":
    main()