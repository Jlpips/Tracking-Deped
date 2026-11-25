// Pure request checks for the admin-users function. No I/O here; index.ts/handler.ts do that.
import type { Caller, Role } from '../_shared/auth.ts'
import { normalizeUsername } from '../_shared/username.ts'

export type { Caller, Role }

/** The parts of a target user's profile the checks need. */
export interface TargetProfile {
  user_id: string
  username: string
  full_name: string
  role: Role
  school_id: string | null
  disabled: boolean
}

export type Validation = { ok: true } | { ok: false; status: number; error: string }

export const ACTIONS = ['create', 'update', 'reset_password', 'set_disabled'] as const
export type Action = (typeof ACTIONS)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const NOT_FOUND = 'User not found.'

const fail = (status: number, error: string): Validation => ({ ok: false, status, error })
const OK: Validation = { ok: true }

type Body = Record<string, unknown>

function isObject(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** Only 'user' and 'admin' can be assigned here; superadmins are managed in the Supabase dashboard. */
function checkRole(role: unknown): Validation {
  return role === 'user' || role === 'admin' ? OK : fail(400, 'Role must be User or Admin.')
}

/** A school user needs a school; an admin must not have one. */
function checkRoleSchool(role: 'user' | 'admin', schoolId: unknown): Validation {
  if (role === 'user') {
    return isUuid(schoolId) ? OK : fail(400, 'Choose the school this user belongs to.')
  }
  return schoolId === null || schoolId === undefined ? OK : fail(400, 'Admins are not assigned to a school.')
}

function checkFullName(v: unknown): Validation {
  return typeof v === 'string' && v.trim() !== '' ? OK : fail(400, 'Enter the full name.')
}

/**
 * Decides whether `caller` may perform `body`. For actions that name a user_id, `target` is that
 * user's profile (null/undefined when not found). Superadmin targets are reported as not found.
 */
export function validateRequest(caller: Caller, body: unknown, target?: TargetProfile | null): Validation {
  if (caller.role !== 'admin' && caller.role !== 'superadmin') {
    return fail(403, 'Only admins can manage users.')
  }
  if (!isObject(body) || !ACTIONS.includes(body.action as Action)) {
    return fail(400, 'Unknown request.')
  }
  const action = body.action as Action

  if (action === 'create') {
    if (typeof body.username !== 'string' || normalizeUsername(body.username) === null) {
      return fail(400, 'Usernames can use only letters, numbers, dots, dashes, and underscores, with no spaces.')
    }
    const name = checkFullName(body.full_name)
    if (!name.ok) return name
    const role = checkRole(body.role)
    if (!role.ok) return role
    return checkRoleSchool(body.role as 'user' | 'admin', body.school_id)
  }

  if (!isUuid(body.user_id)) return fail(400, 'A valid user_id is required.')
  if (!target || target.role === 'superadmin' || target.user_id !== body.user_id) return fail(404, NOT_FOUND)
  const self = body.user_id === caller.userId

  if (action === 'update') {
    if ('username' in body) return fail(400, "The username can't be changed.")
    if ('full_name' in body) {
      const name = checkFullName(body.full_name)
      if (!name.ok) return name
    }
    if ('role' in body) {
      const role = checkRole(body.role)
      if (!role.ok) return role
    }
    const nextRole = ('role' in body ? body.role : target.role) as 'user' | 'admin'
    const nextSchool = 'school_id' in body ? body.school_id : target.school_id
    const rs = checkRoleSchool(nextRole, nextSchool)
    if (!rs.ok) return rs
    if (self && nextRole !== target.role) return fail(400, "You can't change your own role.")
    return OK
  }

  if (action === 'set_disabled') {
    if (typeof body.disabled !== 'boolean') return fail(400, 'disabled must be true or false.')
    if (self && body.disabled) return fail(400, "You can't disable your own account.")
    return OK
  }

  return OK // reset_password
}

/** Letters and digits without look-alikes (0 O 1 l I). */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 12

type RandomFill = (buf: Uint32Array) => Uint32Array

/**
 * 12-character temporary password from a cryptographically random source. Always contains a
 * letter and a digit, so it satisfies the app's own password rule.
 */
export function generateTempPassword(
  fill: RandomFill = (buf) => crypto.getRandomValues(buf),
): string {
  const n = TEMP_PASSWORD_ALPHABET.length
  // Rejection sampling keeps every character equally likely.
  const limit = Math.floor(0x1_0000_0000 / n) * n
  for (;;) {
    let pw = ''
    while (pw.length < TEMP_PASSWORD_LENGTH) {
      const buf = fill(new Uint32Array(TEMP_PASSWORD_LENGTH))
      for (const v of buf) {
        if (v < limit && pw.length < TEMP_PASSWORD_LENGTH) pw += TEMP_PASSWORD_ALPHABET[v % n]
      }
    }
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) return pw
  }
}
