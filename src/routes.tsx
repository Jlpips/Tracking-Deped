import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireRole } from '@/auth/guards'
import AppShell from '@/components/AppShell'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import LoginPage from '@/pages/LoginPage'
import RecordsPage from '@/pages/RecordsPage'

// Admin and system pages are loaded on demand, so school users download less.
const DocumentTypesPage = lazy(() => import('@/pages/admin/DocumentTypesPage'))
const SchoolsPage = lazy(() => import('@/pages/admin/SchoolsPage'))
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'))
const ActivityLogsPage = lazy(() => import('@/pages/system/ActivityLogsPage'))
const BackupPage = lazy(() => import('@/pages/system/BackupPage'))

/** Keeps the app shell visible while a lazily loaded page downloads. */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>{children}</Suspense>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/records" replace />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route element={<RequireRole roles={['admin', 'superadmin']} />}>
          <Route
            path="/admin/users"
            element={
              <Lazy>
                <UsersPage />
              </Lazy>
            }
          />
          <Route
            path="/admin/schools"
            element={
              <Lazy>
                <SchoolsPage />
              </Lazy>
            }
          />
          <Route
            path="/admin/document-types"
            element={
              <Lazy>
                <DocumentTypesPage />
              </Lazy>
            }
          />
        </Route>
        <Route element={<RequireRole roles={['superadmin']} />}>
          <Route
            path="/system/logs"
            element={
              <Lazy>
                <ActivityLogsPage />
              </Lazy>
            }
          />
          <Route
            path="/system/backup"
            element={
              <Lazy>
                <BackupPage />
              </Lazy>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/records" replace />} />
    </Routes>
  )
}
