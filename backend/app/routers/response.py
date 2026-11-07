"""Alerts, RESCUE WINDOW emergencies, scenarios, environment, NASA sources, Mission Link sync, settings."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import analysis as analysis_mod
from ..alerting import log_event
from ..common import freshen, get_astronaut, require_session, row_dict
from ..db import L, get_db, iso, utcnow
from ..metrics import DEFAULT_THRESHOLDS, ENVIRONMENT, METRICS, VITALS, get_setting, get_thresholds, put_setting
from ..models import (Alert, AppSetting, Astronaut, DailyLog, DataSource, EmergencyAction, EmergencyEvent,
                      EmergencyProtocol, EnvironmentReading, MedicalResource, SyncRecord, SystemEvent, VitalMeasurement)
from ..nasa import osdr_studies, refresh_osdr, refresh_space_weather, space_weather
from ..scenarios import SCENARIOS, reset_scenarios, run_scenario, scenario_catalog
from ..seed import EDUCATIONAL_NOTICE, seed
from .crew import alert_brief

router = APIRouter(prefix="/api")

PRIORITY = {
    "P1": {"label": L("IMMEDIATE", "IMEDIATA"),
           "window": L("Response-priority window: IMMEDIATE — human assessment now.",
                       "Janela de prioridade de resposta: IMEDIATA — avaliação humana agora."),
           "basis": L("A configured critical limit was crossed.", "Um limite crítico configurado foi ultrapassado.")},
    "P2": {"label": L("URGENT", "URGENTE"),
           "window": L("Response-priority window: URGENT — human assessment within minutes.",
                       "Janela de prioridade de resposta: URGENTE — avaliação humana em minutos."),
           "basis": L("Combined score reached the RED threshold.", "A pontuação combinada atingiu o limite VERMELHO.")},
}
UNCERTAINTY = L("This is a response-PRIORITY indication derived from configurable demo rules. It is NOT a survival estimate, "
                "a time-to-harm prediction or a diagnosis. Data may be incomplete or wrong; confirm with a human assessment.",
                "Esta é uma indicação de PRIORIDADE de resposta derivada de regras de demonstração configuráveis. NÃO é estimativa de "
                "sobrevivência, previsão de tempo até dano nem diagnóstico. Os dados podem estar incompletos ou errados; confirme com avaliação humana.")


# ---------------- Alerts ----------------
@router.get("/alerts")
def list_alerts(status: str | None = Query(None, pattern="^(open|acknowledged|escalated|resolved|active)$"),
                limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), _=Depends(require_session)):
    q = select(Alert).order_by(Alert.created_at.desc()).limit(limit)
    if status == "active":
        q = q.where(Alert.status != "resolved")
    elif status:
        q = q.where(Alert.status == status)
    return [alert_brief(db, a) for a in db.scalars(q).all()]


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    al = db.get(Alert, alert_id)
    if not al:
        raise HTTPException(404, detail={"code": "ALERT_NOT_FOUND", "message": "Alert not found."})
    return {**alert_brief(db, al), "analysis": al.analysis}


class AlertAction(BaseModel):
    note: str = Field(default="", max_length=500)


def _set_alert_status(db: Session, al: Alert, status: str, actor: str, note: str) -> None:
    now = utcnow()
    al.status, al.updated_at = status, now
    al.history = al.history + [{"t": iso(now), "kind": status, "actor": actor, "level": al.level,
                                "text": L(note or f"Alert {status} by {actor}.", note or f"Alerta {status} por {actor}.")}]


@router.post("/alerts/{alert_id}/{action}")
def alert_action(alert_id: int, action: str, body: AlertAction, db: Session = Depends(get_db), s=Depends(require_session)):
    status = {"acknowledge": "acknowledged", "escalate": "escalated", "resolve": "resolved"}.get(action)
    al = db.get(Alert, alert_id)
    if not status or not al:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "Unknown alert or action."})
    if al.status == "resolved":
        raise HTTPException(409, detail={"code": "ALERT_RESOLVED", "message": "Alert is already resolved."})
    _set_alert_status(db, al, status, s.name, body.note)
    em = db.scalars(select(EmergencyEvent).where(EmergencyEvent.alert_id == al.id, EmergencyEvent.status != "resolved")).first()
    if em:
        _emergency_action(db, em, action, s.name, body.note)
    elif action == "escalate":
        _queue_sync(db, L(f"Escalation of alert #{al.id}", f"Escalonamento do alerta #{al.id}"))
    log_event(db, f"alert_{status}", L(f"Alert #{al.id} {status} by {s.name}.", f"Alerta #{al.id} {status} por {s.name}."),
              "info", al.astronaut_id)
    db.commit()
    return alert_brief(db, al)


# ---------------- RESCUE WINDOW ----------------
@router.get("/emergencies")
def list_emergencies(db: Session = Depends(get_db), _=Depends(require_session)):
    out = []
    for e in db.scalars(select(EmergencyEvent).order_by(EmergencyEvent.opened_at.desc())).all():
        a = db.get(Astronaut, e.astronaut_id)
        out.append({**row_dict(e, exclude={"snapshot"}), "astronaut_name": a.name, "astronaut_code": a.code,
                    "level": e.snapshot.get("level"), "score": e.snapshot.get("score"), "simulated": e.scenario_run_id is not None})
    return out


@router.get("/emergencies/{emergency_id}")
def emergency_detail(emergency_id: int, db: Session = Depends(get_db), _=Depends(require_session)):
    e = db.get(EmergencyEvent, emergency_id)
    if not e:
        raise HTTPException(404, detail={"code": "EMERGENCY_NOT_FOUND", "message": "Emergency not found."})
    a = db.get(Astronaut, e.astronaut_id)
    now = utcnow()
    start = (e.first_deviation_at or e.opened_at) - timedelta(hours=2)
    end = e.closed_at or now
    vitals = db.scalars(select(VitalMeasurement).where(VitalMeasurement.astronaut_id == a.id, VitalMeasurement.timestamp >= start,
                                                       VitalMeasurement.timestamp <= end).order_by(VitalMeasurement.timestamp)).all()
    env = db.scalars(select(EnvironmentReading).where(EnvironmentReading.timestamp >= start, EnvironmentReading.timestamp <= end)
                     .order_by(EnvironmentReading.timestamp)).all()
    daily = db.scalars(select(DailyLog).where(DailyLog.astronaut_id == a.id, DailyLog.timestamp >= start - timedelta(days=4),
                                              DailyLog.timestamp <= end).order_by(DailyLog.timestamp)).all()
    cats = {e.category, "general"}
    resources = [row_dict(r) for r in db.scalars(select(MedicalResource)).all() if cats & set(r.tags)]
    resources.sort(key=lambda r: 0 if e.category in r["tags"] else 1)
    protocols = [row_dict(p) for p in db.scalars(select(EmergencyProtocol)).all() if p.category in cats]
    protocols.sort(key=lambda p: 0 if p["category"] == e.category else 1)
    if e.category == "environmental":
        protocols += [row_dict(p) for p in db.scalars(select(EmergencyProtocol).where(EmergencyProtocol.category == "respiratory")).all()]
    snap = e.snapshot
    risk_factors = [{"label": c["label"], "reason": c["reason"], "points": c["points"], "kind": c["kind"]} for c in snap.get("contributors", [])]
    return {
        **row_dict(e), "astronaut": row_dict(a), "simulated": e.scenario_run_id is not None,
        "scenario": SCENARIOS.get(next((k for k in SCENARIOS if e.scenario_run_id and SCENARIOS[k]["category"] == e.category), ""), {}).get("title"),
        "priority_info": {**PRIORITY[e.priority], "uncertainty": UNCERTAINTY, "confidence": snap.get("confidence")},
        "elapsed_since_first_deviation_s": int(((e.closed_at or now) - (e.first_deviation_at or e.opened_at)).total_seconds()),
        "timeline": [row_dict(t) for t in e.timeline],
        "evolution": {"vitals": [row_dict(v, exclude={"astronaut_id", "note"}) for v in vitals],
                      "environment": [row_dict(v) for v in env], "daily": [row_dict(d, exclude={"astronaut_id"}) for d in daily]},
        "risk_factors": risk_factors, "resources": resources, "protocols": protocols,
        "protocol_notice": EDUCATIONAL_NOTICE, "disclaimer": analysis_mod.DISCLAIMER,
    }


class EmergencyActionIn(BaseModel):
    kind: str = Field(pattern="^(acknowledge|escalate|action|note|resolve)$")
    text: str = Field(default="", max_length=500)
    client_ts: str | None = Field(default=None, max_length=40)


def _queue_sync(db: Session, what: dict) -> SyncRecord:
    link = get_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20})
    now = utcnow()
    rec = SyncRecord(requested_at=now, delay_s=link["one_way_delay_s"], items={"escalation": 1, "what": what},
                     status="queued" if link["status"] == "blackout" else "in_transit",
                     eta_at=None if link["status"] == "blackout" else now + timedelta(seconds=2 * link["one_way_delay_s"]),
                     note="Escalation package to ground medical team (simulated link).")
    db.add(rec)
    return rec


def _emergency_action(db: Session, e: EmergencyEvent, kind: str, actor: str, text: str) -> EmergencyAction:
    now = utcnow()
    msgs = {
        "acknowledge": L(f"Alert acknowledged by {actor}.", f"Alerta reconhecido por {actor}."),
        "escalate": L(f"Escalated by {actor} to the ground medical team (queued on the simulated link).",
                      f"Escalonado por {actor} para a equipe médica em solo (na fila do link simulado)."),
        "resolve": L(f"Event resolved by {actor}.", f"Evento resolvido por {actor}."),
    }
    body = L(text, text) if text else msgs.get(kind, L("Action recorded.", "Ação registrada."))
    if text and kind in msgs:
        body = L(f"{msgs[kind]['en']} — {text}", f"{msgs[kind]['pt']} — {text}")
    act = EmergencyAction(emergency_id=e.id, timestamp=now, kind=kind, actor=actor, text=body)
    db.add(act)
    if kind == "acknowledge" and e.status == "active":
        e.status = "acknowledged"
    elif kind == "escalate":
        e.status = "escalated"
        _queue_sync(db, L(f"RESCUE WINDOW event #{e.id}", f"Evento RESCUE WINDOW #{e.id}"))
    elif kind == "resolve":
        e.status, e.closed_at = "resolved", now
    return act


@router.post("/emergencies/{emergency_id}/actions", status_code=201)
def emergency_action(emergency_id: int, body: EmergencyActionIn, db: Session = Depends(get_db), s=Depends(require_session)):
    e = db.get(EmergencyEvent, emergency_id)
    if not e:
        raise HTTPException(404, detail={"code": "EMERGENCY_NOT_FOUND", "message": "Emergency not found."})
    if e.status == "resolved":
        raise HTTPException(409, detail={"code": "EMERGENCY_RESOLVED", "message": "Event already resolved."})
    if body.kind in ("action", "note") and not body.text.strip():
        raise HTTPException(422, detail={"code": "TEXT_REQUIRED", "message": "Describe the action taken."})
    act = _emergency_action(db, e, body.kind, s.name, body.text.strip())
    if e.alert_id and (al := db.get(Alert, e.alert_id)) and body.kind in ("acknowledge", "escalate", "resolve"):
        _set_alert_status(db, al, {"acknowledge": "acknowledged", "escalate": "escalated", "resolve": "resolved"}[body.kind], s.name, body.text)
    log_event(db, f"rescue_{body.kind}", L(f"RESCUE WINDOW #{e.id}: {act.text['en']}", f"RESCUE WINDOW #{e.id}: {act.text['pt']}"),
              "warn" if body.kind == "escalate" else "info", e.astronaut_id)
    db.commit()
    return row_dict(act)


@router.get("/protocols")
def protocols(db: Session = Depends(get_db), _=Depends(require_session)):
    return {"notice": EDUCATIONAL_NOTICE, "protocols": [row_dict(p) for p in db.scalars(select(EmergencyProtocol)).all()]}


@router.get("/resources")
def resources(db: Session = Depends(get_db), _=Depends(require_session)):
    return [row_dict(r) for r in db.scalars(select(MedicalResource)).all()]


# ---------------- Scenarios ----------------
@router.get("/scenarios")
def scenarios(db: Session = Depends(get_db), _=Depends(require_session)):
    from ..alerting import active_run
    run = active_run(db)
    return {"scenarios": scenario_catalog(),
            "active": ({**row_dict(run), "title": SCENARIOS[run.scenario_key]["title"]} if run else None),
            "notice": L("All scenarios are SIMULATIONS with fictional crew data.", "Todos os cenários são SIMULAÇÕES com dados fictícios.")}


@router.post("/scenarios/{key}/run", status_code=201)
def scenario_run(key: str, db: Session = Depends(get_db), _=Depends(require_session)):
    if key not in SCENARIOS:
        raise HTTPException(404, detail={"code": "SCENARIO_NOT_FOUND", "message": "Unknown scenario."})
    freshen(db)
    return run_scenario(db, key)


@router.post("/scenarios/reset")
def scenario_reset(db: Session = Depends(get_db), _=Depends(require_session)):
    return {"removed_runs": reset_scenarios(db)}


# ---------------- Environment ----------------
def _env_status(metric: str, value: float | None, th: dict) -> str:
    t = th.get(metric) or {}
    if value is None:
        return "missing"
    if ("crit_high" in t and value >= t["crit_high"]) or ("crit_low" in t and value <= t["crit_low"]):
        return "critical"
    if ("warn_high" in t and value > t["warn_high"]) or ("warn_low" in t and value < t["warn_low"]):
        return "warning"
    return "nominal"


@router.get("/environment")
def environment(hours: int = Query(24, ge=1, le=24 * 14), db: Session = Depends(get_db), _=Depends(require_session)):
    now = utcnow()
    rows = db.scalars(select(EnvironmentReading).where(EnvironmentReading.timestamp >= now - timedelta(hours=hours),
                                                       EnvironmentReading.timestamp <= now)
                      .order_by(EnvironmentReading.timestamp)).all()
    th = get_thresholds(db)["environment"]
    latest = rows[-1] if rows else None
    status = {m: {"value": getattr(latest, m) if latest else None, "status": _env_status(m, getattr(latest, m) if latest else None, th),
                  "label": METRICS[m]["label"], "unit": METRICS[m]["unit"], "thresholds": th.get(m, {})} for m in ENVIRONMENT}
    alerts = db.scalars(select(Alert).where(Alert.astronaut_id.is_(None)).order_by(Alert.created_at.desc()).limit(20)).all()
    return {"readings": [row_dict(r) for r in rows], "latest": row_dict(latest) if latest else None, "status": status,
            "alerts": [row_dict(a, exclude={"analysis"}) for a in alerts],
            "dose_note": L("Cabin dose rate comes from a SIMULATED dosimeter. Personal astronaut dose is not measured by ORBITA.",
                           "A taxa de dose vem de um dosímetro SIMULADO. A dose pessoal dos astronautas não é medida pelo ORBITA.")}


@router.get("/environment/space-weather")
def get_space_weather(db: Session = Depends(get_db), _=Depends(require_session)):
    return space_weather(db)


@router.post("/environment/space-weather/refresh")
def post_space_weather(db: Session = Depends(get_db), _=Depends(require_session)):
    return refresh_space_weather(db)


# ---------------- Data sources ----------------
@router.get("/sources")
def sources(db: Session = Depends(get_db), _=Depends(require_session)):
    return [row_dict(s) for s in db.scalars(select(DataSource).order_by(DataSource.category, DataSource.key)).all()]


@router.get("/sources/osdr")
def get_osdr(db: Session = Depends(get_db), _=Depends(require_session)):
    return osdr_studies(db)


@router.post("/sources/osdr/refresh")
def post_osdr(db: Session = Depends(get_db), _=Depends(require_session)):
    return refresh_osdr(db)


# ---------------- Mission Link (simulated Earth communication) ----------------
class LinkIn(BaseModel):
    status: str = Field(pattern="^(nominal|degraded|blackout)$")
    one_way_delay_s: int = Field(ge=0, le=1800)


def _advance_sync(db: Session) -> None:
    now = utcnow()
    link = get_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20})
    for r in db.scalars(select(SyncRecord).where(SyncRecord.status != "delivered")).all():
        if r.status == "queued" and link["status"] != "blackout":
            r.status, r.delay_s = "in_transit", link["one_way_delay_s"]
            r.eta_at = now + timedelta(seconds=2 * link["one_way_delay_s"] * (2 if link["status"] == "degraded" else 1))
        elif r.status == "in_transit" and r.eta_at and r.eta_at <= now:
            r.status, r.completed_at = "delivered", r.eta_at


@router.get("/sync")
def sync_status(db: Session = Depends(get_db), _=Depends(require_session)):
    _advance_sync(db)
    db.commit()
    link = get_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20})
    recs = db.scalars(select(SyncRecord).order_by(SyncRecord.requested_at.desc()).limit(30)).all()
    last = db.scalars(select(SyncRecord).where(SyncRecord.status == "delivered").order_by(SyncRecord.completed_at.desc())).first()
    since = last.requested_at if last else utcnow() - timedelta(days=14)
    pending = {
        "measurements": db.scalar(select(func.count()).select_from(VitalMeasurement).where(VitalMeasurement.timestamp > since)),
        "alerts": db.scalar(select(func.count()).select_from(Alert).where(Alert.updated_at > since)),
        "emergency_actions": db.scalar(select(func.count()).select_from(EmergencyAction).where(EmergencyAction.timestamp > since)),
    }
    return {"link": link, "records": [row_dict(r) for r in recs], "last_sync_at": iso(last.completed_at) if last else None,
            "pending_since_last_sync": pending,
            "notice": L("Simulated Earth link. ORBITA is not connected to any spacecraft or NASA infrastructure.",
                        "Link com a Terra simulado. O ORBITA não está conectado a nenhuma espaçonave ou infraestrutura da NASA.")}


@router.post("/sync", status_code=201)
def request_sync(db: Session = Depends(get_db), s=Depends(require_session)):
    _advance_sync(db)
    link = get_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20})
    last = db.scalars(select(SyncRecord).where(SyncRecord.status == "delivered").order_by(SyncRecord.completed_at.desc())).first()
    since = last.requested_at if last else utcnow() - timedelta(days=14)
    items = {"measurements": db.scalar(select(func.count()).select_from(VitalMeasurement).where(VitalMeasurement.timestamp > since)),
             "daily_logs": db.scalar(select(func.count()).select_from(DailyLog).where(DailyLog.timestamp > since)),
             "alerts": db.scalar(select(func.count()).select_from(Alert).where(Alert.updated_at > since)),
             "emergency_actions": db.scalar(select(func.count()).select_from(EmergencyAction).where(EmergencyAction.timestamp > since))}
    now = utcnow()
    factor = 2 if link["status"] == "degraded" else 1
    rec = SyncRecord(requested_at=now, delay_s=link["one_way_delay_s"], items=items,
                     status="queued" if link["status"] == "blackout" else "in_transit",
                     eta_at=None if link["status"] == "blackout" else now + timedelta(seconds=2 * link["one_way_delay_s"] * factor),
                     note=f"Requested by {s.name}")
    db.add(rec)
    log_event(db, "sync", L(f"Synchronization {'queued (link blackout)' if rec.status == 'queued' else 'sent'} by {s.name}.",
                            f"Sincronização {'na fila (link indisponível)' if rec.status == 'queued' else 'enviada'} por {s.name}."))
    db.commit()
    return row_dict(rec)


@router.put("/sync/link")
def set_link(body: LinkIn, db: Session = Depends(get_db), s=Depends(require_session)):
    put_setting(db, "link", body.model_dump())
    db.flush()
    _advance_sync(db)
    log_event(db, "link", L(f"Simulated Earth link set to {body.status} ({body.one_way_delay_s} s one-way) by {s.name}.",
                            f"Link simulado definido como {body.status} ({body.one_way_delay_s} s por trecho) por {s.name}."),
              "warn" if body.status != "nominal" else "info")
    db.commit()
    return body.model_dump()


# ---------------- Events, settings, demo ----------------
@router.get("/events")
def events(limit: int = Query(50, ge=1, le=500), astronaut_id: int | None = None, db: Session = Depends(get_db),
           _=Depends(require_session)):
    q = select(SystemEvent).order_by(SystemEvent.timestamp.desc()).limit(limit)
    if astronaut_id:
        q = q.where(SystemEvent.astronaut_id == astronaut_id)
    return [row_dict(e) for e in db.scalars(q).all()]


@router.get("/settings/thresholds")
def get_th(db: Session = Depends(get_db), _=Depends(require_session)):
    return {"thresholds": get_thresholds(db), "defaults": DEFAULT_THRESHOLDS,
            "metrics": {m: {"label": METRICS[m]["label"], "unit": METRICS[m]["unit"]} for m in METRICS},
            "notice": L("Demonstration defaults — not validated clinical limits.", "Padrões de demonstração — não são limites clínicos validados.")}


def _validate_thresholds(th: dict) -> None:
    for sec in ("safety", "environment"):
        for m, t in th.get(sec, {}).items():
            if m not in METRICS:
                raise HTTPException(422, detail={"code": "UNKNOWN_METRIC", "message": m})
            lo, hi = METRICS[m]["range"]
            for k, v in t.items():
                if not isinstance(v, (int, float)) or not lo <= v <= hi:
                    raise HTTPException(422, detail={"code": "THRESHOLD_OUT_OF_RANGE", "message": f"{m}.{k}"})
            if "crit_low" in t and "warn_low" in t and t["crit_low"] > t["warn_low"]:
                raise HTTPException(422, detail={"code": "THRESHOLD_ORDER", "message": f"{m}: crit_low must be <= warn_low"})
            if "crit_high" in t and "warn_high" in t and t["crit_high"] < t["warn_high"]:
                raise HTTPException(422, detail={"code": "THRESHOLD_ORDER", "message": f"{m}: crit_high must be >= warn_high"})
    lv = th.get("levels", {})
    if lv and not (1 <= lv.get("yellow_score", 3) < lv.get("red_score", 7) <= 50):
        raise HTTPException(422, detail={"code": "LEVEL_ORDER", "message": "yellow_score must be < red_score"})


@router.put("/settings/thresholds")
def put_th(body: dict, db: Session = Depends(get_db), s=Depends(require_session)):
    th = body.get("thresholds", body)
    _validate_thresholds(th)
    put_setting(db, "thresholds", th)
    log_event(db, "settings", L(f"Thresholds updated by {s.name}.", f"Limites atualizados por {s.name}."))
    db.commit()
    return {"thresholds": get_thresholds(db)}


@router.post("/settings/thresholds/reset")
def reset_th(db: Session = Depends(get_db), s=Depends(require_session)):
    row = db.get(AppSetting, "thresholds")
    if row:
        db.delete(row)
    log_event(db, "settings", L(f"Thresholds reset to demo defaults by {s.name}.", f"Limites restaurados por {s.name}."))
    db.commit()
    return {"thresholds": get_thresholds(db)}


@router.post("/demo/reset")
def demo_reset(db: Session = Depends(get_db), s=Depends(require_session)):
    """Drop and re-create the demo database (keeps the caller's demo session and NASA caches)."""
    from ..db import SessionLocal
    from ..models import CachedPayload, DemoSession
    token, name, role = s.token, s.name, s.role
    caches = [(c.key, c.fetched_at, c.origin, c.payload) for c in db.scalars(select(CachedPayload)).all()]
    db.close()
    fresh = SessionLocal()
    try:
        seed(fresh, force=True)
        fresh.add(DemoSession(token=token, name=name, role=role))
        for k, f, o, p in caches:
            fresh.add(CachedPayload(key=k, fetched_at=f, origin=o, payload=p))
        fresh.commit()
    finally:
        fresh.close()
    analysis_mod._MODEL_CACHE.clear()
    return {"ok": True, "message": "Demo data reset to the initial simulated state."}


@router.get("/vitals/metrics")
def metric_meta(_=Depends(require_session)):
    return {m: {"label": METRICS[m]["label"], "unit": METRICS[m]["unit"], "range": METRICS[m]["range"]} for m in METRICS}


__all__ = ["router", "VITALS", "get_astronaut"]
