import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile, School } from '@/lib/types'
import { usernameToEmail } from '@/lib/username'

export const WRONG_CREDENTIALS = 'Wrong username or password.'
export const ACCOUNT_DISABLED = 'Your account is disabled. Contact the district office.'
export const PROFILE_LOAD_FAILED = 'Could not load your account. Check your connection and sign in again.'

/** The signed-in user's profile, with the school name for display. */
export type AuthProfile = Profile & { school?: School | null }

export interface AuthContextValue {
  session: Session | null
  profile: AuthProfile | null
  loading: boolean
  /** Message for the login page after a forced sign-out (e.g. disabled account). */
  notice: string | null
  signIn(username: string, password: string): Promise<void>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Fire-and-forget logging: audit RPC failures must never block sign-in/out. */
async function quietRpc(fn: string, args: Record<string, unknown>) {
  try {
    await supabase.rpc(fn, args)
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  // The profile together with the user id it was loaded for, so a stale profile is never shown.
  const [loaded, setLoaded] = useState<{ userId: string; profile: AuthProfile | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setSessionReady(true)
    })
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionReady(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, school:schools(id, name)')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data || (data as AuthProfile).disabled) {
      setLoaded({ userId, profile: null })
      setNotice(error ? PROFILE_LOAD_FAILED : ACCOUNT_DISABLED)
      await supabase.auth.signOut()
      return
    }
    setLoaded({ userId, profile: data as AuthProfile })
  }, [])

  const userId = session?.user.id ?? null
  useEffect(() => {
    if (userId) void loadProfile(userId)
  }, [userId, loadProfile])

  const signIn = useCallback(async (username: string, password: string) => {
    let email: string
    try {
      email = usernameToEmail(username)
    } catch {
      throw new Error(WRONG_CREDENTIALS)
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      await quietRpc('log_failed_login', { p_username: username.trim().toLowerCase() })
      throw new Error(WRONG_CREDENTIALS)
    }
    setNotice(null)
    await quietRpc('log_activity', { p_action: 'login' })
  }, [])

  const signOut = useCallback(async () => {
    await quietRpc('log_activity', { p_action: 'logout' })
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId)
  }, [userId, loadProfile])

  const current = userId !== null && loaded?.userId === userId ? loaded : null
  const profile = current?.profile ?? null
  const loading = !sessionReady || (userId !== null && current === null)

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, notice, signIn, signOut, refreshProfile }),
    [session, profile, loading, notice, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
