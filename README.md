# ORBITA — Astronaut Health Intelligence & Survival System

> *"Don't just monitor the astronaut. Understand how their health is changing — and help them act before a situation becomes critical."*

ORBITA is an **experimental, working software prototype** for astronaut health monitoring and decision support on long-duration missions, built for the **2026 NASA Space Apps Challenge**: [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/create-health-monitoring-software-for-astronauts-on-space-missions/).

> ⚠️ **Scientific and medical disclaimer.** ORBITA is an experimental decision-support prototype. It is **not a medical device**, does **not** diagnose disease, has **not** been clinically validated and does **not** replace medical professionals. All alert thresholds are demonstration defaults, not validated clinical or spaceflight limits. Emergency protocols are educational demonstration content, not certified medical instructions. All crew members and physiological measurements are **fictional / simulated**. ORBITA is **not affiliated with, sponsored, endorsed, approved or tested by NASA**, and it is not connected to any spacecraft or NASA infrastructure. Real NASA open data (DONKI, OSDR) is used only as context and is always labeled with its source.

---

## 1. Problem

On long-duration missions (Moon, Mars), crews cannot rely on continuous, real-time contact with medical teams on Earth. Communication delays reach minutes, and blackouts happen. Crews need a way to:

- see how each person's health is **changing relative to their own normal**, not a population average;
- notice **combinations** of small changes (sleep, cognition, vitals, cabin air) before they become critical;
- understand **why** an alert was raised and how confident the data is;
- move quickly **from detection to action** with the resources actually on board;
- keep working **offline** and synchronize later.

## 2. Proposed solution

ORBITA combines personalized physiological baselines, explainable anomaly scoring, environmental context and an emergency response workflow called **RESCUE WINDOW — From Detection to Action**.

| Module | What it does |
|---|---|
| **Mission Control** | Command view: mission day, crew status, active alerts, recent physiological changes, cabin environment, solar activity, system events, astronaut selector, emergency simulations. |
| **Bio-Twin** | Individual baseline per astronaut and metric (mean, SD, 5–95 % range) computed from their own 14-day history; current vs baseline table, deviation profile, historical charts with the personal band, sleep/activity/hydration/cognition, daily log entry, NASA OSDR research context. |
| **Vital-Scan** | Real-time-style monitoring: current readings, sparklines, sensor connectivity (online / stale / no data / disconnected — toggleable), data-gap counts, 24 h trends with baseline band and configured limits, **simulated live feed** (every 5 s), validated manual entry. |
| **Early Warning** | Transparent scoring → GREEN / YELLOW / RED. For every result: what changed, contributing indicators with their points and reasons, why the level was assigned, data confidence and missing data, recommended next steps, plus an unsupervised IsolationForest signal. Alert lifecycle (acknowledge / escalate / resolve) with history. |
| **Rescue Window** | Opens automatically at RED: affected astronaut, response-priority window (P1 *Immediate* / P2 *Urgent*) with explicit uncertainty, abnormal indicators, evolution charts with event markers, risk factors, available medical resources, preconfigured protocol checklists, action log, acknowledge/escalate/resolve, full event timeline. |
| **Space Environment** | Cabin CO₂, O₂, pressure, temperature, humidity and a simulated dosimeter dose rate with configured limits and trends; environmental alerts; real **NASA DONKI** space-weather events (flares, SEP, CME, geomagnetic storms) — never confused with personal dose. |
| **Mission Link** | Offline operation: local cache of every screen, local outbox for actions taken while the server is unreachable, simulated Earth link (nominal / degraded / blackout, configurable one-way delay with Moon/Mars presets), synchronization history with ETA, last-sync time. |
| **Settings** | Language (English default, Portuguese), editable thresholds (validated), data-source catalog, demo reset, disclaimer. |

A **guided demonstration** (10 steps) walks judges through the whole loop.

## 3. System architecture

```
 Browser (React SPA, EN/PT)                          FastAPI backend ("onboard server")
 ┌──────────────────────────────┐   /api (JSON)   ┌───────────────────────────────────────┐
 │ 8 modules + guided demo      │ ──────────────▶ │ routers: crew · response               │
 │ localStorage cache + outbox  │ ◀────────────── │ analysis  (scoring + IsolationForest)  │
 │ (offline / Mission Link)     │                 │ alerting  (alerts, RESCUE WINDOW)      │
 └──────────────────────────────┘                 │ scenarios (3 simulated emergencies)    │
                                                  │ simulation (synthetic feed)            │
                                                  │ nasa      (DONKI + OSDR, cached)       │
                                                  │ SQLite via SQLAlchemy                  │
                                                  └───────────────────────────────────────┘
```

Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## 4. Technology stack

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts, React Router.
- **Backend:** Python 3.12+ (tested on 3.14), FastAPI, SQLAlchemy 2, Pydantic 2.
- **Data / ML:** Pandas, NumPy, scikit-learn (IsolationForest).
- **Database:** SQLite (file `backend/data/orbita.db`, created and seeded automatically).
- **Tests:** pytest (13 integration tests, run offline).

## 5. NASA datasets and APIs actually used

| Source | Endpoint | Used for |
|---|---|---|
| **NASA DONKI** (via api.nasa.gov, `DEMO_KEY` or a free key) | `https://api.nasa.gov/DONKI/{FLR,SEP,CME,GST}?startDate&endDate&api_key` — fallback `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{type}` | Space-weather events (last 30 days) on Space Environment and Mission Control; contextual factor (0 points) in Early Warning. |
| **NASA OSDR** study metadata | `https://osdr.nasa.gov/osdr/data/osd/meta/{id}` for **OSD-569, OSD-570, OSD-53, OSD-687** | "Spaceflight research context" panel in Bio-Twin and the data-source catalog. |

Full descriptions, what each source measures and limitations: [DATA_SOURCES.md](DATA_SOURCES.md).

### Data limitations

- No real astronaut data is used. All physiological and cabin values are simulated or user-entered and are labeled **SIMULATED**, **SCENARIO SIMULATION** or **USER-ENTERED** everywhere.
- OSDR studies are shown as scientific context only; no ORBITA baseline, threshold or measurement is derived from them.
- DONKI describes the heliospheric environment, **not** any astronaut's radiation dose.
- If DONKI is unreachable (it returned HTTP 503 / timeouts from our development network), ORBITA shows cached data or a **clearly labeled synthetic sample in DONKI format** — never presented as real events.

## 6. Installation

Requirements: **Python 3.12+** and **Node.js 20+**.

```bash
# Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   ·   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

## 7. How to run

**Development (two terminals):**

```bash
cd backend && python -m uvicorn app.main:app --port 8000
```

```bash
cd frontend && npm run dev
```

Open http://localhost:5173 (Vite proxies `/api` to port 8000). If 5173 is busy, run `npx vite --port 5180`.

**Single-port mode (production build):**

```bash
cd frontend && npm run build
cd ../backend && python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000 — FastAPI serves the built SPA and the API from one origin. API docs: http://localhost:8000/docs.

**Options (environment variables):** `NASA_API_KEY` (free key from https://api.nasa.gov; defaults to `DEMO_KEY`), `ORBITA_LIVE_NASA=0` (force offline mode), `ORBITA_DATA_DIR` (database folder).

**Tests:**

```bash
cd backend && python -m pytest -q
cd frontend && npm run lint && npm run build
```

## 8. Demonstration

1. Open the app → **Enter demo mode** (no account or password; keep "Start the guided demonstration" ticked).
2. Follow the guided panel (bottom right) — or see the step-by-step judge script in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
3. Three simulated emergencies are available on Mission Control, Early Warning and Rescue Window:
   - **Scenario 1 — Cardiovascular changes** (AST-01 Elena Varga)
   - **Scenario 2 — Sleep deprivation & cognitive decline** (AST-04 Lucas Ferreira)
   - **Scenario 3 — Environmental risk** (cabin CO₂ rise + AST-03 Amara Okafor)
   Each runs *initial state → deviation (YELLOW) → critical (RED)* and opens a RESCUE WINDOW.
4. "End simulation" (top banner) removes scenario data; Settings → *Reset all demo data* restores the initial state.

Everything works without hardware, real accounts or paid APIs.

## 9. What is functional vs simulated

**Functional:** REST API and SQLite persistence; individual baselines; explainable scoring and IsolationForest; alert and emergency lifecycle; event timelines; scenario engine; manual entry with validation; sensor connectivity simulation; threshold editing; live OSDR metadata; DONKI integration with cache/sample fallback; local cache + outbox offline mode; simulated sync with delay; EN/PT; responsive layout; guided demo.

**Simulated:** the crew, all vitals/daily logs/cabin readings, the dosimeter, medical inventory, the Earth link and its delays, and the three emergencies.

## 10. Future development

- Real wearable / BLE sensor ingestion with signal-quality metrics.
- Clinically reviewed thresholds and protocols, with flight-surgeon governance.
- Longitudinal models (e.g., Bayesian change-point detection) validated on real analog-mission data (e.g., HERA, Antarctic stations) under proper agreements.
- Personal dosimetry integration distinct from space-weather context.
- Role-based authentication, audit log export, encrypted storage, CRDT-based multi-node sync.
- Ground-side dashboard receiving the synchronized event packages.

## 11. Repository layout

```
backend/   FastAPI app (app/), tests (tests/), requirements.txt
frontend/  React SPA (src/pages, src/components, src/api)
docs: README.md · PROJECT_OVERVIEW.md · ARCHITECTURE.md · DATA_SOURCES.md · DEMO_SCRIPT.md · SUBMISSION.md
```
