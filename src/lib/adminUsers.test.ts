import { FunctionsHttpError } from '@supabase/supabase-js'
import { callAdminUsers } from '@/lib/adminUsers'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const invoke = vi.mocked(supabase.functions.invoke)

beforeEach(() => invoke.mockReset())

describe('callAdminUsers', () => {
  it('invokes admin-users with the body and returns data', async () => {
    invoke.mockResolvedValue({ data: { username: 'x', temp_password: 'p' }, error: null } as never)
    await expect(callAdminUsers({ action: 'reset_password', user_id: 'u1' })).resolves.toEqual({
      username: 'x',
      temp_password: 'p',
    })
    expect(invoke).toHaveBeenCalledWith('admin-users', { body: { action: 'reset_password', user_id: 'u1' } })
  })

  it("surfaces the function's JSON error message", async () => {
    const res = new Response(JSON.stringify({ error: 'That username is already taken.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(res) } as never)
    await expect(
      callAdminUsers({ action: 'create', username: 'a', full_name: 'A', role: 'admin' }),
    ).rejects.toThrow('That username is already taken.')
  })

  it('falls back to a generic message when the error has no JSON body', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response('oops', { status: 500 })) } as never)
    await expect(callAdminUsers({ action: 'reset_password', user_id: 'u1' })).rejects.toThrow(/try again/i)
  })
})
