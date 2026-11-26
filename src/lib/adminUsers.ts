import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Requests understood by the `admin-users` Edge Function (supabase/functions/admin-users). */
export type AdminUsersRequest =
  | { action: 'create'; username: string; full_name: string; role: 'user' | 'admin'; school_id?: string }
  | { action: 'update'; user_id: string; full_name?: string; role?: 'user' | 'admin'; school_id?: string | null }
  | { action: 'reset_password'; user_id: string }
  | { action: 'set_disabled'; user_id: string; disabled: boolean }

export interface Credentials {
  username: string
  temp_password: string
}

const GENERIC = 'Something went wrong. Please try again.'

/**
 * Calls the admin-users Edge Function. Account creation and password resets need the service key,
 * so they only ever happen there. Rejects with the function's own error message when it has one.
 */
export async function callAdminUsers(body: AdminUsersRequest): Promise<any> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
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
