# ORBITA — Architecture

## Overview

ORBITA is a two-tier application. The **FastAPI backend** plays the role of an *onboard server* (it would run inside the habitat). The **React SPA** is the crew interface and keeps its own local cache so that it remains useful if the onboard server becomes unreachable. Communication with Earth is **simulated** (Mission Link).

```
┌─────────────────────────── Browser ───────────────────────────┐
│ React 19 + TS (Vite, Tailwind v4, Recharts)                    │
│  pages/  MissionControl · BioTwin · VitalScan · EarlyWarning   │
│          RescueWindow · SpaceEnvironment · MissionLink · Settings│
│  components/  Layout (sidebar, banners) · GuidedDemo · charts   │
│  api/client.ts  apiGet (cache-on-success, serve-cache-offline)  │
│                 apiSendOrQueue (local outbox, replay on reconnect)│
│  i18n.tsx  EN (default) / PT dictionary + bilingual API payloads │
└───────────────────────────── /api ─────────────────────────────┘
                                 │  JSON, Bearer demo token
┌──────────────────────── FastAPI (app/) ────────────────────────┐
│ routers/crew.py      auth (demo), mission, astronauts, baselines,│
│                      measurements, daily logs, sensors, analysis │
│ routers/response.py  alerts, emergencies (RESCUE WINDOW),        │
│                      scenarios, environment, sources, sync,      │
│                      settings, events, demo reset                │
│ analysis.py   transparent scoring + IsolationForest              │
│ alerting.py   alert / emergency lifecycle, system events         │
│ scenarios.py  3 progressive simulated emergencies                │
│ simulation.py synthetic feed + backfill to "now"                 │
│ baselines.py  per-astronaut baselines (pandas)                   │
│ nasa.py       DONKI + OSDR clients with SQLite cache             │
│ models.py     SQLAlchemy entities → SQLite (data/orbita.db)      │
└─────────────────────────────────────────────────────────────────┘
```

## Data model (SQLite)

| Entity | Purpose |
|---|---|
| `missions` | Mission name, habitat, start, planned duration (fictional). |
| `astronauts` | Fictional crew profiles (`is_fictional = true`). |
| `baselines` | Per astronaut × metric: mean, SD (with a floor), p05, p95, n, window. Computed from simulated + user data, **excluding scenario data**. |
| `vital_measurements` | HR, SpO₂, systolic/diastolic, temperature, respiratory rate (nullable = missing). `origin` = simulated / user / scenario. |
| `daily_logs` | Sleep hours & quality, activity minutes, fluid intake, cognitive score. |
| `environment_readings` | Cabin pressure, O₂ %, ppCO₂, temperature, humidity, simulated dose rate. |
| `alerts` | Level, category, bilingual title/summary, analysis snapshot, status, history (JSON). |
| `emergency_events` + `emergency_actions` | RESCUE WINDOW events and their timeline (detection, alert, reassessment, acknowledge, escalate, action, note, resolve). |
| `medical_resources`, `emergency_protocols` | Demo inventory and educational checklists. |
| `data_sources`, `cached_payloads` | Source catalog and cached DONKI / OSDR responses. |
| `sync_records` | Simulated Earth-link synchronizations (queued / in transit / delivered, ETA). |
| `system_events` | Mission event log. |
| `scenario_runs` | Active/finished simulations; deleting a run cascades to all its data. |
| `app_settings`, `demo_sessions` | Thresholds, link state, sensor states; demo access tokens. |

## Early Warning scoring (transparent)

For each astronaut at time *t*:

1. **Vitals** — latest reading in the last 6 h per metric. `z = (value − personal mean) / personal SD`.
   |z| ≥ 2 → 1 pt, ≥ 3 → 2 pts, ≥ 4 → 3 pts. Configured safety limits: attention → 2 pts, critical → 4 pts **and RED**. The larger of the two is used, +1 for a rapid change (≥ 2 SD within 90 min).
2. **Daily** — sleep deficit (last night ≥ 2 h: +1; 3-night average ≥ 2 h: +1), sleep quality drop ≥ 20 (+1), cognitive drop ≥ 10/20/30 % (+1/+2/+3), fluid intake < 75 % (+1), activity < 50 % (+1).
3. **Environment** (shared cabin) — attention +1, critical +2 per metric.
4. **Patterns** — ≥ 3 co-occurring vital deviations +2; sleep + cognition +1; environment + physiology +2.
5. **IsolationForest** trained only on the astronaut's own baseline window (standardized vitals): decision function < −0.05 → +1.
6. **Space weather** (DONKI) — listed as context, **0 points**.

Level: RED if any critical flag or score ≥ 7; YELLOW if score ≥ 3; else GREEN (all configurable).
**Confidence** = fraction of the 12 expected indicators present, minus penalties for incomplete baselines, single readings and stale data. It describes data completeness, *not* model accuracy.

## Alert → RESCUE WINDOW lifecycle

- YELLOW/RED creates one open alert per astronaut; later evaluations update it and raise the level (never auto-resolve — humans resolve).
- RED opens an emergency event: timeline gets the first-detection time (when the alert was first raised) and the RED alert. Priority **P1** if a critical limit was crossed, otherwise **P2**.
- Acknowledge / escalate / resolve / free-text actions / protocol steps are recorded with actor and time. Escalation creates a sync package on the simulated Earth link.
- The "response-priority window" is a label derived from the rules, shown with its uncertainty — never a countdown or survival estimate.

## Scenarios

`scenarios.py` defines three scenarios as deltas from the astronaut's own baseline. Running one: (1) removes any previous scenario data, (2) replaces simulated readings in the scenario's time slots, (3) inserts three readings per stage (`origin = "scenario"`), (4) runs the full crew analysis **as of each stage time**, producing the real alert/emergency history. While a scenario is active, the simulated feed for that astronaut continues the critical pattern. Resetting deletes the run (DB cascade).

## Offline operation

- **Client:** every successful GET is cached in `localStorage`; on network failure the cached copy is served and a banner shows the cache age. RESCUE WINDOW actions, manual measurements and daily logs are queued in a local outbox and replayed when the server answers again. "Simulate local server outage" forces this mode for demonstration.
- **Server:** the backend works without internet; NASA payloads are cached in SQLite; a synthetic, labeled DONKI sample is used only when nothing else exists.
- **Earth link:** simulated status and delay; sync records move queued → in transit → delivered (ETA = 2 × one-way delay, × 2 when degraded).

## Security notes (prototype)

Demo access mode only: `POST /api/auth/demo` issues a random bearer token stored in SQLite; all other endpoints except `/api/health` require it. No passwords or real accounts. Inputs are validated with Pydantic (plausible physical ranges, ordering of thresholds, no future timestamps). Not production authentication.

## Main API endpoints

| Area | Endpoints |
|---|---|
| Access | `POST /api/auth/demo`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Mission | `GET /api/mission`, `GET /api/events` |
| Astronauts | `GET/POST /api/astronauts`, `GET/PATCH /api/astronauts/{id}`, `GET /api/astronauts/{id}/baselines`, `POST …/baselines/recompute`, `GET …/history` |
| Measurements | `GET/POST /api/astronauts/{id}/measurements`, `POST …/simulate`, `GET/POST …/daily`, `GET/PUT …/sensors` |
| Analysis | `GET /api/astronauts/{id}/analysis`, `GET /api/analysis/crew`, `POST /api/analysis/run` |
| Alerts | `GET /api/alerts`, `GET /api/alerts/{id}`, `POST /api/alerts/{id}/{acknowledge|escalate|resolve}` |
| Emergencies | `GET /api/emergencies`, `GET /api/emergencies/{id}`, `POST /api/emergencies/{id}/actions`, `GET /api/protocols`, `GET /api/resources` |
| Scenarios | `GET /api/scenarios`, `POST /api/scenarios/{cardio|fatigue|environment}/run`, `POST /api/scenarios/reset` |
| Environment | `GET /api/environment`, `GET /api/environment/space-weather`, `POST …/refresh` |
| Sources | `GET /api/sources`, `GET /api/sources/osdr`, `POST /api/sources/osdr/refresh` |
| Mission Link | `GET /api/sync`, `POST /api/sync`, `PUT /api/sync/link` |
| Settings | `GET/PUT /api/settings/thresholds`, `POST /api/settings/thresholds/reset`, `POST /api/demo/reset` |

Interactive documentation: `http://localhost:8000/docs`.
