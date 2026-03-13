"""Pipeline config: paths and optional Supabase. Load from env or defaults."""
import os
from pathlib import Path

# Base dir: repo root (parent of python/)
BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
MODELS = DATA / "models"

def ensure_dirs():
    RAW.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)

# Optional Supabase (for fetch_sessions.py + worker.py)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Override data paths via env
if os.environ.get("DATA_RAW"):
    RAW = Path(os.environ["DATA_RAW"])
if os.environ.get("DATA_PROCESSED"):
    PROCESSED = Path(os.environ["DATA_PROCESSED"])
if os.environ.get("DATA_MODELS"):
    MODELS = Path(os.environ["DATA_MODELS"])
