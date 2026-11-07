"""Metric metadata and configurable demo thresholds.

IMPORTANT: the default thresholds below are *demonstration defaults* chosen to make the prototype
behave sensibly. They are NOT validated clinical or spaceflight limits and must be reviewed by
qualified professionals before any real-world use. They can be changed in Settings.
"""
import copy

from sqlalchemy.orm import Session

from .db import L
from .models import AppSetting

VITALS = ["heart_rate", "spo2", "systolic", "diastolic", "temperature", "respiratory_rate"]
DAILY = ["sleep_hours", "sleep_quality", "activity_minutes", "hydration_ml", "cognitive_score"]
ENVIRONMENT = ["cabin_pressure_kpa", "o2_percent", "co2_mmhg", "cabin_temperature_c", "humidity_percent", "radiation_ugy_h"]

METRICS: dict[str, dict] = {
    "heart_rate": {"unit": "bpm", "label": L("Heart rate", "Frequência cardíaca"), "min_std": 3.0, "decimals": 0,
                   "range": (25, 230), "group": "cardio"},
    "spo2": {"unit": "%", "label": L("Blood oxygen (SpO2)", "Oxigenação (SpO2)"), "min_std": 0.6, "decimals": 1,
             "range": (50, 100), "group": "respiratory"},
    "systolic": {"unit": "mmHg", "label": L("Systolic pressure", "Pressão sistólica"), "min_std": 4.0, "decimals": 0,
                 "range": (50, 260), "group": "cardio"},
    "diastolic": {"unit": "mmHg", "label": L("Diastolic pressure", "Pressão diastólica"), "min_std": 3.0, "decimals": 0,
                  "range": (25, 160), "group": "cardio"},
    "temperature": {"unit": "°C", "label": L("Body temperature", "Temperatura corporal"), "min_std": 0.15, "decimals": 1,
                    "range": (30, 43), "group": "thermal"},
    "respiratory_rate": {"unit": "/min", "label": L("Respiratory rate", "Frequência respiratória"), "min_std": 1.2,
                         "decimals": 0, "range": (4, 60), "group": "respiratory"},
    "sleep_hours": {"unit": "h", "label": L("Sleep duration", "Duração do sono"), "min_std": 0.4, "decimals": 1,
                    "range": (0, 16), "group": "sleep"},
    "sleep_quality": {"unit": "/100", "label": L("Sleep quality", "Qualidade do sono"), "min_std": 4.0, "decimals": 0,
                      "range": (0, 100), "group": "sleep"},
    "activity_minutes": {"unit": "min", "label": L("Exercise / activity", "Exercício / atividade"), "min_std": 8.0,
                         "decimals": 0, "range": (0, 600), "group": "activity"},
    "hydration_ml": {"unit": "mL", "label": L("Fluid intake", "Ingestão de líquidos"), "min_std": 150.0, "decimals": 0,
                     "range": (0, 8000), "group": "hydration"},
    "cognitive_score": {"unit": "/100", "label": L("Cognitive assessment", "Avaliação cognitiva"), "min_std": 2.5,
                        "decimals": 0, "range": (0, 100), "group": "cognitive"},
    "cabin_pressure_kpa": {"unit": "kPa", "label": L("Cabin pressure", "Pressão da cabine"), "decimals": 1,
                           "range": (0, 120), "group": "environment"},
    "o2_percent": {"unit": "%", "label": L("Cabin oxygen", "Oxigênio da cabine"), "decimals": 1, "range": (0, 100),
                   "group": "environment"},
    "co2_mmhg": {"unit": "mmHg", "label": L("Cabin CO2 (partial pressure)", "CO2 da cabine (pressão parcial)"),
                 "decimals": 2, "range": (0, 40), "group": "environment"},
    "cabin_temperature_c": {"unit": "°C", "label": L("Cabin temperature", "Temperatura da cabine"), "decimals": 1,
                            "range": (-10, 60), "group": "environment"},
    "humidity_percent": {"unit": "%", "label": L("Relative humidity", "Umidade relativa"), "decimals": 0,
                         "range": (0, 100), "group": "environment"},
    "radiation_ugy_h": {"unit": "µGy/h", "label": L("Cabin dose rate (simulated dosimeter)", "Taxa de dose na cabine (dosímetro simulado)"),
                        "decimals": 1, "range": (0, 100000), "group": "environment"},
}

DEFAULT_THRESHOLDS: dict = {
    "safety": {
        "heart_rate": {"warn_low": 45, "warn_high": 110, "crit_low": 38, "crit_high": 135},
        "spo2": {"warn_low": 94, "crit_low": 90},
        "systolic": {"warn_low": 95, "warn_high": 145, "crit_low": 85, "crit_high": 175},
        "diastolic": {"warn_low": 55, "warn_high": 95, "crit_low": 45, "crit_high": 115},
        "temperature": {"warn_low": 35.8, "warn_high": 37.8, "crit_low": 35.0, "crit_high": 39.0},
        "respiratory_rate": {"warn_low": 10, "warn_high": 22, "crit_low": 7, "crit_high": 30},
    },
    "environment": {
        "co2_mmhg": {"warn_high": 4.0, "crit_high": 6.0},
        "o2_percent": {"warn_low": 19.5, "crit_low": 18.0},
        "cabin_pressure_kpa": {"warn_low": 97.0, "warn_high": 104.0, "crit_low": 90.0},
        "cabin_temperature_c": {"warn_low": 18.0, "warn_high": 27.0},
        "humidity_percent": {"warn_low": 25, "warn_high": 75},
        "radiation_ugy_h": {"warn_high": 40.0, "crit_high": 120.0},
    },
    "baseline": {"z_minor": 2.0, "z_major": 3.0, "z_severe": 4.0},
    "daily": {
        "sleep_deficit_h": 2.0,
        "sleep_quality_drop": 20,
        "cognitive_drop_pct": [10, 20, 30],
        "hydration_min_pct": 75,
        "activity_min_pct": 50,
    },
    "levels": {"yellow_score": 3, "red_score": 7},
}


def get_thresholds(db: Session) -> dict:
    row = db.get(AppSetting, "thresholds")
    if row is None:
        return copy.deepcopy(DEFAULT_THRESHOLDS)
    merged = copy.deepcopy(DEFAULT_THRESHOLDS)
    for section, values in (row.value or {}).items():
        if isinstance(values, dict) and section in merged:
            for k, v in values.items():
                if isinstance(v, dict) and isinstance(merged[section].get(k), dict):
                    merged[section][k].update(v)
                else:
                    merged[section][k] = v
    return merged


def get_setting(db: Session, key: str, default: dict) -> dict:
    row = db.get(AppSetting, key)
    return copy.deepcopy(row.value) if row else copy.deepcopy(default)


def put_setting(db: Session, key: str, value: dict) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
