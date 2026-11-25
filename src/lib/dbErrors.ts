export const STILL_USED = "This is still used by existing records, so it can't be deleted."
export const NAME_EXISTS = 'That name already exists.'

/** Turns a PostgREST error into the message shown to admins on the Schools and Document types pages. */
export function friendlyDbError(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.'
  if (error.code === '23503') return STILL_USED
  if (error.code === '23505') return NAME_EXISTS
  return error.message || 'Something went wrong. Please try again.'
}
