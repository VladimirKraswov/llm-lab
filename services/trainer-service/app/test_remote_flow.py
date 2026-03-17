import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import json
import os
import sys

# Mocking unsloth and torch before importing runner/train_runner
sys.modules["unsloth"] = MagicMock()
sys.modules["torch"] = MagicMock()
sys.modules["datasets"] = MagicMock()
sys.modules["transformers"] = MagicMock()
sys.modules["trl"] = MagicMock()

import runner
from schemas import JobConfig

class TestRemoteFlow(unittest.TestCase):
    def setUp(self):
        self.config_dict = {
            "job_name": "test-job",
            "mode": "remote",
            "model": {
                "source": "huggingface",
                "repo_id": "test/model"
            },
            "dataset": {
                "source": "url",
                "train_url": "http://example.com/train.json",
                "val_url": "http://example.com/val.json"
            },
            "training": {
                "method": "lora",
                "target_modules": ["q_proj", "v_proj"]
            },
            "lora": {
                "target_modules": ["q_proj", "v_proj"]
            },
            "outputs": {
                "base_dir": "test_outputs",
                "logs_dir": "test_outputs/logs",
                "lora_dir": "test_outputs/lora",
                "checkpoints_dir": "test_outputs/checkpoints",
                "metrics_dir": "test_outputs/metrics",
                "merged_dir": "test_outputs/merged",
                "quantized_dir": "test_outputs/quantized"
            },
            "postprocess": {
                "merge_lora": True
            },
            "upload": {
                "enabled": True,
                "target": "url",
                "upload_url": "http://example.com/upload"
            },
            "report_url": "http://example.com/report"
        }
        self.cfg = JobConfig.model_validate(self.config_dict)

    @patch("runner.load_config")
    @patch("runner.Reporter")
    @patch("runner.AssetManager")
    @patch("runner.Archiver")
    @patch("runner.run_training")
    @patch("runner.try_hf_login")
    @patch("runner.setup_logging")
    @patch("pathlib.Path.open", unittest.mock.mock_open())
    def test_full_pipeline_success(self, mock_setup_logging, mock_hf_login, mock_run_training, mock_archiver, mock_asset_manager, mock_reporter, mock_load_config):
        mock_load_config.return_value = self.cfg
        mock_run_training.return_value = {"status": "success"}

        # Simulate command line args
        with patch("sys.argv", ["runner.py", "--config", "http://example.com/config.json"]):
            runner.main()

        # Verify reporter calls
        mock_reporter.return_value.report_status.assert_any_call("started", message="Training pipeline started")
        mock_reporter.return_value.report_status.assert_any_call("finished", message="Training pipeline finished successfully")

        # Verify asset manager
        mock_asset_manager.return_value.prepare_dataset.assert_called_once_with(self.cfg)

        # Verify archiver
        mock_archiver.return_value.make_archive.assert_called_once()
        mock_archiver.return_value.upload_archive.assert_called_once_with(unittest.mock.ANY, "http://example.com/upload")

    @patch("runner.load_config")
    @patch("runner.Reporter")
    @patch("runner.AssetManager")
    @patch("runner.Archiver")
    @patch("runner.run_training")
    @patch("runner.setup_logging")
    @patch("pathlib.Path.open", unittest.mock.mock_open())
    def test_pipeline_failure(self, mock_setup_logging, mock_run_training, mock_archiver, mock_asset_manager, mock_reporter, mock_load_config):
        mock_load_config.return_value = self.cfg
        mock_run_training.side_effect = Exception("Training failed")

        with patch("sys.argv", ["runner.py", "--config", "http://example.com/config.json"]):
            with self.assertRaises(SystemExit) as cm:
                runner.main()

            self.assertEqual(cm.exception.code, 1)

        # Verify error reporting
        mock_reporter.return_value.report_error.assert_called_once_with("Training failed", logs=unittest.mock.ANY)

if __name__ == "__main__":
    unittest.main()
