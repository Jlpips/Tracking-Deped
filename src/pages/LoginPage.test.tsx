import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import LoginPage from '@/pages/LoginPage'
import { makeAuth } from '@/test/auth'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  )
}

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('LoginPage', () => {
  it('shows the district-office help text', () => {
    mockUseAuth.mockReturnValue(makeAuth({ session: null, profile: null }))
    renderLogin()
    expect(screen.getByText(/Ask the district office to reset it/)).toBeInTheDocument()
    expect(screen.getByText('Know where every document is.')).toBeInTheDocument()
  })

  it('shows "Wrong username or password." when signIn rejects', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('Wrong username or password.'))
    mockUseAuth.mockReturnValue(makeAuth({ session: null, profile: null, signIn }))
    renderLogin()
    fillAndSubmit('108874', 'nope')
    expect(await screen.findByText('Wrong username or password.')).toBeInTheDocument()
    expect(signIn).toHaveBeenCalledWith('108874', 'nope')
  })

  it('shows the auth notice (e.g. disabled account)', () => {
    mockUseAuth.mockReturnValue(
      makeAuth({ session: null, profile: null, notice: 'Your account is disabled. Contact the district office.' }),
    )
    renderLogin()
    expect(screen.getByText('Your account is disabled. Contact the district office.')).toBeInTheDocument()
  })
})
