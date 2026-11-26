import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { friendlyDbError } from '@/lib/dbErrors'
import { supabase } from '@/lib/supabase'
import type { School } from '@/lib/types'
import { errorMessage, Field, FormError, PageHeader } from '@/pages/admin/shared'

type SchoolRow = School & { profiles?: { count: number }[]; records?: { count: number }[] }

const count = (rel?: { count: number }[]) => rel?.[0]?.count ?? 0

export default function SchoolsPage() {
  const [rows, setRows] = useState<SchoolRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SchoolRow | undefined>(undefined)
  const [toDelete, setToDelete] = useState<SchoolRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let live = true
    // Counts are what the admin can see: users (superadmins excluded by RLS) and records.
    Promise.resolve().then(() => supabase.from('schools').select('id, name, profiles(count), records(count)').order('name')).then(
      ({ data, error }) => {
        if (!live) return
        if (error) setLoadError(error.message)
        else {
          setLoadError(null)
          setRows((data ?? []) as SchoolRow[])
        }
      },
      (e: unknown) => live && setLoadError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [reloadKey])

  function openForm(s?: SchoolRow) {
    setEditing(s)
    setFormOpen(true)
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const { error } = await supabase.from('schools').delete().eq('id', toDelete.id)
      if (error) return setDeleteError(friendlyDbError(error))
      toast.success('School deleted')
      setToDelete(null)
      reload()
    } catch (e) {
      setDeleteError(errorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Schools"
        subtitle="Schools in the district."
        action={
          <Button onClick={() => openForm()}>
            <Plus aria-hidden />
            Add school
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center">
                  <p role="alert" className="text-destructive">
                    {loadError}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : rows === null ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading schools…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No schools yet. Add the first one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium whitespace-normal">{s.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(s.profiles)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(s.records)}</TableCell>
                  <TableCell className="w-10 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openForm(s)}>Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setDeleteError(null)
                            setToDelete(s)
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          {formOpen && (
            <SchoolForm
              key={editing?.id ?? 'new'}
              school={editing}
              onCancel={() => setFormOpen(false)}
              onSaved={() => {
                setFormOpen(false)
                toast.success('School saved')
                reload()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name ?? 'this school'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Schools with users or records can't be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormError message={deleteError} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SchoolForm({ school, onCancel, onSaved }: { school?: SchoolRow; onCancel(): void; onSaved(): void }) {
  const [name, setName] = useState(school?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = name.trim()
    if (!value) return setError('Enter the school name.')
    setSaving(true)
    setError(null)
    try {
      const { error: dbError } = school
        ? await supabase.from('schools').update({ name: value }).eq('id', school.id)
        : await supabase.from('schools').insert({ name: value })
      if (dbError) setError(friendlyDbError(dbError))
      else onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{school ? 'Edit school' : 'Add school'}</DialogTitle>
        <DialogDescription className="sr-only">
          {school ? 'Rename this school.' : 'Add a school to the district list.'}
        </DialogDescription>
      </DialogHeader>
      <Field id="sf-name" label="School name" hint="It will appear in the school dropdown for admins and in Add user.">
        <Input
          id="sf-name"
          placeholder="e.g. Pinagbayanan ES"
          aria-describedby="sf-name-hint"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <FormError message={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save school'}
        </Button>
      </DialogFooter>
    </form>
  )
}
