import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiGet, connection, type GetResult } from './api/client'
import type { Bi, Level } from './api/types'

export const METRIC: Record<string, { label: Bi; short: Bi; unit: string; decimals: number; color: string }> = {
  heart_rate: { label: { en: 'Heart rate', pt: 'Frequência cardíaca' }, short: { en: 'HR', pt: 'FC' }, unit: 'bpm', decimals: 0, color: '#f472b6' },
  spo2: { label: { en: 'Blood oxygen (SpO2)', pt: 'Oxigenação (SpO2)' }, short: { en: 'SpO2', pt: 'SpO2' }, unit: '%', decimals: 1, color: '#38bdf8' },
  systolic: { label: { en: 'Systolic pressure', pt: 'Pressão sistólica' }, short: { en: 'SYS', pt: 'SIS' }, unit: 'mmHg', decimals: 0, color: '#a78bfa' },
  diastolic: { label: { en: 'Diastolic pressure', pt: 'Pressão diastólica' }, short: { en: 'DIA', pt: 'DIA' }, unit: 'mmHg', decimals: 0, color: '#818cf8' },
  temperature: { label: { en: 'Body temperature', pt: 'Temperatura corporal' }, short: { en: 'TEMP', pt: 'TEMP' }, unit: '°C', decimals: 1, color: '#fb923c' },
  respiratory_rate: { label: { en: 'Respiratory rate', pt: 'Frequência respiratória' }, short: { en: 'RR', pt: 'FR' }, unit: '/min', decimals: 0, color: '#34d399' },
  sleep_hours: { label: { en: 'Sleep duration', pt: 'Duração do sono' }, short: { en: 'Sleep', pt: 'Sono' }, unit: 'h', decimals: 1, color: '#818cf8' },
  sleep_quality: { label: { en: 'Sleep quality', pt: 'Qualidade do sono' }, short: { en: 'Quality', pt: 'Qualidade' }, unit: '/100', decimals: 0, color: '#c084fc' },
  activity_minutes: { label: { en: 'Exercise / activity', pt: 'Exercício / atividade' }, short: { en: 'Activity', pt: 'Atividade' }, unit: 'min', decimals: 0, color: '#34d399' },
  hydration_ml: { label: { en: 'Fluid intake', pt: 'Ingestão de líquidos' }, short: { en: 'Fluids', pt: 'Líquidos' }, unit: 'mL', decimals: 0, color: '#38bdf8' },
  cognitive_score: { label: { en: 'Cognitive assessment', pt: 'Avaliação cognitiva' }, short: { en: 'Cognition', pt: 'Cognição' }, unit: '/100', decimals: 0, color: '#fbbf24' },
  cabin_pressure_kpa: { label: { en: 'Cabin pressure', pt: 'Pressão da cabine' }, short: { en: 'Pressure', pt: 'Pressão' }, unit: 'kPa', decimals: 1, color: '#a78bfa' },
  o2_percent: { label: { en: 'Cabin oxygen', pt: 'Oxigênio da cabine' }, short: { en: 'O2', pt: 'O2' }, unit: '%', decimals: 1, color: '#38bdf8' },
  co2_mmhg: { label: { en: 'Cabin CO2 (ppCO2)', pt: 'CO2 da cabine (ppCO2)' }, short: { en: 'CO2', pt: 'CO2' }, unit: 'mmHg', decimals: 2, color: '#fbbf24' },
  cabin_temperature_c: { label: { en: 'Cabin temperature', pt: 'Temperatura da cabine' }, short: { en: 'Temp', pt: 'Temp' }, unit: '°C', decimals: 1, color: '#fb923c' },
  humidity_percent: { label: { en: 'Relative humidity', pt: 'Umidade relativa' }, short: { en: 'RH', pt: 'UR' }, unit: '%', decimals: 0, color: '#2dd4bf' },
  radiation_ugy_h: { label: { en: 'Cabin dose rate (simulated dosimeter)', pt: 'Taxa de dose (dosímetro simulado)' }, short: { en: 'Dose rate', pt: 'Taxa de dose' }, unit: 'µGy/h', decimals: 1, color: '#f472b6' },
}

export const LEVEL_COLOR: Record<Level, string> = { GREEN: '#34d399', YELLOW: '#fbbf24', RED: '#f43f5e' }

export function fmt(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const d = METRIC[metric]?.decimals ?? 1
  return v.toFixed(d)
}

export function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null
  return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z')
}

export function fmtTime(s: string | null | undefined, lang: string, withDate = false): string {
  const d = parseIso(s)
  if (!d) return '—'
  return d.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    timeZone: 'UTC',
  }) + ' UTC'
}

export function ago(s: string | null | undefined, lang: string, now = Date.now()): string {
  const d = parseIso(s)
  if (!d) return '—'
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000))
  const pt = lang === 'pt'
  if (sec < 60) return pt ? `há ${sec} s` : `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return pt ? `há ${min} min` : `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return pt ? `há ${h} h` : `${h} h ago`
  return pt ? `há ${Math.round(h / 24)} d` : `${Math.round(h / 24)} d ago`
}

export function duration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(r).padStart(2, '0')}s`
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useConnection() {
  return useSyncExternalStore(connection.subscribe, connection.get)
}

/** Load a GET endpoint with local-cache fallback, optional polling, and reload(). */
export function useApi<T>(path: string | null, pollMs?: number, rev?: number) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean; fromCache: boolean; cachedAt: string | null }>(
    { data: null, error: null, loading: !!path, fromCache: false, cachedAt: null },
  )
  const pathRef = useRef(path)
  pathRef.current = path
  const load = useCallback(async () => {
    const p = pathRef.current
    if (!p) return
    try {
      const r: GetResult<T> = await apiGet<T>(p)
      if (pathRef.current === p) setState({ data: r.data, error: null, loading: false, fromCache: r.fromCache, cachedAt: r.cachedAt })
    } catch (e) {
      if (pathRef.current === p) setState((s) => ({ ...s, error: e as Error, loading: false }))
    }
  }, [])
  useEffect(() => {
    if (!path) return
    setState((s) => ({ ...s, loading: true, error: null }))
    void load()
    if (!pollMs) return
    const id = setInterval(load, pollMs)
    return () => clearInterval(id)
  }, [path, pollMs, load, rev])
  return { ...state, reload: load }
}
