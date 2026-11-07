"""Individual baselines: each astronaut is compared with their OWN history, not a population norm."""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import utcnow
from .metrics import DAILY, METRICS, VITALS
from .models import Astronaut, Baseline, DailyLog, VitalMeasurement

BASELINE_DAYS = 14
MIN_SAMPLES = 5


def compute_baselines(db: Session, astronaut: Astronaut, now: datetime | None = None,
                      days: int = BASELINE_DAYS) -> list[Baseline]:
    """Recompute baselines from simulated + user-entered history (scenario data is excluded)."""
    now = now or utcnow()
    start = now - timedelta(days=days)
    vit = db.execute(select(*[getattr(VitalMeasurement, m) for m in VITALS]).where(
        VitalMeasurement.astronaut_id == astronaut.id, VitalMeasurement.timestamp >= start,
        VitalMeasurement.timestamp <= now, VitalMeasurement.origin != "scenario")).all()
    dly = db.execute(select(*[getattr(DailyLog, m) for m in DAILY]).where(
        DailyLog.astronaut_id == astronaut.id, DailyLog.timestamp >= start, DailyLog.timestamp <= now,
        DailyLog.origin != "scenario")).all()
    frames = [pd.DataFrame(vit, columns=VITALS, dtype="float64"), pd.DataFrame(dly, columns=DAILY, dtype="float64")]
    db.execute(delete(Baseline).where(Baseline.astronaut_id == astronaut.id))
    out = []
    for df in frames:
        for m in df.columns:
            s = df[m].dropna()
            if len(s) < MIN_SAMPLES:
                continue
            std = max(float(s.std(ddof=1)), METRICS[m]["min_std"])
            b = Baseline(astronaut_id=astronaut.id, metric=m, mean=round(float(s.mean()), 3), std=round(std, 3),
                         p05=round(float(np.percentile(s, 5)), 3), p95=round(float(np.percentile(s, 95)), 3),
                         n_samples=int(len(s)), window_start=start, window_end=now, computed_at=utcnow())
            db.add(b)
            out.append(b)
    db.flush()
    return out


def baseline_map(db: Session, astronaut_id: int) -> dict[str, Baseline]:
    return {b.metric: b for b in db.scalars(select(Baseline).where(Baseline.astronaut_id == astronaut_id)).all()}
