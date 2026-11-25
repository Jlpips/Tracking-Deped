import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { generateTempPassword, TEMP_PASSWORD_ALPHABET, validateRequest, type Caller, type TargetProfile } from './logic.ts'

const ADMIN: Caller = { userId: 'a0000000-0000-4000-8000-000000000001', role: 'admin', username: 'macalelon-admin' }
const SUPER: Caller = { userId: 'a0000000-0000-4000-8000-000000000002', role: 'superadmin', username: 'root' }
const USER: Caller = { userId: 'a0000000-0000-4000-8000-000000000003', role: 'user', username: '108874' }
const SCHOOL = 'b0000000-0000-4000-8000-000000000001'
const TARGET_ID = 'c0000000-0000-4000-8000-000000000001'

const target = (o: Partial<TargetProfile> = {}): TargetProfile => ({
  user_id: TARGET_ID,
  username: '108870',
  full_name: 'School User 2',
  role: 'user',
  school_id: SCHOOL,
  disabled: false,
  ...o,
})

const validCreate = { action: 'create', username: '108871', full_name: 'School User 3', role: 'user', school_id: SCHOOL }

function err(r: ReturnType<typeof validateRequest>): { status: number; error: string } {
  if (r.ok) throw new Error('expected a refusal, got ok')
  return r
}

Deno.test('a school user caller is refused with 403', () => {
  assertEquals(err(validateRequest(USER, validCreate)).status, 403)
  assertEquals(err(validateRequest(USER, { action: 'reset_password', user_id: TARGET_ID }, target())).status, 403)
})

Deno.test('admin creating a valid user is ok; superadmin too', () => {
  assertEquals(validateRequest(ADMIN, validCreate), { ok: true })
  assertEquals(validateRequest(SUPER, validCreate), { ok: true })
  assertEquals(
    validateRequest(ADMIN, { action: 'create', username: 'district.admin', full_name: 'Admin 2', role: 'admin' }),
    { ok: true },
  )
})

Deno.test('unknown action or non-object body → 400', () => {
  assertEquals(err(validateRequest(ADMIN, { action: 'delete', user_id: TARGET_ID })).status, 400)
  assertEquals(err(validateRequest(ADMIN, null)).status, 400)
  assertEquals(err(validateRequest(ADMIN, 'create')).status, 400)
})

Deno.test("role 'superadmin' in the body → 400 (create and update)", () => {
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, role: 'superadmin', school_id: undefined })).status, 400)
  assertEquals(err(validateRequest(SUPER, { ...validCreate, role: 'superadmin', school_id: undefined })).status, 400)
  assertEquals(
    err(validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, role: 'superadmin', school_id: null }, target()))
      .status,
    400,
  )
})

Deno.test("role 'user' without school_id → 400; role 'admin' with school_id → 400", () => {
  const { school_id: _s, ...noSchool } = validCreate
  assertEquals(err(validateRequest(ADMIN, noSchool)).status, 400)
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, school_id: '' })).status, 400)
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, role: 'admin' })).status, 400)
})

Deno.test("username 'a b' → 400; empty full name → 400", () => {
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, username: 'a b' })).status, 400)
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, username: '' })).status, 400)
  assertEquals(err(validateRequest(ADMIN, { ...validCreate, full_name: '   ' })).status, 400)
})

Deno.test('target profile is superadmin → 404 for every user_id action', () => {
  const sa = target({ role: 'superadmin', school_id: null })
  for (const caller of [ADMIN, SUPER]) {
    const a = err(validateRequest(caller, { action: 'update', user_id: TARGET_ID, full_name: 'X' }, sa))
    const b = err(validateRequest(caller, { action: 'reset_password', user_id: TARGET_ID }, sa))
    const c = err(validateRequest(caller, { action: 'set_disabled', user_id: TARGET_ID, disabled: true }, sa))
    for (const r of [a, b, c]) assertEquals({ status: r.status, error: r.error }, { status: 404, error: 'User not found.' })
  }
})

Deno.test('missing target → 404; malformed user_id → 400', () => {
  assertEquals(err(validateRequest(ADMIN, { action: 'reset_password', user_id: TARGET_ID }, null)).status, 404)
  assertEquals(err(validateRequest(ADMIN, { action: 'reset_password', user_id: TARGET_ID })).status, 404)
  assertEquals(err(validateRequest(ADMIN, { action: 'reset_password', user_id: 'nope' }, target())).status, 400)
  assertEquals(err(validateRequest(ADMIN, { action: 'reset_password' }, target())).status, 400)
})

Deno.test('update keeps the role/school rule using the target’s current values', () => {
  // Name-only change on a school user: fine.
  assertEquals(validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, full_name: 'New' }, target()), { ok: true })
  // Promote to admin and clear the school: fine.
  assertEquals(
    validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, role: 'admin', school_id: null }, target()),
    { ok: true },
  )
  // Promote to admin but keep the school: refused.
  assertEquals(err(validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, role: 'admin' }, target())).status, 400)
  // Admin → user without a school: refused.
  const adm = target({ role: 'admin', school_id: null })
  assertEquals(err(validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, role: 'user' }, adm)).status, 400)
  // Username can't be changed.
  assertEquals(
    err(validateRequest(ADMIN, { action: 'update', user_id: TARGET_ID, username: 'other' }, target())).status,
    400,
  )
})

Deno.test('an admin cannot change their own role or disable themselves', () => {
  const me = target({ user_id: ADMIN.userId, role: 'admin', school_id: null, username: ADMIN.username })
  const role = err(
    validateRequest(ADMIN, { action: 'update', user_id: ADMIN.userId, role: 'user', school_id: SCHOOL }, me),
  )
  assertEquals(role.status, 400)
  const dis = err(validateRequest(ADMIN, { action: 'set_disabled', user_id: ADMIN.userId, disabled: true }, me))
  assertEquals(dis.status, 400)
  // Renaming yourself (same role) is fine.
  assertEquals(
    validateRequest(ADMIN, { action: 'update', user_id: ADMIN.userId, full_name: 'Me', role: 'admin', school_id: null }, me),
    { ok: true },
  )
})

Deno.test('set_disabled needs a boolean', () => {
  assertEquals(err(validateRequest(ADMIN, { action: 'set_disabled', user_id: TARGET_ID }, target())).status, 400)
  assertEquals(
    validateRequest(ADMIN, { action: 'set_disabled', user_id: TARGET_ID, disabled: false }, target({ disabled: true })),
    { ok: true },
  )
})

Deno.test('generateTempPassword: 12 chars, unambiguous alphabet, a letter and a digit', () => {
  for (const ch of '0O1lI') assert(!TEMP_PASSWORD_ALPHABET.includes(ch), `alphabet must not contain ${ch}`)
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const pw = generateTempPassword()
    assertEquals(pw.length, 12)
    for (const ch of pw) assert(TEMP_PASSWORD_ALPHABET.includes(ch), `unexpected char ${ch}`)
    assertMatch(pw, /[A-Za-z]/)
    assertMatch(pw, /[0-9]/)
    seen.add(pw)
  }
  assertEquals(seen.size, 500)
})

Deno.test('generateTempPassword retries until it has both a letter and a digit', () => {
  // A random source that first yields all letters, then all digits, then a mix.
  const batches = [Array(12).fill(0), Array(12).fill(TEMP_PASSWORD_ALPHABET.indexOf('2'))]
  let call = 0
  const rand = (buf: Uint32Array) => {
    const fixed = batches[call++]
    for (let i = 0; i < buf.length; i++) buf[i] = fixed ? fixed[i] : i % 2 ? TEMP_PASSWORD_ALPHABET.indexOf('7') : i
    return buf
  }
  const pw = generateTempPassword(rand)
  assertEquals(call, 3)
  assertMatch(pw, /[A-Za-z]/)
  assertMatch(pw, /[0-9]/)
})
