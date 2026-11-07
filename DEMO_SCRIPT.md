# ORBITA — Demo Script (≈ 6 minutes)

Everything below runs locally without hardware, real accounts or paid APIs. All crew data is fictional/simulated.

**Before the demo:** start the app (see README §7). For a clean state: Settings → *Reset all demo data*.

| # | Step | Where | What to show / say |
|---|---|---|---|
| 1 | **Open the application** | Login | ORBITA identity and mission statement. Click **Enter demo mode** (no password — clearly labeled demo access). Keep *Start the guided demonstration* ticked; the guided panel appears bottom-right. |
| 2 | **Mission Control** | `/` | Mission day 118/180, 4 crew monitored, overall status, active alerts, Earth-link status & last sync, crew cards with latest vitals, recent physiological changes, cabin environment, DONKI solar activity, system events. Point out the **SIMULATED** badges. |
| 3 | **Select an astronaut** | Crew card | Click **Elena Varga (AST-01)** — every module follows the selected astronaut. |
| 4 | **Review the health profile** | Bio-Twin | Personal baseline per metric (mean ± SD, 5–95 % range, n samples) and the deviation profile. Each astronaut has a *different* normal (compare Elena HR ≈ 58 vs Amara ≈ 71). Show NASA OSDR research context (real, live metadata) and the note that nothing is derived from it. |
| 5 | **View physiological indicators** | Vital-Scan | Click **Start feed** (simulated readings every 5 s). Show sensor connectivity — Lucas Ferreira's temperature sensor is *Disconnected* and appears as missing data. Optionally enter a manual measurement (try HR 999 to show validation). |
| 6 | **Activate a simulated emergency** | Early Warning (or guided panel) | Run **Scenario 1 — Cardiovascular changes**. Result: *Initial state GREEN → Early deviation YELLOW → Critical pattern RED*. |
| 7 | **See the Early Warning alert** | Early Warning | Score bar vs thresholds; *why* RED; *what changed* vs baseline; contributing indicators with points and reasons; data confidence & missing data; IsolationForest signal; recommended next steps; "ANOMALY ≠ DIAGNOSIS". |
| 8 | **Open RESCUE WINDOW** | Rescue Window | Priority **P2 · URGENT** (response-priority window — *not* a survival estimate, uncertainty shown), time since first deviation, abnormal indicators, evolution charts with DET/ALE markers, risk factors. |
| 9 | **Review the recommended response** | Rescue Window → Protocols / Resources | Medical resources on board (AED, ECG monitor, O₂…), protocol checklist (*educational content*). Tick a step, **Acknowledge**, type an action ("Repeat vitals taken by CMO") and **Escalate** (creates a package on the simulated Earth link). |
| 10 | **Inspect the event history** | Rescue Window → Timeline; Mission Link | Timeline: first detection, RED alert, every human action with actor and time. In Mission Link: escalation package *in transit → delivered*, last sync time. |

## Optional extras (if time allows)

- **Offline operation:** Mission Link → tick *Simulate local server outage*. Navigate to Rescue Window — it renders from the local cache, with an OFFLINE banner. Record an action: it appears as *QUEUED LOCALLY — pending sync*. Untick → the queued action syncs to the server.
- **Earth link delay:** set *Blackout* → *Synchronize now* stays *Queued*; set *Mars, closest (~3 min)* → *In transit* with ETA.
- **Scenario 2** (sleep deprivation, AST-04): three nights of short sleep, cognitive score −30 %, fluid intake down → YELLOW at day −1, RED today.
- **Scenario 3** (environmental, AST-03): cabin ppCO₂ rises to 6.6 mmHg + respiratory/heart-rate changes → crew-wide environmental alert + RESCUE WINDOW for Amara with the cabin-atmosphere protocol.
- **Space Environment:** DONKI events (or the clearly labeled synthetic sample if NASA is unreachable), and the note that solar events ≠ personal dose.
- **Settings:** change *RED ≥* to 5 and watch levels change; switch to **Português**.
- **End simulation** in the top banner removes all scenario data.
