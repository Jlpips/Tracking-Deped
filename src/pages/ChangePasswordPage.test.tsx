import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import { makeAuth, makeProfile } from '@/test/auth'

const sb = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signInWithPassword: sb.signInWithPassword, updateUser: sb.updateUser },
    rpc: sb.rpc,
  },
}))
vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/change-password']}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/records" element={<h1>Records page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password and continue' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ must_change_password: true }) }))
})

describe('ChangePasswordPage', () => {
  it('names the account being set up', () => {
    renderPage()
    expect(screen.getByText('108874')).toBeInTheDocument()
    expect(screen.getByText('At least 8 characters, with a letter and a number.')).toBeInTheDocument()
  })

  it('rejects a weak password', async () => {
    renderPage()
    fill('Temp-1234', 'abcdefgh', 'abcdefgh')
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters, with a letter and a number')
    expect(sb.updateUser).not.toHaveBeenCalled()
  })

  it('rejects a mismatched confirmation', async () => {
    renderPage()
    fill('Temp-1234', 'newpass123', 'newpass124')
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
  })

  it('rejects reusing the temporary password', async () => {
    renderPage()
    fill('newpass123', 'newpass123', 'newpass123')
    expect(await screen.findByRole('alert')).toHaveTextContent('different from your temporary password')
  })

  it('reports a wrong temporary password', async () => {
    sb.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } })
    renderPage()
    fill('Wrong-111', 'newpass123', 'newpass123')
    expect(await screen.findByRole('alert')).toHaveTextContent('Your temporary password is not correct.')
    expect(sb.updateUser).not.toHaveBeenCalled()
  })

  it('updates the password, clears the flag, refreshes and goes to /records', async () => {
    const auth = makeAuth({ profile: makeProfile({ must_change_password: true }) })
    mockUseAuth.mockReturnValue(auth)
    sb.signInWithPassword.mockResolvedValue({ data: {}, error: null })
    sb.updateUser.mockResolvedValue({ data: {}, error: null })
    sb.rpc.mockResolvedValue({ data: null, error: null })
    renderPage()
    fill('Temp-1234', 'newpass123', 'newpass123')
    expect(await screen.findByText('Records page')).toBeInTheDocument()
    expect(sb.signInWithPassword).toHaveBeenCalledWith({ email: '108874@dts.local', password: 'Temp-1234' })
    expect(sb.updateUser).toHaveBeenCalledWith({ password: 'newpass123' })
    expect(sb.rpc).toHaveBeenCalledWith('complete_password_change')
    await waitFor(() => expect(auth.refreshProfile).toHaveBeenCalled())
  })
})
