// Pure checks used by import-workbook.ts (kept separate so they can be unit-tested).

export interface CreatorProfile {
  user_id: string
  username: string
  role: string
  disabled: boolean
}

export type CreatorCheck = { ok: true; user_id: string; username: string } | { ok: false; error: string }

/**
 * The account given with --created-by is shown as "Encoded by" on every imported record,
 * so it must be an enabled district admin - never the hidden superadmin or a school user.
 */
export function checkImportCreator(username: string, profile: CreatorProfile | null): CreatorCheck {
  if (!profile) {
    return { ok: false, error: `No account with username "${username}". Create an admin account first (Users page).` }
  }
  if (profile.role === 'superadmin') {
    return {
      ok: false,
      error: `"${username}" is a superadmin. Imported records show who encoded them; use a district admin account instead.`,
    }
  }
  if (profile.role !== 'admin') {
    return { ok: false, error: `"${username}" is a school user. --created-by must be a district admin account.` }
  }
  if (profile.disabled) {
    return { ok: false, error: `"${username}" is disabled. Enable it or choose another admin account.` }
  }
  return { ok: true, user_id: profile.user_id, username: profile.username }
}

/** Date problems for a parsed row, or null. Dates are ISO yyyy-mm-dd strings. */
export function leaveDateProblem(
  docType: { name: string; requires_leave_dates: boolean },
  record: { date_from: string | null; date_to: string | null },
): string | null {
  if (docType.requires_leave_dates && (!record.date_from || !record.date_to)) {
    return `FROM and TO dates are required for ${docType.name}`
  }
  if (record.date_from && record.date_to && record.date_to < record.date_from) {
    return `TO date ${record.date_to} is before FROM date ${record.date_from}`
  }
  return null
}
