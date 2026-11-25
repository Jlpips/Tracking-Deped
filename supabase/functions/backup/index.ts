// backup Edge Function: create, list, download, and restore backups (superadmins only).
// Runs with the service-role key, so dumps and restores never happen in the browser.
// Routing and checks live in handler.ts/logic.ts; this file only wires the real Supabase clients.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getCaller, type CallerProfile } from '../_shared/auth.ts'
import { handler, StoreError, type BackupStore, type TableName, type Tables } from './handler.ts'
import { isBackupName } from './logic.ts'

const BUCKET = 'backups'
const PAGE = 1000

const SELECT: Record<TableName, { columns: string; order: string }> = {
  schools: { columns: 'id, name', order: 'id' },
  document_types: { columns: 'id, name, office, requires_leave_dates', order: 'id' },
  profiles: { columns: 'user_id, username, full_name, role, school_id, must_change_password, disabled', order: 'user_id' },
  records: { columns: '*', order: 'id' },
}

const CONFLICT_KEY: Record<TableName, string> = {
  schools: 'id',
  document_types: 'id',
  profiles: 'user_id',
  records: 'id',
}

function env(...names: string[]): string {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  throw new Error(`Missing environment variable: ${names.join(' or ')}`)
}

// deno-lint-ignore no-explicit-any
function storeError(e: any, code?: string): StoreError {
  return new StoreError(e?.message ?? String(e), code ?? e?.code ?? (e?.statusCode ? String(e.statusCode) : undefined))
}

// deno-lint-ignore no-explicit-any
function isMissingObject(e: any): boolean {
  const status = String(e?.statusCode ?? e?.status ?? '')
  return status === '404' || status === '400' || /not.?found/i.test(e?.message ?? '')
}

function makeStore(admin: SupabaseClient): BackupStore {
  const bucket = () => admin.storage.from(BUCKET)

  async function selectAll(table: TableName): Promise<unknown[]> {
    const { columns, order } = SELECT[table]
    const out: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(table).select(columns).order(order).range(from, from + PAGE - 1)
      if (error) throw storeError(error)
      out.push(...(data ?? []))
      if ((data ?? []).length < PAGE) return out
    }
  }

  return {
    async dump() {
      const [schools, document_types, profiles, records] = await Promise.all([
        selectAll('schools'),
        selectAll('document_types'),
        selectAll('profiles'),
        selectAll('records'),
      ])
      return { schools, document_types, profiles, records } as Tables
    },
    async upload(name, body) {
      const { error } = await bucket().upload(name, new Blob([body], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: false,
      })
      if (error) {
        // deno-lint-ignore no-explicit-any
        const status = String((error as any).statusCode ?? '')
        throw storeError(error, status === '409' || /already exists/i.test(error.message) ? 'Duplicate' : undefined)
      }
    },
    async list() {
      const { data, error } = await bucket().list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
      if (error) throw storeError(error)
      return (data ?? [])
        .filter((f) => isBackupName(f.name))
        .map((f) => ({
          name: f.name,
          created_at: f.created_at ?? '',
          size: Number((f.metadata as { size?: number } | null)?.size ?? 0),
        }))
    },
    async read(name) {
      const { data, error } = await bucket().download(name)
      if (error) {
        if (isMissingObject(error)) return null
        throw storeError(error)
      }
      return await data.text()
    },
    async signedUrl(name, seconds) {
      const { data, error } = await bucket().createSignedUrl(name, seconds, { download: name })
      if (error || !data) throw storeError(error, isMissingObject(error) ? 'NotFound' : undefined)
      return data.signedUrl
    },
    async authUserIds() {
      const ids = new Set<string>()
      for (let page = 1; ; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE })
        if (error) throw storeError(error)
        for (const u of data.users) ids.add(u.id)
        if (data.users.length < PAGE) return ids
      }
    },
    async upsert(table, rows) {
      const { error } = await admin.from(table).upsert(rows, { onConflict: CONFLICT_KEY[table] })
      if (error) throw storeError(error)
    },
    async insertLog(row) {
      const { error } = await admin.from('activity_logs').insert(row)
      if (error) throw storeError(error)
    },
  }
}

const url = env('SUPABASE_URL')
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const anon = createClient(url, env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'), noSession)
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), noSession)
const store = makeStore(admin)

Deno.serve((req) =>
  handler(req, {
    store,
    now: () => new Date(),
    getCaller: (r) =>
      getCaller(r, {
        async verifyJwt(jwt) {
          const { data, error } = await anon.auth.getUser(jwt)
          return error || !data.user ? null : data.user.id
        },
        async loadProfile(userId) {
          const { data, error } = await admin
            .from('profiles')
            .select('user_id, username, role, disabled')
            .eq('user_id', userId)
            .maybeSingle()
          if (error) throw storeError(error)
          return (data as CallerProfile | null) ?? null
        },
      }),
  }),
)
