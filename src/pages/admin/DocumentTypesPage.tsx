import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { MoreHorizontal, Plus, Search } from 'lucide-react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { friendlyDbError } from '@/lib/dbErrors'
import { supabase } from '@/lib/supabase'
import type { DocumentType } from '@/lib/types'
import { errorMessage, Field, FormError, PageHeader } from '@/pages/admin/shared'

/** Names and offices are stored upper-case, like the seeded district route list. */
const canon = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase()

export default function DocumentTypesPage() {
  const [rows, setRows] = useState<DocumentType[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const [query, setQuery] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DocumentType | undefined>(undefined)
  const [toDelete, setToDelete] = useState<DocumentType | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let live = true
    Promise.resolve().then(() => supabase.from('document_types').select('id, name, office, requires_leave_dates').order('name')).then(
      ({ data, error }) => {
        if (!live) return
        if (error) setLoadError(error.message)
        else {
          setLoadError(null)
          setRows((data ?? []) as DocumentType[])
        }
      },
      (e: unknown) => live && setLoadError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [reloadKey])

  const offices = useMemo(() => [...new Set((rows ?? []).map((t) => t.office))].sort(), [rows])
  const shown = useMemo(() => {
    const q = query.trim().toUpperCase()
    return (rows ?? []).filter((t) => !q || t.name.includes(q) || t.office.includes(q))
  }, [rows, query])

  function openForm(t?: DocumentType) {
    setEditing(t)
    setFormOpen(true)
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const { error } = await supabase.from('document_types').delete().eq('id', toDelete.id)
      if (error) return setDeleteError(friendlyDbError(error))
      toast.success('Document type deleted')
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
        title="Document types"
        subtitle={`${rows?.length ?? 0} types from the district route list. Set which office each one goes to.`}
        action={
          <Button onClick={() => openForm()}>
            <Plus aria-hidden />
            Add type
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search"
            placeholder="Search document type or office"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {rows && <span className="text-sm text-muted-foreground">{shown.length} shown</span>}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document type</TableHead>
              <TableHead>Routed to office</TableHead>
              <TableHead>Asks for dates?</TableHead>
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
                  Loading document types…
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? 'No document types yet.' : 'No matching document types.'}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="min-w-48 font-medium whitespace-normal">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.office}</Badge>
                  </TableCell>
                  <TableCell>{t.requires_leave_dates ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="w-10 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openForm(t)}>Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setDeleteError(null)
                            setToDelete(t)
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
            <TypeForm
              key={editing?.id ?? 'new'}
              type={editing}
              offices={offices}
              onCancel={() => setFormOpen(false)}
              onSaved={() => {
                setFormOpen(false)
                toast.success('Document type saved')
                reload()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name ?? 'this document type'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Types already used by records can't be deleted. This cannot be undone.
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

function TypeForm({
  type,
  offices,
  onCancel,
  onSaved,
}: {
  type?: DocumentType
  offices: string[]
  onCancel(): void
  onSaved(): void
}) {
  const [name, setName] = useState(type?.name ?? '')
  const [office, setOffice] = useState(type?.office ?? '')
  const [dates, setDates] = useState(type?.requires_leave_dates ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { name: canon(name), office: canon(office), requires_leave_dates: dates }
    if (!row.name) return setError('Enter the document type.')
    if (!row.office) return setError('Enter the office it is routed to.')
    setSaving(true)
    setError(null)
    try {
      const { error: dbError } = type
        ? await supabase.from('document_types').update(row).eq('id', type.id)
        : await supabase.from('document_types').insert(row)
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
        <DialogTitle>{type ? 'Edit document type' : 'Add document type'}</DialogTitle>
        <DialogDescription className="sr-only">
          The document type name, the office it is routed to, and whether it asks for dates.
        </DialogDescription>
      </DialogHeader>
      <Field id="tf-name" label="Document type">
        <Input id="tf-name" placeholder="e.g. Travel Order" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="tf-office" label="Routed to office" hint="Filled in automatically when this type is chosen.">
        <Input
          id="tf-office"
          list="tf-office-list"
          placeholder="e.g. Accounting Office"
          aria-describedby="tf-office-hint"
          value={office}
          onChange={(e) => setOffice(e.target.value)}
        />
        <datalist id="tf-office-list">
          {offices.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={dates}
          onChange={(e) => setDates(e.target.checked)}
        />
        Has Date from, Date to, and Excluded date
      </label>
      <FormError message={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save document type'}
        </Button>
      </DialogFooter>
    </form>
  )
}
