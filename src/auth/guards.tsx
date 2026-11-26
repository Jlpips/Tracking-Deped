import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ACCOUNT_DISABLED, useAuth } from '@/auth/AuthProvider'
import type { Role } from '@/lib/types'

export function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground" role="status">
      Loading…
    </div>
  )
}

/**
 * Signed-in, enabled users only. Users who must change their password are held on
 * /change-password until they do.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  // AuthProvider signs out disabled/missing profiles; this only covers the moment in between.
  if (!profile || profile.disabled) return <Navigate to="/login" replace state={{ notice: ACCOUNT_DISABLED }} />
  if (profile.must_change_password && pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <>{children ?? <Outlet />}</>
}

/** Use inside <RequireAuth>. Anyone without one of `roles` is sent to /records. */
export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { profile } = useAuth()
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/records" replace />
  return <>{children ?? <Outlet />}</>
}
