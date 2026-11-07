"""EARLY WARNING — explainable anomaly scoring.

Transparent, rule-based scoring (every point is traceable to a stated rule) plus an optional
unsupervised IsolationForest "multivariate anomaly signal" trained on the astronaut's own history.

This produces ANOMALY signals, not diagnoses. Nothing here is clinically validated; no accuracy or
prediction percentage is claimed. A RED level means "requires immediate human assessment".
"""
from datetime import datetime, timedelta

import numpy as np
from sklearn.ensemble import IsolationForest
from sqlalchemy import select
from sqlalchemy.orm import Session

from .baselines import baseline_map
from .config import CURRENT_WINDOW_H
from .db import L, iso, utcnow
from .metrics import DAILY, METRICS, VITALS, get_thresholds
from .models import Astronaut, DailyLog, EnvironmentReading, VitalMeasurement

ORIGIN_PRIORITY = {"user": 3, "scenario": 2, "simulated": 1}
_MODEL_CACHE: dict[tuple, tuple] = {}

DISCLAIMER = L(
    "Anomaly signal only — not a medical diagnosis. ORBITA is an experimental decision-support prototype; "
    "thresholds are configurable demo defaults, not validated clinical limits. Always seek human medical assessment.",
    "Apenas um sinal de anomalia — não é um diagnóstico médico. O ORBITA é um protótipo experimental de apoio à decisão; "
    "os limites são padrões de demonstração configuráveis, não limites clínicos validados. Busque sempre avaliação médica humana.",
)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _fmt(metric: str, v: float | None) -> str:
    if v is None:
        return "—"
    d = METRICS[metric].get("decimals", 1)
    return f"{v:.{d}f}"


def _z_points(z: float, cfg: dict) -> int:
    a = abs(z)
    if a >= cfg["z_severe"]:
        return 3
    if a >= cfg["z_major"]:
        return 2
    if a >= cfg["z_minor"]:
        return 1
    return 0


def _safety(value: float, t: dict | None) -> tuple[int, str | None, bool]:
    """Returns (points, which-limit, critical?) for configured safety ranges."""
    if not t:
        return 0, None, False
    if "crit_low" in t and value <= t["crit_low"]:
        return 4, "crit_low", True
    if "crit_high" in t and value >= t["crit_high"]:
        return 4, "crit_high", True
    if "warn_low" in t and value < t["warn_low"]:
        return 2, "warn_low", False
    if "warn_high" in t and value > t["warn_high"]:
        return 2, "warn_high", False
    return 0, None, False


def _isolation_signal(db: Session, astronaut_id: int, baselines: dict, latest: dict, now: datetime) -> dict | None:
    """Multivariate anomaly signal on the 6 vitals, trained only on this astronaut's own non-scenario history."""
    if not all(m in baselines for m in VITALS):
        return None
    stamp = max(b.computed_at for b in baselines.values())
    key = (astronaut_id, stamp)
    if key not in _MODEL_CACHE:
        b0 = min(b.window_start for b in baselines.values())
        b1 = max(b.window_end for b in baselines.values())
        rows = db.execute(select(*[getattr(VitalMeasurement, m) for m in VITALS]).where(
            VitalMeasurement.astronaut_id == astronaut_id, VitalMeasurement.origin != "scenario",
            VitalMeasurement.timestamp >= b0, VitalMeasurement.timestamp <= b1)).all()
        if len(rows) < 30:
            return None
        means = np.array([baselines[m].mean for m in VITALS])
        stds = np.array([baselines[m].std for m in VITALS])
        X = np.array([[np.nan if v is None else v for v in r] for r in rows], dtype=float)
        X = np.where(np.isnan(X), means, X)
        Xs = (X - means) / stds
        model = IsolationForest(n_estimators=150, contamination="auto", random_state=7).fit(Xs)
        _MODEL_CACHE.clear() if len(_MODEL_CACHE) > 64 else None
        _MODEL_CACHE[key] = (model, means, stds)
    model, means, stds = _MODEL_CACHE[key]
    vec = np.array([latest.get(m) if latest.get(m) is not None else means[i] for i, m in enumerate(VITALS)], dtype=float)
    score = float(model.decision_function(((vec - means) / stds).reshape(1, -1))[0])
    return {"score": round(score, 3), "flagged": score < -0.05,
            "imputed": [m for m in VITALS if latest.get(m) is None]}


def analyze(db: Session, astronaut: Astronaut, now: datetime | None = None, thresholds: dict | None = None,
            space_context: dict | None = None) -> dict:
    now = now or utcnow()
    th = thresholds or get_thresholds(db)
    bl = baseline_map(db, astronaut.id)
    contributors: list[dict] = []
    missing: list[dict] = []
    notes: list[dict] = []
    critical_flags: list[str] = []

    # ---------- Vital signs ----------
    window_start = now - timedelta(hours=CURRENT_WINDOW_H)
    rows = db.scalars(select(VitalMeasurement).where(
        VitalMeasurement.astronaut_id == astronaut.id, VitalMeasurement.timestamp > window_start,
        VitalMeasurement.timestamp <= now).order_by(VitalMeasurement.timestamp)).all()
    latest: dict[str, float | None] = {}
    latest_ts: dict[str, datetime] = {}
    origins: set[str] = set()
    vital_points: dict[str, int] = {}
    for m in VITALS:
        series = [(r.timestamp, getattr(r, m), r.origin) for r in rows if getattr(r, m) is not None]
        if not series:
            latest[m] = None
            missing.append({"indicator": m, "label": METRICS[m]["label"],
                            "reason": L(f"No reading in the last {CURRENT_WINDOW_H} h",
                                        f"Nenhuma leitura nas últimas {CURRENT_WINDOW_H} h")})
            continue
        ts, value, origin = series[-1]
        origins.add(origin)
        latest[m], latest_ts[m] = value, ts
        b = bl.get(m)
        pts_base, z = 0, None
        reasons_en, reasons_pt = [], []
        if b:
            z = (value - b.mean) / b.std
            pts_base = _z_points(z, th["baseline"])
            if pts_base:
                reasons_en.append(f"{abs(z):.1f} SD {'above' if z > 0 else 'below'} personal baseline "
                                  f"({_fmt(m, b.mean)} ± {_fmt(m, b.std)} {METRICS[m]['unit']})")
                reasons_pt.append(f"{abs(z):.1f} DP {'acima' if z > 0 else 'abaixo'} da linha de base pessoal "
                                  f"({_fmt(m, b.mean)} ± {_fmt(m, b.std)} {METRICS[m]['unit']})")
        pts_safe, which, crit = _safety(value, th["safety"].get(m))
        if pts_safe:
            limit = th["safety"][m][which]
            reasons_en.append(f"{'critical' if crit else 'attention'} limit {limit} {METRICS[m]['unit']} crossed "
                              "(configured demo threshold)")
            reasons_pt.append(f"limite de {'criticidade' if crit else 'atenção'} {limit} {METRICS[m]['unit']} "
                              "ultrapassado (limite de demonstração configurado)")
            if crit:
                critical_flags.append(m)
        # Rapid change: >= 2 SD shift within the last 90 minutes, with >= 3 readings.
        pts_trend = 0
        if b:
            recent = [(t, v) for t, v, _ in series if t >= now - timedelta(minutes=90)]
            if len(recent) >= 3:
                delta = recent[-1][1] - recent[0][1]
                if abs(delta) >= 2 * b.std and (z is None or np.sign(delta) == np.sign(z)):
                    pts_trend = 1
                    reasons_en.append(f"rapid change of {delta:+.1f} {METRICS[m]['unit']} in "
                                      f"{int((recent[-1][0] - recent[0][0]).total_seconds() // 60)} min")
                    reasons_pt.append(f"mudança rápida de {delta:+.1f} {METRICS[m]['unit']} em "
                                      f"{int((recent[-1][0] - recent[0][0]).total_seconds() // 60)} min")
        pts = max(pts_base, pts_safe) + pts_trend
        if pts:
            vital_points[m] = pts
            contributors.append({
                "indicator": m, "label": METRICS[m]["label"], "kind": "vital", "group": METRICS[m]["group"],
                "value": value, "unit": METRICS[m]["unit"], "measured_at": iso(ts), "origin": origin,
                "baseline": b.mean if b else None, "baseline_std": b.std if b else None,
                "z": round(z, 2) if z is not None else None,
                "delta": round(value - b.mean, 2) if b else None,
                "points": pts, "critical": crit,
                "reason": L(_cap("; ".join(reasons_en)), _cap("; ".join(reasons_pt))),
            })
        if not b:
            notes.append(L(f"No personal baseline yet for {METRICS[m]['label']['en']}; only fixed demo limits applied.",
                           f"Ainda sem linha de base pessoal para {METRICS[m]['label']['pt']}; apenas limites fixos aplicados."))
    n_vital_readings = len(rows)

    # ---------- Daily indicators (sleep, activity, hydration, cognition) ----------
    logs = db.scalars(select(DailyLog).where(DailyLog.astronaut_id == astronaut.id,
                                             DailyLog.timestamp <= now,
                                             DailyLog.timestamp > now - timedelta(days=4))).all()
    by_day: dict = {}
    for lg in logs:
        cur = by_day.get(lg.day)
        if cur is None or (ORIGIN_PRIORITY[lg.origin], lg.timestamp) > (ORIGIN_PRIORITY[cur.origin], cur.timestamp):
            by_day[lg.day] = lg
    days = [by_day[d] for d in sorted(by_day)]
    last = days[-1] if days and days[-1].timestamp > now - timedelta(hours=36) else None
    daily_points: dict[str, int] = {}
    dcfg = th["daily"]
    if last is None:
        for m in DAILY:
            missing.append({"indicator": m, "label": METRICS[m]["label"],
                            "reason": L("No daily log in the last 36 h", "Nenhum registro diário nas últimas 36 h")})
    else:
        def add_daily(m: str, pts: int, en: str, pt: str):
            b = bl.get(m)
            v = getattr(last, m)
            daily_points[m] = pts
            origins.add(last.origin)
            contributors.append({
                "indicator": m, "label": METRICS[m]["label"], "kind": "daily", "group": METRICS[m]["group"],
                "value": v, "unit": METRICS[m]["unit"], "measured_at": iso(last.timestamp), "origin": last.origin,
                "baseline": b.mean if b else None, "baseline_std": b.std if b else None,
                "z": round((v - b.mean) / b.std, 2) if b and v is not None else None,
                "delta": round(v - b.mean, 2) if b and v is not None else None,
                "points": pts, "critical": False, "reason": L(en, pt)})

        for m in DAILY:
            if getattr(last, m) is None:
                missing.append({"indicator": m, "label": METRICS[m]["label"],
                                "reason": L("Not recorded in the latest daily log", "Não registrado no último registro diário")})
        b = bl.get("sleep_hours")
        if b and last.sleep_hours is not None:
            deficit = b.mean - last.sleep_hours
            recent = [d.sleep_hours for d in days[-3:] if d.sleep_hours is not None]
            avg_def = b.mean - (sum(recent) / len(recent)) if recent else 0
            pts, en, pt = 0, [], []
            if deficit >= dcfg["sleep_deficit_h"]:
                pts += 1
                en.append(f"last sleep {last.sleep_hours:.1f} h, {deficit:.1f} h below personal baseline ({b.mean:.1f} h)")
                pt.append(f"último sono {last.sleep_hours:.1f} h, {deficit:.1f} h abaixo da linha de base ({b.mean:.1f} h)")
            if len(recent) >= 3 and avg_def >= dcfg["sleep_deficit_h"]:
                pts += 1
                en.append(f"3-night average {b.mean - avg_def:.1f} h (accumulated deficit)")
                pt.append(f"média de 3 noites {b.mean - avg_def:.1f} h (déficit acumulado)")
            if pts:
                add_daily("sleep_hours", pts, _cap("; ".join(en)), _cap("; ".join(pt)))
        b = bl.get("sleep_quality")
        if b and last.sleep_quality is not None and b.mean - last.sleep_quality >= dcfg["sleep_quality_drop"]:
            add_daily("sleep_quality", 1, f"Sleep quality {last.sleep_quality:.0f}/100 vs personal baseline {b.mean:.0f}",
                      f"Qualidade do sono {last.sleep_quality:.0f}/100 vs linha de base {b.mean:.0f}")
        b = bl.get("cognitive_score")
        if b and last.cognitive_score is not None:
            drop = (b.mean - last.cognitive_score) / b.mean * 100
            pts = sum(1 for lim in dcfg["cognitive_drop_pct"] if drop >= lim)
            if pts:
                add_daily("cognitive_score", pts,
                          f"Cognitive score {last.cognitive_score:.0f} is {drop:.0f}% below personal baseline ({b.mean:.0f})",
                          f"Pontuação cognitiva {last.cognitive_score:.0f} está {drop:.0f}% abaixo da linha de base ({b.mean:.0f})")
        b = bl.get("hydration_ml")
        if b and last.hydration_ml is not None and last.hydration_ml < b.mean * dcfg["hydration_min_pct"] / 100:
            add_daily("hydration_ml", 1, f"Fluid intake {last.hydration_ml:.0f} mL is below {dcfg['hydration_min_pct']}% of personal baseline ({b.mean:.0f} mL)",
                      f"Ingestão {last.hydration_ml:.0f} mL abaixo de {dcfg['hydration_min_pct']}% da linha de base ({b.mean:.0f} mL)")
        b = bl.get("activity_minutes")
        if b and last.activity_minutes is not None and last.activity_minutes < b.mean * dcfg["activity_min_pct"] / 100:
            add_daily("activity_minutes", 1, f"Exercise {last.activity_minutes:.0f} min is below {dcfg['activity_min_pct']}% of personal baseline ({b.mean:.0f} min)",
                      f"Exercício {last.activity_minutes:.0f} min abaixo de {dcfg['activity_min_pct']}% da linha de base ({b.mean:.0f} min)")

    # ---------- Environment (shared cabin context) ----------
    env = db.scalars(select(EnvironmentReading).where(EnvironmentReading.timestamp <= now,
                                                      EnvironmentReading.timestamp > now - timedelta(hours=3))
                     .order_by(EnvironmentReading.timestamp.desc()).limit(1)).first()
    env_points = 0
    if env is None:
        missing.append({"indicator": "environment", "label": L("Cabin environment", "Ambiente da cabine"),
                        "reason": L("No environmental reading in the last 3 h", "Nenhuma leitura ambiental nas últimas 3 h")})
    else:
        for m, t in th["environment"].items():
            v = getattr(env, m)
            if v is None:
                continue
            p, which, crit = _safety(v, t)
            if p:
                pts = 2 if crit else 1
                env_points += pts
                contributors.append({
                    "indicator": m, "label": METRICS[m]["label"], "kind": "environment", "group": "environment",
                    "value": v, "unit": METRICS[m]["unit"], "measured_at": iso(env.timestamp), "origin": env.origin,
                    "baseline": None, "baseline_std": None, "z": None, "delta": None, "points": pts, "critical": False,
                    "reason": L(f"Cabin {METRICS[m]['label']['en'].lower()} crossed the {'critical' if crit else 'attention'} limit "
                                f"{t[which]} {METRICS[m]['unit']} (shared crew exposure context)",
                                f"{METRICS[m]['label']['pt']} ultrapassou o limite de {'criticidade' if crit else 'atenção'} "
                                f"{t[which]} {METRICS[m]['unit']} (contexto de exposição compartilhada)")})

    # ---------- Space weather context (never treated as personal dose) ----------
    context = []
    if space_context and space_context.get("significant"):
        context.append({"kind": "space_weather", "points": 0, "origin": space_context.get("origin"),
                        "events": space_context.get("significant")[:3],
                        "reason": L("Significant solar activity reported by NASA DONKI in the last 72 h. This is "
                                    "heliospheric context only — it is NOT the astronaut's personal radiation dose.",
                                    "Atividade solar significativa relatada pelo NASA DONKI nas últimas 72 h. É apenas "
                                    "contexto heliosférico — NÃO é a dose de radiação pessoal do astronauta.")})

    # ---------- Pattern / combination rules ----------
    physio_points = sum(vital_points.values()) + sum(daily_points.values())
    if len(vital_points) >= 3:
        contributors.append({"indicator": "pattern_multi_vital", "label": L("Co-occurring vital changes", "Alterações vitais simultâneas"),
                             "kind": "pattern", "group": "pattern", "points": 2, "critical": False,
                             "reason": L(f"{len(vital_points)} vital signs deviate at the same time, which is less likely to be a single sensor artefact",
                                         f"{len(vital_points)} sinais vitais desviam ao mesmo tempo, o que torna menos provável um artefato de um único sensor")})
    if ("sleep_hours" in daily_points or "sleep_quality" in daily_points) and "cognitive_score" in daily_points:
        contributors.append({"indicator": "pattern_fatigue", "label": L("Sleep loss with cognitive decline", "Perda de sono com queda cognitiva"),
                             "kind": "pattern", "group": "fatigue", "points": 1, "critical": False,
                             "reason": L("Reduced sleep coincides with a lower cognitive assessment score",
                                         "Sono reduzido coincide com pontuação cognitiva menor")})
    if env_points and physio_points >= 2:
        contributors.append({"indicator": "pattern_env_physio", "label": L("Environment + physiology", "Ambiente + fisiologia"),
                             "kind": "pattern", "group": "environment", "points": 2, "critical": False,
                             "reason": L("Physiological changes occur while cabin conditions are outside configured limits",
                                         "Alterações fisiológicas ocorrem enquanto a cabine está fora dos limites configurados")})

    # ---------- Unsupervised multivariate signal ----------
    model = _isolation_signal(db, astronaut.id, bl, latest, now) if any(latest.get(m) is not None for m in VITALS) else None
    if model and model["flagged"]:
        contributors.append({"indicator": "model_isolation_forest", "label": L("Multivariate anomaly signal", "Sinal multivariado de anomalia"),
                             "kind": "model", "group": "model", "points": 1, "critical": False, "value": model["score"],
                             "reason": L("The combination of current vitals is unusual compared with this astronaut's own history "
                                         "(IsolationForest, unsupervised, not clinically validated)",
                                         "A combinação atual de sinais vitais é incomum em relação ao próprio histórico do astronauta "
                                         "(IsolationForest, não supervisionado, não validado clinicamente)")})

    # ---------- Level ----------
    score = sum(c["points"] for c in contributors)
    lv = th["levels"]
    if critical_flags or score >= lv["red_score"]:
        level = "RED"
    elif score >= lv["yellow_score"]:
        level = "YELLOW"
    else:
        level = "GREEN"
    contributors.sort(key=lambda c: (-c["points"], c["kind"]))

    # ---------- Confidence (data completeness & freshness, not model accuracy) ----------
    expected = len(VITALS) + len(DAILY) + 1
    present = expected - len(missing)
    conf = present / expected
    if len(bl) < len(VITALS):
        conf -= 0.15
        notes.append(L("Personal baseline is incomplete.", "Linha de base pessoal incompleta."))
    if n_vital_readings <= 1:
        conf -= 0.1
        notes.append(L("Only one recent vital-sign reading: repeat the measurement before drawing conclusions.",
                       "Apenas uma leitura recente de sinais vitais: repita a medição antes de concluir."))
    stale = [m for m, t in latest_ts.items() if now - t > timedelta(hours=3)]
    if stale:
        conf -= 0.05 * len(stale)
    conf = max(0.0, min(1.0, conf))
    conf_label = "high" if conf >= 0.85 else "medium" if conf >= 0.6 else "low"

    category = classify(contributors, level)
    return {
        "astronaut_id": astronaut.id, "astronaut_code": astronaut.code, "astronaut_name": astronaut.name,
        "evaluated_at": iso(now), "level": level, "score": score, "category": category,
        "thresholds": {"yellow": lv["yellow_score"], "red": lv["red_score"]},
        "critical_flags": critical_flags,
        "contributors": contributors, "context": context,
        "what_changed": _what_changed(contributors),
        "why": _why(level, score, lv, critical_flags),
        "confidence": {"score": round(conf, 2), "label": conf_label, "missing": missing,
                       "stale": stale, "notes": notes, "data_origins": sorted(origins)},
        "model": model,
        "recommendations": recommendations(level, category, contributors, missing),
        "is_diagnosis": False,
        "disclaimer": DISCLAIMER,
    }


def classify(contributors: list[dict], level: str) -> str:
    if level == "GREEN":
        return "stable"
    groups: dict[str, int] = {}
    for c in contributors:
        groups[c["group"]] = groups.get(c["group"], 0) + c["points"]
    physio = {g: p for g, p in groups.items() if g in ("cardio", "respiratory", "thermal", "sleep", "cognitive", "fatigue", "hydration", "activity")}
    if groups.get("environment", 0) >= 2 and physio:
        return "environmental"
    fatigue = sum(groups.get(g, 0) for g in ("sleep", "cognitive", "fatigue"))
    cardio = groups.get("cardio", 0)
    resp = groups.get("respiratory", 0)
    if not physio and groups.get("environment"):
        return "environmental"
    best = max([("cardiovascular", cardio), ("respiratory", resp), ("fatigue", fatigue),
                ("thermal", groups.get("thermal", 0))], key=lambda x: x[1])
    return best[0] if best[1] > 0 else "general"


def _what_changed(contributors: list[dict]) -> list[dict]:
    out = []
    for c in contributors:
        if c["kind"] not in ("vital", "daily", "environment"):
            continue
        m = c["indicator"]
        if c.get("baseline") is not None:
            en = f"{c['label']['en']}: {_fmt(m, c['value'])} {c['unit']} ({c['delta']:+.1f} vs personal baseline {_fmt(m, c['baseline'])})"
            pt = f"{c['label']['pt']}: {_fmt(m, c['value'])} {c['unit']} ({c['delta']:+.1f} vs linha de base {_fmt(m, c['baseline'])})"
        else:
            en = f"{c['label']['en']}: {_fmt(m, c['value'])} {c['unit']}"
            pt = f"{c['label']['pt']}: {_fmt(m, c['value'])} {c['unit']}"
        out.append(L(en, pt))
    return out[:6]


def _why(level: str, score: int, lv: dict, flags: list[str]) -> dict:
    if flags:
        names_en = ", ".join(METRICS[f]["label"]["en"] for f in flags)
        names_pt = ", ".join(METRICS[f]["label"]["pt"] for f in flags)
        return L(f"RED because a configured critical limit was crossed ({names_en}). Total score {score}.",
                 f"VERMELHO porque um limite crítico configurado foi ultrapassado ({names_pt}). Pontuação total {score}.")
    if level == "RED":
        return L(f"RED because the combined score {score} reached the red threshold ({lv['red_score']}).",
                 f"VERMELHO porque a pontuação combinada {score} atingiu o limite vermelho ({lv['red_score']}).")
    if level == "YELLOW":
        return L(f"YELLOW because the combined score {score} reached the attention threshold ({lv['yellow_score']}).",
                 f"AMARELO porque a pontuação combinada {score} atingiu o limite de atenção ({lv['yellow_score']}).")
    return L(f"GREEN: combined score {score} is below the attention threshold ({lv['yellow_score']}).",
             f"VERDE: pontuação combinada {score} abaixo do limite de atenção ({lv['yellow_score']}).")


def recommendations(level: str, category: str, contributors: list[dict], missing: list[dict]) -> list[dict]:
    recs: list[dict] = []
    ind = {c["indicator"] for c in contributors}
    if level == "RED":
        recs.append(L("Request immediate human assessment by the crew medical officer.",
                      "Solicitar avaliação humana imediata pelo oficial médico da tripulação."))
        recs.append(L("Open RESCUE WINDOW and follow the relevant preconfigured protocol checklist.",
                      "Abrir a RESCUE WINDOW e seguir o checklist do protocolo pré-configurado relevante."))
        recs.append(L("Notify the ground medical team as soon as the communication link allows (expect delay).",
                      "Notificar a equipe médica em solo assim que o link de comunicação permitir (considere o atraso)."))
    elif level == "YELLOW":
        recs.append(L("Repeat the measurement within 15 minutes and check sensor placement.",
                      "Repetir a medição em até 15 minutos e verificar o posicionamento do sensor."))
        recs.append(L("Increase monitoring frequency and review with the crew medical officer.",
                      "Aumentar a frequência de monitoramento e revisar com o oficial médico da tripulação."))
    else:
        recs.append(L("Continue routine monitoring.", "Continuar o monitoramento de rotina."))
    if category == "cardiovascular" or ind & {"heart_rate", "systolic", "diastolic"}:
        recs.append(L("Stop strenuous activity, rest in a stable position and take a repeat reading.",
                      "Interromper atividade intensa, repousar em posição estável e repetir a leitura."))
        if level == "RED":
            recs.append(L("Confirm the location and readiness of the AED and ECG-capable monitor.",
                          "Confirmar a localização e a prontidão do DEA e do monitor com ECG."))
    if "spo2" in ind:
        recs.append(L("Verify oximeter placement and cross-check cabin O2 before acting on SpO2 alone.",
                      "Verificar o oxímetro e conferir o O2 da cabine antes de agir apenas pelo SpO2."))
    if category == "fatigue" or ind & {"sleep_hours", "cognitive_score"}:
        recs.append(L("Consider postponing safety-critical tasks (e.g. EVA, robotics) until assessed; schedule a rest period and repeat the cognitive test.",
                      "Considerar adiar tarefas críticas (ex.: EVA, robótica) até a avaliação; programar descanso e repetir o teste cognitivo."))
    if "hydration_ml" in ind:
        recs.append(L("Review and log fluid intake.", "Revisar e registrar a ingestão de líquidos."))
    if category == "environmental" or any(c["kind"] == "environment" for c in contributors):
        recs.append(L("Confirm cabin readings with an independent sensor and follow the cabin-atmosphere checklist.",
                      "Confirmar as leituras da cabine com um sensor independente e seguir o checklist de atmosfera."))
    if missing:
        recs.append(L(f"Collect the {len(missing)} missing indicator(s) to improve data confidence.",
                      f"Coletar o(s) {len(missing)} indicador(es) ausente(s) para melhorar a confiança dos dados."))
    return recs
