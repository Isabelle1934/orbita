import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError, apiSend, apiSendOrQueue } from '../api/client'
import type { Analysis, Baseline, SensorStatus, Thresholds, VitalRow } from '../api/types'
import { VITALS } from '../api/types'
import { AstronautPicker } from '../components/AstronautPicker'
import { MetricChart, Sparkline } from '../components/charts'
import { Button, Chip, cx, Field, LevelPill, LoadState, Notice, OriginBadge, PageHeader, Panel } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { ago, fmt, fmtTime, METRIC, useApi, useNow } from '../lib'
import { useApp } from '../state'

export function VitalScan() {
  const { t, lang } = useI18n()
  const { astronautId, revision, bump } = useApp()
  const [feed, setFeed] = useState(false)
  const [tick, setTick] = useState(0)
  const rev = revision + tick
  const vit = useApi<VitalRow[]>(`/api/astronauts/${astronautId}/measurements?hours=24`, 30000, rev)
  const bls = useApi<Baseline[]>(`/api/astronauts/${astronautId}/baselines`, undefined, revision)
  const sens = useApi<{ sensors: SensorStatus[]; readings_24h: number; missing_24h: Record<string, number> }>(`/api/astronauts/${astronautId}/sensors`, 30000, rev)
  const ana = useApi<Analysis>(`/api/astronauts/${astronautId}/analysis`, 30000, rev)
  const th = useApi<{ thresholds: Thresholds }>('/api/settings/thresholds')
  const [feedErr, setFeedErr] = useState<string | null>(null)
  const now = useNow(5000)
  const feedRef = useRef(feed)
  feedRef.current = feed

  const once = async () => {
    try {
      await apiSend(`/api/astronauts/${astronautId}/simulate`, 'POST')
      setFeedErr(null)
      setTick((x) => x + 1)
    } catch (e) {
      setFeedErr((e as Error).message)
      setFeed(false)
    }
  }

  useEffect(() => {
    if (!feed) return
    void once()
    const id = setInterval(() => feedRef.current && void once(), 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, astronautId])
  useEffect(() => setFeed(false), [astronautId])

  const bl = useMemo(() => Object.fromEntries((bls.data ?? []).map((b) => [b.metric, b])), [bls.data])
  const rows = useMemo(() => vit.data ?? [], [vit.data])
  const latest = useMemo(() => {
    const out: Record<string, VitalRow | undefined> = {}
    for (const m of VITALS) out[m] = [...rows].reverse().find((r) => r[m] !== null)
    return out
  }, [rows])

  const toggleSensor = async (s: SensorStatus) => {
    await apiSend(`/api/astronauts/${astronautId}/sensors`, 'PUT', { metric: s.metric, state: s.state === 'connected' ? 'disconnected' : 'connected' })
    setTick((x) => x + 1)
  }

  const contrib = new Map((ana.data?.contributors ?? []).map((c) => [c.indicator, c]))

  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.vitalscan')} title={t('vs.title')} subtitle={t('vs.subtitle')} right={<AstronautPicker />} />

      <div className="panel p-4 flex flex-wrap items-center gap-3">
        <span className={cx('size-2.5 rounded-full', feed ? 'bg-sim pulse-dot' : 'bg-ink-faint')} />
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">{t('vs.feed')} <OriginBadge origin="simulated" /></div>
          <div className="text-xs text-ink-mute">{feed ? t('vs.feedOn') : t('vs.feedOff')}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant={feed ? 'warn' : 'primary'} icon={feed ? 'pause' : 'play'} onClick={() => setFeed(!feed)}>{feed ? t('vs.stop') : t('vs.start')}</Button>
          <Button icon="refresh" onClick={() => void once()} disabled={feed}>{t('vs.one')}</Button>
        </div>
        {ana.data && <div className="w-full sm:w-auto flex items-center gap-2"><LevelPill level={ana.data.level} /><span className="text-xs text-ink-mute num">{t('ew.score')} {ana.data.score}</span></div>}
        {feedErr && <div className="w-full text-xs text-crit">{feedErr}</div>}
      </div>

      {/* Live tiles */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {VITALS.map((m) => {
          const r = latest[m]
          const v = r?.[m] ?? null
          const b = bl[m]
          const z = b && v !== null ? (v - b.mean) / b.std : null
          const s = sens.data?.sensors.find((x) => x.metric === m)
          const c = contrib.get(m)
          const series = rows.slice(-24).map((x) => x[m])
          const sTone = s?.status === 'online' ? 'ok' : s?.status === 'stale' ? 'warn' : 'crit'
          return (
            <div key={m} className={cx('panel p-4', c ? (c.critical || c.points >= 3 ? 'border-crit/50!' : 'border-warn/40!') : '')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-ink-soft">{METRIC[m].label[lang]}</div>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-semibold num">{fmt(m, v)}</span>
                    <span className="text-sm text-ink-mute">{METRIC[m].unit}</span>
                  </div>
                </div>
                {s && <Chip tone={sTone}>{t(`sensor.${s.status}` as Key)}</Chip>}
              </div>
              <div className="mt-2"><Sparkline values={series} color={METRIC[m].color} /></div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-ink-mute">
                {r ? <><OriginBadge origin={r.origin} /><span>{ago(r.timestamp, lang, now)}</span></> : <span className="text-warn">{t('vs.noReading')}</span>}
                {b && <span className="num">· {t('common.baseline')} {fmt(m, b.mean)}</span>}
                {z !== null && <span className={cx('num', Math.abs(z) >= 2 ? 'text-warn' : 'text-ok')}>· {z > 0 ? '+' : ''}{z.toFixed(1)} SD</span>}
              </div>
              {c && <p className="text-[11px] mt-2 text-warn leading-snug">{c.reason[lang]}</p>}
              {s && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-line-soft">
                  <span className="text-[11px] text-ink-faint">{s.last_reading_at ? `${lang === 'pt' ? 'última' : 'last'} ${fmtTime(s.last_reading_at, lang)}` : '—'}</span>
                  <Button size="sm" variant="ghost" onClick={() => void toggleSensor(s)}>{s.state === 'connected' ? t('vs.disconnect') : t('vs.connect')}</Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid xl:grid-cols-[1fr_360px] gap-5">
        <Panel title={`${t('vs.trends')} · 24 h`} right={<OriginBadge origin="simulated" />}>
          {vit.data ? (
            <div className="grid md:grid-cols-2 gap-4">
              {VITALS.map((m) => (
                <div key={m} className="min-w-0">
                  <div className="text-xs text-ink-soft mb-1">{METRIC[m].label[lang]}</div>
                  <MetricChart rows={rows as never} metric={m} baseline={bl[m]} limits={th.data?.thresholds.safety[m]} height={150} />
                </div>
              ))}
            </div>
          ) : <LoadState loading={vit.loading} error={vit.error} onRetry={vit.reload} />}
          <p className="text-[11px] text-ink-faint mt-2">{t('bt.band')} · {lang === 'pt' ? 'linhas tracejadas = limites de demonstração configurados' : 'dashed lines = configured demo limits'}</p>
        </Panel>

        <div className="space-y-5">
          <Panel title={t('vs.quality')}>
            {sens.data && (
              <>
                <div className="text-sm"><span className="num text-xl font-semibold">{sens.data.readings_24h}</span> <span className="text-ink-mute">{t('vs.readings24')}</span></div>
                <ul className="mt-3 space-y-1.5">
                  {VITALS.map((m) => {
                    const g = sens.data!.missing_24h[m] ?? 0
                    const pct = sens.data!.readings_24h ? (g / sens.data!.readings_24h) * 100 : 0
                    return (
                      <li key={m} className="text-xs">
                        <div className="flex justify-between"><span className="text-ink-soft">{METRIC[m].short[lang]}</span><span className={cx('num', g ? 'text-warn' : 'text-ink-mute')}>{g} {t('vs.gaps')}</span></div>
                        <div className="h-1 bg-space-950 rounded-full mt-1 overflow-hidden"><div className="h-full bg-warn" style={{ width: `${pct}%` }} /></div>
                      </li>
                    )
                  })}
                </ul>
                {ana.data && ana.data.confidence.missing.length > 0 && (
                  <div className="mt-3"><Notice tone="warn" icon="warning">{ana.data.confidence.missing.map((x) => `${x.label[lang]}: ${x.reason[lang]}`).join(' · ')}</Notice></div>
                )}
              </>
            )}
          </Panel>
          <ManualEntry astronautId={astronautId} onDone={() => { setTick((x) => x + 1); bump() }} />
        </div>
      </div>

      <Panel title={t('vs.recent')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left label-caps"><th className="py-2 pr-3">{t('common.time')}</th>{VITALS.map((m) => <th key={m} className="pr-3">{METRIC[m].short[lang]}</th>)}<th>{t('common.source')}</th></tr></thead>
            <tbody>
              {[...rows].reverse().slice(0, 15).map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="py-1.5 pr-3 num text-ink-mute whitespace-nowrap">{fmtTime(r.timestamp, lang, true)}</td>
                  {VITALS.map((m) => <td key={m} className={cx('pr-3 num', r[m] === null && 'text-warn/70')}>{r[m] === null ? '∅' : fmt(m, r[m])}</td>)}
                  <td><OriginBadge origin={r.origin} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-faint mt-2">∅ = {lang === 'pt' ? 'valor ausente (sensor sem leitura)' : 'missing value (no sensor reading)'}</p>
      </Panel>
    </div>
  )
}

function ManualEntry({ astronautId, onDone }: { astronautId: number; onDone: () => void }) {
  const { t, lang } = useI18n()
  const [v, setV] = useState<Record<string, string>>({})
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrs({})
    setMsg(null)
    const body: Record<string, number | string> = {}
    for (const m of VITALS) if (v[m]?.trim()) body[m] = Number(v[m])
    if (v.note?.trim()) body.note = v.note.trim()
    try {
      const r = await apiSendOrQueue<{ analysis: { level: string; score: number } }>(`/api/astronauts/${astronautId}/measurements`, 'POST', body, `Manual vitals #${astronautId}`)
      if ('queued' in r) setMsg({ tone: 'text-warn', text: t('vs.queued') })
      else setMsg({ tone: 'text-ok', text: `${t('vs.recorded')} ${r.analysis.level} (${t('ew.score')} ${r.analysis.score})` })
      setV({})
      onDone()
    } catch (e2) {
      if (e2 instanceof ApiError) {
        setErrs(Object.fromEntries(e2.errors.map((x) => [x.field, x.message])))
        setMsg({ tone: 'text-crit', text: e2.errors.find((x) => x.field === 'body')?.message?.replace('Value error, ', '') || e2.message })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={t('vs.manual')} sub={t('vs.manualHint')} right={<OriginBadge origin="user" />}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {VITALS.map((m) => (
          <Field key={m} label={`${METRIC[m].short[lang]} (${METRIC[m].unit})`} error={errs[m]}>
            <input className="field num" type="number" step="any" inputMode="decimal" value={v[m] ?? ''} aria-invalid={!!errs[m]}
              onChange={(e) => setV({ ...v, [m]: e.target.value })} />
          </Field>
        ))}
        <div className="col-span-2">
          <Field label={lang === 'pt' ? 'Observação' : 'Note'}><input className="field" maxLength={300} value={v.note ?? ''} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !VITALS.some((m) => v[m]?.trim())}>{t('vs.submit')}</Button>
          {msg && <span className={cx('text-xs', msg.tone)} role="status">{msg.text}</span>}
        </div>
      </form>
    </Panel>
  )
}
