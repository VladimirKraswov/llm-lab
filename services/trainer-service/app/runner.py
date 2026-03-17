import argparse
import json
import logging
import sys
import traceback
from pathlib import Path

from config_loader import load_config
from hf_utils import try_hf_login
from train_runner import run_training
from reporter import Reporter
from asset_manager import AssetManager
from archiver import Archiver


def setup_logging(logs_dir: str):
    logs_path = Path(logs_dir)
    logs_path.mkdir(parents=True, exist_ok=True)
    log_file = logs_path / "trainer.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return log_file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    # Early load to get logs_dir if possible
    try:
        cfg = load_config(args.config)
    except Exception as e:
        print(f"ERROR: failed to load config: {e}")
        sys.exit(1)

    log_file = setup_logging(cfg.outputs.logs_dir)
    logging.info(f"==> logging initialized: {log_file}")

    reporter = Reporter(cfg.report_url, cfg.job_name)
    asset_manager = AssetManager(cfg)
    archiver = Archiver()

    try:
        reporter.report_status("started", message="Training pipeline started")

        effective_config_path = Path(cfg.outputs.logs_dir) / "effective-job.json"
        summary_path = Path(cfg.outputs.logs_dir) / "summary.json"

        with effective_config_path.open("w", encoding="utf-8") as f:
            f.write(cfg.model_dump_json(indent=2))

        logging.info("==> config loaded")
        logging.info(f"==> job_name: {cfg.job_name}")

        try_hf_login()

        # Step: Prepare Assets
        logging.info("==> preparing assets")
        asset_manager.prepare_dataset(cfg)

        # Step: Run Training
        logging.info("==> starting training")
        result = run_training(cfg)
        logging.info("==> training finished")

        # Step: Archive and Upload
        if cfg.upload.enabled and cfg.upload.target == "url" and cfg.upload.upload_url:
            logging.info("==> archiving and uploading results")
            archive_path = Path(cfg.outputs.base_dir) / f"{cfg.job_name}.tar.gz"
            archiver.make_archive(cfg.outputs.base_dir, str(archive_path))
            archiver.upload_archive(str(archive_path), cfg.upload.upload_url)
            result["archive_path"] = str(archive_path)

        with summary_path.open("w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        logging.info("==> pipeline finished successfully")
        reporter.report_status("finished", message="Training pipeline finished successfully")

        print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        logging.error(f"FATAL ERROR: {error_msg}")
        logging.error(stack_trace)

        # Get last 50 lines of log for reporting
        try:
            with open(log_file, "r") as f:
                logs = "".join(f.readlines()[-50:])
        except:
            logs = "Could not retrieve logs"

        reporter.report_error(error_msg, logs=logs)
        sys.exit(1)


if __name__ == "__main__":
    main()
