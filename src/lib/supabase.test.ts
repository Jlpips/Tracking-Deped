describe('supabase client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    await expect(import('./supabase')).rejects.toThrow(/VITE_SUPABASE_URL.*VITE_SUPABASE_PUBLISHABLE_KEY/)
  })
  it('creates a client from the env vars', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    const mod = await import('./supabase')
    expect(typeof mod.supabase.from).toBe('function')
  })
})
