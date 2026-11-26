import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { getCaller, HttpError, type CallerProfile } from './auth.ts'

const req = (auth?: string) =>
  new Request('http://x/fn', { method: 'POST', headers: auth ? { Authorization: auth } : {} })

const profile = (o: Partial<CallerProfile> = {}): CallerProfile => ({
  user_id: 'u1',
  username: 'macalelon-admin',
  role: 'admin',
  disabled: false,
  ...o,
})

function deps(p: CallerProfile | null, userId: string | null = 'u1') {
  const seen: string[] = []
  return {
    seen,
    verifyJwt: (jwt: string) => {
      seen.push(jwt)
      return Promise.resolve(userId)
    },
    loadProfile: (_id: string) => Promise.resolve(p),
  }
}

async function status401(p: Promise<unknown>) {
  const e = await assertRejects(() => p, HttpError)
  assertEquals((e as HttpError).status, 401)
}

Deno.test('getCaller: missing or malformed Authorization → 401', async () => {
  await status401(getCaller(req(), deps(profile())))
  await status401(getCaller(req('Basic abc'), deps(profile())))
})

Deno.test('getCaller: JWT that does not verify → 401', async () => {
  await status401(getCaller(req('Bearer bad'), deps(profile(), null)))
})

Deno.test('getCaller: missing or disabled profile → 401', async () => {
  await status401(getCaller(req('Bearer t'), deps(null)))
  await status401(getCaller(req('Bearer t'), deps(profile({ disabled: true }))))
})

Deno.test('getCaller: returns userId, role, username for a valid caller', async () => {
  const d = deps(profile({ role: 'user', username: '108874' }))
  assertEquals(await getCaller(req('Bearer tok'), d), { userId: 'u1', role: 'user', username: '108874' })
  assertEquals(d.seen, ['tok'])
})
