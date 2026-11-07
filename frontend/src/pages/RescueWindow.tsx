import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiSend, apiSendOrQueue, outbox } from '../api/client'
import type { EmergencyDetail, EmergencySummary, Scenario, ScenarioResult } from '../api/types'
import { VITALS } from '../api/types'
import { MetricChart, DailyChart, type Marker } from '../components/charts'
import { Button, Chip, cx, Empty, Icon, LevelPill, LoadState, Notice, OriginBadge, PageHeader, Panel } from '../components/ui'
import { useI18n } from '../i18n'
import { duration, fmt, fmtTime, LEVEL_COLOR, METRIC, parseIso, useApi, useConnection, useNow } from '../lib'
import { useApp } from '../state'

const KIND_ICON: Record<string, string> = { detection: 'vitalscan', alert: 'warning', acknowledge: 'check', escalate: 'satellite', action: 'flag', note: 'info', resolve: 'check', reassessment: 'refresh' }

export function RescueWindow() {
  const { t, lang } = useI18n()
  const { id } = useParams()
  const nav = useNavigate()
  const { revision, bump, setAstronautId } = useApp()
  const list = useApi<EmergencySummary[]>('/api/emergencies', 20000, revision)
  const sc = useApi<{ scenarios: Scenario[] }>('/api/scenarios')
  const [busy, setBusy] = useState<string | null>(null)

  const selected = id ? Number(id) : (list.data?.find((e) => e.status !== 'resolved') ?? list.data?.[0])?.id
  useEffect(() => {
    if (!id && selected) nav(`/rescue-window/${selected}${window.location.hash}`, { replace: true })
  }, [id, selected, nav])

  const run = async (key: string) => {
    setBusy(key)
    try {
      const r = await apiSend<ScenarioResult>(`/api/scenarios/${key}/run`, 'POST')
      setAstronautId(r.astronaut_id)
      bump()
      if (r.emergency_id) nav(`/rescue-window/${r.emergency_id}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.rescue')} title={t('rw.title')} subtitle={t('rw.subtitle')} />
      {list.data && list.data.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1" role="tablist" aria-label={t('rw.events')}>
          {list.data.map((e) => (
            <Link key={e.id} to={`/rescue-window/${e.id}`} role="tab" aria-selected={e.id === selected}
              className={cx('shrink-0 rounded-lg border px-3 py-2 text-left', e.id === selected ? 'border-crit/60 bg-crit/10' : 'border-line bg-space-900 hover:border-violet/40')}>
              <div className="flex items-center gap-2 text-xs">
                <span className={cx('size-1.5 rounded-full', e.status === 'resolved' ? 'bg-ok' : 'bg-crit pulse-dot')} />
                <span className="num text-ink-mute">#{e.id} · {e.priority}</span>{e.simulated && <OriginBadge origin="scenario" />}
              </div>
              <div className="text-sm font-medium mt-0.5">{e.astronaut_name}</div>
              <div className="text-[11px] text-ink-mute">{e.category} · {e.status}</div>
            </Link>
          ))}
        </div>
      )}
      {list.loading && !list.data ? <LoadState loading error={null} /> : !selected ? (
        <Panel>
          <div className="text-center py-8">
            <div className="mx-auto size-12 rounded-full border border-line grid place-items-center text-ink-mute"><Icon name="rescue" size={22} /></div>
            <h2 className="mt-4 font-semibold">{t('rw.none')}</h2>
            <p className="text-sm text-ink-mute mt-1">{t('rw.noneHint')}</p>
            <div className="flex flex-wrap gap-2 justify-center mt-5">
              {sc.data?.scenarios.map((s) => (
                <Button key={s.key} variant="primary" size="sm" icon="play" disabled={!!busy} onClick={() => void run(s.key)}>{busy === s.key ? '…' : s.title[lang]}</Button>
              ))}
            </div>
          </div>
        </Panel>
      ) : <Detail id={selected} />}
    </div>
  )
}

function Detail({ id }: { id: number }) {
  const { t, tx, lang } = useI18n()
  const { revision, bump } = useApp()
  const [tick, setTick] = useState(0)
  const d = useApi<EmergencyDetail>(`/api/emergencies/${id}`, 15000, revision + tick)
  const now = useNow(1000)
  const conn = useConnection()
  const pending = outbox.list().filter((o) => o.path === `/api/emergencies/${id}/actions`)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (d.data && window.location.hash) setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 300)
  }, [d.data?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (kind: string, body = '') => {
    setMsg(null)
    const r = await apiSendOrQueue(`/api/emergencies/${id}/actions`, 'POST', { kind, text: body, client_ts: new Date().toISOString() }, `RESCUE WINDOW #${id}: ${kind}`)
    if (r && typeof r === 'object' && 'queued' in r) setMsg(t('rw.queued'))
    setTick((x) => x + 1)
    bump()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await send('action', text.trim())
    setText('')
  }

  if (!d.data) return <LoadState loading={d.loading} error={d.error} onRetry={d.reload} />
  const e = d.data
  const snap = e.snapshot
  const resolved = e.status === 'resolved'
  const markers: Marker[] = e.timeline
    .filter((x) => ['detection', 'alert', 'acknowledge', 'escalate', 'resolve'].includes(x.kind))
    .map((x) => ({ t: x.timestamp, label: x.kind.slice(0, 3).toUpperCase(), color: x.level ? LEVEL_COLOR[x.level] : '#38bdf8' }))
  const startMs = parseIso(e.first_deviation_at || e.opened_at)!.getTime()
  const elapsed = resolved ? e.elapsed_since_first_deviation_s : (now - startMs) / 1000
  const abnormal = snap.contributors.filter((c) => c.kind === 'vital' || c.kind === 'daily' || c.kind === 'environment')
  const vitalsShown = VITALS.filter((m) => abnormal.some((c) => c.indicator === m)).concat(VITALS.filter((m) => !abnormal.some((c) => c.indicator === m))).slice(0, 4)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={cx('panel p-5', resolved ? 'border-ok/40!' : 'border-crit/50! bg-gradient-to-br from-crit/10 to-transparent')}>
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LevelPill level={snap.level} />
              {e.simulated && <OriginBadge origin="scenario" />}
              <Chip>{e.category}</Chip>
              <Chip tone={resolved ? 'ok' : e.status === 'escalated' ? 'crit' : 'warn'}>{e.status}</Chip>
            </div>
            <h2 className="text-xl font-semibold mt-2">{e.astronaut.name} <span className="text-ink-mute text-sm num">{e.astronaut.code} · {e.astronaut.role}</span></h2>
            {e.scenario && <div className="text-xs text-sim mt-1">{tx(e.scenario)} — {t('common.scenario')}</div>}
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-[280px]">
            <div className="panel-flat px-4 py-3">
              <div className="label-caps">{t('rw.priority')}</div>
              <div className={cx('text-2xl font-semibold mt-1', resolved ? 'text-ok' : 'text-crit')}>{e.priority} · {tx(e.priority_info.label)}</div>
            </div>
            <div className="panel-flat px-4 py-3">
              <div className="label-caps">{t('rw.elapsed')}</div>
              <div className="text-2xl font-semibold num mt-1">{duration(elapsed)}</div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm font-medium">{tx(e.priority_info.window)} <span className="text-ink-mute font-normal">{tx(e.priority_info.basis)}</span></p>
        <div className="mt-3"><Notice tone="warn" icon="warning">{tx(e.priority_info.uncertainty)} {t(`conf.${e.priority_info.confidence.label}` as never)} ({Math.round(e.priority_info.confidence.score * 100)}%).</Notice></div>
        {!resolved && (
          <div className="flex flex-wrap gap-2 mt-4">
            {e.status === 'active' && <Button variant="primary" icon="check" onClick={() => void send('acknowledge')}>{t('ew.ack')}</Button>}
            {e.status !== 'escalated' && <Button variant="warn" icon="satellite" onClick={() => void send('escalate')}>{t('ew.escalate')}</Button>}
            <Button variant="ghost" icon="check" onClick={() => void send('resolve')}>{t('ew.resolve')}</Button>
          </div>
        )}
        {msg && <p className="text-xs text-warn mt-2" role="status">{msg}</p>}
      </div>

      <div className="grid xl:grid-cols-[1fr_400px] gap-5">
        <div className="space-y-5 min-w-0">
          <Panel title={t('rw.abnormal')}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {abnormal.map((c) => (
                <div key={c.indicator} className={cx('panel-flat p-3', c.critical || c.points >= 3 ? 'border-crit/40!' : 'border-warn/30!')}>
                  <div className="text-xs text-ink-soft">{tx(c.label)}</div>
                  <div className="num text-xl font-semibold mt-0.5">{fmt(c.indicator, c.value)} <span className="text-xs text-ink-mute">{c.unit}</span></div>
                  <div className="text-[11px] text-ink-mute num">{c.baseline != null ? `${t('common.baseline')} ${fmt(c.indicator, c.baseline)} · ${c.delta! > 0 ? '+' : ''}${fmt(c.indicator, c.delta)}` : ''} · +{c.points}</div>
                </div>
              ))}
              {abnormal.length === 0 && <Empty>—</Empty>}
            </div>
          </Panel>

          <Panel title={t('rw.evolution')} right={<div className="flex gap-1"><OriginBadge origin="simulated" />{e.simulated && <OriginBadge origin="scenario" />}</div>}>
            <div className="grid md:grid-cols-2 gap-4">
              {vitalsShown.map((m) => (
                <div key={m} className="min-w-0">
                  <div className="text-xs text-ink-soft mb-1">{METRIC[m].label[lang]}</div>
                  <MetricChart rows={e.evolution.vitals as never} metric={m} baseline={snap.contributors.find((c) => c.indicator === m)?.baseline_std ? { mean: snap.contributors.find((c) => c.indicator === m)!.baseline!, std: snap.contributors.find((c) => c.indicator === m)!.baseline_std! } : null} markers={markers} height={170} />
                </div>
              ))}
              {e.category === 'environmental' && ['co2_mmhg', 'o2_percent'].map((m) => (
                <div key={m} className="min-w-0">
                  <div className="text-xs text-ink-soft mb-1">{METRIC[m].label[lang]}</div>
                  <MetricChart rows={e.evolution.environment as never} metric={m} markers={markers} height={170} />
                </div>
              ))}
              {e.category === 'fatigue' && ['sleep_hours', 'cognitive_score'].map((m) => (
                <div key={m} className="min-w-0">
                  <div className="text-xs text-ink-soft mb-1">{METRIC[m].label[lang]}</div>
                  <DailyChart rows={e.evolution.daily as never} metric={m} height={170} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mt-2">{lang === 'pt' ? 'Linhas verticais: DET = detecção, ALE = alerta vermelho, ACK/ESC/RES = ações humanas.' : 'Vertical lines: DET = detection, ALE = red alert, ACK/ESC/RES = human actions.'}</p>
          </Panel>

          <Panel title={t('rw.risk')}>
            <ul className="space-y-2">
              {e.risk_factors.map((r, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="num text-xs text-warn w-8 shrink-0 pt-0.5">+{r.points}</span>
                  <div><div className="font-medium">{tx(r.label)}</div><div className="text-xs text-ink-mute">{tx(r.reason)}</div></div>
                </li>
              ))}
            </ul>
            <div className="mt-4"><Notice tone="warn" icon="warning">{tx(e.disclaimer)}</Notice></div>
          </Panel>

          <Panel title={t('rw.protocols')} id="protocols">
            <Notice tone="sim" icon="info">{tx(e.protocol_notice)}</Notice>
            <div className="space-y-4 mt-4">
              {e.protocols.map((p) => (
                <div key={p.key}>
                  <div className="flex items-center gap-2"><Chip tone="violet">{p.key}</Chip><span className="font-medium text-sm">{tx(p.title)}</span></div>
                  <ol className="mt-2 space-y-1.5">
                    {p.steps.map((s, i) => {
                      const k = `${p.key}-${i}`
                      const checked = done.has(k) || e.timeline.some((x) => x.text.en.includes(`[${p.key} #${i + 1}]`))
                      return (
                        <li key={k}>
                          <label className={cx('flex gap-2.5 items-start text-sm rounded-md px-2 py-1.5 cursor-pointer hover:bg-space-850', checked && 'text-ink-mute line-through')}>
                            <input type="checkbox" className="mt-0.5 accent-violet size-4" checked={checked} disabled={checked || resolved}
                              onChange={() => {
                                setDone(new Set(done).add(k))
                                void send('action', `${t('rw.stepDone')} [${p.key} #${i + 1}]: ${s.en}`)
                              }} />
                            <span><span className="num text-xs text-ink-faint mr-1">{i + 1}.</span>{tx(s)}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-5 min-w-0">
          <Panel title={t('ew.next')}>
            <ol className="space-y-2">
              {snap.recommendations.map((r, i) => <li key={i} className="flex gap-2 text-sm"><span className="num text-xs text-violet-soft mt-0.5">{String(i + 1).padStart(2, '0')}</span><span className="text-ink-soft">{tx(r)}</span></li>)}
            </ol>
          </Panel>
          <Panel title={t('rw.resources')}>
            <ul className="divide-y divide-line-soft">
              {e.resources.map((r) => (
                <li key={r.id} className="py-2 flex items-start gap-3 text-sm">
                  <span className={cx('mt-1.5 size-1.5 rounded-full shrink-0', r.status === 'available' ? 'bg-ok' : 'bg-warn')} />
                  <div className="min-w-0 flex-1"><div>{tx(r.name)}</div><div className="text-[11px] text-ink-mute">{r.location}</div></div>
                  <span className="num text-xs text-ink-soft whitespace-nowrap">{r.quantity} {r.unit}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-ink-faint mt-2">{lang === 'pt' ? 'Inventário de demonstração (fictício).' : 'Demonstration inventory (fictional).'}</p>
          </Panel>
          <Panel title={t('rw.timeline')} id="timeline">
            {!resolved && (
              <form onSubmit={submit} className="flex gap-2 mb-4">
                <input className="field" value={text} maxLength={500} onChange={(x) => setText(x.target.value)} placeholder={t('rw.logPlaceholder')} aria-label={t('rw.log')} />
                <Button type="submit" variant="primary" disabled={!text.trim()}>{t('rw.record')}</Button>
              </form>
            )}
            <ol className="relative border-l border-line ml-2 space-y-4">
              {conn.outbox >= 0 && [...pending].reverse().map((p) => {
                const b = p.body as { kind: string; text: string }
                return (
                  <li key={p.id} className="pl-5 relative opacity-80">
                    <span className="absolute -left-[11px] top-0 size-5 rounded-full bg-space-900 border border-dashed border-warn grid place-items-center text-warn"><Icon name="satellite" size={11} /></span>
                    <div className="text-[11px] text-warn num">{fmtTime(p.queuedAt, lang, true)} · {lang === 'pt' ? 'NA FILA LOCAL — aguardando sincronização' : 'QUEUED LOCALLY — pending sync'} · <span className="uppercase tracking-wider">{b.kind}</span></div>
                    <div className="text-sm text-ink-soft mt-0.5">{b.text || b.kind}</div>
                  </li>
                )
              })}
              {[...e.timeline].reverse().map((x) => (
                <li key={x.id} className="pl-5 relative">
                  <span className="absolute -left-[11px] top-0 size-5 rounded-full bg-space-900 border grid place-items-center" style={{ borderColor: x.level ? LEVEL_COLOR[x.level] : '#3b82f6', color: x.level ? LEVEL_COLOR[x.level] : '#38bdf8' }}>
                    <Icon name={KIND_ICON[x.kind] || 'info'} size={11} />
                  </span>
                  <div className="text-[11px] text-ink-mute num">{fmtTime(x.timestamp, lang, true)} · {x.actor} · <span className="uppercase tracking-wider">{x.kind}</span></div>
                  <div className="text-sm text-ink-soft mt-0.5">{tx(x.text)}</div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  )
}
