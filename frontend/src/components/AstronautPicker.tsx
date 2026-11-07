import type { Astronaut } from '../api/types'
import { useI18n } from '../i18n'
import { useApi } from '../lib'
import { useApp } from '../state'
import { cx } from './ui'

export function useCrew() {
  return useApi<Astronaut[]>('/api/astronauts')
}

export function AstronautPicker({ className }: { className?: string }) {
  const { t } = useI18n()
  const { astronautId, setAstronautId } = useApp()
  const crew = useCrew()
  const list = crew.data?.filter((a) => a.active) ?? []
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)} role="radiogroup" aria-label={t('common.select')}>
      {list.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={a.id === astronautId} onClick={() => setAstronautId(a.id)}
          className={cx('rounded-lg border px-3 py-1.5 text-left transition cursor-pointer',
            a.id === astronautId ? 'border-violet/60 bg-violet/15 text-ink' : 'border-line bg-space-900 text-ink-soft hover:border-violet/40')}>
          <span className="num text-[10px] text-ink-mute block leading-none">{a.code}</span>
          <span className="text-sm font-medium">{a.name}</span>
        </button>
      ))}
    </div>
  )
}
