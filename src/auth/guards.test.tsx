import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { AppRoutes } from '@/routes'
import { makeAuth, makeProfile } from '@/test/auth'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const mockUseAuth = vi.mocked(useAuth)

describe('route guards', () => {
  it('sends a signed-out visitor to /login', () => {
    mockUseAuth.mockReturnValue(makeAuth({ session: null, profile: null }))
    renderAt('/records')
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('forces a password change before any other page', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ must_change_password: true }) }))
    renderAt('/records')
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/change-password')
  })

  it('redirects / to /records', () => {
    mockUseAuth.mockReturnValue(makeAuth())
    renderAt('/')
    expect(screen.getByTestId('where')).toHaveTextContent('/records')
  })

  it('keeps a school user out of admin pages', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'user' }) }))
    renderAt('/admin/users')
    expect(screen.getByTestId('where')).toHaveTextContent('/records')
    expect(screen.getByRole('heading', { name: 'Records' })).toBeInTheDocument()
  })

  it('keeps an admin out of system pages', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'admin', school_id: null, school: null }) }))
    renderAt('/system/logs')
    expect(screen.getByTestId('where')).toHaveTextContent('/records')
  })

  it('lets an admin open admin pages', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'admin', school_id: null, school: null }) }))
    renderAt('/admin/schools')
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/schools')
  })

  it('lets a superadmin open system pages', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'superadmin', school_id: null, school: null }) }))
    renderAt('/system/backup')
    expect(screen.getByTestId('where')).toHaveTextContent('/system/backup')
  })

  it('sends a signed-in session without a usable profile to /login with the disabled message', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: null }))
    renderAt('/records')
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
    expect(screen.getByText('Your account is disabled. Contact the district office.')).toBeInTheDocument()
  })
})

describe('AppShell sidebar', () => {
  it('shows a school user only Records, with their school', () => {
    mockUseAuth.mockReturnValue(makeAuth())
    renderAt('/records')
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('Records')
    expect(nav).not.toHaveTextContent('Users')
    expect(screen.getByText('School User 1')).toBeInTheDocument()
    expect(screen.getByText('Calantas ES')).toBeInTheDocument()
  })

  it('shows an admin the Admin group but not System', () => {
    mockUseAuth.mockReturnValue(
      makeAuth({ profile: makeProfile({ role: 'admin', full_name: 'District Admin', school_id: null, school: null }) }),
    )
    renderAt('/records')
    expect(screen.getByRole('link', { name: /Users/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Schools/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Document types/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Activity logs/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('District Admin').length).toBeGreaterThan(0)
  })

  it('shows a superadmin both groups', () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'superadmin', school_id: null, school: null }) }))
    renderAt('/records')
    expect(screen.getByRole('link', { name: /Users/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Activity logs/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Backup/ })).toBeInTheDocument()
  })

  it('logs out from the who-am-I block', () => {
    const auth = makeAuth()
    mockUseAuth.mockReturnValue(auth)
    renderAt('/records')
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })
})
