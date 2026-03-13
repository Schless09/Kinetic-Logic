"""
Create a minimal fixture session in data/raw so you can run process -> train -> evaluate
without real app data. Uses a 1-second synthetic video and a short sensor trace.
"""
import json
import subprocess
import sys
from pathlib import Path

from config import RAW, ensure_dirs

FIXTURE_SESSION_ID = "fixture-session-001"


def main() -> None:
    ensure_dirs()
    out_dir = RAW / FIXTURE_SESSION_ID
    out_dir.mkdir(parents=True, exist_ok=True)

    # Minimal KineticTrace: 50 samples at 50 Hz (1 sec), video at 30 fps
    samples = []
    for i in range(50):
        t_ms = i * 20
        # Slight variation so the model has something to learn
        samples.append({
            "timestamp_ms": t_ms,
            "video_frame_id": min(i * 30 // 50, 29),
            "sensors": {
                "accel": {"x": 0.1 * (i % 5), "y": 0.0, "z": 9.8},
                "gyro": {"x": 0.01 * i, "y": 0.0, "z": 0.0},
            },
        })
    trace = {
        "metadata": {"device": "fixture", "fps": 30, "sensor_hz": 50},
        "samples": samples,
    }
    (out_dir / "sensor.json").write_text(json.dumps(trace, indent=2))

    # 1-second 30fps video (30 frames) so frame extraction has something to read
    video_path = out_dir / "video.mp4"
    if not video_path.exists():
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
            "-r", "30", "-pix_fmt", "yuv420p", str(video_path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print("ffmpeg failed (need it for fixture video):", e, file=sys.stderr)
            print("Install ffmpeg or copy a real session into data/raw/<session_id>/", file=sys.stderr)
            sys.exit(1)
    print(f"Fixture written to {out_dir}")
    print("Run: python process.py  then  python train.py  then  python evaluate.py")


if __name__ == "__main__":
    main()
