import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ACTION_GROUPS,
  actionKind,
  actionLabel,
  formatDetails,
  listActivityLogs,
  type ActionGroup,
  type ActionKind,
  type ActivityLog,
} from '@/lib/activityLogs'
import { errorMessage, PageHeader, SELECT_CLASS } from '@/pages/admin/shared'

const DOT: Record<ActionKind, string> = {
  create: 'bg-emerald-600',
  edit: 'bg-brand',
  delete: 'bg-destructive',
  system: 'bg-navy dark:bg-sky-300',
  login: 'bg-muted-foreground/60',
  fail: 'bg-destructive ring-3 ring-destructive/25',
}

const ROLE_LABEL: Record<string, string> = { user: 'School user', admin: 'Admin', superadmin: 'Superadmin' }

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatWhen(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : when.format(d)
}

function userText(log: ActivityLog): string {
  if (log.username) return log.username
  return log.action === 'login.failed' ? 'Unknown' : '—'
}

const SEARCH_DELAY_MS = 300

export default function ActivityLogsPage() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<ActionGroup>('all')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ActivityLog[] | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce typing into the query; a new search starts again at page 1.
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => {
      setQ(search)
      setPage(1)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [search, q])

  useEffect(() => {
    let live = true
    listActivityLogs({ q, group, page }).then(
      (r) => {
        if (!live) return
        setError(null)
        setRows(r.rows)
        setHasNext(r.hasNext)
      },
      (e: unknown) => live && setError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [q, group, page, reloadKey])

  return (
    <div className="space-y-5">
      <PageHeader title="Activity logs" subtitle="Who did what, and when. Only superadmins can see this." />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            placeholder="Search user or action"
            aria-label="Search user or action"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Action"
          className={cn(SELECT_CLASS, 'w-auto min-w-36')}
          value={group}
          onChange={(e) => {
            setGroup(e.target.value as ActionGroup)
            setPage(1)
          }}
        >
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : rows === null ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading activity…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No activity matches.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((log) => (
                <TableRow key={log.id} className="align-top">
                  <TableCell className="font-mono text-xs text-muted-foreground">{formatWhen(log.at)}</TableCell>
                  <TableCell className="font-medium">{userText(log)}</TableCell>
                  <TableCell className="text-muted-foreground">{log.role ? (ROLE_LABEL[log.role] ?? log.role) : '—'}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <i aria-hidden className={cn('block size-2.5 shrink-0 rounded-full', DOT[actionKind(log.action)])} />
                      {actionLabel(log.action)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-md min-w-48 whitespace-normal break-words text-muted-foreground">
                    {formatDetails(log.details)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-muted-foreground">Page {page}</span>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
