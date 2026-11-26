import { supabase } from '@/lib/supabase'

export interface ActivityLog {
  id: number
  at: string
  user_id: string | null
  username: string | null
  role: string | null
  action: string
  details: Record<string, unknown> | null
}

export const LOGS_PAGE_SIZE = 50

/** LIKE-escapes `s`, then quotes it for a PostgREST filter value (same rules as src/lib/records.ts). */
function quoted(like: string): string {
  return `"${like.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const prefix = (p: string) => `action.like.${quoted(`${escapeLike(p)}%`)}`

export const ACTION_GROUPS = [
  { value: 'all', label: 'All actions', filter: null },
  { value: 'records', label: 'Records', filter: prefix('records.') },
  { value: 'users', label: 'Users', filter: `${prefix('profiles.')},${prefix('user.')}` },
  { value: 'signin', label: 'Sign-in', filter: `${prefix('login')},action.eq.logout` },
  { value: 'exports', label: 'Exports', filter: prefix('export.') },
  { value: 'backups', label: 'Backups', filter: prefix('backup.') },
  { value: 'settings', label: 'Settings', filter: `${prefix('schools.')},${prefix('document_types.')}` },
] as const

export type ActionGroup = (typeof ACTION_GROUPS)[number]['value']

export interface LogFilters {
  q: string
  group: ActionGroup
  page: number
}

/** One page of activity logs, newest first. Asks for one extra row to know whether there is a next page. */
export async function listActivityLogs(f: LogFilters): Promise<{ rows: ActivityLog[]; hasNext: boolean }> {
  let query = supabase.from('activity_logs').select('id, at, user_id, username, role, action, details')
  const q = f.q.trim()
  if (q) {
    const p = quoted(`%${escapeLike(q)}%`)
    query = query.or(`username.ilike.${p},action.ilike.${p}`)
  }
  const group = ACTION_GROUPS.find((g) => g.value === f.group)
  if (group?.filter) query = query.or(group.filter)
  const start = (f.page - 1) * LOGS_PAGE_SIZE
  const { data, error } = await query
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + LOGS_PAGE_SIZE)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ActivityLog[]
  return { rows: rows.slice(0, LOGS_PAGE_SIZE), hasNext: rows.length > LOGS_PAGE_SIZE }
}

const LABELS: Record<string, string> = {
  'records.insert': 'Added record',
  'records.update': 'Edited record',
  'records.delete': 'Deleted record',
  'profiles.insert': 'Added user profile',
  'profiles.update': 'Changed user profile',
  'profiles.delete': 'Removed user profile',
  'user.create': 'Added user',
  'user.update': 'Edited user',
  'user.reset_password': 'Reset password',
  'user.disable': 'Disabled user',
  'user.enable': 'Enabled user',
  login: 'Signed in',
  logout: 'Signed out',
  'login.failed': 'Failed sign-in',
  'export.csv': 'Exported CSV',
  'backup.create': 'Created backup',
  'backup.restore': 'Restored backup',
  'schools.insert': 'Added school',
  'schools.update': 'Edited school',
  'schools.delete': 'Deleted school',
  'document_types.insert': 'Added document type',
  'document_types.update': 'Edited document type',
  'document_types.delete': 'Deleted document type',
}

export function actionLabel(action: string): string {
  return LABELS[action] ?? action
}

export type ActionKind = 'create' | 'edit' | 'delete' | 'system' | 'login' | 'fail'

/** Colour group for the action dot. */
export function actionKind(action: string): ActionKind {
  if (action === 'login.failed') return 'fail'
  if (action === 'login' || action === 'logout') return 'login'
  if (action.startsWith('backup.') || action.startsWith('export.')) return 'system'
  if (/\.(delete|disable)$/.test(action)) return 'delete'
  if (/\.(insert|create)$/.test(action)) return 'create'
  return 'edit'
}

/** Keys whose value is shown on its own (they identify the thing acted on). */
const BARE = new Set(['dts_number', 'name', 'username'])
/** Ids are noise next to a readable identifier. */
const HIDDEN = new Set(['id', 'user_id', 'school_id'])

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.map(formatValue).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k.replace(/_/g, ' ')} ${formatValue(x)}`)
      .join(', ')
  }
  return String(v)
}

/** Compact one-line text for a log row's jsonb details. */
export function formatDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details) return ''
  const entries = Object.entries(details)
  const visible = entries.filter(([k]) => !HIDDEN.has(k))
  const shown = visible.length > 0 ? visible : entries
  return shown.map(([k, v]) => (BARE.has(k) ? formatValue(v) : `${k.replace(/_/g, ' ')}: ${formatValue(v)}`)).join(' · ')
}
