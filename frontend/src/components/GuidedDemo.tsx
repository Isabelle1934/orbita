import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiSend } from '../api/client'
import type { Bi, ScenarioResult } from '../api/types'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { Button, cx, Icon } from './ui'

interface Step {
  title: Bi
  body: Bi
  route: string
  hash?: string
  action?: 'select' | 'scenario'
}

const STEPS: Step[] = [
  { route: '/', title: { en: 'Welcome to ORBITA', pt: 'Bem-vindo ao ORBITA' },
    body: { en: 'This guided tour walks through the full loop: monitoring → anomaly detection → RESCUE WINDOW → event history. All crew data is fictional and simulated.',
            pt: 'Este tour percorre o ciclo completo: monitoramento → detecção de anomalias → RESCUE WINDOW → histórico. Todos os dados são fictícios e simulados.' } },
  { route: '/', title: { en: 'Mission Control', pt: 'Controle da Missão' },
    body: { en: 'The command view: mission day, crew status, active alerts, cabin environment, solar activity from NASA DONKI and the latest system events.',
            pt: 'A visão de comando: dia da missão, status da tripulação, alertas, ambiente da cabine, atividade solar do NASA DONKI e últimos eventos.' } },
  { route: '/', action: 'select', title: { en: 'Select an astronaut', pt: 'Selecione um astronauta' },
    body: { en: 'Commander Elena Varga (AST-01) is selected for you. Every view follows the selected crew member.',
            pt: 'A comandante Elena Varga (AST-01) é selecionada. Todas as telas seguem o tripulante selecionado.' } },
  { route: '/bio-twin', title: { en: 'Review the Bio-Twin', pt: 'Revise o Bio-Twin' },
    body: { en: 'Her personal baseline is computed from her own 14-day history. Current values are compared with HER range, not a population average.',
            pt: 'A linha de base é calculada com o próprio histórico de 14 dias. Os valores atuais são comparados com a faixa DELA, não com uma média populacional.' } },
  { route: '/vital-scan', title: { en: 'View physiological indicators', pt: 'Veja os indicadores fisiológicos' },
    body: { en: 'Vital-Scan shows current readings, sensor connectivity, data gaps and a simulated live feed. You can also enter a measurement manually.',
            pt: 'O Vital-Scan mostra leituras atuais, conectividade, falhas de dados e um feed simulado. Também é possível inserir medições manualmente.' } },
  { route: '/early-warning', action: 'scenario', title: { en: 'Activate a simulated emergency', pt: 'Ative uma emergência simulada' },
    body: { en: 'Run SCENARIO 1 — Cardiovascular changes. ORBITA injects clearly labeled simulated readings in three stages and evaluates each one.',
            pt: 'Execute o CENÁRIO 1 — Alterações cardiovasculares. O ORBITA injeta leituras simuladas rotuladas em três etapas e avalia cada uma.' } },
  { route: '/early-warning', title: { en: 'See the Early Warning alert', pt: 'Veja o alerta do Early Warning' },
    body: { en: 'The level went GREEN → YELLOW → RED. Each point of the score is traceable: what changed, which indicators contributed, data confidence and missing data.',
            pt: 'O nível passou de VERDE → AMARELO → VERMELHO. Cada ponto é rastreável: o que mudou, quais indicadores contribuíram, confiança e dados ausentes.' } },
  { route: '/rescue-window', title: { en: 'Open the RESCUE WINDOW', pt: 'Abra a RESCUE WINDOW' },
    body: { en: 'The response-priority window, abnormal indicators, the evolution of measurements and possible risk factors — with explicit uncertainty. It is not a survival estimate.',
            pt: 'A janela de prioridade de resposta, indicadores anormais, evolução das medições e fatores de risco — com incerteza explícita. Não é estimativa de sobrevivência.' } },
  { route: '/rescue-window', hash: 'protocols', title: { en: 'Review the recommended response', pt: 'Revise a resposta recomendada' },
    body: { en: 'Available medical resources and the preconfigured protocol checklist (educational demo content). Tick a step, acknowledge or escalate — every action is logged.',
            pt: 'Recursos médicos disponíveis e checklist do protocolo (conteúdo educacional). Marque uma etapa, reconheça ou escalone — cada ação é registrada.' } },
  { route: '/rescue-window', hash: 'timeline', title: { en: 'Inspect the event history', pt: 'Inspecione o histórico do evento' },
    body: { en: 'The timeline shows first detection, the RED alert and every human action. It is stored locally and synced over the simulated Earth link (Mission Link).',
            pt: 'A linha do tempo mostra a primeira detecção, o alerta VERMELHO e cada ação humana. Fica armazenada localmente e é sincronizada pelo link simulado (Mission Link).' } },
]

export function GuidedDemo() {
  const { tx, lang } = useI18n()
  const { guidedStep, setGuidedStep, setGuided, setAstronautId, bump } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [min, setMin] = useState(false)
  const i = Math.min(guidedStep, STEPS.length - 1)
  const s = STEPS[i]

  const go = (n: number) => {
    const st = STEPS[n]
    setGuidedStep(n)
    setMsg(null)
    if (st.action === 'select') setAstronautId(1)
    nav(st.route + (st.hash ? `#${st.hash}` : ''))
    if (st.hash) setTimeout(() => document.getElementById(st.hash!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600)
  }

  const runScenario = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await apiSend<ScenarioResult>('/api/scenarios/cardio/run', 'POST')
      setAstronautId(r.astronaut_id)
      bump()
      setMsg(r.stages.map((x) => x.level).join(' → '))
      go(6)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onRoute = s.route === '/' ? loc.pathname === '/' : loc.pathname.startsWith(s.route)
  return (
    <div className={cx('fixed z-50 bottom-4 right-4 left-4 sm:left-auto sm:w-[380px] panel bg-space-900! shadow-2xl shadow-black/60 border-violet/50!', min && 'sm:w-[260px]')}
      role="dialog" aria-label="Guided demo">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="label-caps text-violet-soft!">{lang === 'pt' ? 'Demo guiada' : 'Guided demo'} · <span className="num">{i + 1}/{STEPS.length}</span></span>
        <div className="flex gap-1">
          <button type="button" className="p-1 text-ink-mute hover:text-ink cursor-pointer text-xs" onClick={() => setMin(!min)}>{min ? '▴' : '▾'}</button>
          <button type="button" className="p-1 text-ink-mute hover:text-ink cursor-pointer" aria-label="Close guided demo" onClick={() => setGuided(false)}><Icon name="x" size={14} /></button>
        </div>
      </div>
      {!min && (
        <div className="px-4 pb-4 pt-2">
          <div className="flex gap-1 mb-3" aria-hidden="true">
            {STEPS.map((_, n) => <span key={n} className={cx('h-1 flex-1 rounded-full', n <= i ? 'bg-violet' : 'bg-space-700')} />)}
          </div>
          <h3 className="font-semibold">{tx(s.title)}</h3>
          <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">{tx(s.body)}</p>
          {msg && <p className="text-xs mt-2 num text-sim">{msg}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            {i > 0 && <Button size="sm" variant="ghost" onClick={() => go(i - 1)}>{lang === 'pt' ? 'Voltar' : 'Back'}</Button>}
            {!onRoute && <Button size="sm" onClick={() => go(i)}>{lang === 'pt' ? 'Ir para a tela' : 'Go to screen'}</Button>}
            {s.action === 'scenario' ? (
              <Button size="sm" variant="primary" icon="play" disabled={busy} onClick={() => void runScenario()}>
                {busy ? '…' : lang === 'pt' ? 'Executar Cenário 1' : 'Run Scenario 1'}
              </Button>
            ) : i < STEPS.length - 1 ? (
              <Button size="sm" variant="primary" icon="arrow" onClick={() => go(i + 1)}>{lang === 'pt' ? 'Próximo' : 'Next'}</Button>
            ) : (
              <Button size="sm" variant="primary" icon="check" onClick={() => setGuided(false)}>{lang === 'pt' ? 'Concluir' : 'Finish'}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
