import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { HttpError } from '../_shared/auth.ts'
import { handler, StoreError, type AdminStore, type Deps, type ProfileRow } from './handler.ts'
import type { Caller } from './logic.ts'

const ADMIN: Caller = { userId: 'a0000000-0000-4000-8000-000000000001', role: 'admin', username: 'macalelon-admin' }
const SCHOOL = 'b0000000-0000-4000-8000-000000000001'
const T_USER = 'c0000000-0000-4000-8000-000000000001'
const T_SUPER = 'c0000000-0000-4000-8000-000000000002'
const T_MISSING = 'c0000000-0000-4000-8000-000000000003'

type Call = [string, ...unknown[]]

function makeStore(overrides: Partial<AdminStore> = {}) {
  const calls: Call[] = []
  const profiles = new Map<string, ProfileRow>([
    [
      T_USER,
      {
        user_id: T_USER,
        username: '108870',
        full_name: 'School User 2',
        role: 'user',
        school_id: SCHOOL,
        disabled: false,
        must_change_password: false,
      },
    ],
    [
      T_SUPER,
      {
        user_id: T_SUPER,
        username: 'root',
        full_name: 'Superadmin',
        role: 'superadmin',
        school_id: null,
        disabled: false,
        must_change_password: false,
      },
    ],
    [
      ADMIN.userId,
      {
        user_id: ADMIN.userId,
        username: ADMIN.username,
        full_name: 'District Admin',
        role: 'admin',
        school_id: null,
        disabled: false,
        must_change_password: false,
      },
    ],
  ])
  const store: AdminStore = {
    getProfile: (id) => {
      calls.push(['getProfile', id])
      return Promise.resolve(profiles.get(id) ?? null)
    },
    usernameTaken: (u) => {
      calls.push(['usernameTaken', u])
      return Promise.resolve([...profiles.values()].some((p) => p.username === u))
    },
    createAuthUser: (email, password) => {
      calls.push(['createAuthUser', email, password])
      return Promise.resolve('new-user-id')
    },
    deleteAuthUser: (id) => {
      calls.push(['deleteAuthUser', id])
      return Promise.resolve()
    },
    updateAuthUser: (id, attrs) => {
      calls.push(['updateAuthUser', id, attrs])
      return Promise.resolve()
    },
    insertProfile: (row) => {
      calls.push(['insertProfile', row])
      return Promise.resolve()
    },
    updateProfile: (id, patch) => {
      calls.push(['updateProfile', id, patch])
      return Promise.resolve()
    },
    insertLog: (row) => {
      calls.push(['insertLog', row])
      return Promise.resolve()
    },
    ...overrides,
  }
  return { store, calls }
}

function deps(store: AdminStore, caller: Caller | Error = ADMIN): Deps {
  return {
    getCaller: () => (caller instanceof Error ? Promise.reject(caller) : Promise.resolve(caller)),
    store,
    newPassword: () => 'Abcd2345efgh',
  }
}

const post = (body: unknown) =>
  new Request('http://x/admin-users', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function call(d: Deps, body: unknown) {
  const res = await handler(post(body), d)
  return { status: res.status, json: await res.json(), res }
}

const names = (calls: Call[]) => calls.map((c) => c[0])
const authCalls = (calls: Call[]) => names(calls).filter((n) => n.endsWith('AuthUser'))

Deno.test('OPTIONS preflight returns CORS headers', async () => {
  const { store } = makeStore()
  const res = await handler(new Request('http://x/admin-users', { method: 'OPTIONS' }), deps(store))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
  assertStringIncludes(res.headers.get('Access-Control-Allow-Headers') ?? '', 'authorization')
  await res.body?.cancel()
})

Deno.test('non-POST → 405', async () => {
  const { store } = makeStore()
  const res = await handler(new Request('http://x/admin-users', { method: 'GET' }), deps(store))
  assertEquals(res.status, 405)
  await res.body?.cancel()
})

Deno.test('unauthenticated caller → 401, nothing touched', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store, new HttpError(401, 'Please sign in again.')), { action: 'reset_password', user_id: T_USER })
  assertEquals(r.status, 401)
  assertEquals(r.json.error, 'Please sign in again.')
  assertEquals(r.res.headers.get('Access-Control-Allow-Origin'), '*')
  assertEquals(calls, [])
})

Deno.test('invalid JSON → 400', async () => {
  const { store } = makeStore()
  const res = await handler(
    new Request('http://x/admin-users', { method: 'POST', body: '{nope', headers: { Authorization: 'Bearer t' } }),
    deps(store),
  )
  assertEquals(res.status, 400)
  await res.body?.cancel()
})

Deno.test('school user caller → 403 without loading the target', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store, { userId: 'x', role: 'user', username: '108874' }), {
    action: 'reset_password',
    user_id: T_USER,
  })
  assertEquals(r.status, 403)
  assertEquals(calls, [])
})

for (const body of [
  { action: 'update', user_id: T_SUPER, full_name: 'Hacked' },
  { action: 'reset_password', user_id: T_SUPER },
  { action: 'set_disabled', user_id: T_SUPER, disabled: true },
  { action: 'set_disabled', user_id: T_SUPER, disabled: false },
]) {
  Deno.test(`${body.action}${'disabled' in body ? ` (disabled: ${body.disabled})` : ''} on a superadmin target → 404, no auth/profile/log writes`, async () => {
    for (const caller of [ADMIN, { ...ADMIN, role: 'superadmin' as const }]) {
      const { store, calls } = makeStore()
      const r = await call(deps(store, caller), body)
      assertEquals(r.status, 404)
      assertEquals(r.json.error, 'User not found.')
      assertEquals(names(calls), ['getProfile'])
    }
  })
}

Deno.test('acting on a missing target → 404', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'reset_password', user_id: T_MISSING })
  assertEquals(r.status, 404)
  assertEquals(authCalls(calls), [])
})

Deno.test('create: auth user + profile (must_change_password) + log; returns temp password once', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), {
    action: 'create',
    username: ' 108871 ',
    full_name: ' School User 3 ',
    role: 'user',
    school_id: SCHOOL,
  })
  assertEquals(r.status, 200)
  assertEquals(r.json, { user_id: 'new-user-id', username: '108871', temp_password: 'Abcd2345efgh' })
  const create = calls.find((c) => c[0] === 'createAuthUser')!
  assertEquals(create.slice(1), ['108871@dts.local', 'Abcd2345efgh'])
  const insert = calls.find((c) => c[0] === 'insertProfile')!
  assertEquals(insert[1], {
    user_id: 'new-user-id',
    username: '108871',
    full_name: 'School User 3',
    role: 'user',
    school_id: SCHOOL,
    must_change_password: true,
    disabled: false,
  })
  const log = calls.find((c) => c[0] === 'insertLog')![1] as Record<string, unknown>
  assertEquals(log.action, 'user.create')
  assertEquals(log.user_id, ADMIN.userId)
  assertEquals(log.username, ADMIN.username)
  assertEquals(log.role, 'admin')
  const details = log.details as Record<string, unknown>
  assertEquals(details.user_id, 'new-user-id')
  assertEquals(details.username, '108871')
  assert(!JSON.stringify(log).includes('Abcd2345efgh'), 'log must not contain the password')
})

Deno.test('create admin stores school_id null', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'create', username: 'admin2', full_name: 'Admin 2', role: 'admin' })
  assertEquals(r.status, 200)
  assertEquals((calls.find((c) => c[0] === 'insertProfile')![1] as ProfileRow).school_id, null)
})

Deno.test('create: duplicate username → 409 before any auth call', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'create', username: '108870', full_name: 'X', role: 'user', school_id: SCHOOL })
  assertEquals(r.status, 409)
  assertEquals(r.json.error, 'That username is already taken.')
  assertEquals(authCalls(calls), [])
})

Deno.test('create: auth says the address is registered → 409', async () => {
  const { store } = makeStore({
    createAuthUser: () => Promise.reject(new StoreError('A user with this email address has already been registered', 'email_exists')),
  })
  const r = await call(deps(store), { action: 'create', username: '108899', full_name: 'X', role: 'user', school_id: SCHOOL })
  assertEquals(r.status, 409)
  assertEquals(r.json.error, 'That username is already taken.')
})

Deno.test('create: profile insert fails → auth user is deleted (rollback), error returned', async () => {
  const { store, calls } = makeStore({
    insertProfile: (row) => {
      calls.push(['insertProfile', row])
      return Promise.reject(new StoreError('insert or update on table "profiles" violates foreign key constraint', '23503'))
    },
  })
  const r = await call(deps(store), { action: 'create', username: '108899', full_name: 'X', role: 'user', school_id: SCHOOL })
  assertEquals(r.status, 400)
  assert(typeof r.json.error === 'string' && r.json.error.length > 0)
  assert(calls.some((c) => c[0] === 'deleteAuthUser' && c[1] === 'new-user-id'), 'rollback must delete the auth user')
  assert(!names(calls).includes('insertLog'))
})

Deno.test('create: profile insert races on username (23505) → rollback + 409', async () => {
  const { store, calls } = makeStore({
    insertProfile: () => Promise.reject(new StoreError('duplicate key value violates unique constraint', '23505')),
  })
  const r = await call(deps(store), { action: 'create', username: '108899', full_name: 'X', role: 'user', school_id: SCHOOL })
  assertEquals(r.status, 409)
  assert(calls.some((c) => c[0] === 'deleteAuthUser'))
})

Deno.test('update: patches profile only (no username), logs user.update', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), {
    action: 'update',
    user_id: T_USER,
    full_name: ' Renamed ',
    role: 'admin',
    school_id: null,
  })
  assertEquals(r.status, 200)
  assertEquals(authCalls(calls), [])
  const upd = calls.find((c) => c[0] === 'updateProfile')!
  assertEquals(upd.slice(1), [T_USER, { full_name: 'Renamed', role: 'admin', school_id: null }])
  const log = calls.find((c) => c[0] === 'insertLog')![1] as { action: string; details: Record<string, unknown> }
  assertEquals(log.action, 'user.update')
  assertEquals(log.details.user_id, T_USER)
  assertEquals(log.details.username, '108870')
})

Deno.test('reset_password: new password + must_change_password, logs, returns username + temp password', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'reset_password', user_id: T_USER })
  assertEquals(r.status, 200)
  assertEquals(r.json, { username: '108870', temp_password: 'Abcd2345efgh' })
  assertEquals(calls.find((c) => c[0] === 'updateAuthUser')!.slice(1), [T_USER, { password: 'Abcd2345efgh' }])
  assertEquals(calls.find((c) => c[0] === 'updateProfile')!.slice(1), [T_USER, { must_change_password: true }])
  const log = calls.find((c) => c[0] === 'insertLog')![1] as { action: string }
  assertEquals(log.action, 'user.reset_password')
  assert(!JSON.stringify(log).includes('Abcd2345efgh'))
})

Deno.test('set_disabled true: bans for 876000h, sets profile flag, logs user.disable', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'set_disabled', user_id: T_USER, disabled: true })
  assertEquals(r.status, 200)
  assertEquals(calls.find((c) => c[0] === 'updateAuthUser')!.slice(1), [T_USER, { ban_duration: '876000h' }])
  assertEquals(calls.find((c) => c[0] === 'updateProfile')!.slice(1), [T_USER, { disabled: true }])
  assertEquals((calls.find((c) => c[0] === 'insertLog')![1] as { action: string }).action, 'user.disable')
})

Deno.test("set_disabled false: ban 'none', clears flag, logs user.enable", async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'set_disabled', user_id: T_USER, disabled: false })
  assertEquals(r.status, 200)
  assertEquals(calls.find((c) => c[0] === 'updateAuthUser')!.slice(1), [T_USER, { ban_duration: 'none' }])
  assertEquals(calls.find((c) => c[0] === 'updateProfile')!.slice(1), [T_USER, { disabled: false }])
  assertEquals((calls.find((c) => c[0] === 'insertLog')![1] as { action: string }).action, 'user.enable')
})

Deno.test('admin cannot disable themselves or change their own role (400, nothing written)', async () => {
  for (const body of [
    { action: 'set_disabled', user_id: ADMIN.userId, disabled: true },
    { action: 'update', user_id: ADMIN.userId, role: 'user', school_id: SCHOOL },
  ]) {
    const { store, calls } = makeStore()
    const r = await call(deps(store), body)
    assertEquals(r.status, 400)
    assertEquals(names(calls), ['getProfile'])
  }
})

Deno.test('store failure surfaces as 500 JSON error with CORS', async () => {
  const { store } = makeStore({ updateAuthUser: () => Promise.reject(new StoreError('boom')) })
  const r = await call(deps(store), { action: 'reset_password', user_id: T_USER })
  assertEquals(r.status, 500)
  assertEquals(typeof r.json.error, 'string')
  assertEquals(r.res.headers.get('Access-Control-Allow-Origin'), '*')
})
