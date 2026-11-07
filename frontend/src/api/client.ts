// ORBITA API client with local persistence for offline operation (MISSION LINK).
// - Every successful GET is cached in localStorage; when the onboard server is unreachable the cache is served.
// - Selected writes (manual entries, RESCUE WINDOW actions) are queued in a local outbox and replayed later.

const TOKEN_KEY = 'orbita.token'
const CACHE_PREFIX = 'orbita.cache:'
const OUTBOX_KEY = 'orbita.outbox'
const FORCE_OFFLINE_KEY = 'orbita.forceOffline'

export class ApiError extends Error {
  status: number
  code: string
  errors: { field: string; message: string }[]
  constructor(status: number, code: string, message: string, errors: { field: string; message: string }[] = []) {
    super(message)
    this.status = status
    this.code = code
    this.errors = errors
  }
}

export class OfflineError extends Error {
  constructor() {
    super('ORBITA server unreachable')
  }
}

export interface OutboxItem {
  id: string
  path: string
  method: string
  body: unknown
  queuedAt: string
  label: string
}

type ConnState = { reachable: boolean; lastOkAt: string | null; forcedOffline: boolean; outbox: number; servedFromCache: boolean }

let conn: ConnState = {
  reachable: true,
  lastOkAt: null,
  forcedOffline: safeGet(FORCE_OFFLINE_KEY) === '1',
  outbox: readOutbox().length,
  servedFromCache: false,
}
const listeners = new Set<(s: ConnState) => void>()
let unauthorizedHandler: (() => void) | null = null

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage full or blocked: caching is best effort */
  }
}

function setConn(p: Partial<ConnState>) {
  conn = { ...conn, ...p }
  listeners.forEach((l) => l(conn))
}

export const connection = {
  get: () => conn,
  subscribe(fn: (s: ConnState) => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  setForcedOffline(v: boolean) {
    safeSet(FORCE_OFFLINE_KEY, v ? '1' : '0')
    setConn({ forcedOffline: v, reachable: v ? false : conn.reachable })
    if (!v) void flushOutbox()
  },
}

export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn
}

export const token = {
  get: () => safeGet(TOKEN_KEY),
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

export function readCache<T>(path: string): { at: string; data: T } | null {
  const raw = safeGet(CACHE_PREFIX + path)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function cacheInventory(): { path: string; at: string; bytes: number }[] {
  const out: { path: string; at: string; bytes: number }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!k.startsWith(CACHE_PREFIX)) continue
      const v = localStorage.getItem(k) || ''
      try {
        out.push({ path: k.slice(CACHE_PREFIX.length), at: JSON.parse(v).at, bytes: v.length })
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

function readOutbox(): OutboxItem[] {
  try {
    return JSON.parse(safeGet(OUTBOX_KEY) || '[]')
  } catch {
    return []
  }
}
function writeOutbox(items: OutboxItem[]) {
  safeSet(OUTBOX_KEY, JSON.stringify(items))
  setConn({ outbox: items.length })
}
export const outbox = { list: readOutbox }

async function raw(path: string, method: string, body?: unknown): Promise<Response> {
  if (conn.forcedOffline) throw new OfflineError()
  const headers: Record<string, string> = { Accept: 'application/json' }
  const t = token.get()
  if (t) headers.Authorization = `Bearer ${t}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new OfflineError()
  }
}

// The dev proxy / reverse proxy answers 5xx without a JSON body when the API process is down.
function proxyDown(res: Response): boolean {
  return res.status >= 500 && !(res.headers.get('content-type') || '').includes('json')
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler()
    const d = json?.detail
    if (typeof d === 'object' && d) throw new ApiError(res.status, d.code || 'ERROR', d.message || 'Error', d.errors || [])
    throw new ApiError(res.status, 'ERROR', typeof d === 'string' ? d : `HTTP ${res.status}`)
  }
  return json as T
}

export interface GetResult<T> {
  data: T
  fromCache: boolean
  cachedAt: string | null
}

export async function apiGet<T>(path: string): Promise<GetResult<T>> {
  try {
    const res = await raw(path, 'GET')
    if (proxyDown(res)) throw new OfflineError()
    const data = await parse<T>(res)
    const at = new Date().toISOString()
    safeSet(CACHE_PREFIX + path, JSON.stringify({ at, data }))
    const wasDown = !conn.reachable
    setConn({ reachable: true, lastOkAt: at, servedFromCache: false })
    if (wasDown) void flushOutbox()
    return { data, fromCache: false, cachedAt: at }
  } catch (e) {
    if (e instanceof OfflineError) {
      setConn({ reachable: false, servedFromCache: true })
      const c = readCache<T>(path)
      if (c) return { data: c.data, fromCache: true, cachedAt: c.at }
    }
    throw e
  }
}

export async function apiSend<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await raw(path, method, body)
  if (proxyDown(res)) {
    setConn({ reachable: false })
    throw new OfflineError()
  }
  const out = await parse<T>(res)
  setConn({ reachable: true, lastOkAt: new Date().toISOString() })
  return out
}

/** Write that is queued locally when the server cannot be reached. Returns {queued:true} in that case. */
export async function apiSendOrQueue<T>(path: string, method: 'POST' | 'PUT', body: unknown, label: string): Promise<T | { queued: true }> {
  try {
    return await apiSend<T>(path, method, body)
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e
    const items = readOutbox()
    items.push({ id: crypto.randomUUID(), path, method, body, label, queuedAt: new Date().toISOString() })
    writeOutbox(items)
    return { queued: true }
  }
}

let flushing = false
export async function flushOutbox(): Promise<number> {
  if (flushing || conn.forcedOffline) return 0
  flushing = true
  let sent = 0
  try {
    let items = readOutbox()
    while (items.length) {
      const it = items[0]
      try {
        await apiSend(it.path, it.method as 'POST', it.body)
      } catch (e) {
        if (e instanceof OfflineError) break
        // A permanently rejected item (e.g. event already resolved) is dropped so it cannot block the queue.
      }
      items = items.slice(1)
      writeOutbox(items)
      sent++
    }
  } finally {
    flushing = false
  }
  return sent
}
