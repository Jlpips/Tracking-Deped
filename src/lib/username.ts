const USERNAME_RE = /^[a-z0-9._-]+$/

/** Maps a sign-in username to the internal Supabase Auth address. Never shown in the UI. */
export function usernameToEmail(username: string): string {
  const u = username.trim().toLowerCase()
  if (!USERNAME_RE.test(u)) throw new Error('Invalid username')
  return `${u}@dts.local`
}
