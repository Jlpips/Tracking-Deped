// Deno copy of src/lib/username.ts (Edge Functions can't import from src/). Keep the two in sync.
const USERNAME_RE = /^[a-z0-9._-]+$/

/** Stored form of a username (trimmed, lower-case), or null if it has characters we don't allow. */
export function normalizeUsername(username: string): string | null {
  const u = username.trim().toLowerCase()
  return USERNAME_RE.test(u) ? u : null
}

/** Maps a sign-in username to the internal Supabase Auth address. Never shown in the UI. */
export function usernameToEmail(username: string): string {
  const u = normalizeUsername(username)
  if (u === null) throw new Error('Invalid username')
  return `${u}@dts.local`
}
