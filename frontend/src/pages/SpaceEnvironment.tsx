import { useState } from 'react'
import { apiSend } from '../api/client'
import type { Alert, Bi, EnvRow, SpaceWeather } from '../api/types'
import { MetricChart } from '../components/charts'
import { Button, Chip, cx, Empty, LevelPill, LoadState, Notice, OriginBadge, PageHeader, Panel } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { ago, fmt, fmtTime, METRIC, useApi } from '../lib'
import { useApp } from '../state'

type EnvStatus = Record<string, { value: number | null; status: 'nominal' | 'warning' | 'critical' | 'missing'; label: Bi; unit: string; thresholds: Record<string, number> }>

const KEYS = ['co2_mmhg', 'o2_percent', 'cabin_pressure_kpa', 'cabin_temperature_c', 'humidity_percent', 'radiation_ugy_h']

export function SpaceEnvironment() {
  const { t, tx, lang } = useI18n()
  const { revision } = useApp()
  const env = useApi<{ readings: EnvRow[]; latest: EnvRow | null; status: EnvStatus; alerts: Alert[]; dose_note: Bi }>('/api/environment?hours=24', 30000, revision)
  const [rev, setRev] = useState(0)
  const sw = useApi<SpaceWeather>('/api/environment/space-weather', undefined, rev)
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<string[] | null>(null)

  const refresh = async () => {
    setBusy(true)
    try {
      const r = await apiSend<SpaceWeather>('/api/environment/space-weather/refresh', 'POST')
      setErrs(r.refresh_errors?.length ? r.refresh_errors : [])
      setRev((x) => x + 1)
    } catch (e) {
      setErrs([(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.environment')} title={t('env.title')} subtitle={t('env.subtitle')} />
      {!env.data ? <LoadState loading={env.loading} error={env.error} onRetry={env.reload} /> : (
        <>
          <Panel title={t('env.cabin')} right={<><OriginBadge origin={env.data.latest?.origin || 'simulated'} /><span className="text-[11px] text-ink-mute">{env.data.latest && ago(env.data.latest.timestamp, lang)}</span></>}>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {KEYS.map((k) => {
                const s = env.data!.status[k]
                const tone = { nominal: 'text-ok border-ok/30', warning: 'text-warn border-warn/40', critical: 'text-crit border-crit/50', missing: 'text-ink-mute border-line' }[s.status]
                const th = Object.entries(s.thresholds).map(([a, b]) => `${a.replace('_', ' ')} ${b}`).join(' · ')
                return (
                  <div key={k} className={cx('rounded-xl border bg-space-900/70 p-3', tone.split(' ')[1])}>
                    <div className="text-[11px] text-ink-soft leading-tight min-h-[28px]">{tx(s.label)}</div>
                    <div className="num text-2xl font-semibold text-ink mt-1">{fmt(k, s.value)} <span className="text-xs text-ink-mute">{s.unit}</span></div>
                    <div className={cx('text-[11px] font-semibold uppercase tracking-wider mt-1', tone.split(' ')[0])}>{t(`env.status.${s.status}` as Key)}</div>
                    <div className="text-[10px] text-ink-faint mt-1 leading-snug">{th}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3"><Notice>{tx(env.data.dose_note)}</Notice></div>
          </Panel>

          <div className="grid xl:grid-cols-[1fr_380px] gap-5">
            <Panel title={t('env.trends')} right={<OriginBadge origin="simulated" />}>
              <div className="grid md:grid-cols-2 gap-4">
                {KEYS.map((k) => (
                  <div key={k} className="min-w-0">
                    <div className="text-xs text-ink-soft mb-1">{METRIC[k].label[lang]}</div>
                    <MetricChart rows={env.data!.readings as never} metric={k} limits={env.data!.status[k].thresholds} height={150} />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={t('env.alerts')}>
              {env.data.alerts.length === 0 ? <Empty>{t('mc.noAlerts')}</Empty> : (
                <ul className="space-y-2">
                  {env.data.alerts.map((a) => (
                    <li key={a.id} className="panel-flat p-3">
                      <div className="flex items-center gap-2"><LevelPill level={a.level} size="sm" label={false} /><Chip>{a.status}</Chip>{a.scenario_run_id && <OriginBadge origin="scenario" />}</div>
                      <div className="text-sm mt-1.5">{tx(a.title)}</div>
                      <div className="text-xs text-ink-mute num">{tx(a.summary)}</div>
                      <div className="text-[11px] text-ink-faint mt-1">{fmtTime(a.created_at, lang, true)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      <Panel title={t('env.donki')}
        right={<>{sw.data && <OriginBadge origin={sw.data.origin} />}<Button size="sm" icon="refresh" disabled={busy} onClick={() => void refresh()}>{busy ? '…' : t('common.refresh')}</Button></>}>
        {!sw.data ? <LoadState loading={sw.loading} error={sw.error} onRetry={sw.reload} /> : (
          <>
            <div className={cx('text-sm font-medium', sw.data.origin === 'live' ? 'text-nasa' : 'text-warn')}>{tx(sw.data.label)}</div>
            <div className="text-xs text-ink-mute mt-1">{t('env.fetched')}: {sw.data.fetched_at ? fmtTime(sw.data.fetched_at, lang, true) : '—'}</div>
            {errs && errs.length > 0 && <div className="mt-2"><Notice tone="warn" icon="warning">{lang === 'pt' ? 'Falha ao consultar a NASA (usando cache/amostra): ' : 'NASA request failed (using cache/sample): '}{errs.join(' | ')}</Notice></div>}
            {errs && errs.length === 0 && <div className="text-xs text-ok mt-2">✓ {lang === 'pt' ? 'Dados ao vivo atualizados.' : 'Live data refreshed.'}</div>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {Object.entries(sw.data.counts).map(([k, v]) => (
                <div key={k} className="panel-flat px-3 py-2">
                  <div className="text-[11px] text-ink-mute">{k} · {tx(sw.data!.types[k])}</div>
                  <div className="num text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid lg:grid-cols-[1fr_320px] gap-4">
              <div className="overflow-x-auto">
                {sw.data.events.length === 0 ? <Empty>{t('env.noEvents')}</Empty> : (
                  <table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="text-left label-caps"><th className="py-2 pr-3">Type</th><th className="pr-3">{t('common.time')}</th><th className="pr-3">Detail</th><th>ID</th></tr></thead>
                    <tbody>
                      {sw.data.events.slice(0, 25).map((e) => (
                        <tr key={e.id} className={cx('border-t border-line-soft', e.significant && 'text-warn')}>
                          <td className="py-1.5 pr-3"><Chip tone={e.significant ? 'warn' : 'info'}>{e.type}</Chip></td>
                          <td className="pr-3 num text-xs whitespace-nowrap">{fmtTime(e.time, lang, true)}</td>
                          <td className="pr-3 text-xs">{e.detail}</td>
                          <td className="text-[11px] num">{e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="text-cyan hover:underline">{e.id}</a> : e.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="space-y-3">
                <Notice icon="sun">{tx(sw.data.note)}</Notice>
                <div className="panel-flat p-3">
                  <div className="label-caps mb-2">{t('env.significant')}</div>
                  {sw.data.significant.length === 0 ? <div className="text-xs text-ink-mute">{t('common.none')}</div> :
                    sw.data.significant.map((e) => <div key={e.id} className="text-xs text-warn">{e.type} {e.detail} · {fmtTime(e.time, lang, true)}</div>)}
                  <p className="text-[10px] text-ink-faint mt-2">{lang === 'pt' ? 'Critério: flare ≥ M5, qualquer SEP, tempestade com Kp ≥ 7.' : 'Criteria: flare ≥ M5, any SEP, storm with Kp ≥ 7.'}</p>
                </div>
                <div className="panel-flat p-3 text-[11px] text-ink-mute break-all">
                  <div className="label-caps mb-1">{t('env.endpoints')}</div>
                  {Object.keys(sw.data.endpoints).length ? Object.entries(sw.data.endpoints).map(([k, v]) => <div key={k}>{k}: {v}</div>) : (
                    <>https://api.nasa.gov/DONKI/&#123;FLR,SEP,CME,GST&#125; · https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/&#123;type&#125;</>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
