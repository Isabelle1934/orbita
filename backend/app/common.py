"""Shared API helpers: demo-access auth, serialization, freshness."""
from datetime import date, datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .alerting import active_run
from .db import get_db, iso
from .models import Astronaut, DemoSession, ScenarioRun
from .simulation import ensure_fresh


def row_dict(obj, exclude: set[str] | None = None) -> dict:
    out = {}
    for col in inspect(obj).mapper.column_attrs:
        k = col.key
        if exclude and k in exclude:
            continue
        v = getattr(obj, k)
        if isinstance(v, datetime):
            v = iso(v)
        elif isinstance(v, date):
            v = v.isoformat()
        out[k] = v
    return out


def require_session(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> DemoSession:
    """DEMO ACCESS MODE: a token issued by POST /api/auth/demo. Not production authentication."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "DEMO_SESSION_REQUIRED", "message": "Enter demo access mode first."})
    s = db.get(DemoSession, authorization.split(" ", 1)[1].strip())
    if s is None:
        raise HTTPException(401, detail={"code": "DEMO_SESSION_INVALID", "message": "Demo session expired or unknown."})
    return s


def get_astronaut(db: Session, astronaut_id: int) -> Astronaut:
    a = db.get(Astronaut, astronaut_id)
    if a is None:
        raise HTTPException(404, detail={"code": "ASTRONAUT_NOT_FOUND", "message": f"Astronaut {astronaut_id} not found."})
    return a


def freshen(db: Session) -> ScenarioRun | None:
    """Advance the simulated feed to 'now' (except data held by an active scenario)."""
    run = active_run(db)
    skip = {run.astronaut_id} if run else set()
    skip_env = bool(run and run.scenario_key == "environment")
    ensure_fresh(db, skip_ids=skip, skip_env=skip_env)
    return run


def astronaut_dict(a: Astronaut) -> dict:
    return row_dict(a)


__all__ = ["row_dict", "require_session", "get_astronaut", "freshen", "astronaut_dict", "select"]
