# ORBITA — Data Sources

ORBITA keeps three categories of data strictly separated, and labels each one in the interface.

| # | Category | UI label |
|---|---|---|
| 1 | Real NASA open scientific data | **NASA OPEN DATA** (blue) |
| 2 | Simulated physiological / environmental measurements | **SIMULATED** / **SCENARIO SIMULATION** (violet) |
| 3 | User-entered demonstration data | **USER-ENTERED** (teal) |

When live NASA data is unavailable, a clearly labeled **SYNTHETIC SAMPLE** (amber) may appear in its place.

---

## 1. Real NASA open scientific data

### 1.1 NASA DONKI — Space Weather Database Of Notifications, Knowledge, Information

- **Provider:** NASA / Community Coordinated Modeling Center (CCMC), via the NASA Open APIs portal.
- **Portal:** https://api.nasa.gov/
- **Endpoints queried** (last 30 days, `startDate` / `endDate` in `YYYY-MM-DD`):
  - `https://api.nasa.gov/DONKI/FLR` — solar flares
  - `https://api.nasa.gov/DONKI/SEP` — solar energetic particle events
  - `https://api.nasa.gov/DONKI/CME` — coronal mass ejections
  - `https://api.nasa.gov/DONKI/GST` — geomagnetic storms
  - Key: `DEMO_KEY` by default (free, rate-limited) or a free personal key via `NASA_API_KEY`. No paid API.
  - Fallback for each type: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{type}` (no key).
- **What it measures:** event times, flare X-ray class (e.g. M2.1, X1.0) and source location, CME notes, SEP instruments, geomagnetic Kp index.
- **How ORBITA uses it:** Space Environment page (event list, counts, significant events: flare ≥ M5, any SEP, Kp ≥ 7), Mission Control summary, and a **context-only (0 points)** note in Early Warning.
- **Limitations:** describes the heliospheric / geomagnetic environment. It is **not** a measurement of any astronaut's radiation dose, which would require onboard personal dosimetry. ORBITA never converts DONKI events into a dose.
- **Availability note:** during development, `api.nasa.gov` returned HTTP 503 / connection timeouts and the CCMC host timed out from our network. ORBITA therefore caches successful responses in SQLite and, if nothing was ever fetched, shows a **synthetic sample in DONKI format** whose IDs start with `SAMPLE-` and whose label says "SYNTHETIC SAMPLE — not a real NASA event".

### 1.2 NASA Open Science Data Repository (OSDR)

- **Provider:** NASA Open Science Data Repository — https://osdr.nasa.gov/
- **Endpoint:** `https://osdr.nasa.gov/osdr/data/osd/meta/{id}` (study metadata, JSON). Fetched live successfully during development.
- **Studies used** (titles as published in OSDR):

| Accession | Title | What it measures |
|---|---|---|
| OSD-569 | Whole Blood Measurements from the SpaceX Inspiration4 Mission (RNA-seq, epitranscriptome, WGS, clonal hematopoiesis, CBC) | Whole blood from four private astronauts collected pre- and post-flight (3-day LEO mission, 2021): complete blood count, RNA sequencing, genome sequencing. |
| OSD-570 | SpaceX Inspiration4 PBMC Profiling: snRNA-seq, snATAC-seq, and T-cell and B-cell repertoire profiling | Single-nucleus transcriptomics / chromatin accessibility and immune repertoire of peripheral blood mononuclear cells. |
| OSD-53 | Spaceflight Modulates Gene Expression in Astronauts | Whole-blood transcription profiling of Space Shuttle astronauts before launch (L-10) and after landing (R+0). |
| OSD-687 | SpaceX Inspiration4 T-Cell Histone Modification Profiling (H3K4me1, H3K4me3, H3K27ac) | Epigenetic histone-modification profiling of T cells. |

- **How ORBITA uses it:** the metadata (title, description, assay types, factors, release date, link) is shown in the Bio-Twin *Spaceflight research context* panel and in Settings → Data sources, to ground the concept in real human-spaceflight research.
- **Limitations:** ORBITA does **not** derive any measurement, baseline, threshold or score from these datasets. They are omics/blood datasets from short missions with very small cohorts, not continuous vital-sign streams. If OSDR is unreachable, ORBITA shows only the verified accession IDs and titles (no invented content).

## 2. Simulated physiological and environmental measurements

- **Generator:** `backend/app/simulation.py` (fictional profiles per crew member + Gaussian noise + simple circadian variation; ~3 % random missing values; one disconnected temperature sensor for AST-04).
- **Contents:** 14 days of vitals every 2 h, one daily log per day, cabin readings every hour; backfilled to the current time when the server starts; live-style readings via the Vital-Scan feed.
- **Scenarios:** `backend/app/scenarios.py` — three progressive emergencies defined as deltas from each astronaut's own baseline (`origin = "scenario"`).
- **Medical inventory and protocols:** fictional demonstration content; protocols are marked *educational demonstration content — not certified medical instructions*.
- **Limitations:** not real astronaut data and not a physiological model; values are plausible-looking but synthetic. Default thresholds are demonstration defaults, not validated limits.

## 3. User-entered demonstration data

- Manual vital-sign entries (Vital-Scan) and daily logs (Bio-Twin), stored with `origin = "user"` and labeled USER-ENTERED.
- Validation only checks physically plausible ranges (e.g. HR 25–230 bpm, SpO₂ 50–100 %, diastolic < systolic) and timestamps (not in the future, ≤ 60 days old).
