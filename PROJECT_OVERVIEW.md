# ORBITA — Project Overview

## Challenge

2026 NASA Space Apps Challenge — **Create Health Monitoring Software for Astronauts on Space Missions**
https://www.spaceappschallenge.org/2026/challenges/create-health-monitoring-software-for-astronauts-on-space-missions/

## Vision

On long-duration missions the crew is its own first line of medical response. Delays of minutes and communication blackouts mean that a health change may need to be understood and acted upon before Earth can help. ORBITA's goal is to **understand how each astronaut's health is changing and help the crew act before a situation becomes critical**.

## Core ideas

1. **Personal, not population, normals.** Each astronaut is compared with their own baseline (Bio-Twin). An HR of 72 bpm can be ordinary for one person and a +4 SD change for another.
2. **Combinations matter.** Early Warning scores vitals, sleep, cognition, hydration, activity and cabin conditions together, and adds weight when changes co-occur.
3. **Explainability first.** Every point of the score is traceable to a stated rule, shown with the value, the personal baseline, the deviation and the reason. Data confidence and missing data are always visible. The system distinguishes *anomaly* from *diagnosis*.
4. **From detection to action — RESCUE WINDOW.** At RED, ORBITA assembles everything needed to respond: who is affected, which indicators are abnormal, how they evolved, possible risk factors, resources on board, relevant protocol checklists, and a log of every action — with a response-*priority* window and explicit uncertainty (never a countdown or survival estimate).
5. **Earth-independent.** Local persistence, cached views, a local outbox and a simulated delayed Earth link with synchronization history.
6. **Scientific honesty.** Real NASA data (DONKI, OSDR) is used for context and is always labeled; simulated and user-entered data are labeled everywhere; thresholds are configurable demo defaults.

## Users (intended)

- Crew members and the crew medical officer (onboard).
- Flight surgeons / ground medical team (receive synchronized event packages — simulated here).
- Space Apps judges (guided demonstration mode).

## What exists today

A working MVP: FastAPI + SQLite backend with 40+ REST endpoints, a React interface with eight modules, three reproducible emergency scenarios, live NASA OSDR metadata, DONKI integration with offline fallback, EN/PT, responsive layout, 13 automated backend tests.

## What it is not

Not a medical device, not clinically validated, not a diagnostic tool, not connected to any spacecraft, not affiliated with or endorsed by NASA.

## Team notes / next steps

See README §10 (future development): real sensor ingestion, clinically reviewed thresholds/protocols, validation on analog-mission data under proper agreements, personal dosimetry, production-grade authentication and sync.
