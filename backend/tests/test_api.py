"""Integration tests: run against a temporary SQLite database, offline (no NASA network calls)."""
import os
import tempfile

os.environ["ORBITA_DATA_DIR"] = tempfile.mkdtemp(prefix="orbita-test-")
os.environ["ORBITA_LIVE_NASA"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        token = c.post("/api/auth/demo", json={"name": "Tester"}).json()["token"]
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


def test_requires_demo_session():
    with TestClient(app) as c:
        assert c.get("/api/mission").status_code == 401
        assert c.get("/api/health").status_code == 200


def test_mission_status_baseline_is_green(client):
    d = client.get("/api/mission").json()
    assert d["mission"]["is_simulated"] is True
    assert len(d["crew"]) == 4
    assert d["mission"]["day"] >= 118
    for member in d["crew"]:
        assert member["level"] in ("GREEN", "YELLOW")


def test_individual_baselines_differ(client):
    b1 = {b["metric"]: b["mean"] for b in client.get("/api/astronauts/1/baselines").json()}
    b3 = {b["metric"]: b["mean"] for b in client.get("/api/astronauts/3/baselines").json()}
    assert abs(b1["heart_rate"] - b3["heart_rate"]) > 5


def test_manual_measurement_validation(client):
    r = client.post("/api/astronauts/1/measurements", json={"heart_rate": 999})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "VALIDATION_ERROR"
    r = client.post("/api/astronauts/1/measurements", json={})
    assert r.status_code == 422
    r = client.post("/api/astronauts/1/measurements", json={"systolic": 80, "diastolic": 90})
    assert r.status_code == 422
    r = client.post("/api/astronauts/1/measurements", json={"heart_rate": 60, "spo2": 98})
    assert r.status_code == 201 and r.json()["measurement"]["origin"] == "user"


def test_missing_sensor_reduces_confidence(client):
    a = client.get("/api/astronauts/4/analysis").json()
    assert any(m["indicator"] == "temperature" for m in a["confidence"]["missing"])
    assert a["is_diagnosis"] is False
    s = client.get("/api/astronauts/4/sensors").json()
    temp = next(x for x in s["sensors"] if x["metric"] == "temperature")
    assert temp["status"] == "disconnected"


@pytest.mark.parametrize("key,category", [("cardio", "cardiovascular"), ("fatigue", "fatigue"), ("environment", "environmental")])
def test_scenarios_progress_to_rescue_window(client, key, category):
    r = client.post(f"/api/scenarios/{key}/run").json()
    levels = [s["level"] for s in r["stages"]]
    assert levels == ["GREEN", "YELLOW", "RED"]
    assert r["simulated"] is True and r["emergency_id"]
    e = client.get(f"/api/emergencies/{r['emergency_id']}").json()
    assert e["category"] == category and e["simulated"] is True
    assert [t["kind"] for t in e["timeline"]][:2] == ["detection", "alert"]
    assert e["protocols"] and e["resources"]
    assert "NOT a survival estimate" in e["priority_info"]["uncertainty"]["en"]
    # acknowledge -> escalate -> action -> resolve
    for kind, text in (("acknowledge", ""), ("escalate", ""), ("action", "Crew medical officer took repeat vitals")):
        assert client.post(f"/api/emergencies/{e['id']}/actions", json={"kind": kind, "text": text}).status_code == 201
    assert client.post(f"/api/emergencies/{e['id']}/actions", json={"kind": "action", "text": ""}).status_code == 422
    e2 = client.get(f"/api/emergencies/{e['id']}").json()
    assert e2["status"] == "escalated" and len(e2["timeline"]) >= 5
    assert client.post(f"/api/emergencies/{e['id']}/actions", json={"kind": "resolve"}).status_code == 201
    assert client.post(f"/api/emergencies/{e['id']}/actions", json={"kind": "note", "text": "x"}).status_code == 409


def test_scenario_reset_removes_simulated_scenario_data(client):
    client.post("/api/scenarios/cardio/run")
    assert client.get("/api/scenarios").json()["active"] is not None
    client.post("/api/scenarios/reset")
    assert client.get("/api/scenarios").json()["active"] is None
    assert all(a["scenario_run_id"] is None for a in client.get("/api/alerts").json())


def test_sync_with_blackout_queues(client):
    client.put("/api/sync/link", json={"status": "blackout", "one_way_delay_s": 5})
    rec = client.post("/api/sync").json()
    assert rec["status"] == "queued"
    client.put("/api/sync/link", json={"status": "nominal", "one_way_delay_s": 0})
    s = client.get("/api/sync").json()
    assert s["records"][0]["status"] in ("in_transit", "delivered")


def test_space_weather_offline_is_labeled_sample(client):
    sw = client.get("/api/environment/space-weather").json()
    assert sw["origin"] in ("sample", "live")
    if sw["origin"] == "sample":
        assert "SYNTHETIC" in sw["label"]["en"]
    assert "not a measurement" in sw["note"]["en"]


def test_thresholds_validation(client):
    bad = {"safety": {"heart_rate": {"warn_high": 120, "crit_high": 100}}}
    assert client.put("/api/settings/thresholds", json=bad).status_code == 422
    ok = {"levels": {"yellow_score": 4, "red_score": 8}}
    assert client.put("/api/settings/thresholds", json=ok).json()["thresholds"]["levels"]["yellow_score"] == 4
    client.post("/api/settings/thresholds/reset")


def test_demo_reset_persists_session(client):
    assert client.post("/api/demo/reset").status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    assert len(client.get("/api/astronauts").json()) == 4
