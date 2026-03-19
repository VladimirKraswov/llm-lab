from __future__ import annotations

import logging
import time
from typing import Any, Dict, List

import requests

from schemas import CallbackConfig, JobConfig

logger = logging.getLogger(__name__)


class Reporter:
    def __init__(self, cfg: JobConfig):
        self.cfg = cfg
        self.job_name = cfg.job_name
        self.job_id = cfg.job_id or cfg.job_name

    def _build_headers(self, callback: CallbackConfig) -> Dict[str, str]:
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if callback.auth.headers:
            headers.update(callback.auth.headers)
        if callback.auth.bearer_token:
            headers["Authorization"] = f"Bearer {callback.auth.bearer_token}"
        return headers

    def _callbacks_for(self, event_kind: str) -> List[CallbackConfig]:
        callbacks: List[CallbackConfig] = []

        if event_kind == "status" and self.cfg.reporting.status.active:
            callbacks.append(self.cfg.reporting.status)
        elif event_kind == "progress" and self.cfg.reporting.progress.active:
            callbacks.append(self.cfg.reporting.progress)
        elif event_kind == "final" and self.cfg.reporting.final.active:
            callbacks.append(self.cfg.reporting.final)

        if not callbacks and self.cfg.report_url:
            callbacks.append(
                CallbackConfig(
                    enabled=True,
                    url=self.cfg.report_url,
                    timeout_sec=15,
                )
            )

        return callbacks

    def _emit(self, event_kind: str, payload: Dict[str, Any]) -> None:
        callbacks = self._callbacks_for(event_kind)
        if not callbacks:
            return

        payload = {
            "job_id": self.job_id,
            "job_name": self.job_name,
            "event": event_kind,
            "timestamp": time.time(),
            **payload,
        }

        for callback in callbacks:
            try:
                logger.info("==> reporting %s to %s", event_kind, callback.url)
                response = requests.post(
                    callback.url,
                    json=payload,
                    headers=self._build_headers(callback),
                    timeout=callback.timeout_sec,
                )
                response.raise_for_status()
            except Exception as exc:
                logger.warning("failed to report %s: %s", event_kind, exc)

    def report_status(
        self,
        status: str,
        message: str | None = None,
        stage: str | None = None,
        progress: float | None = None,
        extra: Dict[str, Any] | None = None,
        logs: str | None = None,
    ) -> None:
        self._emit(
            "status",
            {
                "status": status,
                "stage": stage,
                "progress": progress,
                "message": message,
                "logs": logs,
                "extra": extra or {},
            },
        )

    def report_progress(
        self,
        stage: str,
        progress: float | None = None,
        message: str | None = None,
        extra: Dict[str, Any] | None = None,
    ) -> None:
        self._emit(
            "progress",
            {
                "status": "running",
                "stage": stage,
                "progress": progress,
                "message": message,
                "extra": extra or {},
            },
        )

    def report_final(self, result: Dict[str, Any], status: str = "finished") -> None:
        self._emit(
            "final",
            {
                "status": status,
                "result": result,
            },
        )

    def report_error(
        self,
        error_message: str,
        logs: str | None = None,
        stage: str = "failed",
        extra: Dict[str, Any] | None = None,
    ) -> None:
        self.report_status(
            "failed",
            message=error_message,
            stage=stage,
            progress=100,
            extra=extra or {},
            logs=logs,
        )