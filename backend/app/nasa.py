"""NASA open data integration.

* DONKI (Space Weather Database Of Notifications, Knowledge, Information), via the public
  api.nasa.gov gateway (DEMO_KEY or a free personal key) with the CCMC DONKI web service as fallback.
* NASA Open Science Data Repository (OSDR) study metadata API.

Results are cached in SQLite so the app keeps working offline. When neither a live response nor a
cache exists, clearly labeled SYNTHETIC SAMPLE records (in DONKI's format) are returned instead —
they are never presented as real events.
"""
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from .config import ENABLE_LIVE_NASA, HTTP_TIMEOUT, NASA_API_KEY
from .db import L, iso, utcnow
from .models import CachedPayload, DataSource

DONKI_TYPES = {
    "FLR": L("Solar flares", "Erupções solares"),
    "SEP": L("Solar energetic particle events", "Eventos de partículas solares energéticas"),
    "CME": L("Coronal mass ejections", "Ejeções de massa coronal"),
    "GST": L("Geomagnetic storms", "Tempestades geomagnéticas"),
}
DONKI_PRIMARY = "https://api.nasa.gov/DONKI/{type}"
DONKI_FALLBACK = "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{type}"
OSDR_META = "https://osdr.nasa.gov/osdr/data/osd/meta/{num}"

# Human-spaceflight studies verified to exist in OSDR (titles as published there).
OSDR_STUDIES = {
    "OSD-569": "Whole Blood Measurements from the SpaceX Inspiration4 Mission (RNA-seq, epitranscriptome, WGS, clonal hematopoiesis, CBC)",
    "OSD-570": "SpaceX Inspiration4 PBMC Profiling: snRNA-seq, snATAC-seq, and T-cell and B-cell repertoire profiling",
    "OSD-53": "Spaceflight Modulates Gene Expression in Astronauts",
    "OSD-687": "SpaceX Inspiration4 T-Cell Histone Modification Profiling (H3K4me1, H3K4me3, H3K27ac)",
}


def _cache_get(db: Session, key: str) -> CachedPayload | None:
    return db.get(CachedPayload, key)


def _cache_put(db: Session, key: str, origin: str, payload) -> CachedPayload:
    row = db.get(CachedPayload, key)
    if row is None:
        row = CachedPayload(key=key, fetched_at=utcnow(), origin=origin, payload=payload)
        db.add(row)
    else:
        row.fetched_at, row.origin, row.payload = utcnow(), origin, payload
    return row


def _mark_source(db: Session, key: str, status: str) -> None:
    src = db.query(DataSource).filter_by(key=key).first()
    if src:
        src.status = status
        if status == "live":
            src.last_fetched_at = utcnow()


def _fetch_donki_type(client: httpx.Client, t: str, start: str, end: str) -> tuple[list, str]:
    errors = []
    for url, params in (
        (DONKI_PRIMARY.format(type=t), {"startDate": start, "endDate": end, "api_key": NASA_API_KEY}),
        (DONKI_FALLBACK.format(type=t), {"startDate": start, "endDate": end}),
    ):
        try:
            r = client.get(url, params=params)
            if r.status_code == 200:
                data = r.json() if r.text.strip() else []
                return (data if isinstance(data, list) else []), url
            errors.append(f"{url}: HTTP {r.status_code}")
        except (httpx.HTTPError, ValueError) as e:
            errors.append(f"{url}: {type(e).__name__}")
    raise RuntimeError("; ".join(errors))


def _sample_donki(now: datetime) -> dict:
    """SYNTHETIC records in DONKI's field layout, used only when no live data or cache exists."""
    def t(h):
        return (now - timedelta(hours=h)).strftime("%Y-%m-%dT%H:%MZ")
    note = "SYNTHETIC SAMPLE — not a real NASA event"
    return {
        "FLR": [{"flrID": "SAMPLE-FLR-001", "beginTime": t(30), "peakTime": t(29.6), "endTime": t(29), "classType": "M2.1",
                 "sourceLocation": "N12W30", "activeRegionNum": None, "link": "", "note": note},
                {"flrID": "SAMPLE-FLR-002", "beginTime": t(140), "peakTime": t(139.5), "endTime": t(139), "classType": "C8.4",
                 "sourceLocation": "S08E15", "activeRegionNum": None, "link": "", "note": note}],
        "SEP": [],
        "CME": [{"activityID": "SAMPLE-CME-001", "startTime": t(28), "note": note, "link": ""}],
        "GST": [{"gstID": "SAMPLE-GST-001", "startTime": t(200), "allKpIndex": [{"observedTime": t(200), "kpIndex": 5.33, "source": "SAMPLE"}],
                 "link": "", "note": note}],
    }


def refresh_space_weather(db: Session, days: int = 30, now: datetime | None = None) -> dict:
    now = now or utcnow()
    start, end = (now - timedelta(days=days)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")
    result, errors, endpoints = {}, [], {}
    if ENABLE_LIVE_NASA:
        with httpx.Client(timeout=HTTP_TIMEOUT, headers={"User-Agent": "ORBITA-prototype/1.0"}) as client:
            for t in DONKI_TYPES:
                try:
                    result[t], endpoints[t] = _fetch_donki_type(client, t, start, end)
                except RuntimeError as e:
                    errors.append(f"{t}: {e}")
    if len(result) == len(DONKI_TYPES):
        _cache_put(db, "donki", "live", {"window": [start, end], "data": result, "endpoints": endpoints})
        _mark_source(db, "nasa_donki", "live")
    else:
        _mark_source(db, "nasa_donki", "cached" if _cache_get(db, "donki") else "sample")
    db.commit()
    out = space_weather(db, now)
    out["refresh_errors"] = errors
    out["live_enabled"] = ENABLE_LIVE_NASA
    return out


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "")).replace(tzinfo=None)
    except ValueError:
        return None


def space_weather(db: Session, now: datetime | None = None) -> dict:
    """Normalized DONKI summary from cache (live) or synthetic sample (offline)."""
    now = now or utcnow()
    cached = _cache_get(db, "donki")
    if cached:
        data, origin, fetched = cached.payload["data"], cached.origin, cached.fetched_at
        endpoints = cached.payload.get("endpoints", {})
    else:
        data, origin, fetched, endpoints = _sample_donki(now), "sample", None, {}
    events = []
    for f in data.get("FLR", []):
        cls = f.get("classType") or ""
        events.append({"type": "FLR", "id": f.get("flrID"), "time": f.get("peakTime") or f.get("beginTime"),
                       "detail": f"Class {cls}" + (f" · {f['sourceLocation']}" if f.get("sourceLocation") else ""),
                       "class": cls, "link": f.get("link", ""),
                       "significant": cls[:1] == "X" or (cls[:1] == "M" and _num(cls[1:]) >= 5)})
    for s in data.get("SEP", []):
        events.append({"type": "SEP", "id": s.get("sepID"), "time": s.get("eventTime"),
                       "detail": ", ".join(i.get("displayName", "") for i in s.get("instruments", []) if isinstance(i, dict))[:120],
                       "link": s.get("link", ""), "significant": True})
    for c in data.get("CME", []):
        events.append({"type": "CME", "id": c.get("activityID"), "time": c.get("startTime"),
                       "detail": (c.get("note") or "")[:160], "link": c.get("link", ""), "significant": False})
    for g in data.get("GST", []):
        kp = max([k.get("kpIndex", 0) or 0 for k in g.get("allKpIndex", [])] or [0])
        events.append({"type": "GST", "id": g.get("gstID"), "time": g.get("startTime"), "detail": f"Max Kp {kp:g}",
                       "kp": kp, "link": g.get("link", ""), "significant": kp >= 7})
    for e in events:
        e["time_dt"] = _parse(e["time"])
    events.sort(key=lambda e: e["time_dt"] or datetime.min, reverse=True)
    recent = [e for e in events if e["time_dt"] and e["time_dt"] >= now - timedelta(hours=72)]
    significant = [e for e in recent if e["significant"]]
    for e in events:
        e.pop("time_dt")
    counts = {t: sum(1 for e in events if e["type"] == t) for t in DONKI_TYPES}
    return {
        "origin": origin,  # live | sample
        "fetched_at": iso(fetched), "endpoints": endpoints,
        "label": L("NASA DONKI — real space weather records" if origin == "live" else
                   "SYNTHETIC SAMPLE in DONKI format — live NASA data unavailable",
                   "NASA DONKI — registros reais de clima espacial" if origin == "live" else
                   "AMOSTRA SINTÉTICA no formato DONKI — dados NASA ao vivo indisponíveis"),
        "counts": counts, "types": DONKI_TYPES, "events": events[:60],
        "recent_72h": len(recent), "significant": significant,
        "note": L("Solar events describe the heliospheric environment. They are not a measurement of any "
                  "astronaut's personal radiation dose, which requires onboard dosimetry.",
                  "Eventos solares descrevem o ambiente heliosférico. Não são medição da dose de radiação "
                  "pessoal de nenhum astronauta, que exige dosimetria a bordo."),
    }


def space_context(db: Session, now: datetime | None = None) -> dict:
    sw = space_weather(db, now)
    return {"origin": sw["origin"], "significant": sw["significant"]}


def _num(s: str) -> float:
    try:
        return float(s)
    except ValueError:
        return 0.0


def refresh_osdr(db: Session) -> dict:
    studies, errors = [], []
    if ENABLE_LIVE_NASA:
        with httpx.Client(timeout=HTTP_TIMEOUT + 7, headers={"User-Agent": "ORBITA-prototype/1.0"}) as client:
            for acc in OSDR_STUDIES:
                num = acc.split("-")[1]
                try:
                    r = client.get(OSDR_META.format(num=num))
                    r.raise_for_status()
                    st = r.json()["study"][acc]["studies"][0]
                    studies.append({
                        "accession": acc, "title": st.get("title"),
                        "description": (st.get("description") or "")[:900],
                        "release_date": st.get("publicReleaseDate"),
                        "factors": [f.get("factorName") for f in st.get("factors", [])],
                        "assays": sorted({(a.get("measurementType") or {}).get("annotationValue", "")
                                          for a in st.get("assays", [])} - {""}),
                        "url": f"https://osdr.nasa.gov/bio/repo/data/studies/{acc}",
                        "api": OSDR_META.format(num=num),
                    })
                except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
                    errors.append(f"{acc}: {type(e).__name__}")
    if len(studies) == len(OSDR_STUDIES):
        _cache_put(db, "osdr", "live", {"studies": studies})
        _mark_source(db, "nasa_osdr", "live")
    else:
        _mark_source(db, "nasa_osdr", "cached" if _cache_get(db, "osdr") else "offline")
    db.commit()
    out = osdr_studies(db)
    out["refresh_errors"] = errors
    return out


def osdr_studies(db: Session) -> dict:
    cached = _cache_get(db, "osdr")
    if cached:
        return {"origin": cached.origin, "fetched_at": iso(cached.fetched_at), "studies": cached.payload["studies"]}
    return {"origin": "offline", "fetched_at": None, "studies": [
        {"accession": acc, "title": title, "description": "", "release_date": None, "factors": [], "assays": [],
         "url": f"https://osdr.nasa.gov/bio/repo/data/studies/{acc}", "api": OSDR_META.format(num=acc.split('-')[1])}
        for acc, title in OSDR_STUDIES.items()]}
