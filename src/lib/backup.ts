import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Same limit and message as supabase/functions/backup/logic.ts. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024
export const NOT_A_BACKUP_MESSAGE = 'This file is not a DTS Tracker backup.'

export interface BackupFile {
  name: string
  created_at: string
  size: number
}

export type TableName = 'schools' | 'document_types' | 'profiles' | 'records'

export interface RestoreResult {
  restored: Record<TableName, number>
  skipped: { table: TableName; id: string; label: string; reason: string }[]
  safety_backup: string
}

/** Requests understood by the `backup` Edge Function (supabase/functions/backup). */
export type BackupRequest =
  | { action: 'create' }
  | { action: 'list' }
  | { action: 'download'; name: string }
  | { action: 'restore'; name: string; confirm: string }
  | { action: 'restore'; backup: unknown; confirm: string }

const GENERIC = 'Something went wrong. Please try again.'

/** Calls the backup Edge Function. Rejects with the function's own error message when it has one. */
export async function callBackup(body: BackupRequest): Promise<any> {
  const { data, error } = await supabase.functions.invoke('backup', { body })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    let message = GENERIC
    try {
      const payload = await (error.context as Response).json()
      if (payload && typeof payload.error === 'string' && payload.error) message = payload.error
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new Error(message)
  }
  throw new Error(error.message || GENERIC)
}

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (o: Obj, ...keys: string[]) => keys.every((k) => typeof o[k] === 'string')
const rowsOk = (v: unknown, check: (o: Obj) => boolean) => Array.isArray(v) && v.every((r) => isObject(r) && check(r))

/** Browser-side copy of the server's parseBackup shape check (the server checks again). */
export function looksLikeBackup(json: unknown): boolean {
  return (
    isObject(json) &&
    json.version === 1 &&
    typeof json.created_at === 'string' &&
    rowsOk(json.schools, (s) => str(s, 'id', 'name')) &&
    rowsOk(json.document_types, (d) => str(d, 'id', 'name', 'office') && typeof d.requires_leave_dates === 'boolean') &&
    rowsOk(json.profiles, (p) => str(p, 'user_id', 'username', 'full_name', 'role')) &&
    rowsOk(json.records, (r) => str(r, 'id', 'school_id', 'created_by', 'document_type_id', 'dts_number', 'title', 'name', 'date'))
  )
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/** Reads and checks a chosen backup file. Rejects with "This file is not a DTS Tracker backup." */
export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error(NOT_A_BACKUP_MESSAGE)
  let json: unknown
  try {
    json = JSON.parse(await readText(file))
  } catch {
    throw new Error(NOT_A_BACKUP_MESSAGE)
  }
  if (!looksLikeBackup(json)) throw new Error(NOT_A_BACKUP_MESSAGE)
  return json
}

/**
 * The function signs URLs with its own SUPABASE_URL, which locally is an internal Docker host.
 * Keep the signed path and token but point it at the project URL this app uses.
 */
export function toBrowserUrl(signed: string, base: string = import.meta.env.VITE_SUPABASE_URL): string {
  try {
    const u = new URL(signed)
    const b = new URL(base)
    // Keep any path prefix on the base (e.g. a proxy) in front of /storage/v1/….
    const prefix = b.pathname.replace(/\/$/, '')
    return `${b.origin}${prefix}${u.pathname}${u.search}`
  } catch {
    return signed
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
