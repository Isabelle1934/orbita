"""SIMULATED emergency scenarios for demonstration. Every row created here has origin="scenario".

Each scenario injects progressive readings (initial state -> deviation -> critical), runs the
Early Warning engine "as of" each stage time and records the resulting event history.
"""
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .alerting import active_emergency, log_event, run_crew
from .baselines import baseline_map
from .db import L, iso, utcnow
from .models import Astronaut, DailyLog, EnvironmentReading, ScenarioRun, VitalMeasurement
from .simulation import ENV_PROFILE, PROFILES

SCENARIOS: dict[str, dict] = {
    "cardio": {
        "astronaut": "AST-01", "category": "cardiovascular",
        "title": L("Scenario 1 — Cardiovascular changes", "Cenário 1 — Alterações cardiovasculares"),
        "summary": L("Heart rate rises with increasing irregularity while SpO2 and blood pressure fall during a work period.",
                     "A frequência cardíaca sobe com irregularidade crescente enquanto SpO2 e pressão caem durante um período de trabalho."),
        "stages": [
            {"key": "initial", "minutes_before": 50, "label": L("Initial state", "Estado inicial"),
             "vitals": {"heart_rate": 2, "respiratory_rate": 0.5}},
            {"key": "deviation", "minutes_before": 28, "label": L("Early deviation", "Desvio inicial"),
             "vitals": {"heart_rate": 17, "respiratory_rate": 2.6, "spo2": -0.8, "systolic": -4}, "jitter": {"heart_rate": 2}},
            {"key": "critical", "minutes_before": 4, "label": L("Critical pattern", "Padrão crítico"),
             "vitals": {"heart_rate": 64, "spo2": -5.4, "systolic": -24, "diastolic": -13, "respiratory_rate": 9, "temperature": 0.2},
             "jitter": {"heart_rate": 12}},
        ],
    },
    "fatigue": {
        "astronaut": "AST-04", "category": "fatigue",
        "title": L("Scenario 2 — Sleep deprivation and cognitive decline", "Cenário 2 — Privação de sono e queda cognitiva"),
        "summary": L("Three nights of shortened, poor-quality sleep with falling cognitive assessment scores and reduced fluid intake.",
                     "Três noites de sono curto e de baixa qualidade, com queda nas avaliações cognitivas e menor ingestão de líquidos."),
        "stages": [
            {"key": "initial", "minutes_before": 3 * 1440, "label": L("Initial state", "Estado inicial"),
             "daily": [(3 * 1440, {"sleep_hours": -0.8, "sleep_quality": -8, "cognitive_score": -2, "hydration_ml": -100})],
             "vitals": {"heart_rate": 1}},
            {"key": "deviation", "minutes_before": 1440, "label": L("Accumulating sleep debt", "Débito de sono acumulado"),
             "daily": [(2 * 1440, {"sleep_hours": -1.9, "sleep_quality": -30, "cognitive_score": -9, "hydration_ml": -300}),
                       (1440, {"sleep_hours": -2.5, "sleep_quality": -38, "cognitive_score": -14, "hydration_ml": -450, "activity_minutes": -30})],
             "vitals": {"heart_rate": 5, "temperature": 0.1}},
            {"key": "critical", "minutes_before": 5, "label": L("Critical fatigue pattern", "Padrão crítico de fadiga"),
             "daily": [(5, {"sleep_hours": -3.6, "sleep_quality": -50, "cognitive_score": -28, "hydration_ml": -800, "activity_minutes": -55})],
             "vitals": {"heart_rate": 9, "respiratory_rate": 1.5, "temperature": 0.2}},
        ],
    },
    "environment": {
        "astronaut": "AST-03", "category": "environmental",
        "title": L("Scenario 3 — Environmental risk", "Cenário 3 — Risco ambiental"),
        "summary": L("Cabin CO2 partial pressure rises (simulated scrubber degradation) while one crew member shows respiratory and heart-rate changes.",
                     "A pressão parcial de CO2 da cabine sobe (degradação simulada do filtro) enquanto um tripulante apresenta alterações respiratórias e cardíacas."),
        "stages": [
            {"key": "initial", "minutes_before": 60, "label": L("Initial state", "Estado inicial"),
             "env": {"co2_mmhg": 2.9, "o2_percent": 20.8}, "vitals": {"respiratory_rate": 0.5}},
            {"key": "deviation", "minutes_before": 35, "label": L("CO2 rising", "CO2 em elevação"),
             "env": {"co2_mmhg": 4.6, "o2_percent": 20.5, "cabin_temperature_c": 23.6},
             "vitals": {"respiratory_rate": 3.0, "heart_rate": 4}},
            {"key": "critical", "minutes_before": 5, "label": L("Critical environment + physiology", "Ambiente crítico + fisiologia"),
             "env": {"co2_mmhg": 6.6, "o2_percent": 19.8, "cabin_temperature_c": 25.1},
             "vitals": {"respiratory_rate": 8, "heart_rate": 24, "spo2": -1.8, "systolic": 10, "temperature": 0.3},
             "crew_vitals": {"respiratory_rate": 1.5}},
        ],
    },
}


def _means(db: Session, a: Astronaut) -> dict:
    prof = {k: v[0] for k, v in PROFILES.get(a.code, {}).items()}
    prof.update({m: b.mean for m, b in baseline_map(db, a.id).items()})
    return prof


BASE_NOISE = {"heart_rate": 1.0, "spo2": 0.15, "systolic": 1.0, "diastolic": 1.0, "temperature": 0.04, "respiratory_rate": 0.3}


def _vitals(means: dict, deltas: dict, jitter: dict, rng, frac: float) -> dict:
    out = {}
    for m in ("heart_rate", "spo2", "systolic", "diastolic", "temperature", "respiratory_rate"):
        v = means.get(m, 0) + deltas.get(m, 0) * frac + rng.normal(0, jitter.get(m, 0) * frac or BASE_NOISE[m])
        if m == "spo2":
            v = min(v, 100)
        out[m] = round(float(v), 1 if m in ("spo2", "temperature") else 0)
    return out


def reset_scenarios(db: Session, now: datetime | None = None) -> int:
    runs = db.scalars(select(ScenarioRun)).all()
    n = len(runs)
    if n:
        db.execute(delete(ScenarioRun))
        log_event(db, "scenario_reset", L("All simulated scenario data was removed.", "Todos os dados de cenários simulados foram removidos."),
                  "info", None, now or utcnow())
        db.commit()
    return n


def run_scenario(db: Session, key: str, now: datetime | None = None, seed: int | None = None) -> dict:
    if key not in SCENARIOS:
        raise KeyError(key)
    now = now or utcnow()
    reset_scenarios(db, now)
    sc = SCENARIOS[key]
    rng = np.random.default_rng(seed if seed is not None else 7)
    a = db.scalars(select(Astronaut).where(Astronaut.code == sc["astronaut"])).first()
    if a is None:
        a = db.scalars(select(Astronaut).where(Astronaut.active.is_(True)).order_by(Astronaut.id)).first()
    crew = db.scalars(select(Astronaut).where(Astronaut.active.is_(True))).all()
    first_stage = now - timedelta(minutes=sc["stages"][0]["minutes_before"])
    run = ScenarioRun(scenario_key=key, astronaut_id=a.id, started_at=first_stage, status="active", stages=[])
    db.add(run)
    db.flush()
    log_event(db, "scenario_started", L(f"SIMULATION started: {sc['title']['en']} ({a.name})",
                                        f"SIMULAÇÃO iniciada: {sc['title']['pt']} ({a.name})"), "info", a.id, first_stage)
    # The scenario owns its time window: simulated readings inside it are replaced by scenario readings.
    # Short scenarios (minutes) own the whole window; multi-day scenarios only own a slot around each stage.
    span = now - first_stage
    windows = ([(first_stage - timedelta(minutes=10), now + timedelta(minutes=1))] if span <= timedelta(hours=6) else
               [(now - timedelta(minutes=st["minutes_before"] + 20), now - timedelta(minutes=st["minutes_before"]) + timedelta(minutes=1))
                for st in sc["stages"]])
    for w0, w1 in windows:
        db.execute(delete(VitalMeasurement).where(VitalMeasurement.astronaut_id == a.id, VitalMeasurement.origin == "simulated",
                                                  VitalMeasurement.timestamp >= w0, VitalMeasurement.timestamp <= w1))
        if any(st.get("env") for st in sc["stages"]):
            db.execute(delete(EnvironmentReading).where(EnvironmentReading.origin == "simulated",
                                                        EnvironmentReading.timestamp >= w0, EnvironmentReading.timestamp <= w1))
    means = _means(db, a)
    stages_out = []
    for st in sc["stages"]:
        t_stage = now - timedelta(minutes=st["minutes_before"])
        for mins_before, deltas in st.get("daily", []):
            ts = now - timedelta(minutes=mins_before)
            vals = {m: round(max(0.0, means[m] + d), 1 if m == "sleep_hours" else 0) for m, d in deltas.items()}
            for m in ("sleep_hours", "sleep_quality", "activity_minutes", "hydration_ml", "cognitive_score"):
                vals.setdefault(m, round(means[m], 1 if m == "sleep_hours" else 0))
            db.add(DailyLog(astronaut_id=a.id, day=ts.date(), timestamp=ts, origin="scenario", scenario_run_id=run.id, **vals))
        for i, frac in enumerate((0.75, 0.9, 1.0)):
            ts = t_stage - timedelta(minutes=3 * (2 - i))
            db.add(VitalMeasurement(astronaut_id=a.id, timestamp=ts, origin="scenario", scenario_run_id=run.id,
                                    note=f"scenario:{key}:{st['key']}",
                                    **_vitals(means, st.get("vitals", {}), st.get("jitter", {}), rng, frac)))
            if st.get("env"):
                env = {k: v[0] for k, v in ENV_PROFILE.items()}
                env.update({k: round(env[k] + (v - env[k]) * frac, 2) for k, v in st["env"].items()})
                db.add(EnvironmentReading(timestamp=ts, origin="scenario", scenario_run_id=run.id, **env))
            if st.get("crew_vitals") and i == 2:
                for other in crew:
                    if other.id != a.id:
                        db.add(VitalMeasurement(astronaut_id=other.id, timestamp=ts, origin="scenario", scenario_run_id=run.id,
                                                note=f"scenario:{key}:{st['key']}",
                                                **_vitals(_means(db, other), st["crew_vitals"], {}, rng, 1.0)))
        db.flush()
        ids = None if st.get("env") else [a.id]
        results = run_crew(db, t_stage, run.id, ids)
        mine = next(r for r in results if r["astronaut_id"] == a.id)
        stages_out.append({"key": st["key"], "label": st["label"], "time": iso(t_stage), "level": mine["level"],
                           "score": mine["score"], "category": mine["category"],
                           "top": [c["label"] for c in mine["contributors"][:3]],
                           "contributors": [{"indicator": c["indicator"], "points": c["points"], "value": c.get("value")} for c in mine["contributors"]]})
        log_event(db, "scenario_stage", L(f"SIMULATION stage '{st['label']['en']}' → {mine['level']} (score {mine['score']})",
                                          f"Etapa da SIMULAÇÃO '{st['label']['pt']}' → {mine['level']} (pontuação {mine['score']})"),
                  {"GREEN": "info", "YELLOW": "warn", "RED": "critical"}[mine["level"]], a.id, t_stage)
    run.stages = stages_out
    em = active_emergency(db, a.id)
    db.commit()
    return {"run_id": run.id, "scenario": key, "astronaut_id": a.id, "astronaut_name": a.name,
            "stages": stages_out, "emergency_id": em.id if em else None, "simulated": True}


def scenario_catalog() -> list[dict]:
    return [{"key": k, "title": v["title"], "summary": v["summary"], "astronaut_code": v["astronaut"],
             "category": v["category"], "stages": [{"key": s["key"], "label": s["label"]} for s in v["stages"]]}
            for k, v in SCENARIOS.items()]


def continue_reading(db: Session, run: ScenarioRun, a: Astronaut, now: datetime | None = None) -> VitalMeasurement:
    """While a scenario is active, the simulated feed of the affected astronaut keeps the critical pattern."""
    now = now or utcnow()
    st = SCENARIOS[run.scenario_key]["stages"][-1]
    row = VitalMeasurement(astronaut_id=a.id, timestamp=now, origin="scenario", scenario_run_id=run.id,
                           note=f"scenario:{run.scenario_key}:continuation",
                           **_vitals(_means(db, a), st.get("vitals", {}), st.get("jitter", {}), np.random.default_rng(), 1.0))
    db.add(row)
    if st.get("env"):
        env = {k: v[0] for k, v in ENV_PROFILE.items()}
        env.update(st["env"])
        db.add(EnvironmentReading(timestamp=now, origin="scenario", scenario_run_id=run.id, **env))
    return row
