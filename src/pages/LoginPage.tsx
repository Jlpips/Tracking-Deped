import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, WRONG_CREDENTIALS } from '@/auth/AuthProvider'
import { AuthLayout } from '@/components/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const { session, profile, loading, notice, signIn } = useAuth()
  const location = useLocation()
  const stateNotice = (location.state as { notice?: string } | null)?.notice ?? null
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session && profile && !profile.disabled) return <Navigate to="/records" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(username, password)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : WRONG_CREDENTIALS)
    } finally {
      setBusy(false)
    }
  }

  const message = error ?? notice ?? stateNotice

  return (
    <AuthLayout
      headline="Know where every document is."
      blurb="Log documents entered in DTS and see right away which office they go to."
      footer={
        <span className="self-start rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-white/80">
          108874GCNBR-000024
        </span>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the account issued by the district office.</p>
        </div>
        {message && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            placeholder="e.g. your School ID"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-9 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs text-muted-foreground">
          There is no sign-up. Your username and temporary password come from the district office. Forgot your
          password? Ask the district office to reset it.
        </p>
      </form>
    </AuthLayout>
  )
}
