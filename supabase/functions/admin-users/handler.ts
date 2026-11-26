// Request routing for admin-users. All I/O goes through injected deps so this is testable with fakes;
// index.ts wires the real Supabase clients.
import { HttpError, type Caller, type Role } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { normalizeUsername, usernameToEmail } from '../_shared/username.ts'
import { isUuid, validateRequest, type Action } from './logic.ts'

export interface ProfileRow {
  user_id: string
  username: string
  full_name: string
  role: Role
  school_id: string | null
  must_change_password: boolean
  disabled: boolean
}

export interface LogRow {
  user_id: string
  username: string
  role: Role
  action: string
  details: Record<string, unknown>
}

/** Thrown by store implementations; `code` is a Postgres or Auth error code when known. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export interface AdminStore {
  getProfile(userId: string): Promise<ProfileRow | null>
  usernameTaken(username: string): Promise<boolean>
  /** Creates a confirmed auth user; resolves its id. */
  createAuthUser(email: string, password: string): Promise<string>
  deleteAuthUser(userId: string): Promise<void>
  updateAuthUser(userId: string, attrs: { password?: string; ban_duration?: string }): Promise<void>
  insertProfile(row: ProfileRow): Promise<void>
  updateProfile(userId: string, patch: Partial<Omit<ProfileRow, 'user_id' | 'username'>>): Promise<void>
  insertLog(row: LogRow): Promise<void>
}

export interface Deps {
  getCaller(req: Request): Promise<Caller>
  store: AdminStore
  newPassword(): string
}

const USERNAME_TAKEN = 'That username is already taken.'
const BAN_FOREVER = '876000h'

type Body = Record<string, unknown>

function isAuthDuplicate(e: unknown): boolean {
  if (!(e instanceof StoreError)) return false
  return e.code === 'email_exists' || e.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(e.message)
}

function dbErrorResponse(e: unknown): Response {
  if (e instanceof StoreError) {
    if (e.code === '23505') return json({ error: USERNAME_TAKEN }, 409)
    if (e.code === '23503') return json({ error: 'That school no longer exists. Reload and try again.' }, 400)
    if (e.code === '23514') return json({ error: 'A school user needs a school; an admin has none.' }, 400)
  }
  console.error('admin-users:', e)
  return json({ error: 'Something went wrong. Please try again.' }, 500)
}

async function log(deps: Deps, caller: Caller, action: string, details: Record<string, unknown>) {
  try {
    await deps.store.insertLog({ user_id: caller.userId, username: caller.username, role: caller.role, action, details })
  } catch (e) {
    // The change itself succeeded; a missing log row must not turn it into an error for the admin.
    console.error('admin-users: activity log failed', e)
  }
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const caller = await deps.getCaller(req)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Unknown request.' }, 400)
    }

    // Load the target first (admins only) so superadmins and missing users are refused before any auth call.
    const isAdmin = caller.role === 'admin' || caller.role === 'superadmin'
    const userId = (body as Body | null)?.user_id
    const target = isAdmin && isUuid(userId) ? await deps.store.getProfile(userId) : null

    const v = validateRequest(caller, body, target)
    if (!v.ok) return json({ error: v.error }, v.status)

    const b = body as Body
    switch (b.action as Action) {
      case 'create':
        return await create(deps, caller, b)
      case 'update':
        return await update(deps, caller, b, target!)
      case 'reset_password':
        return await resetPassword(deps, caller, target!)
      case 'set_disabled':
        return await setDisabled(deps, caller, target!, b.disabled as boolean)
    }
    return json({ error: 'Unknown request.' }, 400)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    return dbErrorResponse(e)
  }
}

async function create(deps: Deps, caller: Caller, b: Body): Promise<Response> {
  const username = normalizeUsername(b.username as string)!
  const role = b.role as 'user' | 'admin'
  if (await deps.store.usernameTaken(username)) return json({ error: USERNAME_TAKEN }, 409)

  const password = deps.newPassword()
  let id: string
  try {
    id = await deps.store.createAuthUser(usernameToEmail(username), password)
  } catch (e) {
    if (isAuthDuplicate(e)) return json({ error: USERNAME_TAKEN }, 409)
    throw e
  }

  const row: ProfileRow = {
    user_id: id,
    username,
    full_name: (b.full_name as string).trim(),
    role,
    school_id: role === 'user' ? (b.school_id as string) : null,
    must_change_password: true,
    disabled: false,
  }
  try {
    await deps.store.insertProfile(row)
  } catch (e) {
    // Roll back so the username can be used again.
    try {
      await deps.store.deleteAuthUser(id)
    } catch (rollback) {
      console.error('admin-users: rollback of auth user failed', id, rollback)
    }
    return dbErrorResponse(e)
  }

  await log(deps, caller, 'user.create', { user_id: id, username, role, school_id: row.school_id })
  return json({ user_id: id, username, temp_password: password })
}

async function update(deps: Deps, caller: Caller, b: Body, target: ProfileRow): Promise<Response> {
  const patch: Partial<ProfileRow> = {}
  if ('full_name' in b) patch.full_name = (b.full_name as string).trim()
  if ('role' in b) patch.role = b.role as 'user' | 'admin'
  if ('school_id' in b) patch.school_id = (b.school_id as string | null) ?? null
  await deps.store.updateProfile(target.user_id, patch)
  await log(deps, caller, 'user.update', {
    user_id: target.user_id,
    username: target.username,
    changes: Object.keys(patch),
  })
  return json({ ok: true })
}

async function resetPassword(deps: Deps, caller: Caller, target: ProfileRow): Promise<Response> {
  const password = deps.newPassword()
  await deps.store.updateAuthUser(target.user_id, { password })
  await deps.store.updateProfile(target.user_id, { must_change_password: true })
  await log(deps, caller, 'user.reset_password', { user_id: target.user_id, username: target.username })
  return json({ username: target.username, temp_password: password })
}

async function setDisabled(deps: Deps, caller: Caller, target: ProfileRow, disabled: boolean): Promise<Response> {
  await deps.store.updateAuthUser(target.user_id, { ban_duration: disabled ? BAN_FOREVER : 'none' })
  await deps.store.updateProfile(target.user_id, { disabled })
  await log(deps, caller, disabled ? 'user.disable' : 'user.enable', {
    user_id: target.user_id,
    username: target.username,
  })
  return json({ ok: true })
}
