import { render, screen } from '@testing-library/react'
import App from './App'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

describe('App', () => {
  it('shows the sign-in screen when nobody is signed in', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getAllByText('DTS Tracker').length).toBeGreaterThan(0)
  })
})
