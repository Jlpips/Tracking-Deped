// admin-users Edge Function: account creation, edits, password resets, and disabling.
// Runs with the service-role key, so these operations never happen in the browser.
// Routing and checks live in handler.ts/logic.ts; this file only wires the real Supabase clients.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getCaller, type CallerProfile } from '../_shared/auth.ts'
import { generateTempPassword } from './logic.ts'
import { handler, StoreError, type AdminStore, type ProfileRow } from './handler.ts'

const PROFILE_COLUMNS = 'user_id, username, full_name, role, school_id, must_change_password, disabled'

function env(...names: string[]): string {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  throw new Error(`Missing environment variable: ${names.join(' or ')}`)
}

function storeError(e: { message: string; code?: string }): StoreError {
  return new StoreError(e.message, e.code)
}

function makeStore(admin: SupabaseClient): AdminStore {
  return {
    async getProfile(userId) {
      const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle()
      if (error) throw storeError(error)
      return (data as ProfileRow | null) ?? null
    },
    async usernameTaken(username) {
      const { count, error } = await admin
        .from('profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('username', username)
      if (error) throw storeError(error)
      return (count ?? 0) > 0
    },
    async createAuthUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !data.user) throw storeError(error ?? { message: 'Could not create the account.' })
      return data.user.id
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw storeError(error)
    },
    async updateAuthUser(userId, attrs) {
      const { error } = await admin.auth.admin.updateUserById(userId, attrs)
      if (error) throw storeError(error)
    },
    async insertProfile(row) {
      const { error } = await admin.from('profiles').insert(row)
      if (error) throw storeError(error)
    },
    async updateProfile(userId, patch) {
      const { error } = await admin.from('profiles').update(patch).eq('user_id', userId)
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
    newPassword: () => generateTempPassword(),
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
