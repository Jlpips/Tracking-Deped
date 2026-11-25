export type Role = 'user' | 'admin' | 'superadmin'

export interface Caller {
  userId: string
  role: Role
  username: string
}

export interface CallerProfile {
  user_id: string
  username: string
  role: Role
  disabled: boolean
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface CallerDeps {
  /** Verifies an access token (anon client `auth.getUser(jwt)`); resolves the user id, or null if invalid. */
  verifyJwt(jwt: string): Promise<string | null>
  /** Loads a profile with the service client; null when there is none. */
  loadProfile(userId: string): Promise<CallerProfile | null>
}

const SIGN_IN_AGAIN = 'Please sign in again.'

/** Identifies the signed-in caller. Throws HttpError(401) if the token is missing/invalid or the profile is missing/disabled. */
export async function getCaller(req: Request, deps: CallerDeps): Promise<Caller> {
  const header = req.headers.get('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(header)
  if (!m) throw new HttpError(401, SIGN_IN_AGAIN)
  const userId = await deps.verifyJwt(m[1].trim())
  if (!userId) throw new HttpError(401, SIGN_IN_AGAIN)
  const profile = await deps.loadProfile(userId)
  if (!profile || profile.disabled) throw new HttpError(401, SIGN_IN_AGAIN)
  return { userId: profile.user_id, role: profile.role, username: profile.username }
}
