import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireRole } from '@/auth/guards'
import AppShell from '@/components/AppShell'
import DocumentTypesPage from '@/pages/admin/DocumentTypesPage'
import SchoolsPage from '@/pages/admin/SchoolsPage'
import UsersPage from '@/pages/admin/UsersPage'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import LoginPage from '@/pages/LoginPage'
import RecordsPage from '@/pages/RecordsPage'
import ActivityLogsPage from '@/pages/system/ActivityLogsPage'
import BackupPage from '@/pages/system/BackupPage'

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
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/schools" element={<SchoolsPage />} />
          <Route path="/admin/document-types" element={<DocumentTypesPage />} />
        </Route>
        <Route element={<RequireRole roles={['superadmin']} />}>
          <Route path="/system/logs" element={<ActivityLogsPage />} />
          <Route path="/system/backup" element={<BackupPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/records" replace />} />
    </Routes>
  )
}
