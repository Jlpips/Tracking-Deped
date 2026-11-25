import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Copy, Download, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toCsv } from '@/lib/csv'
import {
  RECORD_EXPORT_HEADERS,
  deleteRecord,
  listAllRecords,
  listRecords,
  recordExportRow,
  type RecordFilters,
} from '@/lib/records'
import { supabase } from '@/lib/supabase'
import type { DocumentType, DtsRecord, School } from '@/lib/types'
import { RecordForm } from '@/pages/RecordForm'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300
/** Radix Select can't use '' as an item value, so "All …" options use this sentinel. */
const ALL = '__all'
const EMPTY_COPY = 'No matching records. Try a different filter.'

type Filters = Omit<RecordFilters, 'page' | 'pageSize'>
type ParamKey = 'q' | 'school' | 'type' | 'office' | 'from' | 'to' | 'page'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIso(v: string): Date | null {
  const m = ISO_DATE.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const fmtFull = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** "Nov 24, 2026"; non-ISO text (e.g. a free-form excluded date) is shown as typed. */
function formatDate(v: string | null): string {
  if (!v) return ''
  const d = parseIso(v)
  return d ? fmtFull.format(d) : v
}

/** "Dec 9 – Dec 11, 2026", or both years spelled out when they differ. */
function formatRange(from: string | null, to: string | null): string {
  if (!from && !to) return ''
  if (!from || !to) return formatDate(from ?? to)
  const a = parseIso(from)
  const b = parseIso(to)
  if (a && b && a.getFullYear() === b.getFullYear()) return `${fmtShort.format(a)} – ${fmtFull.format(b)}`
  return `${formatDate(from)} – ${formatDate(to)}`
}

function displayName(r: DtsRecord): string {
  return r.honorific ? `${r.honorific} ${r.name}` : r.name
}

function localIsoToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function compact(f: Filters): Filters {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as Filters
}

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Filter options ordered by name; resolves to [] on any failure so the page still works. */
async function loadOptions<T>(table: 'document_types' | 'schools'): Promise<T[]> {
  try {
    const { data, error } = await supabase.from(table).select('*').order('name')
    return error || !data ? [] : (data as T[])
  } catch {
    return []
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function RecordsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'
  const [params, setParams] = useSearchParams()

  const q = params.get('q') ?? ''
  const schoolId = isAdmin ? (params.get('school') ?? '') : ''
  const typeId = params.get('type') ?? ''
  const office = params.get('office') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const filters = useMemo<Filters>(
    () =>
      compact({
        q: q || undefined,
        schoolId: schoolId || undefined,
        documentTypeId: typeId || undefined,
        office: office || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    [q, schoolId, typeId, office, from, to],
  )

  /** Sets/clears params; any filter change returns to page 1 unless `page` itself is being set. */
  const update = useCallback(
    (changes: Partial<Record<ParamKey, string | undefined>>, replace = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (!('page' in changes)) next.delete('page')
          for (const [k, v] of Object.entries(changes)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace },
      )
    },
    [setParams],
  )

  // Search box: local state, written to the URL after a pause in typing.
  const [search, setSearch] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  if (q !== syncedQ) {
    // URL changed (our own debounced write, back button, or a link): reflect it in the box.
    setSyncedQ(q)
    setSearch(q)
  }
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => update({ q: search || undefined }, true), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search, q, update])

  // Filter options. A failed load leaves the list empty; the records themselves still load.
  const [types, setTypes] = useState<DocumentType[]>([])
  const [schools, setSchools] = useState<School[]>([])
  useEffect(() => {
    let live = true
    loadOptions<DocumentType>('document_types').then((data) => live && setTypes(data))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!isAdmin) return
    let live = true
    loadOptions<School>('schools').then((data) => live && setSchools(data))
    return () => {
      live = false
    }
  }, [isAdmin])
  const offices = useMemo(() => [...new Set(types.map((t) => t.office))].sort(), [types])

  // Records.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  // Each request is identified by its inputs; we're loading until a result for the current key lands.
  const requestKey = JSON.stringify([filters, page, reloadKey])
  const [result, setResult] = useState<{
    key: string
    rows: DtsRecord[]
    total: number
    error: string | null
  }>({ key: '', rows: [], total: 0, error: null })
  const loading = result.key !== requestKey
  const { rows, total } = result
  const error = loading ? null : result.error

  useEffect(() => {
    let live = true
    listRecords({ ...filters, page, pageSize: PAGE_SIZE }).then(
      (res) => {
        if (live) setResult({ key: requestKey, rows: res.rows, total: res.total, error: null })
      },
      (e: unknown) => {
        if (live) setResult((prev) => ({ ...prev, key: requestKey, error: errorMessage(e) }))
      },
    )
    return () => {
      live = false
    }
  }, [filters, page, requestKey])

  // Past the last page (e.g. after deleting its only row): step back to the last page.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (!loading && !error && page > lastPage) update({ page: lastPage > 1 ? String(lastPage) : undefined }, true)
  }, [loading, error, page, lastPage, update])

  // Sheets and dialogs.
  const [slip, setSlip] = useState<DtsRecord | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DtsRecord | undefined>(undefined)
  const [toDelete, setToDelete] = useState<DtsRecord | null>(null)
  const [exporting, setExporting] = useState(false)

  function openForm(record?: DtsRecord) {
    setSlip(null)
    setEditing(record)
    setFormOpen(true)
  }

  async function confirmDelete() {
    const r = toDelete
    if (!r) return
    try {
      await deleteRecord(r.id)
      toast.success('Record deleted')
      setToDelete(null)
      setSlip(null)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await listAllRecords(filters)
      const headers = isAdmin ? ['School', ...RECORD_EXPORT_HEADERS] : RECORD_EXPORT_HEADERS
      downloadCsv(`dts-records-${localIsoToday()}.csv`, toCsv(headers, all.map((r) => recordExportRow(r, isAdmin))))
      // Audit log is best-effort; never hold up or fail the download on it.
      Promise.resolve(
        supabase.rpc('log_activity', { p_action: 'export.csv', p_details: { rows: all.length, filters } }),
      ).catch(() => {})
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  async function copyDts(dts: string) {
    try {
      await navigator.clipboard.writeText(dts)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy. Select the number and copy it instead.')
    }
  }

  const colCount = isAdmin ? 7 : 6
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRow = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Records</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? 'Documents from every school in the district.'
              : `Documents of ${profile?.school?.name ?? 'your school'}.`}
          </p>
        </div>
        <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
          <Download aria-hidden />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        <Button onClick={() => openForm()}>
          <Plus aria-hidden />
          Add record
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search"
            placeholder="Search name, title, or DTS number"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isAdmin && (
          <FilterSelect
            label="School"
            allLabel="All schools"
            value={schoolId}
            options={schools.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(v) => update({ school: v })}
          />
        )}
        <FilterSelect
          label="Document type"
          allLabel="All document types"
          value={typeId}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => update({ type: v })}
        />
        <FilterSelect
          label="Office"
          allLabel="All offices"
          value={office}
          options={offices.map((o) => ({ value: o, label: o }))}
          onChange={(v) => update({ office: v })}
        />
        <div className="flex items-center gap-1.5">
          <Label htmlFor="records-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="records-from"
            type="date"
            className="w-auto"
            value={from}
            max={to || undefined}
            onChange={(e) => update({ from: e.target.value || undefined })}
          />
          <Label htmlFor="records-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="records-to"
            type="date"
            className="w-auto"
            value={to}
            min={from || undefined}
            onChange={(e) => update({ to: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {isAdmin && <TableHead>School</TableHead>}
              <TableHead>Document</TableHead>
              <TableHead>DTS number</TableHead>
              <TableHead>Office</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  Loading records…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center">
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  {EMPTY_COPY}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  className="cursor-pointer align-top"
                  onClick={() => setSlip(r)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      setSlip(r)
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  {isAdmin && <TableCell className="whitespace-nowrap">{r.school?.name ?? '—'}</TableCell>}
                  <TableCell className="min-w-64 whitespace-normal">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {displayName(r)} · encoded by <span className="font-mono">{r.created_by_username}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.dts_number}</TableCell>
                  <TableCell className="whitespace-normal">
                    {r.document_type && <Badge variant="secondary">{r.document_type.office}</Badge>}
                    <div className="mt-1 max-w-56 text-xs text-muted-foreground">{r.document_type?.name}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {r.date_from || r.date_to ? (
                      <>
                        {formatRange(r.date_from, r.date_to)}
                        {r.excluded_date && (
                          <div className="text-muted-foreground">excl. {formatDate(r.excluded_date)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.dts_number}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setSlip(r)}>View routing slip</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openForm(r)}>Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(r)}>
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
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
          <span>
            {firstRow}–{lastRow} of {total}
          </span>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : undefined })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= lastPage}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      </div>

      <RoutingSlip
        record={slip}
        onClose={() => setSlip(null)}
        onCopy={(dts) => void copyDts(dts)}
        onEdit={(r) => openForm(r)}
        onDelete={(r) => setToDelete(r)}
      />

      <RecordForm
        open={formOpen}
        onOpenChange={setFormOpen}
        record={editing}
        onSaved={() => {
          setFormOpen(false)
          reload()
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete ? `${toDelete.dts_number} · ${toDelete.title}. ` : ''}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange(value: string | undefined): void
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger aria-label={label} className="max-w-full min-w-40 sm:max-w-64">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RoutingSlip({
  record: r,
  onClose,
  onCopy,
  onEdit,
  onDelete,
}: {
  record: DtsRecord | null
  onClose(): void
  onCopy(dts: string): void
  onEdit(r: DtsRecord): void
  onDelete(r: DtsRecord): void
}) {
  return (
    <Sheet open={r !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Routing slip</SheetTitle>
          <SheetDescription className="sr-only">Details of this record and where it was routed.</SheetDescription>
        </SheetHeader>
        {r && (
          <div className="mx-4 overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center gap-3 bg-navy px-4 py-4 text-white">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 text-xs text-[#9fb6d2]">DTS number</div>
                <span className="inline-block rounded-md border border-white/30 bg-white/10 px-2 py-1 font-mono text-sm break-all">
                  {r.dts_number}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                onClick={() => onCopy(r.dts_number)}
              >
                <Copy aria-hidden />
                Copy
              </Button>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[130px_1fr]">
              <SlipItem label="Document">{r.title}</SlipItem>
              <SlipItem label="Document type">{r.document_type?.name ?? '—'}</SlipItem>
              <SlipItem label="Name">{displayName(r)}</SlipItem>
              <SlipItem label="Contact number">{r.contact || '—'}</SlipItem>
              <SlipItem label="School">{r.school?.name ?? '—'}</SlipItem>
              <SlipItem label="Date">{formatDate(r.date)}</SlipItem>
              {(r.date_from || r.date_to) && (
                <SlipItem label="Dates">
                  {formatRange(r.date_from, r.date_to)}
                  {r.excluded_date && (
                    <div className="font-normal text-muted-foreground">Excluded: {formatDate(r.excluded_date)}</div>
                  )}
                </SlipItem>
              )}
              <SlipItem label="Office routed to">{r.document_type?.office ?? '—'}</SlipItem>
              <SlipItem label="Encoded by">
                <span className="font-mono">{r.created_by_username}</span>
              </SlipItem>
            </dl>
            <div aria-hidden className="relative border-t-2 border-dashed">
              <span className="absolute -top-2.5 -left-2.5 size-4 rounded-full border bg-popover" />
              <span className="absolute -top-2.5 -right-2.5 size-4 rounded-full border bg-popover" />
            </div>
            <div className="px-4 pt-4 pb-2 text-sm font-semibold">Routed to</div>
            <div className="flex items-center gap-2.5 px-4 pb-4 text-sm">
              <div className="min-w-0 flex-1 rounded-lg border px-3 py-2">
                <small className="block text-xs text-muted-foreground">From</small>
                {r.school?.name ?? '—'}
              </div>
              <ArrowRight aria-label="to" className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2">
                <small className="block text-xs text-muted-foreground">Office</small>
                <b className="font-semibold">{r.document_type?.office ?? '—'}</b>
              </div>
            </div>
          </div>
        )}
        {r && (
          <SheetFooter className="flex-row items-center border-t">
            <Button variant="destructive" onClick={() => onDelete(r)}>
              Delete
            </Button>
            <span className="flex-1" />
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => onEdit(r)}>Edit</Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SlipItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 font-medium break-words">{children}</dd>
    </>
  )
}
