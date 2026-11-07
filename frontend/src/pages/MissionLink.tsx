import { useEffect, useState } from 'react'
import { apiSend, cacheInventory, clearCache, connection, flushOutbox, outbox, readCache } from '../api/client'
import type { Alert, Bi, LinkState, SyncRecord } from '../api/types'
import { Button, Chip, cx, Empty, Icon, LevelPill, LoadState, Notice, PageHeader, Panel } from '../components/ui'
import { useI18n, type Key } from '../i18n'
import { ago, duration, fmtTime, parseIso, useApi, useConnection, useNow } from '../lib'
import { useApp } from '../state'

const PRESETS = [
  { label: { en: 'Low Earth orbit (~0 s)', pt: 'Órbita baixa (~0 s)' }, s: 0 },
  { label: { en: 'Moon (~1.3 s)', pt: 'Lua (~1,3 s)' }, s: 1 },
  { label: { en: 'Mars, closest (~3 min)', pt: 'Marte, mais próximo (~3 min)' }, s: 180 },
  { label: { en: 'Mars, farthest (~22 min)', pt: 'Marte, mais distante (~22 min)' }, s: 1320 },
]

interface SyncState {
  link: LinkState
  records: SyncRecord[]
  last_sync_at: string | null
  pending_since_last_sync: Record<string, number>
  notice: Bi
}

export function MissionLink() {
  const { t, tx, lang } = useI18n()
  const conn = useConnection()
  const { revision, bump } = useApp()
  const [tick, setTick] = useState(0)
  const s = useApi<SyncState>('/api/sync', 4000, revision + tick)
  const now = useNow(1000)
  const [link, setLink] = useState<LinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [inv, setInv] = useState(cacheInventory())
  const cachedAlerts = readCache<Alert[]>('/api/alerts?limit=60')?.data ?? readCache<Alert[]>('/api/alerts?limit=100')?.data ?? []

  useEffect(() => {
    if (s.data && !link) setLink(s.data.link)
  }, [s.data, link])
  useEffect(() => setInv(cacheInventory()), [tick, conn.lastOkAt])

  const saveLink = async (l: LinkState) => {
    setLink(l)
    await apiSend('/api/sync/link', 'PUT', l)
    setTick((x) => x + 1)
    bump()
  }
  const syncNow = async () => {
    setBusy(true)
    try {
      await apiSend('/api/sync', 'POST')
      setTick((x) => x + 1)
    } finally {
      setBusy(false)
    }
  }
  const items = outbox.list()

  return (
    <div className="space-y-5">
      <PageHeader kicker={t('nav.sub.link')} title={t('ml.title')} subtitle={t('ml.subtitle')} />
      {s.data && <Notice>{tx(s.data.notice)}</Notice>}

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title={t('ml.server')}>
          <div className="flex items-center gap-3">
            <span className={cx('size-3 rounded-full', conn.reachable && !conn.forcedOffline ? 'bg-ok' : 'bg-warn pulse-dot')} />
            <span className="font-medium">{conn.reachable && !conn.forcedOffline ? t('ml.reachable') : t('ml.unreachable')}</span>
            {conn.lastOkAt && <span className="text-xs text-ink-mute ml-auto">{ago(conn.lastOkAt, lang, now)}</span>}
          </div>
          <label className="flex items-center gap-3 mt-4 text-sm cursor-pointer">
            <input type="checkbox" className="accent-violet size-4" checked={conn.forcedOffline} onChange={(e) => { connection.setForcedOffline(e.target.checked); setTick((x) => x + 1) }} />
            {t('ml.forceOffline')}
          </label>
          <p className="text-[11px] text-ink-faint mt-2">{lang === 'pt'
            ? 'Com o modo offline ativo, todas as telas usam o cache local deste navegador; ações da RESCUE WINDOW e medições manuais vão para a fila local.'
            : 'While offline mode is on, every screen uses this browser’s local cache; RESCUE WINDOW actions and manual measurements go to the local outbox.'}</p>

          <div className="mt-5">
            <div className="flex items-center justify-between"><span className="label-caps">{t('ml.outbox')}</span>
              {items.length > 0 && !conn.forcedOffline && <Button size="sm" icon="refresh" onClick={() => void flushOutbox().then(() => { setTick((x) => x + 1); bump() })}>{t('ml.syncNow')}</Button>}</div>
            {items.length === 0 ? <p className="text-xs text-ink-mute mt-2">{t('ml.outboxEmpty')}</p> : (
              <ul className="mt-2 space-y-1">{items.map((i) => <li key={i.id} className="text-xs flex justify-between gap-2"><span className="text-ink-soft truncate">{i.label}</span><span className="num text-ink-mute">{ago(i.queuedAt, lang, now)}</span></li>)}</ul>
            )}
          </div>
          <div className="mt-5">
            <div className="flex items-center justify-between"><span className="label-caps">{t('ml.cache')}</span>
              <Button size="sm" variant="ghost" onClick={() => { clearCache(); setInv([]) }}>{t('ml.clearCache')}</Button></div>
            <div className="text-xs text-ink-mute mt-1">{inv.length} {lang === 'pt' ? 'recursos' : 'resources'} · {(inv.reduce((a, b) => a + b.bytes, 0) / 1024).toFixed(0)} KB</div>
            <ul className="mt-2 max-h-40 overflow-y-auto scrollbar-thin text-[11px] space-y-0.5">
              {inv.slice(0, 30).map((c) => <li key={c.path} className="flex justify-between gap-2"><span className="num text-ink-soft truncate">{c.path}</span><span className="text-ink-faint whitespace-nowrap">{ago(c.at, lang, now)}</span></li>)}
            </ul>
          </div>
        </Panel>

        <Panel title={t('ml.earth')} right={<Icon name="satellite" />}>
          {!s.data || !link ? <LoadState loading={s.loading} error={s.error} onRetry={s.reload} /> : (
            <>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('ml.earth')}>
                {(['nominal', 'degraded', 'blackout'] as const).map((st) => (
                  <button key={st} type="button" role="radio" aria-checked={link.status === st} onClick={() => void saveLink({ ...link, status: st })}
                    className={cx('rounded-lg border px-2 py-2 text-xs cursor-pointer', link.status === st ? (st === 'blackout' ? 'border-crit/60 bg-crit/10 text-crit' : st === 'degraded' ? 'border-warn/60 bg-warn/10 text-warn' : 'border-ok/60 bg-ok/10 text-ok') : 'border-line text-ink-soft')}>
                    {t(`link.${st}` as Key)}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs"><span className="text-ink-soft">{t('ml.delay')}</span><span className="num">{duration(link.one_way_delay_s)}</span></div>
                <input type="range" min={0} max={1320} step={1} value={link.one_way_delay_s} className="w-full accent-violet mt-2" aria-label={t('ml.delay')}
                  onChange={(e) => setLink({ ...link, one_way_delay_s: Number(e.target.value) })} onMouseUp={() => void saveLink(link)} onTouchEnd={() => void saveLink(link)} onKeyUp={() => void saveLink(link)} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PRESETS.map((p) => <Button key={p.s} size="sm" variant="ghost" onClick={() => void saveLink({ ...link, one_way_delay_s: p.s })}>{tx(p.label)}</Button>)}
                </div>
                <p className="text-[10px] text-ink-faint mt-1">{lang === 'pt' ? 'Atrasos aproximados de propagação da luz (um trecho). Para a demo, use poucos segundos.' : 'Approximate one-way light-time delays. For the demo, use a few seconds.'}</p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" icon="refresh" disabled={busy} onClick={() => void syncNow()}>{t('ml.syncNow')}</Button>
                <span className="text-xs text-ink-mute">{t('mc.lastSync')}: <span className="text-ink">{s.data.last_sync_at ? `${fmtTime(s.data.last_sync_at, lang, true)} (${ago(s.data.last_sync_at, lang, now)})` : t('mc.never')}</span></span>
              </div>
              <div className="mt-4">
                <div className="label-caps mb-2">{t('ml.pending')}</div>
                <div className="flex flex-wrap gap-2">{Object.entries(s.data.pending_since_last_sync).map(([k, v]) => <Chip key={k}>{k.replace('_', ' ')} · <span className="num">{v}</span></Chip>)}</div>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel title={t('ml.records')}>
        {!s.data?.records.length ? <Empty>{t('mc.never')}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead><tr className="text-left label-caps"><th className="py-2 pr-3">#</th><th className="pr-3">{t('common.time')}</th><th className="pr-3">{t('common.status')}</th><th className="pr-3">{t('ml.eta')}</th><th className="pr-3">{t('ml.delay')}</th><th>Payload</th></tr></thead>
              <tbody>
                {s.data.records.map((r) => {
                  const eta = parseIso(r.eta_at)?.getTime()
                  return (
                    <tr key={r.id} className="border-t border-line-soft">
                      <td className="py-2 pr-3 num text-ink-mute">{r.id}</td>
                      <td className="pr-3 num text-xs whitespace-nowrap">{fmtTime(r.requested_at, lang, true)}</td>
                      <td className="pr-3"><Chip tone={r.status === 'delivered' ? 'ok' : r.status === 'queued' ? 'crit' : 'warn'}>{t(`sync.${r.status}` as Key)}</Chip></td>
                      <td className="pr-3 num text-xs">{r.status === 'in_transit' && eta ? `${duration(Math.max(0, (eta - now) / 1000))}` : r.completed_at ? fmtTime(r.completed_at, lang) : '—'}</td>
                      <td className="pr-3 num text-xs">{r.delay_s}s</td>
                      <td className="text-[11px] text-ink-mute">{Object.entries(r.items).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k}: ${v}`).join(' · ')}{r.note && <div className="text-ink-faint">{r.note}</div>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('ml.history')} sub={lang === 'pt' ? 'Lido do cache local deste dispositivo — disponível mesmo offline.' : 'Read from this device’s local cache — available even offline.'}>
        {cachedAlerts.length === 0 ? <Empty>{lang === 'pt' ? 'Abra o Early Warning ao menos uma vez para preencher o cache.' : 'Open Early Warning at least once to populate the cache.'}</Empty> : (
          <ul className="divide-y divide-line-soft">
            {cachedAlerts.slice(0, 20).map((a) => (
              <li key={a.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <LevelPill level={a.level} size="sm" label={false} /><span>{tx(a.title)}</span>
                <span className="text-xs text-ink-mute">· {a.astronaut_name ?? t('ew.environmentAlert')} · {a.status}</span>
                <span className="text-[11px] text-ink-faint ml-auto num">{fmtTime(a.created_at, lang, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
