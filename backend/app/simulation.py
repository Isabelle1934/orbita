"""Generation of SIMULATED physiological and environmental readings.

Every row produced here is stored with origin="simulated" and is presented as simulated data in the UI.
None of these values come from real astronauts.
"""
import math
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import SENSOR_OFFLINE_S
from .db import utcnow
from .metrics import VITALS, get_setting, put_setting
from .models import Astronaut, Baseline, DailyLog, EnvironmentReading, VitalMeasurement

# Fictional crew physiology used only to generate the initial simulated history.
PROFILES: dict[str, dict] = {
    "AST-01": {"heart_rate": (58, 3.5), "spo2": (98.2, 0.5), "systolic": (112, 4.5), "diastolic": (72, 3.5),
               "temperature": (36.6, 0.15), "respiratory_rate": (13, 1.0),
               "sleep_hours": (7.1, 0.4), "sleep_quality": (82, 5), "activity_minutes": (100, 12),
               "hydration_ml": (2500, 180), "cognitive_score": (93, 2.5)},
    "AST-02": {"heart_rate": (67, 4.0), "spo2": (97.6, 0.6), "systolic": (122, 5.0), "diastolic": (80, 3.5),
               "temperature": (36.8, 0.15), "respiratory_rate": (15, 1.1),
               "sleep_hours": (6.6, 0.45), "sleep_quality": (76, 6), "activity_minutes": (85, 12),
               "hydration_ml": (2300, 170), "cognitive_score": (88, 3)},
    "AST-03": {"heart_rate": (71, 4.0), "spo2": (98.0, 0.5), "systolic": (108, 4.5), "diastolic": (68, 3.5),
               "temperature": (36.9, 0.15), "respiratory_rate": (16, 1.1),
               "sleep_hours": (7.4, 0.4), "sleep_quality": (85, 5), "activity_minutes": (110, 12),
               "hydration_ml": (2600, 180), "cognitive_score": (90, 2.5)},
    "AST-04": {"heart_rate": (63, 3.5), "spo2": (97.2, 0.6), "systolic": (118, 4.5), "diastolic": (76, 3.5),
               "temperature": (36.5, 0.15), "respiratory_rate": (14, 1.0),
               "sleep_hours": (6.9, 0.45), "sleep_quality": (80, 5), "activity_minutes": (90, 12),
               "hydration_ml": (2400, 170), "cognitive_score": (86, 3)},
}
# Population-style defaults for astronauts created later without a profile or baseline.
DEFAULT_PROFILE = {"heart_rate": (68, 4), "spo2": (97.8, 0.6), "systolic": (117, 5), "diastolic": (76, 4),
                   "temperature": (36.7, 0.15), "respiratory_rate": (14, 1.2), "sleep_hours": (7.0, 0.5),
                   "sleep_quality": (78, 6), "activity_minutes": (90, 12), "hydration_ml": (2400, 200),
                   "cognitive_score": (88, 3)}

ENV_PROFILE = {"cabin_pressure_kpa": (101.3, 0.15), "o2_percent": (20.9, 0.12), "co2_mmhg": (2.4, 0.25),
               "cabin_temperature_c": (22.5, 0.5), "humidity_percent": (45, 3), "radiation_ugy_h": (14.0, 1.8)}

VITAL_INTERVAL = timedelta(hours=2)
ENV_INTERVAL = timedelta(hours=1)
MISSING_RATE = 0.03

_rng = np.random.default_rng()


def profile_for(db: Session, astronaut: Astronaut) -> dict:
    """Mean/std per metric: the astronaut's computed baseline if any, else seed profile, else defaults."""
    prof = dict(PROFILES.get(astronaut.code, DEFAULT_PROFILE))
    rows = db.scalars(select(Baseline).where(Baseline.astronaut_id == astronaut.id)).all()
    for b in rows:
        prof[b.metric] = (b.mean, b.std)
    return prof


def _circadian(metric: str, ts: datetime) -> float:
    phase = math.sin(2 * math.pi * ((ts.hour + ts.minute / 60) - 10) / 24)
    return {"heart_rate": 4.0, "systolic": 3.0, "diastolic": 2.0, "temperature": 0.2, "respiratory_rate": 0.6}.get(metric, 0) * phase


def sensor_states(db: Session, astronaut_id: int) -> dict:
    return get_setting(db, f"sensors:{astronaut_id}", {m: "connected" for m in VITALS})


def set_sensor_state(db: Session, astronaut_id: int, metric: str, state: str) -> dict:
    states = sensor_states(db, astronaut_id)
    states[metric] = state
    put_setting(db, f"sensors:{astronaut_id}", states)
    return states


def make_vitals(prof: dict, ts: datetime, rng=None, noise: float = 1.0, skip: set | None = None,
                missing_rate: float = MISSING_RATE) -> dict:
    rng = rng or _rng
    out = {}
    for m in VITALS:
        if skip and m in skip:
            out[m] = None
            continue
        if rng.random() < missing_rate:
            out[m] = None
            continue
        mean, std = prof[m]
        v = mean + _circadian(m, ts) + rng.normal(0, std * noise)
        if m == "spo2":
            v = min(v, 100.0)
        out[m] = round(float(v), 1 if m in ("spo2", "temperature") else 0)
    return out


def make_daily(prof: dict, rng=None, noise: float = 1.0) -> dict:
    rng = rng or _rng
    out = {}
    for m in ("sleep_hours", "sleep_quality", "activity_minutes", "hydration_ml", "cognitive_score"):
        mean, std = prof[m]
        v = mean + rng.normal(0, std * noise)
        if m in ("sleep_quality", "cognitive_score"):
            v = max(0.0, min(100.0, v))
        out[m] = round(float(max(v, 0)), 1 if m == "sleep_hours" else 0)
    return out


def make_env(rng=None, noise: float = 1.0) -> dict:
    rng = rng or _rng
    return {k: round(float(mean + rng.normal(0, std * noise)), 2) for k, (mean, std) in ENV_PROFILE.items()}


def generate_history(db: Session, astronaut: Astronaut, start: datetime, end: datetime, rng=None,
                     sensor_gaps: dict | None = None) -> None:
    """Fill [start, end] with simulated vitals (every 2 h) and one daily log per day."""
    rng = rng or _rng
    prof = profile_for(db, astronaut)
    ts = start
    while ts <= end:
        skip = {m for m, (g0, g1) in (sensor_gaps or {}).items() if g0 <= ts <= g1}
        db.add(VitalMeasurement(astronaut_id=astronaut.id, timestamp=ts, origin="simulated",
                                **make_vitals(prof, ts, rng, skip=skip)))
        ts += VITAL_INTERVAL
    day = start.date()
    while day <= end.date():
        log_ts = datetime.combine(day, datetime.min.time()) + timedelta(hours=7)
        if start <= log_ts <= end:
            db.add(DailyLog(astronaut_id=astronaut.id, day=day, timestamp=log_ts, origin="simulated",
                            **make_daily(prof, rng)))
        day += timedelta(days=1)


def generate_env_history(db: Session, start: datetime, end: datetime, rng=None) -> None:
    rng = rng or _rng
    ts = start
    while ts <= end:
        db.add(EnvironmentReading(timestamp=ts, origin="simulated", **make_env(rng)))
        ts += ENV_INTERVAL


def ensure_fresh(db: Session, now: datetime | None = None, skip_ids: set[int] | None = None,
                 skip_env: bool = False) -> bool:
    """Backfill the simulated feed up to `now`, so the demo keeps working days after seeding.

    Respects the simulated sensor connection state: disconnected sensors produce no values.
    Returns True if new rows were added.
    """
    now = now or utcnow()
    added = False
    horizon = now - timedelta(days=14)
    for a in db.scalars(select(Astronaut).where(Astronaut.active.is_(True))).all():
        if skip_ids and a.id in skip_ids:
            continue
        last = db.scalar(select(VitalMeasurement.timestamp).where(
            VitalMeasurement.astronaut_id == a.id, VitalMeasurement.origin == "simulated"
        ).order_by(VitalMeasurement.timestamp.desc()).limit(1))
        start = max((last + VITAL_INTERVAL) if last else horizon, horizon)
        if start <= now:
            states = sensor_states(db, a.id)
            prof = profile_for(db, a)
            ts = start
            skip = {m for m, s in states.items() if s != "connected"}
            while ts <= now:
                db.add(VitalMeasurement(astronaut_id=a.id, timestamp=ts, origin="simulated",
                                        **make_vitals(prof, ts, skip=skip)))
                ts += VITAL_INTERVAL
            added = True
        last_day = db.scalar(select(DailyLog.day).where(DailyLog.astronaut_id == a.id)
                             .order_by(DailyLog.day.desc()).limit(1))
        day = (last_day + timedelta(days=1)) if last_day else horizon.date()
        prof = profile_for(db, a)
        while day <= now.date():
            log_ts = datetime.combine(day, datetime.min.time()) + timedelta(hours=7)
            if log_ts <= now:
                db.add(DailyLog(astronaut_id=a.id, day=day, timestamp=log_ts, origin="simulated", **make_daily(prof)))
                added = True
            day += timedelta(days=1)
    last_env = db.scalar(select(EnvironmentReading.timestamp).where(EnvironmentReading.origin == "simulated")
                         .order_by(EnvironmentReading.timestamp.desc()).limit(1))
    start = max((last_env + ENV_INTERVAL) if last_env else horizon, horizon)
    if start <= now and not skip_env:
        generate_env_history(db, start, now)
        added = True
    if added:
        db.commit()
    return added


def simulate_now(db: Session, astronaut: Astronaut, now: datetime | None = None) -> VitalMeasurement:
    """One live-style simulated reading (used by the Vital-Scan simulated feed)."""
    now = now or utcnow()
    states = sensor_states(db, astronaut.id)
    skip = {m for m, s in states.items() if s != "connected"}
    row = VitalMeasurement(astronaut_id=astronaut.id, timestamp=now, origin="simulated",
                           **make_vitals(profile_for(db, astronaut), now, noise=0.7, skip=skip, missing_rate=0.01))
    db.add(row)
    return row


__all__ = ["PROFILES", "ensure_fresh", "simulate_now", "generate_history", "generate_env_history",
           "sensor_states", "set_sensor_state", "SENSOR_OFFLINE_S"]
