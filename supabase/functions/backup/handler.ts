// Request routing for the backup function. All I/O goes through injected deps so this is testable with
// fakes; index.ts wires the real Supabase clients (service role) and Storage bucket `backups`.
import { HttpError, type Caller } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { normalizeUsername, usernameToEmail } from '../_shared/username.ts'
import {
  BACKUP_VERSION,
  backupFileName,
  MAX_BACKUP_BYTES,
  NOT_A_BACKUP_MESSAGE,
  parseBackup,
  validateRequest,
  type Backup,
  type DocumentTypeRow,
  type ProfileRow,
  type RecordRow,
  type SchoolRow,
} from './logic.ts'

export type TableName = 'schools' | 'document_types' | 'profiles' | 'records'

/** Current table contents. `profiles` includes superadmins; the handler leaves them out of backups. */
export interface Tables {
  schools: SchoolRow[]
  document_types: DocumentTypeRow[]
  profiles: ProfileRow[]
  records: RecordRow[]
}

export interface BackupFile {
  name: string
  created_at: string
  size: number
}

export interface LogRow {
  user_id: string
  username: string
  role: string
  action: string
  details: Record<string, unknown>
}

/** Thrown by store implementations; `code` is a Postgres or Storage error code when known. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export interface BackupStore {
  dump(): Promise<Tables>
  /** Saves a new file; rejects with StoreError code 'Duplicate' if the name is taken. */
  upload(name: string, body: string): Promise<void>
  list(): Promise<BackupFile[]>
  /** File contents, or null when there is no such backup. */
  read(name: string): Promise<string | null>
  /** Signed download URL; rejects with StoreError code 'NotFound' when there is no such backup. */
  signedUrl(name: string, seconds: number): Promise<string>
  /** Every account in auth.users: id → email (null if it has none). */
  authUsers(): Promise<Map<string, string | null>>
  /** Insert-or-update by primary key; rejects with StoreError on any failure. */
  upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void>
  insertLog(row: LogRow): Promise<void>
}

export interface Deps {
  getCaller(req: Request): Promise<Caller>
  store: BackupStore
  now(): Date
}

export interface Skipped {
  table: TableName
  id: string
  label: string
  reason: string
}

type Counts = Record<TableName, number>

const TABLES: TableName[] = ['schools', 'document_types', 'profiles', 'records']

/**
 * Columns written on restore, per table (restore order). Values set by the database are left out.
 * Update these lists when a migration adds columns.
 */
const RESTORE: Record<TableName, { key: string; label: string; columns: string[] }> = {
  schools: { key: 'id', label: 'name', columns: ['id', 'name'] },
  document_types: { key: 'id', label: 'name', columns: ['id', 'name', 'office', 'requires_leave_dates'] },
  // disabled / must_change_password go with the auth account (ban, password), which a backup does not hold.
  profiles: { key: 'user_id', label: 'username', columns: ['user_id', 'username', 'full_name', 'role', 'school_id'] },
  // created_by_username and updated_at are set by the records_set_creator trigger.
  records: {
    key: 'id',
    label: 'dts_number',
    columns: [
      'id',
      'school_id',
      'created_by',
      'date',
      'name',
      'honorific',
      'leave_type',
      'description',
      'contact',
      'title',
      'dts_number',
      'document_type_id',
      'date_from',
      'date_to',
      'excluded_date',
      'created_at',
    ],
  },
}

const CHUNK = 500
const SIGNED_URL_SECONDS = 60
/** The JSON body wraps the backup with a few small fields. */
const MAX_REQUEST_CHARS = MAX_BACKUP_BYTES + 64 * 1024
const GENERIC = 'Something went wrong. Please try again.'
const NOT_FOUND = 'Backup not found.'
const SUPERADMIN_SKIPPED = 'Superadmin accounts are not restored.'

type Row = Record<string, unknown>

async function log(deps: Deps, caller: Caller, action: string, details: Record<string, unknown>) {
  try {
    await deps.store.insertLog({ user_id: caller.userId, username: caller.username, role: caller.role, action, details })
  } catch (e) {
    console.error('backup: activity log failed', e)
  }
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const caller = await deps.getCaller(req)

    const text = await req.text()
    if (text.length > MAX_REQUEST_CHARS) return json({ error: 'This backup file is too large (max 20 MB).' }, 413)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'Unknown request.' }, 400)
    }

    const v = validateRequest(caller, body)
    if (!v.ok) return json({ error: v.error }, v.status)

    const r = v.request
    switch (r.action) {
      case 'create': {
        const { name, size } = await createBackup(deps, caller, false)
        return json({ name, size })
      }
      case 'list': {
        const files = await deps.store.list()
        files.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.name.localeCompare(a.name)))
        return json(files.map(({ name, created_at, size }) => ({ name, created_at, size })))
      }
      case 'download':
        return json({ url: await deps.store.signedUrl(r.name, SIGNED_URL_SECONDS) })
      case 'restore':
        return await restore(deps, caller, r.name, r.backup)
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    if (e instanceof StoreError && e.code === 'NotFound') return json({ error: NOT_FOUND }, 404)
    console.error('backup:', e)
    return json({ error: GENERIC }, 500)
  }
}

function isDuplicate(e: unknown): boolean {
  return e instanceof StoreError && (e.code === 'Duplicate' || e.code === '409' || /already exists/i.test(e.message))
}

function countsOf(t: { [K in TableName]: unknown[] }): Counts {
  return { schools: t.schools.length, document_types: t.document_types.length, profiles: t.profiles.length, records: t.records.length }
}

/** Dumps the tables (no superadmins) to a new file. Also returns the full dump for restore's comparison. */
async function createBackup(deps: Deps, caller: Caller, automatic: boolean) {
  const tables = await deps.store.dump()
  const now = deps.now()
  const backup: Backup = {
    version: BACKUP_VERSION,
    created_at: now.toISOString(),
    schools: tables.schools,
    document_types: tables.document_types,
    profiles: tables.profiles.filter((p) => p.role !== 'superadmin'),
    records: tables.records,
  }
  const body = JSON.stringify(backup)
  const base = backupFileName(now)

  let name = base
  for (let i = 2; ; i++) {
    try {
      await deps.store.upload(name, body)
      break
    } catch (e) {
      if (!isDuplicate(e) || i > 20) throw e
      name = base.replace(/\.json$/, `-${i}.json`)
    }
  }

  const counts = countsOf(backup)
  await log(deps, caller, 'backup.create', automatic ? { name, counts, automatic: true } : { name, counts })
  return { name, size: new TextEncoder().encode(body).length, tables }
}

/** Allowed columns present in `row`. A column missing from an older backup is left as it is now, not nulled. */
function pick(row: Row, columns: string[]): Row {
  const out: Row = {}
  for (const c of columns) if (c in row) out[c] = row[c] ?? null
  return out
}

function skipReason(table: TableName, e: unknown): string {
  if (e instanceof StoreError) {
    if (e.code === '23503') {
      if (table === 'records' && /no profile found/i.test(e.message)) return 'The person who added it no longer has an account.'
      return 'Something it refers to (a school, document type, or account) no longer exists.'
    }
    if (e.code === '23505') {
      if (table === 'records') return 'Another record already uses this DTS number.'
      if (table === 'profiles') return 'Another account already uses this username.'
      return 'Another entry already uses this name.'
    }
    if (e.code === '23514') return `It fails a data check: ${e.message}`
    if (e.code === '42501') return SUPERADMIN_SKIPPED
    return e.message || GENERIC
  }
  return e instanceof Error ? e.message : String(e)
}

/** Upserts rows in batches; a failing batch is retried one row at a time so one bad row does not block the rest. */
async function upsertAll(deps: Deps, table: TableName, rows: Row[], skipped: Skipped[]): Promise<number> {
  const { key, label } = RESTORE[table]
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    try {
      await deps.store.upsert(table, chunk)
      written += chunk.length
      continue
    } catch {
      // Fall through to row-by-row.
    }
    for (const row of chunk) {
      try {
        await deps.store.upsert(table, [row])
        written++
      } catch (e) {
        skipped.push({ table, id: String(row[key]), label: String(row[label] ?? ''), reason: skipReason(table, e) })
      }
    }
  }
  return written
}

async function restore(deps: Deps, caller: Caller, name?: string, uploaded?: Backup): Promise<Response> {
  let backup: Backup
  if (name) {
    const text = await deps.store.read(name)
    if (text === null) return json({ error: NOT_FOUND }, 404)
    try {
      backup = parseBackup(JSON.parse(text))
    } catch {
      return json({ error: NOT_A_BACKUP_MESSAGE }, 400)
    }
  } else {
    backup = uploaded!
  }

  // Safety backup first; if it cannot be saved, nothing is restored.
  const safety = await createBackup(deps, caller, true)
  const current = safety.tables

  const authUsers = await deps.store.authUsers()
  const currentUsernames = new Map(current.profiles.map((p) => [p.user_id, p.username]))
  const superadmins = new Set(current.profiles.filter((p) => p.role === 'superadmin').map((p) => p.user_id))

  const restored: Counts = { schools: 0, document_types: 0, profiles: 0, records: 0 }
  const skipped: Skipped[] = []

  for (const table of TABLES) {
    const { key, label, columns } = RESTORE[table]
    const now = new Map<string, Row>()
    for (const row of current[table] as unknown as Row[]) now.set(String(row[key]), row)

    const toWrite: Row[] = []
    for (const original of backup[table] as unknown as Row[]) {
      const row = pick(original, columns)
      const id = String(row[key])
      if (table === 'profiles') {
        const skip = (reason: string) => skipped.push({ table, id, label: String(row[label] ?? ''), reason })
        if (row.role === 'superadmin' || superadmins.has(id)) {
          skip(SUPERADMIN_SKIPPED)
          continue
        }
        if (!authUsers.has(id)) {
          skip('This account no longer exists.')
          continue
        }
        // The username is the sign-in identity (auth email = usernameToEmail(username)) and never changes,
        // so an existing user keeps their current username whatever the file says.
        const existing = currentUsernames.get(id)
        if (existing !== undefined) {
          row.username = existing
        } else {
          const username = String(row.username)
          if (normalizeUsername(username) !== username) {
            skip('The username in the backup is not valid.')
            continue
          }
          if ((authUsers.get(id) ?? '').toLowerCase() !== usernameToEmail(username)) {
            skip("The username in the backup does not match this account's sign-in.")
            continue
          }
        }
      }
      // Rows that already match the backup are left alone (no write, no activity-log noise).
      const existingRow = now.get(id)
      if (existingRow && JSON.stringify(pick(existingRow, Object.keys(row))) === JSON.stringify(row)) continue
      toWrite.push(row)
    }
    restored[table] = await upsertAll(deps, table, toWrite, skipped)
  }

  await log(deps, caller, 'backup.restore', {
    source: name ?? 'upload',
    safety_backup: safety.name,
    restored,
    skipped: skipped.length,
  })
  return json({ restored, skipped, safety_backup: safety.name })
}
