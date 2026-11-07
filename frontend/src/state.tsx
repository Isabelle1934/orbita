import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiSend, onUnauthorized, token } from './api/client'

interface Session {
  name: string
  role: string
}

interface AppState {
  session: Session | null
  login: (name: string, role: string) => Promise<void>
  logout: () => Promise<void>
  astronautId: number
  setAstronautId: (id: number) => void
  guided: boolean
  guidedStep: number
  setGuided: (v: boolean) => void
  setGuidedStep: (n: number) => void
  /** bumped after actions that change data, so views can refresh */
  revision: number
  bump: () => void
}

const Ctx = createContext<AppState | null>(null)

function read<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => (token.get() ? read<Session | null>('orbita.session', null) : null))
  const [astronautId, setAstronautIdState] = useState<number>(() => read('orbita.astronaut', 1))
  const [guided, setGuidedState] = useState<boolean>(() => read('orbita.guided', false))
  const [guidedStep, setGuidedStepState] = useState<number>(() => read('orbita.guidedStep', 0))
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    onUnauthorized(() => {
      token.set(null)
      setSession(null)
    })
  }, [])

  const login = useCallback(async (name: string, role: string) => {
    const r = await apiSend<{ token: string; name: string; role: string }>('/api/auth/demo', 'POST', { name, role })
    token.set(r.token)
    const s = { name: r.name, role: r.role }
    write('orbita.session', s)
    setSession(s)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiSend('/api/auth/logout', 'POST')
    } catch {
      /* offline logout is local only */
    }
    token.set(null)
    setSession(null)
  }, [])

  const value = useMemo<AppState>(
    () => ({
      session,
      login,
      logout,
      astronautId,
      setAstronautId: (id) => {
        setAstronautIdState(id)
        write('orbita.astronaut', id)
      },
      guided,
      guidedStep,
      setGuided: (v) => {
        setGuidedState(v)
        write('orbita.guided', v)
      },
      setGuidedStep: (n) => {
        setGuidedStepState(n)
        write('orbita.guidedStep', n)
      },
      revision,
      bump: () => setRevision((r) => r + 1),
    }),
    [session, login, logout, astronautId, guided, guidedStep, revision],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
