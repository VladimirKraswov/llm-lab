import time
import requests
import logging

logger = logging.getLogger(__name__)

class Reporter:
    def __init__(self, report_url: str, job_name: str):
        self.report_url = report_url
        self.job_name = job_name

    def report_status(self, status: str, message: str = None, logs: str = None):
        if not self.report_url:
            return

        payload = {
            "job_name": self.job_name,
            "status": status,
            "message": message,
            "logs": logs,
            "timestamp": time.time()
        }

        try:
            print(f"==> reporting status: {status}")
            response = requests.post(self.report_url, json=payload, timeout=10)
            response.raise_for_status()
        except Exception as e:
            print(f"WARNING: failed to report status: {e}")

    def report_error(self, error_message: str, logs: str = None):
        self.report_status("failed", message=error_message, logs=logs)
