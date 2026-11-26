import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { AuthLayout } from '@/components/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { usernameToEmail } from '@/lib/username'

const PASSWORD_HINT = 'At least 8 characters, with a letter and a number.'

/** Returns an error message, or null when the new password is acceptable. */
function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
    return 'Use at least 8 characters, with a letter and a number.'
  }
  if (next !== confirm) return 'The new passwords do not match.'
  if (next === current) return 'Choose a password different from your temporary password.'
  return null
}

export default function ChangePasswordPage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!profile) return null
  // Only first sign-in uses this screen; everyone else goes straight to the app.
  if (!profile.must_change_password && !busy) return <Navigate to="/records" replace />
  const username = profile.username

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const invalid = validateNewPassword(current, next, confirm)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setBusy(true)
    try {
      // Re-authenticate with the temporary password so a left-open session can't be hijacked.
      const verify = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password: current })
      if (verify.error) {
        setError('Your temporary password is not correct.')
        return
      }
      const updated = await supabase.auth.updateUser({ password: next })
      if (updated.error) {
        setError(`Could not save your password: ${updated.error.message}`)
        return
      }
      const done = await supabase.rpc('complete_password_change')
      if (done.error) {
        setError(`Your password was changed, but we could not finish setup: ${done.error.message}`)
        return
      }
      await refreshProfile()
      toast.success('Password changed')
      navigate('/records', { replace: true })
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      headline="Set your own password."
      blurb="The password you were given is temporary. Choose a new one to continue. Only you will know it."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Change your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            First sign-in for <b className="font-mono font-medium text-foreground">{username}</b>
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Temporary password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="new-password-hint"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <p id="new-password-hint" className="text-xs text-muted-foreground">
            {PASSWORD_HINT}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-9 w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password and continue'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()} disabled={busy}>
          Sign out
        </Button>
      </form>
    </AuthLayout>
  )
}
