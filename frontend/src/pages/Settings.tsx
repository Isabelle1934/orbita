import { useEffect, useState } from 'react'
import { ApiError, apiSend, clearCache } from '../api/client'
import type { Bi, DataSource, Thresholds } from '../api/types'
import { Button, Chip, cx, LoadState, Notice, OriginBadge, PageHeader, Panel } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { fmtTime, METRIC, useApi } from '../lib'
import { useApp } from '../state'

const TABS = ['general', 'thresholds', 'sources', 'about'] as const

export function Settings() {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => (window.location.hash.slice(1) as never) || 'general')
  useEffect(() => {
    window.history.replaceState(null, '', `#${tab}`)
  }, [tab])
  const labels = { general: t('st.language'), thresholds: t('st.thresholds'), sources: t('st.sources'), about: t('st.about') }
  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.settings')} title={t('st.title')} />
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)}
            className={cx('px-4 py-2 text-sm border-b-2 -mb-px cursor-pointer', tab === x ? 'border-violet text-ink' : 'border-transparent text-ink-mute hover:text-ink')}>{labels[x]}</button>
        ))}
      </div>
      {tab === 'general' && <General />}
      {tab === 'thresholds' && <ThresholdEditor />}
      {tab === 'sources' && <Sources />}
      {tab === 'about' && <About lang={lang} />}
    </div>
  )
}

function General() {
  const { t, lang, setLang } = useI18n()
  const { bump, logout } = useApp()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const reset = async () => {
    if (!window.confirm(t('st.resetConfirm'))) return
    setBusy(true)
    try {
      await apiSend('/api/demo/reset', 'POST')
      clearCache()
      setDone(true)
      bump()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Panel title={t('st.language')}>
        <div className="flex gap-2" role="radiogroup">
          {(['en', 'pt'] as const).map((l) => (
            <Button key={l} variant={lang === l ? 'primary' : 'subtle'} onClick={() => setLang(l)} aria-pressed={lang === l}>{l === 'en' ? 'English' : 'Português (Brasil)'}</Button>
          ))}
        </div>
      </Panel>
      <Panel title={t('st.demo')}>
        <p className="text-sm text-ink-mute">{t('st.resetConfirm').split('.')[0]}.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="danger" icon="refresh" disabled={busy} onClick={() => void reset()}>{busy ? '…' : t('st.resetDemo')}</Button>
          <Button variant="ghost" onClick={() => void logout()}>{t('shell.logout')}</Button>
        </div>
        {done && <p className="text-xs text-ok mt-2" role="status">✓ OK</p>}
      </Panel>
    </div>
  )
}

function ThresholdEditor() {
  const { t, tx, lang } = useI18n()
  const { bump } = useApp()
  const th = useApi<{ thresholds: Thresholds; defaults: Thresholds; notice: Bi }>('/api/settings/thresholds')
  const [draft, setDraft] = useState<Thresholds | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (th.data) setDraft(structuredClone(th.data.thresholds))
  }, [th.data])
  if (!draft || !th.data) return <LoadState loading={th.loading} error={th.error} onRetry={th.reload} />

  const set = (sec: 'safety' | 'environment', m: string, k: string, v: string) => {
    const d = structuredClone(draft)
    d[sec][m][k] = Number(v)
    setDraft(d)
  }
  const save = async () => {
    setMsg(null)
    try {
      await apiSend('/api/settings/thresholds', 'PUT', { safety: draft.safety, environment: draft.environment, levels: draft.levels })
      setMsg({ ok: true, text: t('st.saved') })
      bump()
      th.reload()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message })
    }
  }
  const reset = async () => {
    await apiSend('/api/settings/thresholds/reset', 'POST')
    bump()
    th.reload()
  }
  const table = (sec: 'safety' | 'environment') => {
    const keys = ['crit_low', 'warn_low', 'warn_high', 'crit_high']
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left label-caps"><th className="py-2 pr-3">{t('common.indicator')}</th>{keys.map((k) => <th key={k} className="pr-2">{k.replace('_', ' ')}</th>)}</tr></thead>
          <tbody>
            {Object.entries(draft[sec]).map(([m, lim]) => (
              <tr key={m} className="border-t border-line-soft">
                <td className="py-1.5 pr-3">{METRIC[m]?.label[lang] ?? m} <span className="text-ink-faint text-xs">{METRIC[m]?.unit}</span></td>
                {keys.map((k) => (
                  <td key={k} className="pr-2">
                    {k in lim ? <input className="field num w-24! py-1!" type="number" step="any" value={lim[k]} aria-label={`${m} ${k}`} onChange={(e) => set(sec, m, k, e.target.value)} /> : <span className="text-ink-faint">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <Notice tone="warn" icon="warning">{t('st.thresholdsNote')}</Notice>
      <Panel title={t('st.levels')}>
        <div className="flex flex-wrap gap-4">
          {(['yellow_score', 'red_score'] as const).map((k) => (
            <label key={k} className="text-sm">
              <span className="block text-xs text-ink-soft mb-1">{k === 'yellow_score' ? 'YELLOW ≥' : 'RED ≥'}</span>
              <input className="field num w-28!" type="number" min={1} max={50} value={draft.levels[k]}
                onChange={(e) => setDraft({ ...draft, levels: { ...draft.levels, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title={t('st.safety')}>{table('safety')}</Panel>
      <Panel title={t('st.envLimits')}>{table('environment')}</Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="check" onClick={() => void save()}>{t('common.save')}</Button>
        <Button variant="ghost" onClick={() => void reset()}>{t('common.reset')}</Button>
        {msg && <span className={cx('text-xs', msg.ok ? 'text-ok' : 'text-crit')} role="status">{msg.text}</span>}
      </div>
      <p className="text-[11px] text-ink-faint">{tx(th.data.notice)}</p>
    </div>
  )
}

function Sources() {
  const { t, tx, lang } = useI18n()
  const s = useApi<DataSource[]>('/api/sources')
  if (!s.data) return <LoadState loading={s.loading} error={s.error} onRetry={s.reload} />
  const groups = ['nasa_open_data', 'simulated', 'user_entered'] as const
  return (
    <div className="space-y-5">
      {groups.map((g, gi) => (
        <Panel key={g} title={`${gi + 1}. ${t(`cat.${g}` as Key)}`}>
          <div className="space-y-3">
            {s.data!.filter((x) => x.category === g).map((x) => (
              <article key={x.key} className="panel-flat p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <OriginBadge origin={g === 'nasa_open_data' ? 'nasa' : g === 'simulated' ? 'simulated' : 'user'} />
                  <h3 className="font-medium">{x.name}</h3>
                  <Chip tone={x.status === 'live' || x.status === 'active' ? 'ok' : 'warn'}>{x.status}</Chip>
                </div>
                <div className="text-xs text-ink-mute mt-1">{x.provider}{x.last_fetched_at && ` · ${fmtTime(x.last_fetched_at, lang, true)}`}</div>
                <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
                  <div><dt className="label-caps">{lang === 'pt' ? 'Descrição' : 'Description'}</dt><dd className="text-ink-soft">{tx(x.description)}</dd></div>
                  <div><dt className="label-caps">{lang === 'pt' ? 'O que mede' : 'What it measures'}</dt><dd className="text-ink-soft">{tx(x.measures)}</dd></div>
                  <div><dt className="label-caps">{lang === 'pt' ? 'Uso no ORBITA' : 'Use in ORBITA'}</dt><dd className="text-ink-soft">{tx(x.usage)}</dd></div>
                  <div><dt className="label-caps">{lang === 'pt' ? 'Limitações' : 'Limitations'}</dt><dd className="text-warn/90">{tx(x.limitations)}</dd></div>
                </dl>
                <div className="text-[11px] text-ink-mute mt-3 num break-all">
                  {x.url && <a href={x.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline mr-3">{x.url}</a>}
                  {x.endpoint}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}

function About({ lang }: { lang: string }) {
  const pt = lang === 'pt'
  return (
    <Panel title={pt ? 'Sobre o ORBITA' : 'About ORBITA'}>
      <div className="space-y-3 text-sm text-ink-soft max-w-3xl leading-relaxed">
        <p>{pt
          ? 'O ORBITA é um protótipo experimental de monitoramento de saúde e apoio à decisão para missões espaciais de longa duração, desenvolvido para o NASA Space Apps Challenge 2026 (desafio “Create Health Monitoring Software for Astronauts on Space Missions”).'
          : 'ORBITA is an experimental health-monitoring and decision-support prototype for long-duration space missions, built for the 2026 NASA Space Apps Challenge (challenge “Create Health Monitoring Software for Astronauts on Space Missions”).'}</p>
        <Notice tone="warn" icon="warning">
          {pt
            ? 'Não é um dispositivo médico, não faz diagnósticos, não foi validado clinicamente e não substitui profissionais de saúde. Os limites são padrões de demonstração. Os protocolos são conteúdo educacional, não instruções médicas certificadas. Todos os tripulantes e medições são fictícios/simulados. O ORBITA não é afiliado, patrocinado, aprovado ou testado pela NASA e não está conectado a nenhuma espaçonave ou infraestrutura da NASA. Dados reais da NASA (DONKI, OSDR) são usados apenas como contexto, com a fonte identificada.'
            : 'It is not a medical device, does not diagnose, has not been clinically validated and does not replace medical professionals. Thresholds are demonstration defaults. Protocols are educational content, not certified medical instructions. All crew members and measurements are fictional/simulated. ORBITA is not affiliated with, sponsored, approved or tested by NASA and is not connected to any spacecraft or NASA infrastructure. Real NASA data (DONKI, OSDR) is used only as context, with the source identified.'}
        </Notice>
      </div>
    </Panel>
  )
}
