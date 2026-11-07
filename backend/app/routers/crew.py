"""Auth (demo mode), mission status, astronauts, baselines, measurements, daily logs, sensors."""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..alerting import RANK, active_run, run_crew
from ..analysis import analyze
from ..baselines import compute_baselines
from ..common import freshen, get_astronaut, require_session, row_dict
from ..config import SENSOR_OFFLINE_S, SENSOR_STALE_S
from ..db import L, get_db, iso, utcnow
from ..metrics import DAILY, METRICS, VITALS, get_setting, get_thresholds
from ..models import (Alert, Astronaut, Baseline, DailyLog, DemoSession, EmergencyEvent, EnvironmentReading, Mission,
                      SyncRecord, SystemEvent, VitalMeasurement)
from ..nasa import space_context, space_weather
from ..scenarios import SCENARIOS, continue_reading
from ..simulation import sensor_states, set_sensor_state, simulate_now

router = APIRouter(prefix="/api")


# ---------------- Demo access ----------------
class DemoLogin(BaseModel):
    name: str = Field(default="Demo Judge", min_length=1, max_length=60)
    role: str = Field(default="flight_surgeon_demo", pattern="^(crew_medical_officer|commander|flight_surgeon_demo|observer)$")


@router.post("/auth/demo")
def demo_login(body: DemoLogin, db: Session = Depends(get_db)):
    token = secrets.token_urlsafe(32)
    db.add(DemoSession(token=token, name=body.name.strip(), role=body.role))
    db.commit()
    return {"token": token, "name": body.name.strip(), "role": body.role, "mode": "demo",
            "notice": "Demo access mode — not production authentication. No real accounts exist."}


@router.get("/auth/me")
def me(s: DemoSession = Depends(require_session)):
    return {"name": s.name, "role": s.role, "mode": "demo", "since": iso(s.created_at)}


@router.post("/auth/logout")
def logout(s: DemoSession = Depends(require_session), db: Session = Depends(get_db)):
    db.delete(db.get(DemoSession, s.token))
    db.commit()
    return {"ok": True}


# ---------------- Mission status ----------------
def latest_vitals(db: Session, astronaut_id: int, now: datetime) -> dict:
    out = {}
    rows = db.scalars(select(VitalMeasurement).where(VitalMeasurement.astronaut_id == astronaut_id,
                                                     VitalMeasurement.timestamp <= now,
                                                     VitalMeasurement.timestamp > now - timedelta(hours=12))
                      .order_by(VitalMeasurement.timestamp.desc())).all()
    for m in VITALS:
        for r in rows:
            v = getattr(r, m)
            if v is not None:
                out[m] = {"value": v, "at": iso(r.timestamp), "origin": r.origin}
                break
    return out


@router.get("/mission")
def mission_status(db: Session = Depends(get_db), _=Depends(require_session)):
    run = freshen(db)
    now = utcnow()
    results = run_crew(db, now)
    db.commit()
    m = db.scalars(select(Mission)).first()
    day = int((now - m.start_at).total_seconds() // 86400) + 1
    crew = []
    for r in results:
        a = db.get(Astronaut, r["astronaut_id"])
        crew.append({**row_dict(a), "level": r["level"], "score": r["score"], "category": r["category"],
                     "confidence": r["confidence"]["label"], "top": [{"label": c["label"], "points": c["points"]} for c in r["contributors"][:3]],
                     "vitals": latest_vitals(db, a.id, now), "missing": len(r["confidence"]["missing"])})
    overall = max((c["level"] for c in crew), key=RANK.get, default="GREEN")
    alerts = db.scalars(select(Alert).where(Alert.status != "resolved").order_by(Alert.created_at.desc())).all()
    if any(al.astronaut_id is None and al.level == "RED" for al in alerts):
        overall = "RED"
    elif overall == "GREEN" and any(al.level == "YELLOW" for al in alerts):
        overall = "YELLOW"
    env = db.scalars(select(EnvironmentReading).where(EnvironmentReading.timestamp <= now)
                     .order_by(EnvironmentReading.timestamp.desc()).limit(1)).first()
    events = db.scalars(select(SystemEvent).order_by(SystemEvent.timestamp.desc()).limit(12)).all()
    changes = sorted(([{"astronaut_id": r["astronaut_id"], "astronaut_name": r["astronaut_name"], **c}
                       for r in results for c in r["contributors"] if c["kind"] in ("vital", "daily")]),
                     key=lambda c: -c["points"])[:8]
    emergencies = db.scalars(select(EmergencyEvent).where(EmergencyEvent.status != "resolved")).all()
    sw = space_weather(db, now)
    last_sync = db.scalars(select(SyncRecord).where(SyncRecord.status == "delivered").order_by(SyncRecord.completed_at.desc())).first()
    return {
        "mission": {**row_dict(m), "day": day, "days_remaining": max(m.planned_duration_days - day, 0)},
        "server_time": iso(now), "overall_status": overall, "crew": crew,
        "active_alerts": [alert_brief(db, al) for al in alerts],
        "active_emergencies": [{"id": e.id, "astronaut_id": e.astronaut_id, "priority": e.priority, "status": e.status,
                                "category": e.category, "opened_at": iso(e.opened_at)} for e in emergencies],
        "environment": row_dict(env) if env else None,
        "recent_changes": changes,
        "events": [row_dict(e) for e in events],
        "space_weather": {"origin": sw["origin"], "counts": sw["counts"], "recent_72h": sw["recent_72h"],
                          "significant": sw["significant"][:3], "label": sw["label"], "fetched_at": sw["fetched_at"]},
        "scenario": {"active": bool(run), "key": run.scenario_key if run else None,
                     "title": SCENARIOS[run.scenario_key]["title"] if run else None, "astronaut_id": run.astronaut_id if run else None},
        "link": get_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20}),
        "last_sync_at": iso(last_sync.completed_at) if last_sync else None,
    }


def alert_brief(db: Session, al: Alert) -> dict:
    a = db.get(Astronaut, al.astronaut_id) if al.astronaut_id else None
    em = db.scalars(select(EmergencyEvent).where(EmergencyEvent.alert_id == al.id)).first()
    d = row_dict(al, exclude={"analysis"})
    d.update(astronaut_name=a.name if a else None, astronaut_code=a.code if a else None, emergency_id=em.id if em else None)
    return d


# ---------------- Astronauts ----------------
class AstronautIn(BaseModel):
    code: str = Field(min_length=2, max_length=16, pattern=r"^[A-Z0-9\-]+$")
    name: str = Field(min_length=2, max_length=120)
    role: str = Field(min_length=2, max_length=80)
    age: int = Field(ge=18, le=80)
    sex: str = Field(pattern="^(F|M|X)$")
    mass_kg: float = Field(ge=30, le=200)
    notes: str = Field(default="", max_length=500)


class AstronautPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: str | None = Field(default=None, min_length=2, max_length=80)
    age: int | None = Field(default=None, ge=18, le=80)
    mass_kg: float | None = Field(default=None, ge=30, le=200)
    notes: str | None = Field(default=None, max_length=500)
    active: bool | None = None


@router.get("/astronauts")
def list_astronauts(db: Session = Depends(get_db), _=Depends(require_session)):
    return [row_dict(a) for a in db.scalars(select(Astronaut).order_by(Astronaut.code)).all()]


@router.post("/astronauts", status_code=201)
def create_astronaut(body: AstronautIn, db: Session = Depends(get_db), s=Depends(require_session)):
    if db.scalar(select(Astronaut.id).where(Astronaut.code == body.code)):
        raise HTTPException(409, detail={"code": "CODE_TAKEN", "message": "Astronaut code already exists."})
    a = Astronaut(**body.model_dump(), is_fictional=True)
    db.add(a)
    db.flush()
    db.add(SystemEvent(kind="crew", message=L(f"Crew profile {a.name} created by {s.name}.", f"Perfil {a.name} criado por {s.name}."),
                       astronaut_id=a.id))
    db.commit()
    return row_dict(a)


@router.get("/astronauts/{astronaut_id}")
def astronaut_detail(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    return {**row_dict(a), "baselines": [row_dict(b) for b in a.baselines]}


@router.patch("/astronauts/{astronaut_id}")
def patch_astronaut(astronaut_id: int, body: AstronautPatch, db: Session = Depends(get_db), _=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    return row_dict(a)


@router.get("/astronauts/{astronaut_id}/baselines")
def get_baselines(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    return [{**row_dict(b), "label": METRICS[b.metric]["label"], "unit": METRICS[b.metric]["unit"]} for b in a.baselines]


@router.post("/astronauts/{astronaut_id}/baselines/recompute")
def recompute(astronaut_id: int, days: int = Query(14, ge=3, le=60), db: Session = Depends(get_db), s=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    out = compute_baselines(db, a, days=days)
    db.add(SystemEvent(kind="baseline", astronaut_id=a.id,
                       message=L(f"Personal baseline of {a.name} recomputed from the last {days} days ({s.name}).",
                                 f"Linha de base de {a.name} recalculada com os últimos {days} dias ({s.name}).")))
    db.commit()
    return [row_dict(b) for b in out]


# ---------------- Measurements ----------------
def _rng(m):
    return METRICS[m]["range"]


class VitalIn(BaseModel):
    timestamp: datetime | None = None
    heart_rate: float | None = Field(default=None, ge=_rng("heart_rate")[0], le=_rng("heart_rate")[1])
    spo2: float | None = Field(default=None, ge=_rng("spo2")[0], le=_rng("spo2")[1])
    systolic: float | None = Field(default=None, ge=_rng("systolic")[0], le=_rng("systolic")[1])
    diastolic: float | None = Field(default=None, ge=_rng("diastolic")[0], le=_rng("diastolic")[1])
    temperature: float | None = Field(default=None, ge=_rng("temperature")[0], le=_rng("temperature")[1])
    respiratory_rate: float | None = Field(default=None, ge=_rng("respiratory_rate")[0], le=_rng("respiratory_rate")[1])
    note: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def check(self):
        if all(getattr(self, m) is None for m in VITALS):
            raise ValueError("Provide at least one measurement.")
        if self.systolic is not None and self.diastolic is not None and self.diastolic >= self.systolic:
            raise ValueError("Diastolic pressure must be lower than systolic pressure.")
        return self


class DailyIn(BaseModel):
    timestamp: datetime | None = None
    sleep_hours: float | None = Field(default=None, ge=0, le=16)
    sleep_quality: float | None = Field(default=None, ge=0, le=100)
    activity_minutes: float | None = Field(default=None, ge=0, le=600)
    hydration_ml: float | None = Field(default=None, ge=0, le=8000)
    cognitive_score: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def check(self):
        if all(getattr(self, m) is None for m in DAILY):
            raise ValueError("Provide at least one value.")
        return self


def _ts(ts: datetime | None) -> datetime:
    now = utcnow()
    if ts is None:
        return now
    ts = ts.replace(tzinfo=None) if ts.tzinfo is None else (ts - ts.utcoffset()).replace(tzinfo=None)
    if ts > now + timedelta(minutes=5):
        raise HTTPException(422, detail={"code": "FUTURE_TIMESTAMP", "message": "Timestamp cannot be in the future."})
    if ts < now - timedelta(days=60):
        raise HTTPException(422, detail={"code": "TIMESTAMP_TOO_OLD", "message": "Timestamp older than 60 days."})
    return ts


def _analysis_after_write(db: Session, a: Astronaut) -> dict:
    now = utcnow()
    res = run_crew(db, now, astronaut_ids=[a.id])[0]
    db.commit()
    return {"level": res["level"], "score": res["score"], "alert": res["persisted"]}


@router.get("/astronauts/{astronaut_id}/measurements")
def get_measurements(astronaut_id: int, hours: int = Query(72, ge=1, le=24 * 60), db: Session = Depends(get_db),
                     _=Depends(require_session)):
    get_astronaut(db, astronaut_id)
    since = utcnow() - timedelta(hours=hours)
    rows = db.scalars(select(VitalMeasurement).where(VitalMeasurement.astronaut_id == astronaut_id,
                                                     VitalMeasurement.timestamp >= since)
                      .order_by(VitalMeasurement.timestamp)).all()
    return [row_dict(r, exclude={"astronaut_id"}) for r in rows]


@router.post("/astronauts/{astronaut_id}/measurements", status_code=201)
def add_measurement(astronaut_id: int, body: VitalIn, db: Session = Depends(get_db), s=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    row = VitalMeasurement(astronaut_id=a.id, timestamp=_ts(body.timestamp), origin="user",
                           note=(body.note or f"entered by {s.name}")[:300],
                           **{m: getattr(body, m) for m in VITALS})
    db.add(row)
    db.add(SystemEvent(kind="manual_entry", astronaut_id=a.id,
                       message=L(f"Manual vital-sign entry for {a.name} by {s.name}.", f"Entrada manual de sinais vitais de {a.name} por {s.name}.")))
    db.flush()
    return {"measurement": row_dict(row), "analysis": _analysis_after_write(db, a)}


@router.post("/astronauts/{astronaut_id}/simulate", status_code=201)
def simulate(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    run = active_run(db)
    if run and run.astronaut_id == a.id:
        row = continue_reading(db, run, a)
    else:
        row = simulate_now(db, a)
    db.flush()
    return {"measurement": row_dict(row), "simulated": True, "analysis": _analysis_after_write(db, a)}


@router.get("/astronauts/{astronaut_id}/daily")
def get_daily(astronaut_id: int, days: int = Query(14, ge=1, le=60), db: Session = Depends(get_db), _=Depends(require_session)):
    get_astronaut(db, astronaut_id)
    since = utcnow() - timedelta(days=days)
    rows = db.scalars(select(DailyLog).where(DailyLog.astronaut_id == astronaut_id, DailyLog.timestamp >= since)
                      .order_by(DailyLog.timestamp)).all()
    pri = {"user": 3, "scenario": 2, "simulated": 1}
    by_day: dict = {}
    for r in rows:
        cur = by_day.get(r.day)
        if cur is None or (pri[r.origin], r.timestamp) >= (pri[cur.origin], cur.timestamp):
            by_day[r.day] = r
    return [row_dict(by_day[d], exclude={"astronaut_id"}) for d in sorted(by_day)]


@router.post("/astronauts/{astronaut_id}/daily", status_code=201)
def add_daily(astronaut_id: int, body: DailyIn, db: Session = Depends(get_db), s=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    ts = _ts(body.timestamp)
    prev = db.scalars(select(DailyLog).where(DailyLog.astronaut_id == a.id, DailyLog.day == ts.date())
                      .order_by(DailyLog.timestamp.desc())).first()
    vals = {m: getattr(body, m) for m in DAILY}
    if prev:  # carry over indicators not re-entered
        vals = {m: (v if v is not None else getattr(prev, m)) for m, v in vals.items()}
    row = DailyLog(astronaut_id=a.id, day=ts.date(), timestamp=ts, origin="user", **vals)
    db.add(row)
    db.add(SystemEvent(kind="manual_entry", astronaut_id=a.id,
                       message=L(f"Daily log entered for {a.name} by {s.name}.", f"Registro diário de {a.name} inserido por {s.name}.")))
    db.flush()
    return {"log": row_dict(row), "analysis": _analysis_after_write(db, a)}


# ---------------- Sensors ----------------
class SensorIn(BaseModel):
    metric: str = Field(pattern="^(" + "|".join(VITALS) + ")$")
    state: str = Field(pattern="^(connected|disconnected)$")


@router.get("/astronauts/{astronaut_id}/sensors")
def sensors(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    get_astronaut(db, astronaut_id)
    now = utcnow()
    states = sensor_states(db, astronaut_id)
    out = []
    for m in VITALS:
        last = db.scalar(select(func.max(VitalMeasurement.timestamp)).where(
            VitalMeasurement.astronaut_id == astronaut_id, getattr(VitalMeasurement, m).is_not(None),
            VitalMeasurement.timestamp <= now))
        age = (now - last).total_seconds() if last else None
        if states.get(m) == "disconnected":
            status = "disconnected"
        elif age is None or age > SENSOR_OFFLINE_S:
            status = "offline"
        elif age > SENSOR_STALE_S:
            status = "stale"
        else:
            status = "online"
        out.append({"metric": m, "label": METRICS[m]["label"], "unit": METRICS[m]["unit"], "state": states.get(m, "connected"),
                    "status": status, "last_reading_at": iso(last), "age_s": int(age) if age is not None else None})
    total = db.scalar(select(func.count()).select_from(VitalMeasurement).where(
        VitalMeasurement.astronaut_id == astronaut_id, VitalMeasurement.timestamp >= now - timedelta(hours=24)))
    gaps = {m: db.scalar(select(func.count()).select_from(VitalMeasurement).where(
        VitalMeasurement.astronaut_id == astronaut_id, VitalMeasurement.timestamp >= now - timedelta(hours=24),
        getattr(VitalMeasurement, m).is_(None))) for m in VITALS}
    return {"sensors": out, "readings_24h": total, "missing_24h": gaps,
            "stale_after_s": SENSOR_STALE_S, "offline_after_s": SENSOR_OFFLINE_S}


@router.put("/astronauts/{astronaut_id}/sensors")
def set_sensor(astronaut_id: int, body: SensorIn, db: Session = Depends(get_db), s=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    states = set_sensor_state(db, a.id, body.metric, body.state)
    db.add(SystemEvent(kind="sensor", astronaut_id=a.id, severity="warn" if body.state == "disconnected" else "info",
                       message=L(f"{METRICS[body.metric]['label']['en']} sensor of {a.name} {body.state} (simulated, by {s.name}).",
                                 f"Sensor de {METRICS[body.metric]['label']['pt']} de {a.name} {'desconectado' if body.state == 'disconnected' else 'conectado'} (simulado, por {s.name}).")))
    db.commit()
    return states


# ---------------- Analysis ----------------
@router.get("/astronauts/{astronaut_id}/analysis")
def astronaut_analysis(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    a = get_astronaut(db, astronaut_id)
    return analyze(db, a, utcnow(), get_thresholds(db), space_context(db))


@router.get("/analysis/crew")
@router.post("/analysis/run")
def analysis_run(db: Session = Depends(get_db), _=Depends(require_session)):
    freshen(db)
    res = run_crew(db, utcnow())
    db.commit()
    return res


@router.get("/astronauts/{astronaut_id}/history")
def astronaut_history(astronaut_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    """Historical records: alerts, emergencies and system events of one astronaut."""
    get_astronaut(db, astronaut_id)
    alerts = db.scalars(select(Alert).where(Alert.astronaut_id == astronaut_id).order_by(Alert.created_at.desc())).all()
    ems = db.scalars(select(EmergencyEvent).where(EmergencyEvent.astronaut_id == astronaut_id).order_by(EmergencyEvent.opened_at.desc())).all()
    events = db.scalars(select(SystemEvent).where(SystemEvent.astronaut_id == astronaut_id).order_by(SystemEvent.timestamp.desc()).limit(50)).all()
    return {"alerts": [row_dict(al, exclude={"analysis"}) for al in alerts],
            "emergencies": [row_dict(e, exclude={"snapshot"}) for e in ems],
            "events": [row_dict(e) for e in events]}


__all__ = ["router", "Baseline"]
