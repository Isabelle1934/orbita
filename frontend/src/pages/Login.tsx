import { useState, type FormEvent } from 'react'
import { OfflineError } from '../api/client'
import { Button, Field, Logo, Notice } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { useApp } from '../state'

const ROLES = ['flight_surgeon_demo', 'crew_medical_officer', 'commander', 'observer'] as const

export function Login() {
  const { t, lang, setLang } = useI18n()
  const { login, setGuided, setGuidedStep } = useApp()
  const [name, setName] = useState('Demo Judge')
  const [role, setRole] = useState<string>('observer')
  const [guided, setG] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await login(name.trim() || 'Demo Judge', role)
      setGuidedStep(0)
      setGuided(guided)
    } catch (e2) {
      setErr(e2 instanceof OfflineError ? t('login.server') : (e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="orbita-backdrop min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.1fr_1fr] gap-8 items-center">
        <div>
          <div className="flex items-center gap-4">
            <Logo size={56} />
            <div>
              <div className="text-4xl font-semibold tracking-[0.32em]">ORBITA</div>
              <div className="text-sm text-ink-mute mt-1">{t('login.tagline')}</div>
            </div>
          </div>
          <p className="mt-8 text-xl leading-relaxed text-ink-soft max-w-lg">{t('login.pitch')}</p>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {['Bio-Twin', 'Early Warning', 'Rescue Window', 'Mission Link'].map((x) => (
              <div key={x} className="panel-flat px-3 py-2 text-ink-soft">{x}</div>
            ))}
          </div>
          <p className="mt-6 text-xs text-ink-faint max-w-lg">NASA Space Apps Challenge 2026 · “Create Health Monitoring Software for Astronauts on Space Missions”. {t('shell.disclaimer')}.</p>
        </div>
        <form onSubmit={submit} className="panel p-6 sm:p-7 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">{t('shell.demoMode')}</h1>
            <div className="flex rounded-lg border border-line overflow-hidden text-xs" role="group" aria-label={t('st.language')}>
              {(['en', 'pt'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                  className={`px-3 py-1 cursor-pointer ${lang === l ? 'bg-violet/25 text-ink' : 'text-ink-mute'}`}>{l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <Notice tone="sim">{t('login.notice')}</Notice>
          <Field label={t('login.name')}>
            <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('login.role')}>
            <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}` as Key)}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input type="checkbox" checked={guided} onChange={(e) => setG(e.target.checked)} className="accent-violet size-4" />
            {t('login.guided')}
          </label>
          {err && <Notice tone="crit" icon="warning">{err}</Notice>}
          <Button type="submit" variant="primary" className="w-full py-2.5!" disabled={busy} icon="arrow">{busy ? '…' : t('login.enter')}</Button>
        </form>
      </div>
    </div>
  )
}
