from __future__ import annotations

import logging
import sys
import threading
from typing import Dict, Optional

from archiver import build_retry_session


class LogStreamer(logging.Handler):
    def __init__(
        self,
        logs_url: str,
        job_id: str,
        job_name: str,
        bearer_token: Optional[str] = None,
        timeout_sec: int = 10,
    ):
        super().__init__()
        self.logs_url = str(logs_url or "").strip()
        self.job_id = job_id
        self.job_name = job_name
        self.timeout_sec = timeout_sec
        self.session = build_retry_session(total_retries=2)
        self.lock = threading.Lock()
        self.offset = 0

        self.headers: Dict[str, str] = {"Content-Type": "application/json"}
        if bearer_token:
            self.headers["Authorization"] = f"Bearer {bearer_token}"

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)
            if not message:
                return

            chunk = f"{message}\n"
            encoded = chunk.encode("utf-8", errors="replace")

            with self.lock:
                current_offset = self.offset
                self.offset += len(encoded)

            payload = {
                "job_id": self.job_id,
                "job_name": self.job_name,
                "offset": current_offset,
                "chunk": chunk,
            }

            response = self.session.post(
                self.logs_url,
                json=payload,
                headers=self.headers,
                timeout=(5, self.timeout_sec),
            )
            response.raise_for_status()
        except Exception as exc:
            try:
                sys.stderr.write(f"[log-streamer] failed to send log chunk: {exc}\n")
                sys.stderr.flush()
            except Exception:
                pass

    def close(self) -> None:
        try:
            self.session.close()
        except Exception:
            pass
        super().close()