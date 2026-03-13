"""
Process: video + sensor.json → aligned dataset (frames + manifest).
Reads from data/raw/<session_id>/ (video.* + sensor.json), extracts frames
aligned to sensor samples, writes data/processed/frames/ and manifest.parquet.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

from config import PROCESSED, RAW, ensure_dirs

# KineticTrace schema (mirrors frontend)
SENSOR_DIMS = ["accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"]


def sensor_sample_to_vec(sample: dict) -> list[float]:
    s = sample.get("sensors", {})
    accel = s.get("accel", {})
    gyro = s.get("gyro", {})
    return [
        accel.get("x", 0.0),
        accel.get("y", 0.0),
        accel.get("z", 0.0),
        gyro.get("x", 0.0),
        gyro.get("y", 0.0),
        gyro.get("z", 0.0),
    ]


def find_session_dirs(raw_dir: Path) -> list[Path]:
    """Session dirs must contain both video.* and sensor.json."""
    out = []
    for p in raw_dir.iterdir():
        if not p.is_dir():
            continue
        has_video = any(p.glob("video.*"))
        if (p / "sensor.json").exists() and has_video:
            out.append(p)
    return sorted(out)


def get_video_path(session_dir: Path) -> Path | None:
    for ext in ("mp4", "webm", "mov"):
        p = session_dir / f"video.{ext}"
        if p.exists():
            return p
    return None


def extract_frames_ffmpeg(video_path: Path, out_dir: Path, num_frames: int, fps: float) -> None:
    """Extract frames 0..num_frames-1; names frame_000000.png, frame_000001.png, ..."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if num_frames <= 0:
        return
    # Extract at 1 fps to limit size, or match video fps if low; cap frames
    n = min(num_frames, 500)
    out_pattern = str(out_dir / "frame_%06d.png")
    # select: frame 0, 1, 2, ... n-1
    select_parts = "+".join(f"eq(n\\,{i})" for i in range(n))
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"select='{select_parts}'", "-vsync", "0",
        out_pattern,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback: sample at 1 fps
        subprocess.run([
            "ffmpeg", "-y", "-i", str(video_path), "-r", "1", "-f", "image2", out_pattern
        ], check=True, capture_output=True)


def process_session(session_dir: Path, frames_root: Path) -> pd.DataFrame:
    session_id = session_dir.name
    video_path = get_video_path(session_dir)
    if not video_path:
        raise FileNotFoundError(f"No video in {session_dir}")

    with open(session_dir / "sensor.json") as f:
        trace = json.load(f)
    metadata = trace.get("metadata", {})
    fps = float(metadata.get("fps", 30))
    samples = trace.get("samples", [])
    if len(samples) < 2:
        return pd.DataFrame()

    # Extract frames 0..N-1 so frame_00000i.png = sample i
    frame_out_dir = frames_root / session_id
    num_frames = min(len(samples), 500)
    extract_frames_ffmpeg(video_path, frame_out_dir, num_frames, fps)

    rows = []
    for i in range(len(samples) - 1):
        cur = samples[i]
        nxt = samples[i + 1]
        # Store path relative to PROCESSED so dataset is portable
        frame_path = str(Path("frames") / session_id / f"frame_{i:06d}.png")
        cur_vec = sensor_sample_to_vec(cur)
        nxt_vec = sensor_sample_to_vec(nxt)
        rows.append({
            "session_id": session_id,
            "frame_idx": i,
            "frame_path": frame_path,
            **{f"sensor_{d}": v for d, v in zip(SENSOR_DIMS, cur_vec)},
            **{f"action_{d}": v for d, v in zip(SENSOR_DIMS, nxt_vec)},
        })

    return pd.DataFrame(rows)


def run(session_ids: list[str] | None = None) -> Path:
    ensure_dirs()
    raw_dir = RAW
    frames_root = PROCESSED / "frames"
    frames_root.mkdir(parents=True, exist_ok=True)

    if session_ids:
        session_dirs = [raw_dir / sid for sid in session_ids if (raw_dir / sid).exists()]
    else:
        session_dirs = find_session_dirs(raw_dir)

    if not session_dirs:
        print("No sessions found in", raw_dir, "(need video.* + sensor.json per session dir)")
        sys.exit(1)

    dfs = []
    for d in session_dirs:
        try:
            df = process_session(d, frames_root)
            if not df.empty:
                dfs.append(df)
        except Exception as e:
            print(f"Skip {d.name}: {e}")
            continue

    if not dfs:
        print("No data produced.")
        sys.exit(1)

    manifest = pd.concat(dfs, ignore_index=True)
    manifest_path = PROCESSED / "manifest.parquet"
    manifest.to_parquet(manifest_path, index=False)
    print(f"Wrote {len(manifest)} rows to {manifest_path}")
    return manifest_path


if __name__ == "__main__":
    ids = sys.argv[1:] if len(sys.argv) > 1 else None
    run(ids)
