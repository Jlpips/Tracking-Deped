import { act, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/AuthProvider'

const sb = vi.hoisted(() => {
  const state: { listener: ((event: string, session: unknown) => void) | null; session: unknown } = {
    listener: null,
    session: null,
  }
  return {
    state,
    getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      state.listener = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(async () => {
      state.session = null
      state.listener?.('SIGNED_OUT', null)
      return { error: null }
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(),
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: sb.getSession,
      onAuthStateChange: sb.onAuthStateChange,
      signInWithPassword: sb.signInWithPassword,
      signOut: sb.signOut,
    },
    rpc: sb.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: sb.maybeSingle }) }) }),
  },
}))

let ctx: AuthContextValue
function Probe() {
  ctx = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="profile">{ctx.profile?.full_name ?? 'none'}</span>
      <span data-testid="notice">{ctx.notice ?? ''}</span>
    </div>
  )
}

const session = { user: { id: 'u1' } }
const profileRow = {
  user_id: 'u1',
  username: '108874',
  full_name: 'School User 1',
  role: 'user',
  school_id: 's1',
  must_change_password: false,
  disabled: false,
  school: { id: 's1', name: 'Calantas ES' },
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sb.state.session = null
  sb.state.listener = null
})

describe('AuthProvider', () => {
  it('signIn rejects with the generic message and logs the failed attempt', async () => {
    sb.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await expect(ctx.signIn('108874', 'bad')).rejects.toThrow('Wrong username or password.')
    expect(sb.signInWithPassword).toHaveBeenCalledWith({ email: '108874@dts.local', password: 'bad' })
    expect(sb.rpc).toHaveBeenCalledWith('log_failed_login', { p_username: '108874' })
  })

  it('still rejects with the generic message when log_failed_login itself fails', async () => {
    sb.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } })
    sb.rpc.mockRejectedValueOnce(new Error('network'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await expect(ctx.signIn('108874', 'bad')).rejects.toThrow('Wrong username or password.')
  })

  it('signIn with an invalid username fails without calling Supabase auth', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await expect(ctx.signIn('bad user!', 'x')).rejects.toThrow('Wrong username or password.')
    expect(sb.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signIn success logs the login and loads the profile', async () => {
    sb.signInWithPassword.mockImplementation(async () => {
      sb.state.session = session
      sb.state.listener?.('SIGNED_IN', session)
      return { data: { session }, error: null }
    })
    sb.maybeSingle.mockResolvedValue({ data: profileRow, error: null })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await act(() => ctx.signIn('108874', 'good'))
    expect(sb.rpc).toHaveBeenCalledWith('log_activity', { p_action: 'login' })
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('School User 1'))
  })

  it('signs out a disabled account and sets the notice', async () => {
    sb.state.session = session
    sb.maybeSingle.mockResolvedValue({ data: { ...profileRow, disabled: true }, error: null })
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('notice')).toHaveTextContent('Your account is disabled. Contact the district office.'),
    )
    expect(sb.signOut).toHaveBeenCalled()
    expect(screen.getByTestId('profile')).toHaveTextContent('none')
  })

  it('signOut logs the logout before signing out', async () => {
    sb.state.session = session
    sb.maybeSingle.mockResolvedValue({ data: profileRow, error: null })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('School User 1'))
    await act(() => ctx.signOut())
    expect(sb.rpc).toHaveBeenCalledWith('log_activity', { p_action: 'logout' })
    expect(sb.rpc.mock.invocationCallOrder[0]).toBeLessThan(sb.signOut.mock.invocationCallOrder[0])
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('none'))
  })
})
