import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiSend } from '../api/client'
import type { Alert, Analysis, Scenario, ScenarioResult } from '../api/types'
import { AstronautPicker } from '../components/AstronautPicker'
import { BiText, Button, Chip, cx, Empty, LevelPill, LoadState, Notice, OriginBadge, PageHeader, Panel, ScoreBar } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { ago, fmt, fmtTime, LEVEL_COLOR, useApi } from '../lib'
import { useApp } from '../state'

export function EarlyWarning() {
  const { t, tx, lang } = useI18n()
  const { astronautId, setAstronautId, revision, bump } = useApp()
  const crew = useApi<Analysis[]>('/api/analysis/crew', 30000, revision)
  const ana = useApi<Analysis>(`/api/astronauts/${astronautId}/analysis`, 30000, revision)
  const alerts = useApi<Alert[]>('/api/alerts?limit=60', 30000, revision)
  const sc = useApi<{ scenarios: Scenario[]; notice: { en: string; pt: string }; active: { scenario_key: string } | null }>('/api/scenarios', undefined, revision)
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openAlert, setOpenAlert] = useState<number | null>(null)

  const run = async (key: string) => {
    setBusy(key)
    try {
      const r = await apiSend<ScenarioResult>(`/api/scenarios/${key}/run`, 'POST')
      setResult(r)
      setAstronautId(r.astronaut_id)
      bump()
    } finally {
      setBusy(null)
    }
  }
  const reset = async () => {
    setBusy('reset')
    try {
      await apiSend('/api/scenarios/reset', 'POST')
      setResult(null)
      bump()
    } finally {
      setBusy(null)
    }
  }
  const act = async (id: number, action: string) => {
    await apiSend(`/api/alerts/${id}/${action}`, 'POST', { note: '' })
    bump()
  }

  const a = ana.data
  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.warning')} title={t('ew.title')} subtitle={t('ew.subtitle')}
        right={<Chip tone="violet">{t('ew.notDiagnosis')}</Chip>} />

      {/* Crew levels */}
      <Panel title={t('ew.crewLevels')}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {crew.data?.map((c) => (
            <button key={c.astronaut_id} type="button" onClick={() => setAstronautId(c.astronaut_id)}
              className={cx('text-left rounded-lg border p-3 cursor-pointer transition', c.astronaut_id === astronautId ? 'border-violet/60 bg-violet/10' : 'border-line bg-space-900 hover:border-violet/40')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{c.astronaut_name}</span>
                <span className="size-2.5 rounded-full shrink-0" style={{ background: LEVEL_COLOR[c.level] }} />
              </div>
              <div className="text-[11px] text-ink-mute num mt-1">{c.level} · {t('ew.score')} {c.score} · {t(`conf.${c.confidence.label}` as Key).split(' ')[0]}</div>
            </button>
          )) ?? <LoadState loading={crew.loading} error={crew.error} />}
        </div>
      </Panel>

      {/* Scenarios */}
      <Panel title={t('mc.scenarios')} sub={sc.data ? tx(sc.data.notice) : undefined}
        right={<Button size="sm" variant="ghost" icon="x" disabled={busy !== null} onClick={() => void reset()}>{t('ew.resetAll')}</Button>}>
        <div className="grid md:grid-cols-3 gap-3">
          {sc.data?.scenarios.map((s) => (
            <div key={s.key} className={cx('panel-flat p-4 flex flex-col', sc.data?.active?.scenario_key === s.key && 'border-sim/50!')}>
              <div className="flex items-center gap-2"><OriginBadge origin="scenario" /><span className="text-[11px] text-ink-mute num">{s.astronaut_code}</span></div>
              <h3 className="font-medium mt-2">{tx(s.title)}</h3>
              <p className="text-xs text-ink-mute mt-1 flex-1">{tx(s.summary)}</p>
              <div className="flex items-center gap-1 mt-3 text-[10px] text-ink-faint">{s.stages.map((st, i) => <span key={st.key}>{i > 0 && '→ '}{tx(st.label)}</span>)}</div>
              <Button className="mt-3" variant="primary" size="sm" icon="play" disabled={busy !== null} onClick={() => void run(s.key)}>{busy === s.key ? '…' : t('mc.run')}</Button>
            </div>
          ))}
        </div>
        {result && (
          <div className="mt-4 panel-flat p-4 border-sim/40!" role="status">
            <div className="label-caps text-sim! mb-3">{t('ew.runResult')} · {result.astronaut_name}</div>
            <ol className="grid sm:grid-cols-3 gap-3">
              {result.stages.map((s, i) => (
                <li key={s.key} className="relative">
                  <div className="flex items-center gap-2"><span className="num text-xs text-ink-faint">{i + 1}</span><LevelPill level={s.level} size="sm" /></div>
                  <div className="text-sm font-medium mt-1.5">{tx(s.label)}</div>
                  <div className="text-[11px] text-ink-mute num">{fmtTime(s.time, lang, true)} · {t('ew.score')} {s.score}</div>
                  <div className="text-[11px] text-ink-soft mt-1">{s.top.map((x) => tx(x)).join(', ')}</div>
                </li>
              ))}
            </ol>
            {result.emergency_id && (
              <Link to={`/rescue-window/${result.emergency_id}`} className="inline-flex mt-4"><Button variant="danger" icon="arrow">{t('mc.openRescue')}</Button></Link>
            )}
          </div>
        )}
      </Panel>

      {/* Explanation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{a?.astronaut_name ?? '…'}</h2>
        <AstronautPicker />
      </div>
      {!a ? <LoadState loading={ana.loading} error={ana.error} onRetry={ana.reload} /> : (
        <div className="grid xl:grid-cols-[1fr_380px] gap-5">
          <div className="space-y-5 min-w-0">
            <Panel title={t('ew.why')} right={<span className="text-[11px] text-ink-mute num">{fmtTime(a.evaluated_at, lang, true)}</span>}>
              <div className="flex flex-wrap items-center gap-4">
                <LevelPill level={a.level} size="lg" />
                <div className="flex-1 min-w-[200px]">
                  <div className="flex justify-between text-[11px] text-ink-mute num mb-1">
                    <span>{t('ew.score')} {a.score}</span><span>YELLOW ≥ {a.thresholds.yellow} · RED ≥ {a.thresholds.red}</span>
                  </div>
                  <ScoreBar score={a.score} yellow={a.thresholds.yellow} red={a.thresholds.red} />
                </div>
              </div>
              <p className="mt-4 text-sm text-ink-soft">{tx(a.why)}</p>
              {a.what_changed.length > 0 && (
                <div className="mt-4">
                  <div className="label-caps mb-2">{t('ew.changed')}</div>
                  <ul className="space-y-1 text-sm">{a.what_changed.map((w, i) => <li key={i} className="num text-ink">• {tx(w)}</li>)}</ul>
                </div>
              )}
            </Panel>

            <Panel title={t('ew.contributors')}>
              {a.contributors.length === 0 ? <Empty>{t('ew.noContrib')}</Empty> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead><tr className="text-left label-caps"><th className="py-2 pr-3">{t('common.indicator')}</th><th className="pr-3">{t('common.value')}</th><th className="pr-3">{t('common.baseline')}</th><th className="pr-3">z</th><th className="pr-3">{t('common.points')}</th><th>{t('common.reason')}</th></tr></thead>
                    <tbody>
                      {a.contributors.map((c, i) => (
                        <tr key={i} className="border-t border-line-soft align-top">
                          <td className="py-2 pr-3"><div className="font-medium">{tx(c.label)}</div><div className="text-[10px] text-ink-faint uppercase tracking-wider">{c.kind}</div></td>
                          <td className="pr-3 num whitespace-nowrap">{c.value != null && c.kind !== 'model' ? <>{fmt(c.indicator, c.value)} <span className="text-ink-faint text-xs">{c.unit}</span></> : c.kind === 'model' ? fmt('x', c.value) : '—'}{c.origin && <div><OriginBadge origin={c.origin} /></div>}</td>
                          <td className="pr-3 num text-ink-mute whitespace-nowrap">{c.baseline != null ? `${fmt(c.indicator, c.baseline)} ± ${fmt(c.indicator, c.baseline_std)}` : '—'}</td>
                          <td className="pr-3 num whitespace-nowrap">{c.z != null ? c.z.toFixed(1) : '—'}</td>
                          <td className="pr-3"><span className={cx('num font-semibold', c.critical ? 'text-crit' : c.points >= 3 ? 'text-crit' : 'text-warn')}>+{c.points}</span>{c.critical && <div className="text-[10px] text-crit">CRIT</div>}</td>
                          <td className="text-xs text-ink-soft leading-snug">{tx(c.reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {a.context.map((c, i) => (
                <div key={i} className="mt-3"><Notice icon="sun"><b>{t('ew.context')} (0 pts):</b> {tx(c.reason)} {c.events.map((e) => `${e.type} ${e.detail}`).join(' · ')}</Notice></div>
              ))}
            </Panel>
          </div>

          <div className="space-y-5 min-w-0">
            <Panel title={t('ew.next')}>
              <ol className="space-y-2">
                {a.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-sm"><span className="num text-violet-soft text-xs mt-0.5">{String(i + 1).padStart(2, '0')}</span><span className="text-ink-soft">{tx(r)}</span></li>
                ))}
              </ol>
              <div className="mt-4"><Notice tone="warn" icon="warning">{tx(a.disclaimer)}</Notice></div>
            </Panel>
            <Panel title={t('ew.confidence')}>
              <div className="flex items-center gap-3">
                <div className="text-3xl num font-semibold">{Math.round(a.confidence.score * 100)}%</div>
                <Chip tone={a.confidence.label === 'high' ? 'ok' : a.confidence.label === 'medium' ? 'warn' : 'crit'}>{t(`conf.${a.confidence.label}` as Key)}</Chip>
              </div>
              <p className="text-[11px] text-ink-faint mt-1">{lang === 'pt' ? 'Completude e atualidade dos dados — não é acurácia do modelo.' : 'Completeness and freshness of the data — not model accuracy.'}</p>
              {a.confidence.missing.length === 0 ? <p className="text-xs text-ok mt-3">{t('ew.noMissing')}</p> : (
                <ul className="mt-3 space-y-1 text-xs">{a.confidence.missing.map((m, i) => <li key={i} className="text-warn">• {tx(m.label)} — <span className="text-ink-mute">{tx(m.reason)}</span></li>)}</ul>
              )}
              {a.confidence.notes.map((n, i) => <p key={i} className="text-xs text-ink-mute mt-2">{tx(n)}</p>)}
              <div className="flex flex-wrap gap-1 mt-3">{a.confidence.data_origins.map((o) => <OriginBadge key={o} origin={o} />)}</div>
            </Panel>
            <Panel title={t('ew.model')}>
              {a.model ? (
                <>
                  <div className={cx('text-sm', a.model.flagged ? 'text-warn' : 'text-ok')}>{a.model.flagged ? t('ew.modelFlag') : t('ew.modelOk')}</div>
                  <div className="text-xs text-ink-mute num mt-1">decision_function = {a.model.score.toFixed(3)} {a.model.flagged ? '(< −0.05 → +1 pt)' : ''}</div>
                  {a.model.imputed.length > 0 && <div className="text-[11px] text-ink-faint mt-1">imputed: {a.model.imputed.join(', ')}</div>}
                </>
              ) : <div className="text-xs text-ink-mute">—</div>}
              <p className="text-[11px] text-ink-faint mt-2">{lang === 'pt' ? 'Treinado apenas com o histórico do próprio astronauta. Não supervisionado, não validado clinicamente.' : "Trained only on this astronaut's own history. Unsupervised, not clinically validated."}</p>
            </Panel>
          </div>
        </div>
      )}

      {/* Alerts */}
      <Panel title={t('ew.alerts')} id="history">
        {!alerts.data?.length ? <Empty>{t('mc.noAlerts')}</Empty> : (
          <ul className="space-y-2">
            {alerts.data.map((al) => (
              <li key={al.id} className="panel-flat p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <LevelPill level={al.level} size="sm" label={false} />
                  <span className="font-medium text-sm">{tx(al.title)}</span>
                  <span className="text-xs text-ink-mute">· {al.astronaut_name ?? t('ew.environmentAlert')}</span>
                  {al.scenario_run_id && <OriginBadge origin="scenario" />}
                  <Chip tone={al.status === 'resolved' ? 'ok' : al.status === 'escalated' ? 'crit' : al.status === 'acknowledged' ? 'info' : 'warn'}>{al.status}</Chip>
                  <span className="text-[11px] text-ink-faint ml-auto">{ago(al.created_at, lang)}</span>
                </div>
                <p className="text-xs text-ink-soft mt-1.5 num">{tx(al.summary)}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {al.status !== 'resolved' && <>
                    {al.status === 'open' && <Button size="sm" onClick={() => void act(al.id, 'acknowledge')}>{t('ew.ack')}</Button>}
                    {al.status !== 'escalated' && <Button size="sm" variant="warn" onClick={() => void act(al.id, 'escalate')}>{t('ew.escalate')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => void act(al.id, 'resolve')}>{t('ew.resolve')}</Button>
                  </>}
                  {al.emergency_id && <Link to={`/rescue-window/${al.emergency_id}`}><Button size="sm" variant="danger">RESCUE WINDOW</Button></Link>}
                  <Button size="sm" variant="ghost" onClick={() => setOpenAlert(openAlert === al.id ? null : al.id)}>{t('ew.history')} ({al.history.length})</Button>
                </div>
                {openAlert === al.id && (
                  <ol className="mt-3 border-l border-line pl-4 space-y-2">
                    {al.history.map((h, i) => (
                      <li key={i} className="text-xs"><span className="num text-ink-mute">{fmtTime(h.t, lang, true)}</span> · <span className="text-ink-soft">{h.actor}</span> · {h.level && <span style={{ color: LEVEL_COLOR[h.level] }}>{h.level}</span>} — <BiText v={h.text} /></li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('ew.scoring')}>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs text-ink-soft">
          {[
            [lang === 'pt' ? 'Desvio da linha de base pessoal' : 'Deviation from personal baseline', lang === 'pt' ? '|z| ≥ 2 → +1 · ≥ 3 → +2 · ≥ 4 → +3 (z = (valor − média pessoal) / DP pessoal)' : '|z| ≥ 2 → +1 · ≥ 3 → +2 · ≥ 4 → +3 (z = (value − personal mean) / personal SD)'],
            [lang === 'pt' ? 'Limites de segurança configurados' : 'Configured safety limits', lang === 'pt' ? 'Atenção → 2 pts · Crítico → 4 pts e nível VERMELHO direto. Usa-se o maior entre desvio e limite.' : 'Attention → 2 pts · Critical → 4 pts and RED directly. The larger of deviation and limit is used.'],
            [lang === 'pt' ? 'Tendência e padrões' : 'Trends & patterns', lang === 'pt' ? 'Mudança ≥ 2 DP em 90 min → +1 · ≥ 3 sinais vitais simultâneos → +2 · sono + cognição → +1 · ambiente + fisiologia → +2' : 'Change ≥ 2 SD within 90 min → +1 · ≥ 3 co-occurring vitals → +2 · sleep + cognition → +1 · environment + physiology → +2'],
            [lang === 'pt' ? 'Diário, ambiente e modelo' : 'Daily, environment & model', lang === 'pt' ? 'Sono, qualidade, cognição (−10/20/30%), hidratação, atividade · cabine: atenção +1, crítico +2 · IsolationForest +1 · clima espacial 0 pts (contexto)' : 'Sleep, quality, cognition (−10/20/30%), hydration, activity · cabin: attention +1, critical +2 · IsolationForest +1 · space weather 0 pts (context)'],
          ].map(([h, b]) => <div key={h} className="panel-flat p-3"><div className="font-medium text-ink mb-1">{h}</div>{b}</div>)}
        </div>
        <p className="text-[11px] text-ink-faint mt-3">{lang === 'pt' ? 'Níveis: VERDE < limite amarelo ≤ AMARELO < limite vermelho ≤ VERMELHO (configurável em Configurações).' : 'Levels: GREEN < yellow threshold ≤ YELLOW < red threshold ≤ RED (configurable in Settings).'}</p>
      </Panel>
    </div>
  )
}
