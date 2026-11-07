"""Runtime configuration for the ORBITA backend (environment variables with safe defaults)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("ORBITA_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_URL = os.getenv("ORBITA_DB_URL", f"sqlite:///{(DATA_DIR / 'orbita.db').as_posix()}")

# NASA's public DEMO_KEY works without registration (rate limited). A free personal key
# from https://api.nasa.gov/ can be supplied through NASA_API_KEY. No paid API is used.
NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")
HTTP_TIMEOUT = float(os.getenv("ORBITA_HTTP_TIMEOUT", "8"))
# Set ORBITA_LIVE_NASA=0 to force offline mode (bundled, clearly labeled sample data).
ENABLE_LIVE_NASA = os.getenv("ORBITA_LIVE_NASA", "1") == "1"

# Seconds without a reading after which a sensor is considered stale / offline.
SENSOR_STALE_S = 3 * 3600
SENSOR_OFFLINE_S = 8 * 3600
# Window used to look for the "current" value of a vital sign.
CURRENT_WINDOW_H = 6
