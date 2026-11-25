import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { HttpError, type Caller } from '../_shared/auth.ts'
import { handler, StoreError, type BackupStore, type Deps, type TableName, type Tables } from './handler.ts'
import { sampleBackup } from './testdata.ts'

const SUPER: Caller = { userId: 'a0000000-0000-4000-8000-000000000009', role: 'superadmin', username: 'root' }
const ADMIN: Caller = { userId: 'a0000000-0000-4000-8000-000000000001', role: 'admin', username: 'macalelon-admin' }
const NOW = new Date('2026-11-25T03:04:05Z')
const NAME = 'backup-20261125-030405.json'

type Call = [string, ...unknown[]]
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

function currentTables(): Tables {
  const b = sampleBackup()
  return {
    schools: [...b.schools],
    document_types: [...b.document_types],
    profiles: [
      ...b.profiles,
      {
        user_id: SUPER.userId,
        username: 'root',
        full_name: 'Superadmin',
        role: 'superadmin',
        school_id: null,
        must_change_password: false,
        disabled: false,
      },
    ],
    records: [...b.records],
  }
}

const AUTH_USERS: [string, string | null][] = [
  ['u1', '108870@dts.local'],
  [SUPER.userId, 'root@dts.local'],
]

function makeStore(
  overrides: Partial<BackupStore> = {},
  opts: { tables?: Tables; files?: Map<string, string>; authUsers?: [string, string | null][] } = {},
) {
  const calls: Call[] = []
  const authUsers = opts.authUsers ?? AUTH_USERS
  const files = opts.files ?? new Map<string, string>()
  const tables = opts.tables ?? currentTables()
  const store: BackupStore = {
    dump: () => {
      calls.push(['dump'])
      return Promise.resolve(structuredClone(tables))
    },
    upload: (name, body) => {
      calls.push(['upload', name, body])
      if (files.has(name)) return Promise.reject(new StoreError('The resource already exists', 'Duplicate'))
      files.set(name, body)
      return Promise.resolve()
    },
    list: () => {
      calls.push(['list'])
      return Promise.resolve([
        { name: 'backup-20261101-000000.json', created_at: '2026-11-01T00:00:00Z', size: 10 },
        { name: 'backup-20261124-000000.json', created_at: '2026-11-24T00:00:00Z', size: 30 },
        { name: 'backup-20261110-000000.json', created_at: '2026-11-10T00:00:00Z', size: 20 },
      ])
    },
    read: (name) => {
      calls.push(['read', name])
      return Promise.resolve(files.get(name) ?? null)
    },
    signedUrl: (name, seconds) => {
      calls.push(['signedUrl', name, seconds])
      return Promise.resolve(`http://storage/sign/${name}?token=t`)
    },
    authUsers: () => {
      calls.push(['authUsers'])
      return Promise.resolve(new Map<string, string | null>(authUsers))
    },
    upsert: (table, rows) => {
      calls.push(['upsert', table, rows])
      return Promise.resolve()
    },
    insertLog: (row) => {
      calls.push(['insertLog', row])
      return Promise.resolve()
    },
    ...overrides,
  }
  return { store, calls, files }
}

function deps(store: BackupStore, caller: Caller | Error = SUPER): Deps {
  return {
    getCaller: () => (caller instanceof Error ? Promise.reject(caller) : Promise.resolve(caller)),
    store,
    now: () => NOW,
  }
}

const post = (body: unknown) =>
  new Request('http://x/backup', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function call(d: Deps, body: unknown) {
  const res = await handler(post(body), d)
  return { status: res.status, json: await res.json() }
}

const names = (calls: Call[]) => calls.map((c) => c[0])
const upserts = (calls: Call[]) => calls.filter((c) => c[0] === 'upsert') as ['upsert', TableName, Row[]][]
const logs = (calls: Call[]) => calls.filter((c) => c[0] === 'insertLog').map((c) => c[1] as Row)

Deno.test('OPTIONS preflight returns CORS headers', async () => {
  const { store } = makeStore()
  const res = await handler(new Request('http://x/backup', { method: 'OPTIONS' }), deps(store))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('missing session → 401', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store, new HttpError(401, 'Please sign in again.')), { action: 'list' })
  assertEquals(r.status, 401)
  assertEquals(calls, [])
})

Deno.test('non-superadmin caller → 403 and no store calls', async () => {
  for (const body of [
    { action: 'create' },
    { action: 'list' },
    { action: 'download', name: NAME },
    { action: 'restore', name: NAME, confirm: 'RESTORE' },
  ]) {
    const { store, calls } = makeStore()
    const r = await call(deps(store, ADMIN), body)
    assertEquals(r.status, 403, JSON.stringify(body))
    assertEquals(calls, [])
  }
})

Deno.test("restore with confirm 'restore' → 400 and nothing is touched", async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'restore', name: NAME, confirm: 'restore' })
  assertEquals(r.status, 400)
  assertEquals(calls, [])
})

Deno.test('restore with both or neither of name/backup → 400', async () => {
  const { store, calls } = makeStore()
  const both = await call(deps(store), { action: 'restore', name: NAME, backup: sampleBackup(), confirm: 'RESTORE' })
  assertEquals(both.status, 400)
  const neither = await call(deps(store), { action: 'restore', confirm: 'RESTORE' })
  assertEquals(neither.status, 400)
  assertEquals(calls, [])
})

Deno.test('invalid JSON body → 400', async () => {
  const { store } = makeStore()
  const res = await handler(
    new Request('http://x/backup', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{nope' }),
    deps(store),
  )
  assertEquals(res.status, 400)
})

Deno.test('a request body over 20 MB → 413', async () => {
  const { store, calls } = makeStore()
  const big = 'x'.repeat(21 * 1024 * 1024)
  const res = await handler(
    new Request('http://x/backup', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: big }),
    deps(store),
  )
  assertEquals(res.status, 413)
  assertEquals(names(calls), [])
})

Deno.test('create saves a version 1 backup without superadmins and logs backup.create', async () => {
  const { store, calls, files } = makeStore()
  const r = await call(deps(store), { action: 'create' })
  assertEquals(r.status, 200)
  assertEquals(r.json.name, NAME)
  const body = files.get(NAME)!
  assertEquals(r.json.size, new TextEncoder().encode(body).length)
  const saved = JSON.parse(body)
  assertEquals(saved.version, 1)
  assertEquals(saved.created_at, NOW.toISOString())
  assertEquals(Object.keys(saved).sort(), ['created_at', 'document_types', 'profiles', 'records', 'schools', 'version'])
  assertEquals(saved.profiles.map((p: Row) => p.username), ['108870'])
  assert(!/"(encrypted_)?password"\s*:|"email"/.test(body), 'no password or auth fields')
  const [log] = logs(calls)
  assertEquals(log.action, 'backup.create')
  assertEquals(log.user_id, SUPER.userId)
  assertEquals(log.details, { name: NAME, counts: { schools: 1, document_types: 1, profiles: 1, records: 1 } })
})

Deno.test('create picks a new name when one already exists for that second', async () => {
  const { store, files } = makeStore({}, { files: new Map([[NAME, '{}']]) })
  const r = await call(deps(store), { action: 'create' })
  assertEquals(r.status, 200)
  assertEquals(r.json.name, 'backup-20261125-030405-2.json')
  assert(files.has('backup-20261125-030405-2.json'))
})

Deno.test('list returns backups newest first', async () => {
  const { store } = makeStore()
  const r = await call(deps(store), { action: 'list' })
  assertEquals(r.status, 200)
  assertEquals(
    r.json.map((b: Row) => b.name),
    ['backup-20261124-000000.json', 'backup-20261110-000000.json', 'backup-20261101-000000.json'],
  )
  assertEquals(r.json[0], { name: 'backup-20261124-000000.json', created_at: '2026-11-24T00:00:00Z', size: 30 })
})

Deno.test('download returns a 60 second signed URL', async () => {
  const { store, calls } = makeStore({}, { files: new Map([[NAME, '{}']]) })
  const r = await call(deps(store), { action: 'download', name: NAME })
  assertEquals(r.status, 200)
  assertEquals(r.json, { url: `http://storage/sign/${NAME}?token=t` })
  assertEquals(calls.find((c) => c[0] === 'signedUrl'), ['signedUrl', NAME, 60])
})

Deno.test('restore of a missing stored backup → 404, no safety backup', async () => {
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'restore', name: 'backup-20261101-000000.json', confirm: 'RESTORE' })
  assertEquals(r.status, 404)
  assert(!names(calls).includes('upload'))
  assert(!names(calls).includes('upsert'))
})

Deno.test('restore of a stored file that is not a backup → 400, no safety backup', async () => {
  const { store, calls } = makeStore({}, { files: new Map([['backup-20261101-000000.json', '{"version":2}']]) })
  const r = await call(deps(store), { action: 'restore', name: 'backup-20261101-000000.json', confirm: 'RESTORE' })
  assertEquals(r.status, 400)
  assertEquals(r.json.error, 'This file is not a DTS Tracker backup.')
  assert(!names(calls).includes('upsert'))
})

/** A backup where the record was deleted since, the school renamed since, plus a superadmin and a vanished user. */
function olderBackup() {
  const b = sampleBackup()
  b.schools[0] = { id: 's1', name: 'Anos Elementary School' }
  b.records.push({ ...b.records[0], id: 'r-deleted', dts_number: '108870ABCDE-000002' })
  b.profiles.push(
    { ...b.profiles[0], user_id: 'gone', username: 'gone-user' },
    { ...b.profiles[0], user_id: SUPER.userId, username: 'root', role: 'superadmin', school_id: null },
  )
  return b
}

Deno.test('restore by name: safety backup first, then upserts in order, only changed rows, skips reported', async () => {
  const older = 'backup-20261101-000000.json'
  const { store, calls, files } = makeStore({}, { files: new Map([[older, JSON.stringify(olderBackup())]]) })
  const r = await call(deps(store), { action: 'restore', name: older, confirm: 'RESTORE' })
  assertEquals(r.status, 200, JSON.stringify(r.json))

  // Safety backup is written before any upsert.
  const order = names(calls)
  assert(order.indexOf('upload') < order.indexOf('upsert'))
  assertEquals(r.json.safety_backup, NAME)
  assert(files.has(NAME))

  // Order: schools, (document_types unchanged → skipped), profiles unchanged, records.
  const ups = upserts(calls)
  assertEquals(
    ups.map((u) => u[1]),
    ['schools', 'records'],
  )
  assertEquals(ups[0][2], [{ id: 's1', name: 'Anos Elementary School' }])
  // Only the deleted record is written; created_by_username/updated_at are left to the database.
  assertEquals(ups[1][2].map((r) => r.id), ['r-deleted'])
  assert(!('created_by_username' in ups[1][2][0]))
  assert(!('updated_at' in ups[1][2][0]))

  assertEquals(r.json.restored, { schools: 1, document_types: 0, profiles: 0, records: 1 })
  const skipped = r.json.skipped as Row[]
  assertEquals(skipped.map((s) => [s.table, s.id, s.reason]).sort(), [
    ['profiles', SUPER.userId, 'Superadmin accounts are not restored.'],
    ['profiles', 'gone', 'This account no longer exists.'],
  ])

  const restoreLog = logs(calls).find((l) => l.action === 'backup.restore')!
  assertEquals(restoreLog.details, {
    source: older,
    safety_backup: NAME,
    restored: { schools: 1, document_types: 0, profiles: 0, records: 1 },
    skipped: 2,
  })
  // The safety backup is logged too.
  assertEquals(logs(calls)[0].action, 'backup.create')
})

Deno.test('restore never writes a profile that is a superadmin in the database now', async () => {
  const tables = currentTables()
  // 'u1' has since been promoted to superadmin (done in the dashboard).
  tables.profiles[0] = { ...tables.profiles[0], role: 'superadmin', school_id: null }
  const b = sampleBackup()
  const { store, calls } = makeStore({}, { tables })
  const r = await call(deps(store), { action: 'restore', backup: b, confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  assert(!upserts(calls).some((u) => u[1] === 'profiles'))
  assertEquals((r.json.skipped as Row[]).map((s) => s.id), ['u1'])
})

Deno.test('restore of an uploaded backup writes changed profile fields and logs source upload', async () => {
  const b = sampleBackup()
  b.profiles[0].full_name = 'Old Name'
  b.profiles[0].disabled = true
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'restore', backup: b, confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  const p = upserts(calls).find((u) => u[1] === 'profiles')!
  // Sign-in state (disabled, must_change_password) belongs with the auth account and is not restored.
  assertEquals(p[2], [{ user_id: 'u1', username: '108870', full_name: 'Old Name', role: 'user', school_id: 's1' }])
  assertEquals(logs(calls).find((l) => l.action === 'backup.restore')!.details.source, 'upload')
})

Deno.test('a failing batch is retried row by row; failing rows are skipped with a reason', async () => {
  const b = sampleBackup()
  b.records = [
    { ...b.records[0], id: 'r-a', dts_number: 'A-1' },
    { ...b.records[0], id: 'r-b', dts_number: 'B-1', created_by: 'nobody' },
    { ...b.records[0], id: 'r-c', dts_number: 'C-1' },
  ]
  const { store, calls } = makeStore({
    upsert: (table, rows) => {
      calls.push(['upsert', table, rows])
      if (rows.some((r) => r.id === 'r-b')) {
        return Promise.reject(new StoreError('No profile found for record creator nobody', '23503'))
      }
      return Promise.resolve()
    },
  })
  const r = await call(deps(store), { action: 'restore', backup: b, confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  assertEquals(r.json.restored.records, 2)
  const skipped = r.json.skipped as Row[]
  assertEquals(skipped.length, 1)
  assertEquals(skipped[0].table, 'records')
  assertEquals(skipped[0].id, 'r-b')
  assertEquals(skipped[0].label, 'B-1')
  assertMatch(skipped[0].reason, /no longer has an account/)
})

Deno.test('if the safety backup fails, nothing is restored', async () => {
  const { store, calls } = makeStore({
    upload: () => Promise.reject(new StoreError('storage down')),
  })
  const r = await call(deps(store), { action: 'restore', backup: sampleBackup(), confirm: 'RESTORE' })
  assertEquals(r.status, 500)
  assert(!names(calls).includes('upsert'))
})

// --- Usernames are the sign-in identity: restore never renames, and only inserts matching ones.

Deno.test('restore never changes an existing user’s username; other profile columns are still restored', async () => {
  const b = sampleBackup()
  b.profiles[0] = { ...b.profiles[0], username: 'hijacked', full_name: 'Old Name' }
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'restore', backup: b, confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  const p = upserts(calls).find((u) => u[1] === 'profiles')!
  assertEquals(p[2], [{ user_id: 'u1', username: '108870', full_name: 'Old Name', role: 'user', school_id: 's1' }])
  assertEquals(r.json.restored.profiles, 1)
  assertEquals(r.json.skipped, [])
})

Deno.test('a username-only difference for an existing user writes nothing', async () => {
  const b = sampleBackup()
  b.profiles[0] = { ...b.profiles[0], username: 'someone-else' }
  const { store, calls } = makeStore()
  const r = await call(deps(store), { action: 'restore', backup: b, confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  assert(!upserts(calls).some((u) => u[1] === 'profiles'))
})

function newProfileBackup(username: string) {
  const b = sampleBackup()
  b.profiles.push({ ...b.profiles[0], user_id: 'u2', username, full_name: 'New User' })
  return b
}

Deno.test('a new profile whose username does not normalize is skipped', async () => {
  for (const username of ['Bad Name', '  108871', 'ABC']) {
    const { store, calls } = makeStore({}, { authUsers: [...AUTH_USERS, ['u2', '108871@dts.local']] })
    const r = await call(deps(store), { action: 'restore', backup: newProfileBackup(username), confirm: 'RESTORE' })
    assertEquals(r.status, 200)
    assert(!upserts(calls).some((u) => u[1] === 'profiles'), username)
    assertEquals(r.json.skipped.map((s: Row) => [s.table, s.id, s.reason]), [
      ['profiles', 'u2', 'The username in the backup is not valid.'],
    ])
  }
})

Deno.test('a new profile whose username does not match the auth email is skipped', async () => {
  for (const email of ['other@dts.local', null]) {
    const { store, calls } = makeStore({}, { authUsers: [...AUTH_USERS, ['u2', email]] })
    const r = await call(deps(store), { action: 'restore', backup: newProfileBackup('108871'), confirm: 'RESTORE' })
    assertEquals(r.status, 200)
    assert(!upserts(calls).some((u) => u[1] === 'profiles'))
    assertEquals(r.json.skipped.map((s: Row) => [s.table, s.id, s.reason]), [
      ['profiles', 'u2', "The username in the backup does not match this account's sign-in."],
    ])
  }
})

Deno.test('a valid new profile (auth user without a profile) is inserted with its username', async () => {
  const { store, calls } = makeStore({}, { authUsers: [...AUTH_USERS, ['u2', '108871@dts.local']] })
  const r = await call(deps(store), { action: 'restore', backup: newProfileBackup('108871'), confirm: 'RESTORE' })
  assertEquals(r.status, 200)
  const p = upserts(calls).find((u) => u[1] === 'profiles')!
  assertEquals(p[2], [{ user_id: 'u2', username: '108871', full_name: 'New User', role: 'user', school_id: 's1' }])
  assertEquals(r.json.restored.profiles, 1)
  assertEquals(r.json.skipped, [])
})
