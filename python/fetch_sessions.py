"""
Optional: fetch session assets from Supabase into data/raw/<session_id>/.
Requires SUPABASE_URL and SUPABASE_ANON_KEY. Sessions are read from the API
(sessions with status=uploaded and their assets). Run this before process.py
if you want to pull from the app instead of copying files manually.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from config import RAW, ensure_dirs

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx")
    sys.exit(1)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


def fetch_uploaded_sessions() -> list[dict]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Set SUPABASE_URL and SUPABASE_ANON_KEY")
        return []
    url = f"{SUPABASE_URL}/rest/v1/sessions"
    r = httpx.get(
        url,
        params={"status": "eq.uploaded", "select": "id"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    r.raise_for_status()
    return r.json()


def fetch_assets(session_id: str) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/assets"
    r = httpx.get(
        url,
        params={"session_id": "eq." + session_id, "select": "type,file_url"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    r.raise_for_status()
    return r.json()


def download_file(url: str, path: Path) -> None:
    r = httpx.get(url)
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)


def run(session_ids: list[str] | None = None, limit: int = 20) -> None:
    ensure_dirs()
    if not session_ids:
        sessions = fetch_uploaded_sessions()
        session_ids = [s["id"] for s in sessions[:limit]]
    if not session_ids:
        print("No sessions to fetch")
        return
    for sid in session_ids:
        out_dir = RAW / sid
        if (out_dir / "sensor.json").exists() and list(out_dir.glob("video.*")):
            print(f"Skip {sid} (already present)")
            continue
        assets = fetch_assets(sid)
        for a in assets:
            url = a["file_url"]
            t = a["type"]
            if t == "sensor_json":
                download_file(url, out_dir / "sensor.json")
            elif t == "video":
                ext = "mp4" if "mp4" in url.lower() else "webm"
                download_file(url, out_dir / f"video.{ext}")
        print(f"Fetched {sid}")


if __name__ == "__main__":
    ids = sys.argv[1:] if len(sys.argv) > 1 else None
    run(ids)
