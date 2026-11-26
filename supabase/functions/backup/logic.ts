// Pure checks for the backup function. No I/O here; handler.ts/index.ts do that.
import type { Caller } from '../_shared/auth.ts'

export const BACKUP_VERSION = 1
/** Thrown by parseBackup. */
export const NOT_A_BACKUP = 'Not a DTS Tracker backup'
/** Shown to the superadmin when a file or stored backup fails parseBackup. */
export const NOT_A_BACKUP_MESSAGE = 'This file is not a DTS Tracker backup.'
/** Largest backup accepted for restore (uploaded files are checked in the browser too). */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024

export interface SchoolRow {
  id: string
  name: string
}

export interface DocumentTypeRow {
  id: string
  name: string
  office: string
  requires_leave_dates: boolean
}

/** A profile as saved in a backup: no auth data, no passwords. */
export interface ProfileRow {
  user_id: string
  username: string
  full_name: string
  role: string
  school_id: string | null
  must_change_password: boolean
  disabled: boolean
}

export interface RecordRow {
  id: string
  school_id: string
  created_by: string
  created_by_username?: string
  date: string
  name: string
  honorific: string | null
  leave_type: string | null
  description: string | null
  contact: string | null
  title: string
  dts_number: string
  document_type_id: string
  date_from: string | null
  date_to: string | null
  excluded_date: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface Backup {
  version: 1
  created_at: string
  schools: SchoolRow[]
  document_types: DocumentTypeRow[]
  profiles: ProfileRow[]
  records: RecordRow[]
}

type Obj = Record<string, unknown>

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const str = (o: Obj, ...keys: string[]) => keys.every((k) => typeof o[k] === 'string')

function rowsOk(v: unknown, check: (o: Obj) => boolean): boolean {
  return Array.isArray(v) && v.every((r) => isObject(r) && check(r))
}

/** Validates the shape of a parsed backup file. Throws Error('Not a DTS Tracker backup') if it is not one. */
export function parseBackup(json: unknown): Backup {
  const ok =
    isObject(json) &&
    json.version === BACKUP_VERSION &&
    typeof json.created_at === 'string' &&
    rowsOk(json.schools, (s) => str(s, 'id', 'name')) &&
    rowsOk(json.document_types, (d) => str(d, 'id', 'name', 'office') && typeof d.requires_leave_dates === 'boolean') &&
    rowsOk(json.profiles, (p) => str(p, 'user_id', 'username', 'full_name', 'role')) &&
    rowsOk(json.records, (r) => str(r, 'id', 'school_id', 'created_by', 'document_type_id', 'dts_number', 'title', 'name', 'date'))
  if (!ok) throw new Error(NOT_A_BACKUP)
  return json as unknown as Backup
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `backup-YYYYMMDD-HHmmss.json` in UTC. */
export function backupFileName(d: Date): string {
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `backup-${date}-${time}.json`
}

/** Only names this function creates (an optional `-N` is added when two backups share a second). */
export function isBackupName(v: unknown): v is string {
  return typeof v === 'string' && /^backup-\d{8}-\d{6}(-\d{1,3})?\.json$/.test(v)
}

export type BackupRequest =
  | { action: 'create' }
  | { action: 'list' }
  | { action: 'download'; name: string }
  | { action: 'restore'; name?: string; backup?: Backup }

export type Validation = { ok: true; request: BackupRequest } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): Validation => ({ ok: false, status, error })

export function validateRequest(caller: Caller, body: unknown): Validation {
  if (caller.role !== 'superadmin') return fail(403, 'Only superadmins can manage backups.')
  if (!isObject(body)) return fail(400, 'Unknown request.')

  switch (body.action) {
    case 'create':
    case 'list':
      return { ok: true, request: { action: body.action } }
    case 'download':
      if (!isBackupName(body.name)) return fail(400, 'Backup not found.')
      return { ok: true, request: { action: 'download', name: body.name } }
    case 'restore': {
      if (body.confirm !== 'RESTORE') return fail(400, 'Type RESTORE to confirm.')
      const hasName = body.name !== undefined && body.name !== null
      const hasBackup = body.backup !== undefined && body.backup !== null
      if (hasName === hasBackup) return fail(400, 'Choose either a stored backup or a backup file.')
      if (hasName) {
        if (!isBackupName(body.name)) return fail(400, 'Backup not found.')
        return { ok: true, request: { action: 'restore', name: body.name } }
      }
      try {
        return { ok: true, request: { action: 'restore', backup: parseBackup(body.backup) } }
      } catch {
        return fail(400, NOT_A_BACKUP_MESSAGE)
      }
    }
  }
  return fail(400, 'Unknown request.')
}
