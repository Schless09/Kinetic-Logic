"""
Minimal pipeline worker:
- Polls public.ml_jobs for queued process_session jobs
- Marks job running/succeeded/failed
- Downloads the session's assets (video + sensor_json) into data/raw/<session_id> if needed
- Runs local processing to create data/processed/manifest.parquet (and frames)
- Uploads the manifest as a Storage object and records an ml_artifacts row

This is intentionally lightweight: one process, polling loop, no external queue.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load python/.env so env vars work whether you run from repo root or python/
_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")

from config import PROCESSED, RAW, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, ensure_dirs
from process import run as run_process
from supabase_rest import SupabaseRest

try:
    import httpx
except ImportError:
    print("Install requirements first (httpx missing).")
    sys.exit(1)


POLL_SECONDS = float(os.environ.get("ML_WORKER_POLL_SECONDS", "2.0"))
LOCK_TTL_SECONDS = float(os.environ.get("ML_WORKER_LOCK_TTL_SECONDS", "600"))


def service_client() -> SupabaseRest:
    if not SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL not set")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY not set (required for worker writes)")
    return SupabaseRest(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _now_iso() -> str:
    import datetime as _dt

    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()


def claim_one_job(sb: SupabaseRest, locked_by: str) -> Optional[dict]:
    # NOTE: Supabase REST doesn't support SELECT ... FOR UPDATE SKIP LOCKED.
    # For MVP: read a few queued jobs, then try to atomically update one.
    jobs = sb.get(
        "ml_jobs",
        {
            "select": "id,organization_id,kind,status,session_id,attempts,input",
            "status": "eq.queued",
            "kind": "eq.process_session",
            "order": "created_at.asc",
            "limit": "10",
        },
    )
    for j in jobs:
        # Attempt to "claim" by moving queued -> running
        try:
            updated = sb.patch(
                "ml_jobs",
                {"id": j["id"], "status": "queued"},
                {
                    "status": "running",
                    "locked_by": locked_by,
                    "locked_at": _now_iso(),
                    "started_at": _now_iso(),
                    "attempts": int(j.get("attempts", 0)) + 1,
                    "error": None,
                },
            )
            if updated:
                return updated[0]
        except Exception:
            continue
    return None


def fetch_assets_for_session(sb: SupabaseRest, session_id: str) -> dict:
    rows = sb.get(
        "assets",
        {"select": "type,file_url", "session_id": f"eq.{session_id}"},
    )
    out = {r["type"]: r["file_url"] for r in rows}
    return out


def download(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    r = httpx.get(url, timeout=60.0)
    r.raise_for_status()
    path.write_bytes(r.content)


def ensure_raw_session(sb: SupabaseRest, session_id: str) -> Path:
    session_dir = RAW / session_id
    sensor_path = session_dir / "sensor.json"
    video_candidates = list(session_dir.glob("video.*"))
    if sensor_path.exists() and video_candidates:
        return session_dir

    assets = fetch_assets_for_session(sb, session_id)
    if "sensor_json" not in assets or "video" not in assets:
        raise RuntimeError(f"Missing assets for session {session_id}: {list(assets.keys())}")

    download(assets["sensor_json"], sensor_path)

    vurl = assets["video"]
    ext = "mp4" if "mp4" in vurl.lower() else "webm"
    download(vurl, session_dir / f"video.{ext}")
    return session_dir


def upload_manifest_and_record_artifact(sb: SupabaseRest, job: dict, manifest_path: Path) -> None:
    # For MVP, upload manifest to existing public bucket under:
    # vla-assets/<org>/pipeline/<job_id>/manifest.parquet
    org_id = job["organization_id"]
    job_id = job["id"]
    object_path = f"{org_id}/pipeline/{job_id}/manifest.parquet"

    # Upload via Storage API (service role).
    # POST /storage/v1/object/<bucket>/<path>
    with open(manifest_path, "rb") as f:
        data = f.read()

    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/vla-assets/{object_path}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
    }
    r = httpx.post(url, headers=headers, content=data, timeout=60.0)
    r.raise_for_status()

    public_base = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/vla-assets"
    public_url = f"{public_base}/{object_path}"

    sb.post(
        "ml_artifacts",
        [
            {
                "organization_id": org_id,
                "job_id": job_id,
                "type": "manifest",
                "file_url": public_url,
                "checksum": None,
                "metadata": {"path": object_path},
            }
        ],
    )


def run_job(sb: SupabaseRest, job: dict) -> None:
    session_id = job.get("session_id")
    if not session_id:
        raise RuntimeError("process_session job missing session_id")

    ensure_raw_session(sb, session_id)
    manifest_path = run_process([session_id])
    upload_manifest_and_record_artifact(sb, job, manifest_path)


def main() -> None:
    load_dotenv()
    ensure_dirs()

    locked_by = f"{socket.gethostname()}:{os.getpid()}"
    sb = service_client()

    print(f"Worker started as {locked_by}. Polling every {POLL_SECONDS}s.")
    while True:
        job = None
        try:
            job = claim_one_job(sb, locked_by=locked_by)
            if not job:
                time.sleep(POLL_SECONDS)
                continue

            try:
                run_job(sb, job)
                sb.patch(
                    "ml_jobs",
                    {"id": job["id"]},
                    {"status": "succeeded", "finished_at": _now_iso(), "output": {"ok": True}},
                )
                print(f"Succeeded job {job['id']}")
            except Exception as e:
                sb.patch(
                    "ml_jobs",
                    {"id": job["id"]},
                    {"status": "failed", "finished_at": _now_iso(), "error": str(e), "output": {"ok": False}},
                )
                print(f"Failed job {job['id']}: {e}", file=sys.stderr)
        except KeyboardInterrupt:
            print("Worker exiting.")
            return
        except Exception as e:
            print("Worker loop error:", e, file=sys.stderr)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()

