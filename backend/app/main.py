"""ORBITA — Astronaut Health Intelligence & Survival System (experimental prototype) — FastAPI app."""
import logging
import threading
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, ENABLE_LIVE_NASA
from .db import Base, SessionLocal, engine, utcnow
from .models import CachedPayload
from .nasa import refresh_osdr, refresh_space_weather
from .routers import crew, response
from .seed import seed

log = logging.getLogger("orbita")


def _refresh_nasa_background() -> None:
    db = SessionLocal()
    try:
        for key, fn in (("donki", refresh_space_weather), ("osdr", refresh_osdr)):
            c = db.get(CachedPayload, key)
            if c is None or c.origin != "live" or utcnow() - c.fetched_at > timedelta(hours=6):
                try:
                    fn(db)
                except Exception as e:  # network problems must never break the app
                    log.warning("NASA refresh %s failed: %s", key, e)
                    db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    if ENABLE_LIVE_NASA:
        threading.Thread(target=_refresh_nasa_background, daemon=True).start()
    yield


app = FastAPI(title="ORBITA API", version="1.0.0", lifespan=lifespan,
              description="Experimental astronaut health decision-support prototype (NASA Space Apps 2026). "
                          "Not a medical device. Not affiliated with or endorsed by NASA. All crew data is simulated.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]) or "body", "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": {"code": "VALIDATION_ERROR", "message": "Invalid input.", "errors": errors}})


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "orbita", "time": utcnow().isoformat() + "Z", "live_nasa": ENABLE_LIVE_NASA}


app.include_router(crew.router)
app.include_router(response.router)

# Serve the built SPA (frontend/dist) when present, so `uvicorn app.main:app` runs the whole system.
DIST = Path(BASE_DIR).parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": {"code": "NOT_FOUND", "message": "Unknown endpoint."}})
        f = DIST / path
        if path and f.is_file() and DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
