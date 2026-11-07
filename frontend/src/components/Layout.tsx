import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { apiSend } from '../api/client'
import type { MissionStatus } from '../api/types'
import { useI18n, type Key } from '../i18n'
import { ago, useApi, useConnection } from '../lib'
import { useApp } from '../state'
import { GuidedDemo } from './GuidedDemo'
import { BiText, Button, cx, Icon, LevelPill, Logo } from './ui'

export const NAV: { to: string; key: string; icon: string }[] = [
  { to: '/', key: 'mission', icon: 'mission' },
  { to: '/bio-twin', key: 'biotwin', icon: 'biotwin' },
  { to: '/vital-scan', key: 'vitalscan', icon: 'vitalscan' },
  { to: '/early-warning', key: 'warning', icon: 'warning' },
  { to: '/rescue-window', key: 'rescue', icon: 'rescue' },
  { to: '/environment', key: 'environment', icon: 'environment' },
  { to: '/mission-link', key: 'link', icon: 'link' },
  { to: '/settings', key: 'settings', icon: 'settings' },
]

export function Layout() {
  const { t, lang, setLang } = useI18n()
  const { session, logout, guided, setGuided, setGuidedStep, revision, bump } = useApp()
  const conn = useConnection()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const mission = useApi<MissionStatus>('/api/mission', 20000, revision)
  useEffect(() => {
    setOpen(false)
    if (!loc.hash) window.scrollTo({ top: 0 })
  }, [loc.pathname, loc.hash])
  const m = mission.data
  const hasRescue = (m?.active_emergencies.length ?? 0) > 0

  const endSim = async () => {
    await apiSend('/api/scenarios/reset', 'POST')
    bump()
  }

  return (
    <div className="orbita-backdrop min-h-screen flex">
      {/* Sidebar */}
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-[248px] bg-space-950/95 backdrop-blur border-r border-line flex flex-col transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')} aria-label="Main navigation">
        <div className="px-5 pt-5 pb-4 flex items-center gap-3">
          <Logo size={34} />
          <div>
            <div className="font-semibold tracking-[0.28em] text-[15px]">ORBITA</div>
            <div className="text-[10px] text-ink-mute tracking-wider uppercase">Health Intelligence</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-0.5">
          {NAV.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-3 py-2.5 border transition',
                isActive ? 'bg-gradient-to-r from-violet/20 to-electric/5 border-violet/40 text-ink' : 'border-transparent text-ink-soft hover:bg-space-850 hover:text-ink')}>
              <span className="num text-[10px] text-ink-faint w-4">{String(i + 1).padStart(2, '0')}</span>
              <Icon name={n.icon} size={17} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-tight">{t(`nav.${n.key}` as Key)}</span>
                <span className="block text-[10.5px] text-ink-faint leading-tight mt-0.5">{t(`nav.sub.${n.key}` as Key)}</span>
              </span>
              {n.key === 'rescue' && hasRescue && <span className="size-2 rounded-full bg-crit pulse-dot" aria-label="active" />}
              {n.key === 'warning' && (m?.active_alerts.length ?? 0) > 0 && (
                <span className="num text-[10px] rounded bg-warn/15 text-warn px-1.5">{m?.active_alerts.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-line space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-mute">{t('shell.demoMode')}</span>
            <span className="text-ink-soft truncate max-w-[130px]" title={session?.name}>{session?.name}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={guided ? 'primary' : 'subtle'} icon="flag" className="flex-1"
              onClick={() => { if (!guided) setGuidedStep(0); setGuided(!guided) }}>{t('shell.guided')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setLang(lang === 'en' ? 'pt' : 'en')} aria-label="Language">{lang === 'en' ? 'PT' : 'EN'}</Button>
          </div>
          <button type="button" onClick={() => void logout()} className="text-[11px] text-ink-faint hover:text-ink-soft cursor-pointer">{t('shell.logout')}</button>
        </div>
      </aside>
      {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 min-w-0 lg:pl-[248px] flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-void/80 backdrop-blur border-b border-line">
          <div className="flex items-center gap-3 px-4 sm:px-6 h-14">
            <button type="button" className="lg:hidden p-1.5 -ml-1.5 text-ink-soft cursor-pointer" onClick={() => setOpen(true)} aria-label={t('shell.menu')}>
              <Icon name="menu" size={22} />
            </button>
            <div className="flex items-center gap-2 lg:hidden"><Logo size={22} /><span className="font-semibold tracking-[0.25em] text-sm">ORBITA</span></div>
            <div className="hidden lg:flex items-center gap-3 text-xs text-ink-mute min-w-0">
              {m && <span className="truncate">{m.mission.name} · <span className="text-ink-soft">{t('mc.day')} <span className="num">{m.mission.day}</span>/{m.mission.planned_duration_days}</span></span>}
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {m && <LevelPill level={m.overall_status} size="sm" />}
              <span className={cx('hidden sm:inline-flex items-center gap-1.5 text-[11px]', conn.reachable && !conn.forcedOffline ? 'text-ok' : 'text-warn')}>
                <span className={cx('size-1.5 rounded-full', conn.reachable && !conn.forcedOffline ? 'bg-ok' : 'bg-warn pulse-dot')} />
                {conn.reachable && !conn.forcedOffline ? 'ONLINE' : 'OFFLINE'}
              </span>
              {m && (
                <NavLink to="/mission-link" className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-ink-mute hover:text-ink">
                  <Icon name="satellite" size={14} />
                  {t(`link.${m.link.status}` as Key)} · {t('mc.lastSync')}: {m.last_sync_at ? ago(m.last_sync_at, lang) : t('mc.never')}
                </NavLink>
              )}
            </div>
          </div>
          {(!conn.reachable || conn.forcedOffline) && (
            <div className="bg-warn/10 border-t border-warn/30 text-warn text-xs px-4 sm:px-6 py-1.5 flex flex-wrap gap-x-3">
              <span>{conn.forcedOffline ? t('shell.forced') : t('shell.offline')}{conn.lastOkAt && ` · ${ago(conn.lastOkAt, lang)}`}</span>
              {conn.outbox > 0 && <span>· {conn.outbox} {t('shell.queued')}</span>}
            </div>
          )}
          {m?.scenario.active && (
            <div className="bg-sim/10 border-t border-sim/30 text-sim text-xs px-4 sm:px-6 py-1.5 flex flex-wrap items-center gap-3">
              <span className="font-semibold tracking-wider">{t('shell.simActive')}</span>
              <span className="text-ink-soft"><BiText v={m.scenario.title} /></span>
              <button type="button" onClick={() => void endSim()} className="ml-auto underline underline-offset-2 hover:text-ink cursor-pointer">{t('shell.resetSim')}</button>
            </div>
          )}
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </main>
        <footer className="px-4 sm:px-6 py-4 text-[11px] text-ink-faint border-t border-line-soft">
          {t('shell.disclaimer')}
        </footer>
      </div>
      {guided && <GuidedDemo />}
    </div>
  )
}
