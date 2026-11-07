"""Turns analysis results into persistent alerts, RESCUE WINDOW emergency events and system events."""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .analysis import analyze
from .db import L, iso, utcnow
from .metrics import METRICS, get_thresholds
from .models import Alert, Astronaut, EmergencyAction, EmergencyEvent, EnvironmentReading, ScenarioRun, SystemEvent
from .nasa import space_context

RANK = {"GREEN": 0, "YELLOW": 1, "RED": 2}

TITLES = {
    "cardiovascular": L("Cardiovascular indicator changes", "Alterações em indicadores cardiovasculares"),
    "respiratory": L("Respiratory / oxygenation changes", "Alterações respiratórias / de oxigenação"),
    "fatigue": L("Sleep deprivation and cognitive decline", "Privação de sono e queda cognitiva"),
    "environmental": L("Environmental risk with physiological changes", "Risco ambiental com alterações fisiológicas"),
    "thermal": L("Body temperature changes", "Alterações de temperatura corporal"),
    "general": L("Multiple indicator changes", "Alterações em múltiplos indicadores"),
    "stable": L("Stable", "Estável"),
}


def log_event(db: Session, kind: str, message: dict, severity: str = "info", astronaut_id: int | None = None,
              ts: datetime | None = None) -> None:
    db.add(SystemEvent(kind=kind, message=message, severity=severity, astronaut_id=astronaut_id, timestamp=ts or utcnow()))


def active_run(db: Session) -> ScenarioRun | None:
    return db.scalars(select(ScenarioRun).where(ScenarioRun.status == "active").order_by(ScenarioRun.id.desc())).first()


def open_alert(db: Session, astronaut_id: int | None, category: str | None = None) -> Alert | None:
    q = select(Alert).where(Alert.status != "resolved")
    q = q.where(Alert.astronaut_id.is_(None)) if astronaut_id is None else q.where(Alert.astronaut_id == astronaut_id)
    return db.scalars(q.order_by(Alert.created_at.desc())).first()


def active_emergency(db: Session, astronaut_id: int) -> EmergencyEvent | None:
    return db.scalars(select(EmergencyEvent).where(EmergencyEvent.astronaut_id == astronaut_id,
                                                   EmergencyEvent.status != "resolved")
                      .order_by(EmergencyEvent.opened_at.desc())).first()


def _summary(result: dict) -> dict:
    parts = result["what_changed"][:3]
    return L("; ".join(p["en"] for p in parts) or result["why"]["en"], "; ".join(p["pt"] for p in parts) or result["why"]["pt"])


def process_analysis(db: Session, astronaut: Astronaut, result: dict, now: datetime,
                     scenario_run_id: int | None = None) -> dict:
    run_id = scenario_run_id or (r.id if (r := active_run(db)) else None)
    level = result["level"]
    alert = open_alert(db, astronaut.id)
    out = {"alert_id": alert.id if alert else None, "emergency_id": None, "created": False, "escalated": False}
    if level == "GREEN":
        if alert and (not alert.history or alert.history[-1].get("kind") != "normalized"):
            alert.history = alert.history + [{"t": iso(now), "kind": "normalized", "level": "GREEN", "actor": "ORBITA",
                                              "text": L("Latest indicators are back within personal range. Alert stays open until a human resolves it.",
                                                        "Indicadores mais recentes voltaram à faixa pessoal. O alerta permanece aberto até resolução humana.")}]
            alert.updated_at = now
        return out
    if alert is None:
        alert = Alert(astronaut_id=astronaut.id, level=level, category=result["category"],
                      title=TITLES.get(result["category"], TITLES["general"]), summary=_summary(result), analysis=result,
                      status="open", created_at=now, updated_at=now, scenario_run_id=run_id,
                      history=[{"t": iso(now), "kind": "created", "level": level, "actor": "ORBITA",
                                "text": L(f"Early Warning raised a {level} alert (score {result['score']}).",
                                          f"O Early Warning gerou um alerta {level} (pontuação {result['score']}).")}])
        db.add(alert)
        db.flush()
        out.update(alert_id=alert.id, created=True)
        log_event(db, "alert_created", L(f"{level} alert for {astronaut.name}: {alert.title['en']}",
                                         f"Alerta {level} para {astronaut.name}: {alert.title['pt']}"),
                  "critical" if level == "RED" else "warn", astronaut.id, now)
    else:
        if RANK[level] > RANK[alert.level]:
            alert.history = alert.history + [{"t": iso(now), "kind": "level_up", "level": level, "actor": "ORBITA",
                                              "text": L(f"Level increased {alert.level} → {level} (score {result['score']}).",
                                                        f"Nível aumentou {alert.level} → {level} (pontuação {result['score']}).")}]
            log_event(db, "alert_level_up", L(f"Alert for {astronaut.name} raised to {level}", f"Alerta de {astronaut.name} elevado para {level}"),
                      "critical" if level == "RED" else "warn", astronaut.id, now)
            alert.level = level
            alert.status = "open" if alert.status == "acknowledged" else alert.status
            out["escalated"] = True
        alert.category = result["category"] if RANK[level] >= RANK[alert.level] else alert.category
        alert.title = TITLES.get(alert.category, TITLES["general"])
        alert.analysis = result
        alert.summary = _summary(result)
        alert.updated_at = now
    if level == "RED":
        em = active_emergency(db, astronaut.id)
        if em is None:
            em = EmergencyEvent(astronaut_id=astronaut.id, alert_id=alert.id, category=result["category"],
                                priority="P1" if result["critical_flags"] else "P2", status="active", opened_at=now,
                                first_deviation_at=alert.created_at, snapshot=result, scenario_run_id=run_id)
            db.add(em)
            db.flush()
            if alert.created_at < now:
                first = alert.history[0]
                db.add(EmergencyAction(emergency_id=em.id, timestamp=alert.created_at, kind="detection", level=first.get("level"),
                                       text=L("Early Warning first detected a deviation from the personal baseline.",
                                              "O Early Warning detectou o primeiro desvio da linha de base pessoal.")))
            db.add(EmergencyAction(emergency_id=em.id, timestamp=now, kind="alert", level="RED",
                                   text=L(f"RED condition (score {result['score']}). RESCUE WINDOW opened — immediate human assessment required.",
                                          f"Condição VERMELHA (pontuação {result['score']}). RESCUE WINDOW aberta — avaliação humana imediata necessária.")))
            log_event(db, "rescue_window_opened", L(f"RESCUE WINDOW opened for {astronaut.name}", f"RESCUE WINDOW aberta para {astronaut.name}"),
                      "critical", astronaut.id, now)
        else:
            prev = em.snapshot.get("score", 0)
            em.snapshot = result
            if result["critical_flags"]:
                em.priority = "P1"
            if abs(result["score"] - prev) >= 3:
                db.add(EmergencyAction(emergency_id=em.id, timestamp=now, kind="reassessment", level="RED",
                                       text=L(f"Automatic reassessment: score {prev} → {result['score']}.",
                                              f"Reavaliação automática: pontuação {prev} → {result['score']}.")))
        out["emergency_id"] = em.id
    return out


def process_environment(db: Session, now: datetime, scenario_run_id: int | None = None) -> dict | None:
    """Crew-level environmental alert (not tied to a single astronaut)."""
    th = get_thresholds(db)["environment"]
    env = db.scalars(select(EnvironmentReading).where(EnvironmentReading.timestamp <= now,
                                                      EnvironmentReading.timestamp > now - timedelta(hours=3))
                     .order_by(EnvironmentReading.timestamp.desc()).limit(1)).first()
    if env is None:
        return None
    level, items = "GREEN", []
    for m, t in th.items():
        v = getattr(env, m)
        if v is None:
            continue
        crit = ("crit_high" in t and v >= t["crit_high"]) or ("crit_low" in t and v <= t["crit_low"])
        warn = ("warn_high" in t and v > t["warn_high"]) or ("warn_low" in t and v < t["warn_low"])
        if crit or warn:
            items.append(L(f"{METRICS[m]['label']['en']}: {v} {METRICS[m]['unit']}", f"{METRICS[m]['label']['pt']}: {v} {METRICS[m]['unit']}"))
            level = "RED" if crit else max(level, "YELLOW", key=RANK.get)
    alert = open_alert(db, None)
    if level == "GREEN":
        return None
    summary = L("; ".join(i["en"] for i in items), "; ".join(i["pt"] for i in items))
    run_id = scenario_run_id or (r.id if (r := active_run(db)) else None)
    if alert is None:
        db.add(Alert(astronaut_id=None, level=level, category="environmental",
                     title=L("Cabin environment outside configured limits", "Ambiente da cabine fora dos limites configurados"),
                     summary=summary, analysis={"items": items, "evaluated_at": iso(now)}, status="open",
                     created_at=now, updated_at=now, scenario_run_id=run_id,
                     history=[{"t": iso(now), "kind": "created", "level": level, "actor": "ORBITA",
                               "text": L("Environmental alert raised.", "Alerta ambiental gerado.")}]))
        log_event(db, "environment_alert", L(f"{level} cabin environment alert: {summary['en']}", f"Alerta ambiental {level}: {summary['pt']}"),
                  "critical" if level == "RED" else "warn", None, now)
    else:
        if RANK[level] > RANK[alert.level]:
            alert.history = alert.history + [{"t": iso(now), "kind": "level_up", "level": level, "actor": "ORBITA",
                                              "text": L(f"Level increased to {level}.", f"Nível aumentou para {level}.")}]
            alert.level = level
            log_event(db, "environment_alert", L(f"Cabin environment alert raised to {level}", f"Alerta ambiental elevado para {level}"),
                      "critical" if level == "RED" else "warn", None, now)
        alert.summary, alert.updated_at = summary, now
    return {"level": level, "items": items}


def run_crew(db: Session, now: datetime | None = None, scenario_run_id: int | None = None,
             astronaut_ids: list[int] | None = None) -> list[dict]:
    now = now or utcnow()
    th = get_thresholds(db)
    ctx = space_context(db, now)
    results = []
    q = select(Astronaut).where(Astronaut.active.is_(True)).order_by(Astronaut.code)
    for a in db.scalars(q).all():
        if astronaut_ids and a.id not in astronaut_ids:
            continue
        res = analyze(db, a, now, th, ctx)
        res["persisted"] = process_analysis(db, a, res, now, scenario_run_id)
        results.append(res)
    process_environment(db, now, scenario_run_id)
    db.flush()
    return results
