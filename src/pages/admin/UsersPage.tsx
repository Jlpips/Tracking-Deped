import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { callAdminUsers, type AdminUsersRequest, type Credentials } from '@/lib/adminUsers'
import { supabase } from '@/lib/supabase'
import type { Profile, School } from '@/lib/types'
import { usernameToEmail } from '@/lib/username'
import { errorMessage, Field, FormError, PageHeader, SELECT_CLASS } from '@/pages/admin/shared'

type UserRow = Profile & { school: School | null }
type AssignableRole = 'user' | 'admin'

const USERNAME_RULE = 'Usernames can use only letters, numbers, dots, dashes, and underscores, with no spaces.'
const CREDENTIALS_NOTE =
  'Give these to the user. They must change the password when they first sign in. The password is shown only once.'

function status(u: UserRow): { label: string; className: string } {
  if (u.disabled) return { label: 'Disabled', className: 'text-muted-foreground' }
  if (u.must_change_password) return { label: 'Must change password', className: 'text-amber-700 dark:text-amber-400' }
  return { label: 'Active', className: 'text-emerald-700 dark:text-emerald-400' }
}

type Confirm = { kind: 'reset' | 'disable'; user: UserRow }

export default function UsersPage() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [schools, setSchools] = useState<School[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | undefined>(undefined)
  const [creds, setCreds] = useState<{ title: string; creds: Credentials } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    Promise.resolve().then(() =>
      supabase
        .from('profiles')
        .select('user_id, username, full_name, role, school_id, must_change_password, disabled, school:schools(id, name)')
        .order('full_name'),
    ).then(
      ({ data, error }) => {
        if (!live) return
        if (error) setLoadError(error.message)
        else {
          setLoadError(null)
          setUsers((data ?? []) as unknown as UserRow[])
        }
      },
      (e: unknown) => live && setLoadError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [reloadKey])

  useEffect(() => {
    let live = true
    Promise.resolve().then(() => supabase.from('schools').select('id, name').order('name')).then(
      ({ data }) => live && setSchools((data ?? []) as School[]),
      () => {},
    )
    return () => {
      live = false
    }
  }, [])

  function openForm(u?: UserRow) {
    setEditing(u)
    setFormOpen(true)
  }

  async function runConfirm() {
    if (!confirm) return
    const { kind, user } = confirm
    setBusy(true)
    try {
      if (kind === 'reset') {
        const res = (await callAdminUsers({ action: 'reset_password', user_id: user.user_id })) as Credentials
        setCreds({ title: 'Password reset', creds: res })
      } else {
        await callAdminUsers({ action: 'set_disabled', user_id: user.user_id, disabled: true })
        toast.success('Account disabled')
        reload()
      }
      setConfirm(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function enable(u: UserRow) {
    try {
      await callAdminUsers({ action: 'set_disabled', user_id: u.user_id, disabled: false })
      toast.success('Account enabled')
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        subtitle="Create accounts with a username, a temporary password, and an assigned school."
        action={
          <Button onClick={() => openForm()}>
            <Plus aria-hidden />
            Add user
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>School</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p role="alert" className="text-destructive">
                    {loadError}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : users === null ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Loading users…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No users yet. Add the first one.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const st = status(u)
                const self = u.user_id === profile?.user_id
                return (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium whitespace-normal">{u.full_name}</TableCell>
                    <TableCell className="font-mono text-xs">{u.username}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'user' ? 'secondary' : 'outline'}>
                        {u.role === 'user' ? 'User' : 'Admin'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">{u.school?.name ?? '—'}</TableCell>
                    <TableCell className={`text-sm font-medium ${st.className}`}>{st.label}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.username}`}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openForm(u)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfirm({ kind: 'reset', user: u })}>
                            Reset password
                          </DropdownMenuItem>
                          {!self && (
                            <>
                              <DropdownMenuSeparator />
                              {u.disabled ? (
                                <DropdownMenuItem onSelect={() => void enable(u)}>Enable account</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setConfirm({ kind: 'disable', user: u })}
                                >
                                  Disable account
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {profile?.role === 'superadmin' && (
        <p className="text-xs text-muted-foreground">
          Superadmins are not shown in this list. They are created in Supabase only.
        </p>
      )}

      <UserSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        schools={schools}
        isSelf={editing !== undefined && editing.user_id === profile?.user_id}
        onCreated={(c) => {
          setFormOpen(false)
          setCreds({ title: 'User created', creds: c })
          reload()
        }}
        onSaved={() => {
          setFormOpen(false)
          toast.success('User saved')
          reload()
        }}
      />

      <CredentialsDialog
        value={creds}
        onClose={() => {
          setCreds(null)
          reload()
        }}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'reset'
                ? `Reset the password of ${confirm.user.full_name}?`
                : `Disable ${confirm?.user.full_name ?? 'this account'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'reset'
                ? 'Their current password stops working. You will get a new temporary password to give them.'
                : 'They lose access right away and cannot sign in until the account is enabled again. Their records are kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.kind === 'disable' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void runConfirm()
              }}
            >
              {confirm?.kind === 'reset' ? 'Reset password' : 'Disable account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function UserSheet({
  open,
  onOpenChange,
  user,
  schools,
  isSelf,
  onCreated,
  onSaved,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  user?: UserRow
  schools: School[]
  isSelf: boolean
  onCreated(c: Credentials): void
  onSaved(): void
}) {
  const editing = user !== undefined
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Edit user' : 'Add user'}</SheetTitle>
          <SheetDescription>
            {editing
              ? 'Change the name, role, or school of this account.'
              : 'The user gets a temporary password and must change it at first sign-in.'}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <UserForm
            key={user?.user_id ?? 'new'}
            user={user}
            schools={schools}
            isSelf={isSelf}
            onCancel={() => onOpenChange(false)}
            onCreated={onCreated}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function UserForm({
  user,
  schools,
  isSelf,
  onCancel,
  onCreated,
  onSaved,
}: {
  user?: UserRow
  schools: School[]
  isSelf: boolean
  onCancel(): void
  onCreated(c: Credentials): void
  onSaved(): void
}) {
  const editing = user !== undefined
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<AssignableRole>(user?.role === 'admin' ? 'admin' : 'user')
  const [schoolId, setSchoolId] = useState(user?.school_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const name = fullName.trim()
    if (!name) return setError('Enter the full name.')
    if (!editing) {
      try {
        usernameToEmail(username)
      } catch {
        return setError(USERNAME_RULE)
      }
    }
    if (role === 'user' && !schoolId) return setError('Choose the school this user belongs to.')

    setSaving(true)
    try {
      if (editing) {
        await callAdminUsers({
          action: 'update',
          user_id: user.user_id,
          full_name: name,
          role,
          school_id: role === 'user' ? schoolId : null,
        })
        onSaved()
      } else {
        const body: AdminUsersRequest = {
          action: 'create',
          full_name: name,
          username: username.trim().toLowerCase(),
          role,
          ...(role === 'user' ? { school_id: schoolId } : {}),
        }
        onCreated((await callAdminUsers(body)) as Credentials)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field id="uf-name" label="Full name">
          <Input id="uf-name" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field
          id="uf-username"
          label="Username"
          hint={editing ? "The username can't be changed." : 'The user signs in with this. A School ID works well.'}
        >
          <Input
            id="uf-username"
            className="font-mono"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="e.g. 108874 (School ID)"
            aria-describedby="uf-username-hint"
            disabled={editing}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="uf-role" label="Role" hint={isSelf ? "You can't change your own role." : undefined}>
            <select
              id="uf-role"
              className={SELECT_CLASS}
              disabled={isSelf}
              value={role}
              onChange={(e) => setRole(e.target.value as AssignableRole)}
            >
              <option value="user">User (school)</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          {role === 'user' && (
            <Field id="uf-school" label="Assigned school">
              <select
                id="uf-school"
                className={SELECT_CLASS}
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a school
                </option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <FormError message={error} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save user' : 'Create user'}
        </Button>
      </div>
    </form>
  )
}

function CredentialsDialog({
  value,
  onClose,
}: {
  value: { title: string; creds: Credentials } | null
  onClose(): void
}) {
  async function copyBoth() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(
        `Username: ${value.creds.username}\nTemporary password: ${value.creds.temp_password}`,
      )
      toast.success('Copied')
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.')
    }
  }

  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{value?.title}</DialogTitle>
          <DialogDescription>{CREDENTIALS_NOTE}</DialogDescription>
        </DialogHeader>
        {value && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Username</dt>
            <dd className="font-mono break-all">{value.creds.username}</dd>
            <dt className="text-muted-foreground">Temporary password</dt>
            <dd className="font-mono break-all">{value.creds.temp_password}</dd>
          </dl>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void copyBoth()}>
            <Copy aria-hidden />
            Copy both
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
