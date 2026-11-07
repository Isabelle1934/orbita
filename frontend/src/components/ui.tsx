import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Bi, Level } from '../api/types'
import { useI18n } from '../i18n'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="9" fill="none" stroke="#eef1ff" strokeWidth="3" />
      <ellipse cx="32" cy="32" rx="25" ry="10" fill="none" stroke="#7c5cff" strokeWidth="2.5" transform="rotate(-28 32 32)" />
      <circle cx="53" cy="21" r="3.8" fill="#38bdf8" />
    </svg>
  )
}

const ICONS: Record<string, string> = {
  mission: 'M3 12h4l3-8 4 16 3-8h4',
  biotwin: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 18c0-3.9 3.1-7 7-7s7 3.1 7 7',
  vitalscan: 'M2 12h4l2-5 4 10 2-5h8',
  warning: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.5',
  rescue: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  environment: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z',
  link: 'M4 18a12 12 0 0 1 16 0M7 14.5a7 7 0 0 1 10 0M12 11v0M12 18v.01',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3-2.1.7a6 6 0 0 1-.6 1.5l1 2-1.4 1.4-2-1a6 6 0 0 1-1.5.6L12.7 20h-1.4l-.7-2.1a6 6 0 0 1-1.5-.6l-2 1-1.4-1.4 1-2a6 6 0 0 1-.6-1.5L4 12.7v-1.4l2.1-.7a6 6 0 0 1 .6-1.5l-1-2 1.4-1.4 2 1a6 6 0 0 1 1.5-.6L11.3 4h1.4l.7 2.1a6 6 0 0 1 1.5.6l2-1 1.4 1.4-1 2a6 6 0 0 1 .6 1.5L20 11.3Z',
  play: 'M7 4v16l13-8L7 4Z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12M18 6 6 18',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  satellite: 'M4 20l5-5m-1-6 7 7M13 4l7 7-3 3-7-7 3-3ZM5 13l6 6',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-9v.5',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
}

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] || ICONS.info} />
    </svg>
  )
}

export function Panel({ title, right, children, className, id, sub }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string; sub?: ReactNode }) {
  return (
    <section id={id} className={cx('panel p-4 sm:p-5 min-w-0', className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">{title}</h2>}
            {sub && <p className="text-xs text-ink-mute mt-1">{sub}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, right, kicker }: { title: string; subtitle?: string; right?: ReactNode; kicker?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {kicker && <div className="label-caps text-violet-soft! mb-1">{kicker}</div>}
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-mute mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle' | 'warn'
export function Button({ variant = 'subtle', className, children, icon, size = 'md', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string; size?: 'sm' | 'md' }) {
  const v: Record<Variant, string> = {
    primary: 'bg-gradient-to-r from-violet to-electric text-white border-transparent hover:brightness-110',
    subtle: 'bg-space-800 text-ink border-line hover:border-violet/60',
    ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-space-800',
    danger: 'bg-crit/15 text-crit border-crit/40 hover:bg-crit/25',
    warn: 'bg-warn/15 text-warn border-warn/40 hover:bg-warn/25',
  }
  return (
    <button type="button" {...p}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', v[variant], className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  )
}

export function LevelPill({ level, size = 'md', label = true }: { level: Level; size?: 'sm' | 'md' | 'lg'; label?: boolean }) {
  const { t } = useI18n()
  const c = { GREEN: 'text-ok border-ok/40 bg-ok/10', YELLOW: 'text-warn border-warn/40 bg-warn/10', RED: 'text-crit border-crit/50 bg-crit/15' }[level]
  const dot = { GREEN: 'bg-ok', YELLOW: 'bg-warn', RED: 'bg-crit pulse-dot' }[level]
  const s = { sm: 'text-[10px] px-2 py-0.5', md: 'text-xs px-2.5 py-1', lg: 'text-sm px-3 py-1.5' }[size]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wider uppercase whitespace-nowrap', c, s)}>
      <span className={cx('size-1.5 rounded-full', dot)} />
      {level}
      {label && <span className="font-medium normal-case tracking-normal opacity-80">· {t(`level.${level}`)}</span>}
    </span>
  )
}

export function OriginBadge({ origin, className }: { origin: string; className?: string }) {
  const { t } = useI18n()
  const m: Record<string, [string, string]> = {
    simulated: [t('common.simulated'), 'text-sim border-sim/40 bg-sim/10'],
    scenario: [t('common.scenario'), 'text-sim border-sim/50 bg-sim/15'],
    user: [t('common.user'), 'text-user border-user/40 bg-user/10'],
    live: [t('common.nasa'), 'text-nasa border-nasa/40 bg-nasa/10'],
    nasa: [t('common.nasa'), 'text-nasa border-nasa/40 bg-nasa/10'],
    sample: [t('common.sample'), 'text-warn border-warn/40 bg-warn/10'],
    cached: [t('common.cached'), 'text-ink-soft border-line bg-space-800'],
    offline: [t('common.sample'), 'text-warn border-warn/40 bg-warn/10'],
  }
  const [label, c] = m[origin] || [origin, 'text-ink-soft border-line']
  return <span className={cx('inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap', c, className)}>{label}</span>
}

export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'info' | 'violet'; className?: string }) {
  const c = {
    neutral: 'text-ink-soft border-line bg-space-800/60',
    ok: 'text-ok border-ok/30 bg-ok/10',
    warn: 'text-warn border-warn/30 bg-warn/10',
    crit: 'text-crit border-crit/40 bg-crit/10',
    info: 'text-cyan border-cyan/30 bg-cyan/10',
    violet: 'text-violet-soft border-violet/40 bg-violet/10',
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', c, className)}>{children}</span>
}

export function Stat({ label, value, sub, tone, children }: { label: string; value?: ReactNode; sub?: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className="panel-flat px-4 py-3 min-w-0">
      <div className="label-caps">{label}</div>
      {value !== undefined && <div className={cx('mt-1 text-2xl font-semibold num truncate', tone)}>{value}</div>}
      {sub && <div className="text-xs text-ink-mute mt-0.5 truncate">{sub}</div>}
      {children}
    </div>
  )
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: Error | null; onRetry?: () => void }) {
  const { t } = useI18n()
  if (loading) {
    return (
      <div className="flex items-center gap-3 text-ink-mute text-sm py-10 justify-center" role="status">
        <span className="size-2 rounded-full bg-violet pulse-dot" /> {t('common.loading')}
      </div>
    )
  }
  if (error) {
    return (
      <div className="panel-flat p-4 text-sm flex flex-wrap items-center gap-3 justify-between border-crit/40!" role="alert">
        <span className="text-crit">{error.message}</span>
        {onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>{t('common.retry')}</Button>}
      </div>
    )
  }
  return null
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-ink-mute py-6 text-center">{children}</div>
}

export function Notice({ children, tone = 'info', icon = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'crit' | 'sim'; icon?: string }) {
  const c = {
    info: 'border-cyan/25 bg-cyan/5 text-ink-soft',
    warn: 'border-warn/30 bg-warn/5 text-warn',
    crit: 'border-crit/40 bg-crit/10 text-crit',
    sim: 'border-sim/30 bg-sim/5 text-sim',
  }[tone]
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed', c)}>
      <Icon name={icon} size={16} className="shrink-0 mt-px" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function BiText({ v }: { v: Bi | null | undefined }) {
  const { tx } = useI18n()
  return <>{tx(v)}</>
}

export function ScoreBar({ score, yellow, red }: { score: number; yellow: number; red: number }) {
  const max = Math.max(red * 2, score + 2)
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  const color = score >= red ? 'bg-crit' : score >= yellow ? 'bg-warn' : 'bg-ok'
  return (
    <div className="relative h-2.5 rounded-full bg-space-950 border border-line overflow-hidden" role="img" aria-label={`score ${score}`}>
      <div className={cx('absolute inset-y-0 left-0 rounded-full', color)} style={{ width: pct(score) }} />
      <div className="absolute inset-y-0 w-px bg-warn/80" style={{ left: pct(yellow) }} />
      <div className="absolute inset-y-0 w-px bg-crit/90" style={{ left: pct(red) }} />
    </div>
  )
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs text-ink-soft mb-1">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-crit mt-1">{error}</span> : hint && <span className="block text-[11px] text-ink-faint mt-1">{hint}</span>}
    </label>
  )
}
