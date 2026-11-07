import { useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiSend, apiSendOrQueue } from '../api/client'
import type { Astronaut, Baseline, DailyRow, OsdrStudy, VitalRow } from '../api/types'
import { DAILY, VITALS } from '../api/types'
import { AstronautPicker } from '../components/AstronautPicker'
import { DailyChart, DeviationBars, MetricChart } from '../components/charts'
import { Button, Chip, cx, Field, LoadState, Notice, OriginBadge, PageHeader, Panel } from '../components/ui'
import { useI18n } from '../i18n'
import { fmt, fmtTime, METRIC, useApi } from '../lib'
import { useApp } from '../state'

const WINDOWS = [24, 72, 168, 336]

export function BioTwin() {
  const { t, tx, lang } = useI18n()
  const { astronautId, revision, bump } = useApp()
  const a = useApi<Astronaut & { baselines: Baseline[] }>(`/api/astronauts/${astronautId}`, undefined, revision)
  const [hours, setHours] = useState(72)
  const [metric, setMetric] = useState<string>('heart_rate')
  const vit = useApi<VitalRow[]>(`/api/astronauts/${astronautId}/measurements?hours=${hours}`, 30000, revision)
  const daily = useApi<DailyRow[]>(`/api/astronauts/${astronautId}/daily?days=14`, undefined, revision)
  const osdr = useApi<{ origin: string; fetched_at: string | null; studies: OsdrStudy[] }>('/api/sources/osdr')
  const [days, setDays] = useState(14)
  const [busy, setBusy] = useState(false)

  const bl = useMemo(() => Object.fromEntries((a.data?.baselines ?? []).map((b) => [b.metric, b])), [a.data])
  const current = useMemo(() => {
    const out: Record<string, { v: number; at: string; origin: string } | undefined> = {}
    const rows = vit.data ?? []
    for (const m of VITALS) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = rows[i][m]
        if (v !== null && v !== undefined) {
          out[m] = { v, at: rows[i].timestamp, origin: rows[i].origin }
          break
        }
      }
    }
    const d = daily.data?.[daily.data.length - 1]
    if (d) for (const m of DAILY) if (d[m] !== null) out[m] = { v: d[m] as number, at: d.timestamp, origin: d.origin }
    return out
  }, [vit.data, daily.data])

  const rows = [...VITALS, ...DAILY].map((m) => {
    const b = bl[m]
    const c = current[m]
    const z = b && c ? (c.v - b.mean) / b.std : null
    return { m, b, c, z }
  })

  const recompute = async () => {
    setBusy(true)
    try {
      await apiSend(`/api/astronauts/${astronautId}/baselines/recompute?days=${days}`, 'POST')
      bump()
    } finally {
      setBusy(false)
    }
  }

  if (!a.data) return <LoadState loading={a.loading} error={a.error} onRetry={a.reload} />
  const astro = a.data
  const computed = astro.baselines[0]

  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.biotwin')} title={t('bt.title')} subtitle={t('bt.subtitle')} right={<AstronautPicker />} />

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <Panel title={t('bt.profile')}>
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-2xl bg-gradient-to-br from-violet/40 to-electric/20 border border-violet/40 grid place-items-center text-lg font-semibold">
              {astro.name.split(' ').map((p) => p[0]).join('')}
            </div>
            <div className="min-w-0">
              <div className="num text-[11px] text-ink-mute">{astro.code}</div>
              <div className="font-semibold text-lg leading-tight">{astro.name}</div>
              <div className="text-sm text-ink-mute">{astro.role}</div>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 mt-4 text-center">
            {[[lang === 'pt' ? 'Idade' : 'Age', astro.age], [lang === 'pt' ? 'Sexo' : 'Sex', astro.sex], [lang === 'pt' ? 'Massa' : 'Mass', `${astro.mass_kg} kg`]].map(([k, v]) => (
              <div key={String(k)} className="panel-flat py-2"><dt className="text-[10px] text-ink-faint uppercase">{k}</dt><dd className="num text-sm">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-3"><Chip tone="violet">{t('common.fictional')}</Chip></div>
          <div className="mt-5 space-y-2">
            <div className="label-caps">{t('bt.window')}</div>
            {computed && (
              <p className="text-xs text-ink-mute">
                {fmtTime(computed.window_start, lang, true)} → {fmtTime(computed.window_end, lang, true)} · {t('bt.computed')} {fmtTime(computed.computed_at, lang, true)}
              </p>
            )}
            <div className="flex gap-2">
              <select className="field w-28!" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('bt.window')}>
                {[7, 14, 30].map((d) => <option key={d} value={d}>{d} {t('common.days')}</option>)}
              </select>
              <Button icon="refresh" disabled={busy} onClick={() => void recompute()}>{busy ? '…' : t('bt.recompute')}</Button>
            </div>
            <p className="text-[11px] text-ink-faint">{lang === 'pt' ? 'Dados de cenário são excluídos do cálculo.' : 'Scenario data is excluded from the computation.'}</p>
          </div>
        </Panel>

        <Panel title={t('bt.baselineTable')} right={<span className="text-[11px] text-ink-mute">{t('bt.band')}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-left label-caps">
                  <th className="py-2 pr-3">{t('common.indicator')}</th><th className="pr-3">{t('common.current')}</th>
                  <th className="pr-3">{t('common.baseline')}</th><th className="pr-3">{t('bt.range')}</th><th className="pr-3">{t('bt.deviation')}</th><th>n</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, b, c, z }) => (
                  <tr key={m} className={cx('border-t border-line-soft cursor-pointer hover:bg-space-850/60', metric === m && 'bg-violet/5')}
                    onClick={() => VITALS.includes(m as never) && setMetric(m)}>
                    <td className="py-2 pr-3">{METRIC[m].label[lang]}</td>
                    <td className="pr-3 num whitespace-nowrap">{c ? <>{fmt(m, c.v)} <span className="text-ink-faint text-xs">{METRIC[m].unit}</span> <OriginBadge origin={c.origin} /></> : <span className="text-warn text-xs">{t('vs.noReading')}</span>}</td>
                    <td className="pr-3 num whitespace-nowrap text-ink-soft">{b ? `${fmt(m, b.mean)} ± ${fmt(m, b.std)}` : '—'}</td>
                    <td className="pr-3 num whitespace-nowrap text-ink-mute">{b ? `${fmt(m, b.p05)} – ${fmt(m, b.p95)}` : '—'}</td>
                    <td className={cx('pr-3 num whitespace-nowrap', z === null ? 'text-ink-faint' : Math.abs(z) >= 3 ? 'text-crit' : Math.abs(z) >= 2 ? 'text-warn' : 'text-ok')}>
                      {z === null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)} SD`}
                    </td>
                    <td className="num text-ink-faint text-xs">{b?.n_samples ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid xl:grid-cols-[1fr_380px] gap-5">
        <Panel title={`${t('bt.history')} · ${METRIC[metric].label[lang]}`}
          right={<>
            <select className="field w-auto!" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label={t('common.indicator')}>
              {VITALS.map((m) => <option key={m} value={m}>{METRIC[m].label[lang]}</option>)}
            </select>
            <div className="flex rounded-lg border border-line overflow-hidden text-xs">
              {WINDOWS.map((h) => (
                <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}
                  className={cx('px-2.5 py-1.5 cursor-pointer num', hours === h ? 'bg-violet/25 text-ink' : 'text-ink-mute')}>{h < 48 ? `${h}h` : `${h / 24}d`}</button>
              ))}
            </div>
          </>}>
          {vit.data ? <MetricChart rows={vit.data as never} metric={metric} baseline={bl[metric]} height={260} /> : <LoadState loading={vit.loading} error={vit.error} />}
          <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-ink-mute">
            <span><span className="inline-block w-3 h-2 bg-violet/25 mr-1 align-middle" />{t('bt.band')}</span>
            <OriginBadge origin="simulated" /><OriginBadge origin="user" /><OriginBadge origin="scenario" />
          </div>
        </Panel>
        <Panel title={t('bt.deviationProfile')}>
          <DeviationBars items={rows.filter((r) => r.b).map((r) => ({ label: METRIC[r.m].short[lang], z: r.z }))} />
        </Panel>
      </div>

      <Panel title={t('bt.daily')} right={<OriginBadge origin="simulated" />}>
        {daily.data ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {DAILY.map((m) => (
              <div key={m} className="min-w-0">
                <div className="text-xs text-ink-soft mb-1">{METRIC[m].label[lang]} <span className="text-ink-faint">({METRIC[m].unit})</span></div>
                <DailyChart rows={daily.data as never} metric={m} baseline={bl[m]} height={150} />
              </div>
            ))}
          </div>
        ) : <LoadState loading={daily.loading} error={daily.error} />}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5">
        <DailyForm astronautId={astronautId} onDone={bump} />
        <Panel title={t('bt.research')} right={<OriginBadge origin={osdr.data?.origin === 'live' ? 'nasa' : 'offline'} />}>
          <Notice>{t('bt.researchNote')}</Notice>
          <ul className="mt-3 space-y-2">
            {osdr.data?.studies.map((s) => (
              <li key={s.accession} className="panel-flat p-3">
                <div className="flex items-center gap-2"><Chip tone="info">{s.accession}</Chip>{s.release_date && <span className="text-[11px] text-ink-faint">{s.release_date}</span>}</div>
                <a href={s.url} target="_blank" rel="noreferrer" className="block text-sm font-medium mt-1.5 hover:text-cyan">{s.title}</a>
                {s.description && <p className="text-xs text-ink-mute mt-1 line-clamp-3">{s.description}</p>}
                {s.assays.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{s.assays.slice(0, 5).map((x) => <Chip key={x}>{x}</Chip>)}</div>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-faint mt-2">{osdr.data?.origin === 'live' ? `osdr.nasa.gov · ${fmtTime(osdr.data.fetched_at, lang, true)}` : (lang === 'pt' ? 'Metadados ao vivo indisponíveis — exibindo identificadores e títulos verificados.' : 'Live metadata unavailable — showing verified accession IDs and titles.')}</p>
        </Panel>
      </div>
      <p className="text-[11px] text-ink-faint">{tx({ en: 'Bio-Twin is a statistical profile of past measurements, not a physiological simulation of the body.', pt: 'O Bio-Twin é um perfil estatístico de medições passadas, não uma simulação fisiológica do corpo.' })}</p>
    </div>
  )
}

function DailyForm({ astronautId, onDone }: { astronautId: number; onDone: () => void }) {
  const { t, lang } = useI18n()
  const [v, setV] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ tone: 'info' | 'crit' | 'warn'; text: string } | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setErrs({})
    const body: Record<string, number> = {}
    for (const m of DAILY) if (v[m]?.trim()) body[m] = Number(v[m])
    try {
      const r = await apiSendOrQueue<{ analysis: { level: string; score: number } }>(`/api/astronauts/${astronautId}/daily`, 'POST', body, `Daily log #${astronautId}`)
      if ('queued' in r) setMsg({ tone: 'warn', text: t('vs.queued') })
      else setMsg({ tone: 'info', text: `${t('vs.recorded')} ${r.analysis.level} (${r.analysis.score})` })
      setV({})
      onDone()
    } catch (e2) {
      if (e2 instanceof ApiError) {
        setErrs(Object.fromEntries(e2.errors.map((x) => [x.field, x.message])))
        setMsg({ tone: 'crit', text: e2.errors.find((x) => x.field === 'body')?.message || e2.message })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={t('bt.logDaily')} right={<OriginBadge origin="user" />}>
      <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {DAILY.map((m) => (
          <Field key={m} label={`${METRIC[m].label[lang]} (${METRIC[m].unit})`} error={errs[m]}>
            <input className="field num" inputMode="decimal" type="number" step="any" value={v[m] ?? ''} aria-invalid={!!errs[m]}
              onChange={(e) => setV({ ...v, [m]: e.target.value })} />
          </Field>
        ))}
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !DAILY.some((m) => v[m]?.trim())}>{t('vs.submit')}</Button>
          {msg && <span className={cx('text-xs', msg.tone === 'crit' ? 'text-crit' : msg.tone === 'warn' ? 'text-warn' : 'text-ok')} role="status">{msg.text}</span>}
        </div>
      </form>
    </Panel>
  )
}
