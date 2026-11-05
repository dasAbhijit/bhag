import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthState>({ session: null, user: null, loading: true, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }),
    [session, loading],
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

const NEXT_KEY = 'bhag:next'
/** Remember where to go after sign-in (an invite link, for example). */
export function rememberNext(path: string) {
  try {
    localStorage.setItem(NEXT_KEY, path)
  } catch {
    /* storage can be blocked; the user just lands on the home page */
  }
}
export function takeNext(): string | null {
  try {
    const v = localStorage.getItem(NEXT_KEY)
    localStorage.removeItem(NEXT_KEY)
    return v
  } catch {
    return null
  }
}
