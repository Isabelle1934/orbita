"""SQLAlchemy entities. All timestamps are naive UTC."""
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow


class Mission(Base):
    __tablename__ = "missions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    habitat: Mapped[str] = mapped_column(String(120))
    description: Mapped[dict] = mapped_column(JSON)
    start_at: Mapped[datetime] = mapped_column(DateTime)
    planned_duration_days: Mapped[int] = mapped_column(Integer)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=True)


class Astronaut(Base):
    __tablename__ = "astronauts"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80))
    age: Mapped[int] = mapped_column(Integer)
    sex: Mapped[str] = mapped_column(String(16))
    mass_kg: Mapped[float] = mapped_column(Float)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_fictional: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    baselines: Mapped[list["Baseline"]] = relationship(back_populates="astronaut", cascade="all, delete-orphan")


class Baseline(Base):
    """Individual reference value for one metric, computed from the astronaut's own history."""
    __tablename__ = "baselines"
    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(40))
    mean: Mapped[float] = mapped_column(Float)
    std: Mapped[float] = mapped_column(Float)
    p05: Mapped[float] = mapped_column(Float)
    p95: Mapped[float] = mapped_column(Float)
    n_samples: Mapped[int] = mapped_column(Integer)
    window_start: Mapped[datetime] = mapped_column(DateTime)
    window_end: Mapped[datetime] = mapped_column(DateTime)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    astronaut: Mapped[Astronaut] = relationship(back_populates="baselines")


class VitalMeasurement(Base):
    __tablename__ = "vital_measurements"
    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    heart_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    spo2: Mapped[float | None] = mapped_column(Float, nullable=True)
    systolic: Mapped[float | None] = mapped_column(Float, nullable=True)
    diastolic: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    respiratory_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # simulated | user | scenario
    origin: Mapped[str] = mapped_column(String(16), default="simulated")
    scenario_run_id: Mapped[int | None] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")


class DailyLog(Base):
    """Once-a-day indicators: sleep, activity, hydration and cognitive assessment."""
    __tablename__ = "daily_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime)
    sleep_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    hydration_ml: Mapped[float | None] = mapped_column(Float, nullable=True)
    cognitive_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin: Mapped[str] = mapped_column(String(16), default="simulated")
    scenario_run_id: Mapped[int | None] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), nullable=True)


class EnvironmentReading(Base):
    __tablename__ = "environment_readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    module: Mapped[str] = mapped_column(String(40), default="Habitat")
    cabin_pressure_kpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    o2_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    co2_mmhg: Mapped[float | None] = mapped_column(Float, nullable=True)
    cabin_temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    radiation_ugy_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin: Mapped[str] = mapped_column(String(16), default="simulated")
    scenario_run_id: Mapped[int | None] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), nullable=True)


class ScenarioRun(Base):
    __tablename__ = "scenario_runs"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a scenario reset
    id: Mapped[int] = mapped_column(primary_key=True)
    scenario_key: Mapped[str] = mapped_column(String(40))
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String(16), default="active")
    stages: Mapped[list] = mapped_column(JSON, default=list)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a scenario reset
    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int | None] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(8))  # YELLOW | RED
    category: Mapped[str] = mapped_column(String(32))
    title: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)
    analysis: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|acknowledged|escalated|resolved
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    history: Mapped[list] = mapped_column(JSON, default=list)
    scenario_run_id: Mapped[int | None] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), nullable=True)


class EmergencyEvent(Base):
    __tablename__ = "emergency_events"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a scenario reset
    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(4))  # P1 | P2
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|acknowledged|escalated|resolved
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    first_deviation_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    scenario_run_id: Mapped[int | None] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), nullable=True)
    timeline: Mapped[list["EmergencyAction"]] = relationship(
        back_populates="emergency", cascade="all, delete-orphan", order_by="EmergencyAction.timestamp"
    )


class EmergencyAction(Base):
    """Timeline entry of an emergency event (detections, acknowledgements, actions taken, notes)."""
    __tablename__ = "emergency_actions"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a scenario reset
    id: Mapped[int] = mapped_column(primary_key=True)
    emergency_id: Mapped[int] = mapped_column(ForeignKey("emergency_events.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str] = mapped_column(String(80), default="ORBITA")
    text: Mapped[dict] = mapped_column(JSON)
    level: Mapped[str | None] = mapped_column(String(8), nullable=True)
    emergency: Mapped[EmergencyEvent] = relationship(back_populates="timeline")


class MedicalResource(Base):
    __tablename__ = "medical_resources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[dict] = mapped_column(JSON)
    category: Mapped[str] = mapped_column(String(32))
    tags: Mapped[list] = mapped_column(JSON, default=list)
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(24))
    location: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(16), default="available")


class EmergencyProtocol(Base):
    __tablename__ = "emergency_protocols"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True)
    category: Mapped[str] = mapped_column(String(32))
    title: Mapped[dict] = mapped_column(JSON)
    steps: Mapped[list] = mapped_column(JSON)


class DataSource(Base):
    __tablename__ = "data_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True)
    category: Mapped[str] = mapped_column(String(24))  # nasa_open_data | simulated | user_entered
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(300))
    endpoint: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[dict] = mapped_column(JSON)
    measures: Mapped[dict] = mapped_column(JSON)
    limitations: Mapped[dict] = mapped_column(JSON)
    usage: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="not_fetched")
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CachedPayload(Base):
    """Cache of external API payloads (DONKI, OSDR) for offline operation."""
    __tablename__ = "cached_payloads"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)
    origin: Mapped[str] = mapped_column(String(16))  # live | sample
    payload: Mapped[dict | list] = mapped_column(JSON)


class SyncRecord(Base):
    __tablename__ = "sync_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    eta_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16))  # queued | in_transit | delivered
    delay_s: Mapped[int] = mapped_column(Integer)
    items: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(Text, default="")


class SystemEvent(Base):
    __tablename__ = "system_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(8), default="info")  # info|warn|critical
    astronaut_id: Mapped[int | None] = mapped_column(ForeignKey("astronauts.id", ondelete="CASCADE"), nullable=True)
    message: Mapped[dict] = mapped_column(JSON)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class DemoSession(Base):
    __tablename__ = "demo_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
