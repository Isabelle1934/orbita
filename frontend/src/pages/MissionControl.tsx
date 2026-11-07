import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiSend } from '../api/client'
import type { MissionStatus, Scenario, ScenarioResult, Vital } from '../api/types'
import { VITALS } from '../api/types'
import { BiText, Button, Chip, cx, Empty, Icon, LevelPill, LoadState, OriginBadge, PageHeader, Panel, Stat } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { ago, fmt, fmtTime, LEVEL_COLOR, METRIC, useApi } from '../lib'
import { useApp } from '../state'

const ENV_KEYS = ['co2_mmhg', 'o2_percent', 'cabin_pressure_kpa', 'cabin_temperature_c', 'humidity_percent', 'radiation_ugy_h'] as const

export function MissionControl() {
  const { t, tx, lang } = useI18n()
  const { revision, astronautId, setAstronautId, bump } = useApp()
  const nav = useNavigate()
  const { data: m, loading, error, reload, fromCache, cachedAt } = useApi<MissionStatus>('/api/mission', 15000, revision)
  const sc = useApi<{ scenarios: Scenario[] }>('/api/scenarios')
  const [running, setRunning] = useState<string | null>(null)
  const [scErr, setScErr] = useState<string | null>(null)

  const run = async (key: string) => {
    setRunning(key)
    setScErr(null)
    try {
      const r = await apiSend<ScenarioResult>(`/api/scenarios/${key}/run`, 'POST')
      setAstronautId(r.astronaut_id)
      bump()
      nav('/early-warning')
    } catch (e) {
      setScErr((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  if (!m) return <LoadState loading={loading} error={error} onRetry={reload} />
  const progress = Math.min(100, (m.mission.day / m.mission.planned_duration_days) * 100)

  return (
    <div className="space-y-5">
      <PageHeader kicker={m.mission.habitat} title={m.mission.name} subtitle={tx(m.mission.description)}
        right={<>
          {fromCache && <OriginBadge origin="cached" />}
          <Chip tone="violet">{t('common.simulated')} · {m.crew.length} {t('common.crew').toLowerCase()}</Chip>
          <span className="text-xs text-ink-mute num">{fmtTime(m.server_time, lang, true)}</span>
          {fromCache && cachedAt && <span className="text-[11px] text-warn">{ago(cachedAt, lang)}</span>}
        </>} />

      {/* Mission strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label={t('mc.day')} value={<>{m.mission.day}<span className="text-ink-mute text-base"> / {m.mission.planned_duration_days}</span></>}>
          <div className="mt-2 h-1.5 rounded-full bg-space-950 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet to-cyan" style={{ width: `${progress}%` }} /></div>
        </Stat>
        <Stat label={t('mc.crewMonitored')} value={m.crew.length} sub={m.crew.map((c) => c.code).join(' · ')} />
        <Stat label={t('mc.overall')}>
          <div className="mt-2"><LevelPill level={m.overall_status} size="lg" /></div>
        </Stat>
        <Stat label={t('mc.activeAlerts')} value={m.active_alerts.length}
          tone={m.active_alerts.some((a) => a.level === 'RED') ? 'text-crit' : m.active_alerts.length ? 'text-warn' : 'text-ok'}
          sub={`${m.active_emergencies.length} RESCUE WINDOW`} />
        <Stat label={t('mc.link')} value={<span className="text-base">{t(`link.${m.link.status}` as Key)}</span>}
          sub={`${m.link.one_way_delay_s}s · ${t('mc.lastSync')}: ${m.last_sync_at ? ago(m.last_sync_at, lang) : t('mc.never')}`} />
      </div>

      {m.active_emergencies.length > 0 && (
        <div className="panel border-crit/50! bg-crit/5 p-4 flex flex-wrap items-center gap-3">
          <span className="size-2.5 rounded-full bg-crit pulse-dot" />
          <span className="font-semibold text-crit tracking-wide">RESCUE WINDOW</span>
          <span className="text-sm text-ink-soft">
            {m.active_emergencies.map((e) => m.crew.find((c) => c.id === e.astronaut_id)?.name).join(', ')} · {m.active_emergencies[0].priority}
          </span>
          <Button variant="danger" size="sm" className="ml-auto" icon="arrow" onClick={() => nav(`/rescue-window/${m.active_emergencies[0].id}`)}>{t('mc.openRescue')}</Button>
        </div>
      )}

      {/* Crew */}
      <Panel title={t('mc.crewHealth')} sub={t('common.select')}>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {m.crew.map((c) => (
            <article key={c.id}
              className={cx('rounded-xl border p-4 transition cursor-pointer bg-space-900/70',
                c.id === astronautId ? 'border-violet/60 ring-1 ring-violet/30' : 'border-line hover:border-violet/40')}
              onClick={() => setAstronautId(c.id)} onKeyDown={(e) => e.key === 'Enter' && setAstronautId(c.id)} tabIndex={0}
              aria-label={`${c.name} ${c.level}`} aria-pressed={c.id === astronautId} role="button">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="num text-[10px] text-ink-mute">{c.code}</div>
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-ink-mute truncate">{c.role}</div>
                </div>
                <LevelPill level={c.level} size="sm" label={false} />
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-2 mt-4">
                {VITALS.filter((v) => v !== 'diastolic').map((v: Vital) => {
                  const x = c.vitals[v]
                  return (
                    <div key={v} className="min-w-0">
                      <div className="text-[10px] text-ink-faint uppercase tracking-wider">{METRIC[v].short[lang]}</div>
                      <div className="num text-sm">
                        {v === 'systolic' ? `${fmt('systolic', x?.value)}/${fmt('diastolic', c.vitals.diastolic?.value)}` : fmt(v, x?.value)}
                        <span className="text-[10px] text-ink-faint ml-0.5">{v === 'systolic' ? '' : METRIC[v].unit}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-space-950 overflow-hidden">
                  <div className="h-full" style={{ width: `${Math.min(100, (c.score / 14) * 100)}%`, background: LEVEL_COLOR[c.level] }} />
                </div>
                <span className="num text-[11px] text-ink-mute">{t('ew.score')} {c.score}</span>
              </div>
              <div className="mt-2 min-h-[20px] flex flex-wrap gap-1">
                {c.top.slice(0, 2).map((x, i) => <Chip key={i} tone={c.level === 'RED' ? 'crit' : 'warn'}>{tx(x.label)} +{x.points}</Chip>)}
                {c.missing > 0 && <Chip>{c.missing} {t('mc.missing')}</Chip>}
              </div>
              <div className="flex gap-2 mt-3">
                <Link to="/bio-twin" onClick={(e) => { e.stopPropagation(); setAstronautId(c.id) }} className="text-xs text-violet-soft hover:text-ink">{t('mc.openBio')} →</Link>
                <Link to="/vital-scan" onClick={(e) => { e.stopPropagation(); setAstronautId(c.id) }} className="text-xs text-cyan hover:text-ink">{t('mc.openScan')} →</Link>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-faint"><OriginBadge origin="simulated" /> {t('common.fictional')}</div>
      </Panel>

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title={t('mc.activeAlerts')} className="lg:col-span-1" right={<Link to="/early-warning" className="text-xs text-violet-soft">{t('common.viewAll')} →</Link>}>
          {m.active_alerts.length === 0 ? <Empty>{t('mc.noAlerts')}</Empty> : (
            <ul className="space-y-2">
              {m.active_alerts.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link to={a.emergency_id ? `/rescue-window/${a.emergency_id}` : '/early-warning'} className="block panel-flat p-3 hover:border-violet/40">
                    <div className="flex items-center gap-2 justify-between">
                      <LevelPill level={a.level} size="sm" label={false} />
                      <span className="text-[11px] text-ink-mute">{ago(a.created_at, lang)}</span>
                    </div>
                    <div className="text-sm font-medium mt-1.5">{tx(a.title)}</div>
                    <div className="text-xs text-ink-mute">{a.astronaut_name || t('ew.environmentAlert')} · {a.status}{a.scenario_run_id ? ` · ${t('common.scenario')}` : ''}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('mc.changes')} className="lg:col-span-2">
          {m.recent_changes.length === 0 ? <Empty>{t('mc.noChanges')}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left label-caps"><th className="py-2 pr-3">{t('common.astronaut')}</th><th className="pr-3">{t('common.indicator')}</th><th className="pr-3">{t('common.current')}</th><th className="pr-3">{t('common.baseline')}</th><th>{t('common.points')}</th></tr></thead>
                <tbody>
                  {m.recent_changes.map((c, i) => (
                    <tr key={i} className="border-t border-line-soft">
                      <td className="py-2 pr-3 whitespace-nowrap">{c.astronaut_name}</td>
                      <td className="pr-3">{tx(c.label)}</td>
                      <td className="pr-3 num whitespace-nowrap">{fmt(c.indicator, c.value)} <span className="text-ink-faint text-xs">{c.unit}</span> {c.origin && <OriginBadge origin={c.origin} />}</td>
                      <td className="pr-3 num text-ink-mute whitespace-nowrap">{c.baseline != null ? fmt(c.indicator, c.baseline) : '—'}{c.delta != null && <span className={c.delta > 0 ? 'text-warn' : 'text-cyan'}> ({c.delta > 0 ? '+' : ''}{fmt(c.indicator, c.delta)})</span>}</td>
                      <td className="num">+{c.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title={t('mc.env')} right={<OriginBadge origin={m.environment?.origin || 'simulated'} />}>
          {m.environment ? (
            <div className="grid grid-cols-2 gap-2">
              {ENV_KEYS.map((k) => (
                <div key={k} className="panel-flat px-3 py-2">
                  <div className="text-[10px] text-ink-faint uppercase tracking-wider truncate">{METRIC[k].short[lang]}</div>
                  <div className="num">{fmt(k, m.environment![k])} <span className="text-[10px] text-ink-faint">{METRIC[k].unit}</span></div>
                </div>
              ))}
            </div>
          ) : <Empty>{t('common.noData')}</Empty>}
          <Link to="/environment" className="block text-xs text-violet-soft mt-3">{t('nav.environment')} →</Link>
        </Panel>

        <Panel title={t('mc.solar')} right={<OriginBadge origin={m.space_weather.origin} />}>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl num font-semibold">{m.space_weather.recent_72h}</span>
            <span className="text-sm text-ink-mute">{t('mc.solarEvents')}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(m.space_weather.counts).map(([k, v]) => <Chip key={k} tone="info">{k} · {v}</Chip>)}
          </div>
          {m.space_weather.significant.map((e) => (
            <div key={e.id} className="text-xs text-warn mt-2">{e.type} {e.detail} · {fmtTime(e.time, lang, true)}</div>
          ))}
          <p className="text-[11px] text-ink-faint mt-3">{tx(m.space_weather.label)}</p>
        </Panel>

        <Panel title={t('mc.scenarios')} sub={t('mc.scenariosHint')}>
          <div className="space-y-2">
            {sc.data?.scenarios.map((s) => (
              <div key={s.key} className="panel-flat p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium"><BiText v={s.title} /></div>
                  <div className="text-[11px] text-ink-mute">{s.astronaut_code}</div>
                </div>
                <Button size="sm" variant="primary" icon="play" disabled={!!running} onClick={() => void run(s.key)}>{running === s.key ? '…' : t('mc.run')}</Button>
              </div>
            ))}
            {scErr && <div className="text-xs text-crit">{scErr}</div>}
          </div>
        </Panel>
      </div>

      <Panel title={t('mc.events')}>
        <ol className="divide-y divide-line-soft">
          {m.events.map((e) => (
            <li key={e.id} className="py-2 flex items-start gap-3 text-sm">
              <span className={cx('mt-1.5 size-1.5 rounded-full shrink-0', e.severity === 'critical' ? 'bg-crit' : e.severity === 'warn' ? 'bg-warn' : 'bg-ink-faint')} />
              <span className="num text-[11px] text-ink-mute w-24 shrink-0 pt-0.5">{fmtTime(e.timestamp, lang, true)}</span>
              <span className="min-w-0 text-ink-soft">{tx(e.message)}</span>
              <span className="ml-auto text-[10px] text-ink-faint uppercase tracking-wider hidden sm:block"><Icon name="info" size={12} className="inline" /> {e.kind}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}
