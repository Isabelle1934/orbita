// Types mirroring the ORBITA FastAPI responses.
export type Bi = { en: string; pt: string }
export type Level = 'GREEN' | 'YELLOW' | 'RED'
export type Origin = 'simulated' | 'user' | 'scenario'

export const VITALS = ['heart_rate', 'spo2', 'systolic', 'diastolic', 'temperature', 'respiratory_rate'] as const
export type Vital = (typeof VITALS)[number]
export const DAILY = ['sleep_hours', 'sleep_quality', 'activity_minutes', 'hydration_ml', 'cognitive_score'] as const
export type DailyMetric = (typeof DAILY)[number]

export interface Astronaut {
  id: number
  code: string
  name: string
  role: string
  age: number
  sex: string
  mass_kg: number
  notes: string
  is_fictional: boolean
  active: boolean
}

export interface Baseline {
  id: number
  astronaut_id: number
  metric: string
  mean: number
  std: number
  p05: number
  p95: number
  n_samples: number
  window_start: string
  window_end: string
  computed_at: string
  label: Bi
  unit: string
}

export interface VitalRow {
  id: number
  timestamp: string
  heart_rate: number | null
  spo2: number | null
  systolic: number | null
  diastolic: number | null
  temperature: number | null
  respiratory_rate: number | null
  origin: Origin
  scenario_run_id: number | null
  note?: string
}

export interface DailyRow {
  id: number
  day: string
  timestamp: string
  sleep_hours: number | null
  sleep_quality: number | null
  activity_minutes: number | null
  hydration_ml: number | null
  cognitive_score: number | null
  origin: Origin
}

export interface EnvRow {
  id: number
  timestamp: string
  module: string
  cabin_pressure_kpa: number | null
  o2_percent: number | null
  co2_mmhg: number | null
  cabin_temperature_c: number | null
  humidity_percent: number | null
  radiation_ugy_h: number | null
  origin: Origin
}

export interface Contributor {
  indicator: string
  label: Bi
  kind: 'vital' | 'daily' | 'environment' | 'pattern' | 'model'
  group: string
  value?: number | null
  unit?: string
  measured_at?: string
  origin?: Origin
  baseline?: number | null
  baseline_std?: number | null
  z?: number | null
  delta?: number | null
  points: number
  critical: boolean
  reason: Bi
}

export interface Analysis {
  astronaut_id: number
  astronaut_code: string
  astronaut_name: string
  evaluated_at: string
  level: Level
  score: number
  category: string
  thresholds: { yellow: number; red: number }
  critical_flags: string[]
  contributors: Contributor[]
  context: { kind: string; points: number; origin: string; reason: Bi; events: SpaceEvent[] }[]
  what_changed: Bi[]
  why: Bi
  confidence: {
    score: number
    label: 'high' | 'medium' | 'low'
    missing: { indicator: string; label: Bi; reason: Bi }[]
    stale: string[]
    notes: Bi[]
    data_origins: string[]
  }
  model: { score: number; flagged: boolean; imputed: string[] } | null
  recommendations: Bi[]
  is_diagnosis: false
  disclaimer: Bi
}

export interface CrewMember extends Astronaut {
  level: Level
  score: number
  category: string
  confidence: string
  top: { label: Bi; points: number }[]
  vitals: Partial<Record<Vital, { value: number; at: string; origin: Origin }>>
  missing: number
}

export interface HistoryEntry {
  t: string
  kind: string
  level?: Level
  actor: string
  text: Bi
}

export interface Alert {
  id: number
  astronaut_id: number | null
  astronaut_name: string | null
  astronaut_code: string | null
  level: Level
  category: string
  title: Bi
  summary: Bi
  status: 'open' | 'acknowledged' | 'escalated' | 'resolved'
  created_at: string
  updated_at: string
  history: HistoryEntry[]
  scenario_run_id: number | null
  emergency_id: number | null
  analysis?: Analysis
}

export interface SystemEvent {
  id: number
  timestamp: string
  kind: string
  severity: 'info' | 'warn' | 'critical'
  astronaut_id: number | null
  message: Bi
}

export interface SpaceEvent {
  type: 'FLR' | 'SEP' | 'CME' | 'GST'
  id: string
  time: string
  detail: string
  link: string
  significant: boolean
  class?: string
  kp?: number
}

export interface SpaceWeather {
  origin: 'live' | 'sample'
  fetched_at: string | null
  endpoints: Record<string, string>
  label: Bi
  counts: Record<string, number>
  types: Record<string, Bi>
  events: SpaceEvent[]
  recent_72h: number
  significant: SpaceEvent[]
  note: Bi
  refresh_errors?: string[]
}

export interface MissionStatus {
  mission: {
    id: number
    name: string
    habitat: string
    description: Bi
    start_at: string
    planned_duration_days: number
    is_simulated: boolean
    day: number
    days_remaining: number
  }
  server_time: string
  overall_status: Level
  crew: CrewMember[]
  active_alerts: Alert[]
  active_emergencies: { id: number; astronaut_id: number; priority: string; status: string; category: string; opened_at: string }[]
  environment: EnvRow | null
  recent_changes: (Contributor & { astronaut_id: number; astronaut_name: string })[]
  events: SystemEvent[]
  space_weather: Pick<SpaceWeather, 'origin' | 'counts' | 'recent_72h' | 'significant' | 'label' | 'fetched_at'>
  scenario: { active: boolean; key: string | null; title: Bi | null; astronaut_id: number | null }
  link: LinkState
  last_sync_at: string | null
}

export interface LinkState {
  status: 'nominal' | 'degraded' | 'blackout'
  one_way_delay_s: number
}

export interface SensorStatus {
  metric: Vital
  label: Bi
  unit: string
  state: 'connected' | 'disconnected'
  status: 'online' | 'stale' | 'offline' | 'disconnected'
  last_reading_at: string | null
  age_s: number | null
}

export interface Scenario {
  key: string
  title: Bi
  summary: Bi
  astronaut_code: string
  category: string
  stages: { key: string; label: Bi }[]
}

export interface ScenarioResult {
  run_id: number
  scenario: string
  astronaut_id: number
  astronaut_name: string
  stages: { key: string; label: Bi; time: string; level: Level; score: number; category: string; top: Bi[] }[]
  emergency_id: number | null
  simulated: true
}

export interface TimelineEntry {
  id: number
  emergency_id: number
  timestamp: string
  kind: string
  actor: string
  text: Bi
  level: Level | null
}

export interface Resource {
  id: number
  name: Bi
  category: string
  tags: string[]
  quantity: number
  unit: string
  location: string
  status: string
}

export interface Protocol {
  id: number
  key: string
  category: string
  title: Bi
  steps: Bi[]
}

export interface EmergencySummary {
  id: number
  astronaut_id: number
  astronaut_name: string
  astronaut_code: string
  alert_id: number | null
  category: string
  priority: 'P1' | 'P2'
  status: 'active' | 'acknowledged' | 'escalated' | 'resolved'
  opened_at: string
  first_deviation_at: string | null
  closed_at: string | null
  level: Level
  score: number
  simulated: boolean
}

export interface EmergencyDetail extends Omit<EmergencySummary, 'astronaut_name' | 'astronaut_code' | 'level' | 'score'> {
  astronaut: Astronaut
  snapshot: Analysis
  scenario: Bi | null
  priority_info: { label: Bi; window: Bi; basis: Bi; uncertainty: Bi; confidence: Analysis['confidence'] }
  elapsed_since_first_deviation_s: number
  timeline: TimelineEntry[]
  evolution: { vitals: VitalRow[]; environment: EnvRow[]; daily: DailyRow[] }
  risk_factors: { label: Bi; reason: Bi; points: number; kind: string }[]
  resources: Resource[]
  protocols: Protocol[]
  protocol_notice: Bi
  disclaimer: Bi
}

export interface DataSource {
  id: number
  key: string
  category: 'nasa_open_data' | 'simulated' | 'user_entered'
  name: string
  provider: string
  url: string
  endpoint: string
  description: Bi
  measures: Bi
  limitations: Bi
  usage: Bi
  status: string
  last_fetched_at: string | null
}

export interface OsdrStudy {
  accession: string
  title: string
  description: string
  release_date: string | null
  factors: string[]
  assays: string[]
  url: string
  api: string
}

export interface SyncRecord {
  id: number
  requested_at: string
  eta_at: string | null
  completed_at: string | null
  status: 'queued' | 'in_transit' | 'delivered'
  delay_s: number
  items: Record<string, unknown>
  note: string
}

export type Thresholds = {
  safety: Record<string, Record<string, number>>
  environment: Record<string, Record<string, number>>
  baseline: Record<string, number>
  daily: Record<string, number | number[]>
  levels: { yellow_score: number; red_score: number }
}
