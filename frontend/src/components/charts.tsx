import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from 'recharts'
import { fmt, METRIC, parseIso } from '../lib'
import { useI18n } from '../i18n'

const tooltipStyle = {
  contentStyle: { background: '#0a0f22', border: '1px solid #1d2852', borderRadius: 8, fontSize: 12, color: '#eef1ff' },
  labelStyle: { color: '#b7bfe3' },
}

function tickTime(v: number, span: number, lang: string) {
  const d = new Date(v)
  const opts: Intl.DateTimeFormatOptions =
    span > 2 * 86400000 ? { day: '2-digit', month: 'short', timeZone: 'UTC' } : { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
  return d.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-GB', opts)
}

export interface Marker {
  t: string
  label: string
  color: string
}

/** Time series of one metric with the personal baseline band (mean ± 2 SD) and optional limits/markers. */
export function MetricChart({
  rows, metric, baseline, limits, height = 220, markers, timeKey = 'timestamp',
}: {
  rows: Record<string, unknown>[]
  metric: string
  baseline?: { mean: number; std: number } | null
  limits?: { warn_low?: number; warn_high?: number; crit_low?: number; crit_high?: number }
  height?: number
  markers?: Marker[]
  timeKey?: string
}) {
  const { lang } = useI18n()
  const data = rows
    .map((r) => ({ t: parseIso(r[timeKey] as string)?.getTime() ?? 0, v: r[metric] as number | null, origin: r.origin as string }))
    .filter((d) => d.t)
  const valid = data.filter((d) => d.v !== null && d.v !== undefined)
  if (!valid.length) return <div className="text-xs text-ink-mute py-8 text-center">—</div>
  const span = data[data.length - 1].t - data[0].t
  const vals = valid.map((d) => d.v as number)
  const extra: number[] = []
  if (baseline) extra.push(baseline.mean - 2.5 * baseline.std, baseline.mean + 2.5 * baseline.std)
  const lo = Math.min(...vals, ...extra)
  const hi = Math.max(...vals, ...extra)
  const pad = (hi - lo) * 0.08 || 1
  const color = METRIC[metric]?.color || '#7c5cff'
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => tickTime(v, span, lang)} minTickGap={40} stroke="#1d2852" />
        <YAxis domain={[lo - pad, hi + pad]} tickFormatter={(v) => fmt(metric, v)} width={48} stroke="#1d2852" />
        {baseline && (
          <ReferenceArea y1={baseline.mean - 2 * baseline.std} y2={baseline.mean + 2 * baseline.std} fill="#7c5cff" fillOpacity={0.09} stroke="none" ifOverflow="hidden" />
        )}
        {baseline && <ReferenceLine y={baseline.mean} stroke="#7c5cff" strokeDasharray="4 4" strokeOpacity={0.7} ifOverflow="hidden" />}
        {limits?.warn_high !== undefined && <ReferenceLine y={limits.warn_high} stroke="#fbbf24" strokeOpacity={0.5} strokeDasharray="2 4" ifOverflow="hidden" />}
        {limits?.warn_low !== undefined && <ReferenceLine y={limits.warn_low} stroke="#fbbf24" strokeOpacity={0.5} strokeDasharray="2 4" ifOverflow="hidden" />}
        {limits?.crit_high !== undefined && <ReferenceLine y={limits.crit_high} stroke="#f43f5e" strokeOpacity={0.6} strokeDasharray="2 4" ifOverflow="hidden" />}
        {limits?.crit_low !== undefined && <ReferenceLine y={limits.crit_low} stroke="#f43f5e" strokeOpacity={0.6} strokeDasharray="2 4" ifOverflow="hidden" />}
        {markers?.map((m, i) => {
          const x = parseIso(m.t)?.getTime()
          return x ? <ReferenceLine key={i} x={x} stroke={m.color} strokeDasharray="3 3" label={{ value: m.label, fill: m.color, fontSize: 10, position: 'insideTopLeft' }} /> : null
        })}
        <Area type="monotone" dataKey="v" stroke="none" fill={`url(#g-${metric})`} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} dot={data.length < 40 ? { r: 2.2, fill: color, strokeWidth: 0 } : false} connectNulls={false} isAnimationActive={false} />
        <Tooltip {...tooltipStyle}
          labelFormatter={(v) => new Date(v as number).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' UTC'}
          formatter={(v, _n, item) => [`${fmt(metric, v as number)} ${METRIC[metric]?.unit ?? ''} · ${(item?.payload as { origin?: string })?.origin ?? ''}`, METRIC[metric]?.label[lang] ?? metric]} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function Sparkline({ values, color = '#7c5cff', height = 34 }: { values: (number | null)[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }))
  if (values.filter((v) => v !== null).length < 2) return <div style={{ height }} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Daily bar chart with baseline line. */
export function DailyChart({ rows, metric, baseline, height = 160 }: { rows: Record<string, unknown>[]; metric: string; baseline?: { mean: number } | null; height?: number }) {
  const { lang } = useI18n()
  const data = rows.map((r) => ({ day: String(r.day).slice(5), v: r[metric] as number | null, origin: r.origin as string }))
  const color = METRIC[metric]?.color || '#7c5cff'
  if (!data.some((d) => d.v !== null)) return <div className="text-xs text-ink-mute py-8 text-center">—</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
        <CartesianGrid strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="day" stroke="#1d2852" interval="preserveStartEnd" minTickGap={8} />
        <YAxis stroke="#1d2852" width={44} tickFormatter={(v) => fmt(metric, v)} />
        {baseline && <ReferenceLine y={baseline.mean} stroke="#7c5cff" strokeDasharray="4 4" />}
        <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(124,92,255,0.08)' }}
          formatter={(v, _n, item) => [`${fmt(metric, v as number)} ${METRIC[metric]?.unit} · ${(item?.payload as { origin?: string })?.origin}`, METRIC[metric]?.label[lang]]} />
        <Bar dataKey="v" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.origin === 'scenario' ? '#c084fc' : d.origin === 'user' ? '#2dd4bf' : color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bars: z-score per metric relative to personal baseline. */
export function DeviationBars({ items }: { items: { label: string; z: number | null }[] }) {
  const data = items.map((d) => ({ ...d, z: d.z ?? 0, missing: d.z === null }))
  const max = Math.max(4, ...data.map((d) => Math.abs(d.z)))
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, items.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 4" horizontal={false} />
        <XAxis type="number" domain={[-Math.ceil(max), Math.ceil(max)]} stroke="#1d2852" />
        <YAxis type="category" dataKey="label" width={118} stroke="#1d2852" />
        <ReferenceArea x1={-2} x2={2} fill="#34d399" fillOpacity={0.06} />
        <ReferenceLine x={0} stroke="#525d8c" />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(124,92,255,0.08)' }} formatter={(v) => [`${(v as number).toFixed(2)} SD`, 'z']} />
        <Bar dataKey="z" isAnimationActive={false} radius={3}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.missing ? '#525d8c' : Math.abs(d.z) >= 3 ? '#f43f5e' : Math.abs(d.z) >= 2 ? '#fbbf24' : '#7c5cff'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
