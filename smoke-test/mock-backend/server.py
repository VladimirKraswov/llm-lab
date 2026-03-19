import json
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
STORAGE_DIR = BASE_DIR / "storage"
EVENTS_DIR = STORAGE_DIR / "events"
UPLOADS_DIR = STORAGE_DIR / "uploads"
STATUS_DIR = STORAGE_DIR / "status"

for d in [PUBLIC_DIR, STORAGE_DIR, EVENTS_DIR, UPLOADS_DIR, STATUS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="trainer-service mock backend")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def safe_name(value: str) -> str:
    return Path(value).name.replace("/", "_").replace("\\", "_")


def get_job_id(payload: dict[str, Any]) -> str:
    for key in ("job_id", "jobId", "job_name", "jobName"):
        value = payload.get(key)
        if value:
            return str(value)
    return "unknown-job"


def save_event(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    job_id = get_job_id(payload)
    now = time.time()

    enriched = {
        "received_at": now,
        "kind": kind,
        **payload,
    }

    append_jsonl(EVENTS_DIR / f"{job_id}.events.jsonl", enriched)
    write_json(STATUS_DIR / job_id / f"{kind}.latest.json", enriched)
    return enriched


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                rows.append({"raw": line, "parse_error": True})
    return rows


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "public_dir": str(PUBLIC_DIR),
        "storage_dir": str(STORAGE_DIR),
        "time": time.time(),
    }


@app.post("/api/jobs/status")
async def job_status(payload: dict[str, Any] = Body(...)):
    event = save_event("status", payload)
    return {"ok": True, "job_id": get_job_id(event)}


@app.post("/api/jobs/progress")
async def job_progress(payload: dict[str, Any] = Body(...)):
    event = save_event("progress", payload)
    return {"ok": True, "job_id": get_job_id(event)}


@app.post("/api/jobs/final")
async def job_final(payload: dict[str, Any] = Body(...)):
    event = save_event("final", payload)
    return {"ok": True, "job_id": get_job_id(event)}


@app.post("/api/jobs/upload/{artifact_type}")
async def upload_artifact(
    request: Request,
    artifact_type: str,
    file: UploadFile = File(...),
    job_id: str = Form(...),
    job_name: str = Form(""),
    artifact_name: str | None = Form(None),
):
    target_name = safe_name(artifact_name or file.filename or f"{artifact_type}.bin")
    target_dir = UPLOADS_DIR / job_id / artifact_type
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / target_name

    with target_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    meta = {
        "received_at": time.time(),
        "kind": "upload",
        "job_id": job_id,
        "job_name": job_name,
        "artifact_type": artifact_type,
        "filename": target_name,
        "stored_path": str(target_path),
        "size_bytes": target_path.stat().st_size,
    }

    append_jsonl(EVENTS_DIR / f"{job_id}.events.jsonl", meta)

    base_url = str(request.base_url).rstrip("/")
    download_url = f"{base_url}/uploads/{job_id}/{artifact_type}/{target_name}"

    return {
        "ok": True,
        "artifact_id": f"{job_id}-{artifact_type}-{target_name}",
        "job_id": job_id,
        "artifact_type": artifact_type,
        "filename": target_name,
        "stored_path": str(target_path),
        "download_url": download_url,
    }


@app.get("/api/debug/events/{job_id}")
def debug_events(job_id: str):
    return read_jsonl(EVENTS_DIR / f"{job_id}.events.jsonl")


@app.get("/api/debug/job/{job_id}")
def debug_job(job_id: str):
    job_dir = STATUS_DIR / job_id
    uploads_dir = UPLOADS_DIR / job_id

    latest_files = {}
    if job_dir.exists():
        for p in sorted(job_dir.glob("*.latest.json")):
            try:
                latest_files[p.name] = json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                latest_files[p.name] = {"error": str(e)}

    uploaded_files = []
    if uploads_dir.exists():
        for p in sorted(uploads_dir.rglob("*")):
            if p.is_file():
                uploaded_files.append(
                    {
                        "relative_path": str(p.relative_to(UPLOADS_DIR)),
                        "size_bytes": p.stat().st_size,
                    }
                )

    return {
        "job_id": job_id,
        "latest": latest_files,
        "uploaded_files": uploaded_files,
        "events_count": len(read_jsonl(EVENTS_DIR / f"{job_id}.events.jsonl")),
    }


app.mount("/files", StaticFiles(directory=str(PUBLIC_DIR)), name="files")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")