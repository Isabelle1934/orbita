# NASA Space Apps 2026 — Submission Text

**Project name:** ORBITA — Astronaut Health Intelligence & Survival System
**Challenge:** Create Health Monitoring Software for Astronauts on Space Missions

## Short description (≈ 150 words)

ORBITA is a working prototype of an onboard health-intelligence system for long-duration missions, where crews cannot count on real-time help from Earth. Instead of comparing astronauts with population averages, ORBITA builds a personal baseline for each crew member (Bio-Twin) and watches how vitals, sleep, cognition, hydration, activity and cabin conditions change together. Its Early Warning engine uses a transparent point-based score plus an unsupervised IsolationForest signal, and every alert explains what changed, why, with what data confidence and what to do next — always as an anomaly signal, never a diagnosis. At RED, the RESCUE WINDOW turns detection into action: evolution charts, risk factors, onboard resources, protocol checklists and a timestamped action log, with a clearly labeled response-priority window. ORBITA works offline, syncs over a simulated delayed Earth link, and shows real NASA DONKI space weather and OSDR human-research context. All crew data is simulated.

## Longer description

**Problem.** On missions to the Moon and Mars, communication delays (seconds to over 20 minutes one way) and blackouts mean that crews must recognize and respond to health changes largely on their own.

**What we built.** A full-stack prototype (FastAPI + SQLite + scikit-learn backend; React + TypeScript interface, English/Portuguese) with eight modules: Mission Control, Bio-Twin, Vital-Scan, Early Warning, Rescue Window, Space Environment, Mission Link and Settings, plus a 10-step guided demonstration.

**How it works.** Personal baselines (mean, SD, 5–95 % range) are computed from each astronaut's own history. Early Warning combines baseline z-scores, configurable safety limits, rapid-change detection, daily indicators, cabin conditions and co-occurrence patterns into GREEN / YELLOW / RED; every point is traceable. Three reproducible simulated emergencies (cardiovascular changes; sleep deprivation with cognitive decline; cabin CO₂ rise with physiological changes) demonstrate the full path from initial state to detection, alert, explanation, recommended response and event history.

**NASA data.** NASA DONKI (api.nasa.gov — flares, SEP, CME, geomagnetic storms) provides space-weather context — explicitly not a personal radiation dose; NASA OSDR study metadata (OSD-569, OSD-570, OSD-53, OSD-687) grounds the concept in real human-spaceflight research. When NASA services are unreachable, ORBITA uses cached data or a clearly labeled synthetic sample.

**Responsibility.** ORBITA is an experimental decision-support prototype: not a medical device, not clinically validated, not a replacement for medical professionals, and not affiliated with or endorsed by NASA. Thresholds are demonstration defaults; protocols are educational content; all crew members and measurements are fictional.
