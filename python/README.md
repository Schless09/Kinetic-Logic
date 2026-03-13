# VLA Pipeline MVP: Video → Data → Training → Evaluation

Lightweight Python pipeline for processing Kinetic Logic recordings into training data, training a small behavioral cloning (BC) policy, and evaluating it—**no robots required**. All evaluation is on holdout data and optional toy rollouts.

## Pipeline stages

1. **Process** (`process.py`): Ingest `video.*` + `sensor.json` per session → extract frames, align to sensor samples → write `data/processed/frames/<session_id>/` and `data/processed/manifest.parquet`.
2. **Train** (`train.py`): Load manifest, train a small (image + sensor) → next-sensor BC model; save to `data/models/bc_policy.pt`.
3. **Evaluate** (`evaluate.py`): Load trained model, report validation MSE/RMSE and an optional toy rollout (reusing first frame).

## Setup

**From repo root (recommended):** run once, then use the npm scripts so you never have to activate the venv:

```bash
npm run python:setup    # once: creates python/.venv and installs deps
npm run python:fixture  # optional: create test data
npm run python:process
npm run python:train
npm run python:evaluate
```

**Or manually:** use a virtual environment so pipeline deps don’t conflict with other tools:

```bash
cd python
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Requires **ffmpeg** on PATH for frame extraction.

**Environment:** The pipeline reads from **`python/.env`** (separate from the Next.js root `.env.local`). Copy `python/.env.example` to `python/.env` and set `SUPABASE_URL` and, for the worker, `SUPABASE_SERVICE_ROLE_KEY`. The app’s `NEXT_PUBLIC_*` vars are not used here.

## Data layout

- **Input (raw)**  
  - Option A: Put files manually under `data/raw/<session_id>/`:
    - `video.mp4` or `video.webm`
    - `sensor.json` (KineticTrace: `metadata` + `samples` with `timestamp_ms`, `video_frame_id`, `sensors.accel`, `sensors.gyro`).
  - Option B: Pull from Supabase with `fetch_sessions.py` (set `SUPABASE_URL`, `SUPABASE_ANON_KEY`); it writes into `data/raw/<session_id>/`.

- **Processed**  
  - `data/processed/frames/<session_id>/frame_000000.png`, ...
  - `data/processed/manifest.parquet` (columns: `session_id`, `frame_idx`, `frame_path`, `sensor_*`, `action_*`).

- **Models**  
  - `data/models/bc_policy.pt` (after training).

## Quick test (no real data)

From repo root (after `npm run python:setup`):

```bash
npm run python:fixture    # creates data/raw/fixture-session-001/
npm run python:process   # → data/processed/
npm run python:train      # → data/models/bc_policy.pt
npm run python:evaluate  # prints MSE + toy rollout
```

## Run (real data)

```bash
# Optional: fetch sessions from Supabase into data/raw
export SUPABASE_URL=... SUPABASE_ANON_KEY=...
python fetch_sessions.py

# 1. Process: raw → frames + manifest
python process.py
# Or specific sessions: python process.py <session_id_1> <session_id_2>

# 2. Train: manifest → BC model
python train.py

# 3. Evaluate: load model, report MSE + toy rollout
python evaluate.py
```

Paths can be overridden with `DATA_RAW`, `DATA_PROCESSED`, `DATA_MODELS` (or use `config.py`).

## Worker (pipeline “full loop”)

If you apply the `supabase/migrations/20250321000000_ml_jobs_and_artifacts.sql` migration, the DB will automatically enqueue an `ml_jobs` row when a `session.status` becomes `uploaded`.

To run the worker (writes job status + artifacts), you’ll need `SUPABASE_SERVICE_ROLE_KEY`:

```bash
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
python worker.py
```

## Model

- **BCPolicy**: small CNN on 64×64 RGB frame + 6-D sensor (accel + gyro) → 6-D “action” (next sensor). Trained with MSE; no robot, just supervised prediction on your data.

## No robots

Training and evaluation use only the collected traces. Evaluation is validation loss and an optional autoregressive toy rollout (first frame fixed, predict next sensor for a few steps). For real robot deployment you’d later plug this policy into your stack (sim or hardware).
