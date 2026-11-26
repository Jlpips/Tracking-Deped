import type { Session } from '@supabase/supabase-js'
import type { AuthContextValue, AuthProfile } from '@/auth/AuthProvider'

export function makeProfile(overrides: Partial<AuthProfile> = {}): AuthProfile {
  return {
    user_id: 'u1',
    username: '108874',
    full_name: 'School User 1',
    role: 'user',
    school_id: 's1',
    must_change_password: false,
    disabled: false,
    school: { id: 's1', name: 'Calantas ES' },
    ...overrides,
  }
}

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: { user: { id: 'u1' } } as unknown as Session,
    profile: makeProfile(),
    loading: false,
    notice: null,
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
