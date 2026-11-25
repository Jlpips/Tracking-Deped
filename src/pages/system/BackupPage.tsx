import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { DatabaseBackup, FileJson, MoreHorizontal, RotateCcw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
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
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  callBackup,
  formatBytes,
  readBackupFile,
  toBrowserUrl,
  type BackupFile,
  type RestoreResult,
  type TableName,
} from '@/lib/backup'
import { errorMessage, FormError, PageHeader } from '@/pages/admin/shared'

type Target = { kind: 'stored'; name: string } | { kind: 'upload'; fileName: string; backup: unknown }

const CONFIRM_WORD = 'RESTORE'

const created = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
function formatCreated(at: string): string {
  const d = new Date(at)
  return at && !Number.isNaN(d.getTime()) ? created.format(d) : '—'
}

const TABLE_LABEL: Record<TableName, [string, string]> = {
  records: ['record', 'records'],
  profiles: ['user', 'users'],
  schools: ['school', 'schools'],
  document_types: ['document type', 'document types'],
}
const plural = (n: number, t: TableName) => `${n} ${TABLE_LABEL[t][n === 1 ? 0 : 1]}`

export default function BackupPage() {
  const [files, setFiles] = useState<BackupFile[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [creating, setCreating] = useState(false)
  const [upload, setUpload] = useState<{ fileName: string; backup: unknown } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const [target, setTarget] = useState<Target | null>(null)
  // A fresh dialog (empty confirm box, no old error) each time one opens.
  const [dialogKey, setDialogKey] = useState(0)
  const openRestore = (t: Target) => {
    setTarget(t)
    setDialogKey((k) => k + 1)
  }
  const [result, setResult] = useState<(RestoreResult & { source: string }) | null>(null)

  useEffect(() => {
    let live = true
    callBackup({ action: 'list' }).then(
      (data: BackupFile[]) => {
        if (!live) return
        setListError(null)
        setFiles(data ?? [])
      },
      (e: unknown) => live && setListError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [reloadKey])

  async function createBackup() {
    setCreating(true)
    try {
      const { name } = await callBackup({ action: 'create' })
      toast.success(`Backup created: ${name}`)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  async function download(name: string) {
    try {
      const { url } = await callBackup({ action: 'download', name })
      const a = document.createElement('a')
      a.href = toBrowserUrl(url)
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function chooseFile(file: File | undefined) {
    setUpload(null)
    setUploadError(null)
    if (!file) return
    try {
      const backup = await readBackupFile(file)
      setUpload({ fileName: file.name, backup })
    } catch (e) {
      setUploadError(errorMessage(e))
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void chooseFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Backup & restore" subtitle="Download a copy of the data, or restore it from an earlier backup." />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Create backup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Records, users, schools, and document types. Passwords are not included.
          </p>
          <div className="mt-4">
            <Button onClick={() => void createBackup()} disabled={creating}>
              <DatabaseBackup aria-hidden />
              {creating ? 'Creating backup…' : 'Create backup now'}
            </Button>
          </div>
        </section>

        <section className="flex flex-col rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Restore from file</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use a backup file saved earlier (e.g. from a laptop or flash drive). Records added after it are kept.
          </p>
          <input
            id="backup-file"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              void chooseFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <label
            htmlFor="backup-file"
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'my-3 block cursor-pointer rounded-lg border-[1.5px] border-dashed p-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50',
              'has-[+*:focus-visible]:ring-3',
              dragging && 'border-ring bg-muted/50',
            )}
          >
            Drop a backup file here or <u>choose a file</u>
          </label>
          {upload && (
            <p className="mb-3 flex min-w-0 items-center gap-2 text-sm">
              <FileJson aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{upload.fileName}</span>
            </p>
          )}
          <FormError message={uploadError} />
          <div className={cn(uploadError && 'mt-3')}>
            <Button
              variant="destructive"
              disabled={!upload}
              onClick={() => upload && openRestore({ kind: 'upload', fileName: upload.fileName, backup: upload.backup })}
            >
              <RotateCcw aria-hidden />
              Restore…
            </Button>
          </div>
        </section>
      </div>

      {result && <RestoreSummary result={result} onDismiss={() => setResult(null)} />}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Backup</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center">
                  <p role="alert" className="text-destructive">
                    {listError}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : files === null ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading backups…
                </TableCell>
              </TableRow>
            ) : files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No backups yet. Create the first one.
                </TableCell>
              </TableRow>
            ) : (
              files.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-xs">{f.name}</TableCell>
                  <TableCell>{formatCreated(f.created_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(f.size)}</TableCell>
                  <TableCell className="w-10 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void download(f.name)}>Download</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => openRestore({ kind: 'stored', name: f.name })}>
                          Restore
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

      <RestoreDialog
        key={dialogKey}
        target={target}
        onClose={() => setTarget(null)}
        onRestored={(r) => {
          const source = target?.kind === 'stored' ? target.name : (target?.fileName ?? '')
          setTarget(null)
          if (target?.kind === 'upload') setUpload(null)
          setResult({ ...r, source })
          toast.success('Data restored')
          reload()
        }}
      />
    </div>
  )
}

function RestoreDialog({
  target,
  onClose,
  onRestored,
}: {
  target: Target | null
  onClose(): void
  onRestored(r: RestoreResult): void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = target !== null
  const fileName = target ? (target.kind === 'stored' ? target.name : target.fileName) : ''

  async function restore() {
    if (!target || text !== CONFIRM_WORD) return
    setBusy(true)
    setError(null)
    try {
      const r: RestoreResult = await callBackup(
        target.kind === 'stored'
          ? { action: 'restore', name: target.name, confirm: text }
          : { action: 'restore', backup: target.backup, confirm: text },
      )
      onRestored(r)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void restore()
          }}
        >
          <DialogHeader>
            <DialogTitle>Restore data?</DialogTitle>
            <DialogDescription className="sr-only">Confirm restoring data from a backup.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 break-words">
              Records in <b className="font-mono break-all">{fileName}</b> will be added back, and changed records will go
              back to how they were in the backup. Records added after the backup are kept. An automatic backup is
              created first.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="restore-confirm">Type RESTORE to confirm</Label>
            <Input
              id="restore-confirm"
              placeholder="RESTORE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || text !== CONFIRM_WORD}>
              {busy ? 'Restoring…' : 'Restore data'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RestoreSummary({ result, onDismiss }: { result: RestoreResult & { source: string }; onDismiss(): void }) {
  const tables: TableName[] = ['records', 'profiles', 'schools', 'document_types']
  const changed = tables.filter((t) => (result.restored[t] ?? 0) > 0)
  return (
    <section role="status" className="rounded-xl border bg-card p-5 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold">
          Restored from <span className="font-mono break-all">{result.source}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className="mt-1 text-muted-foreground">
        {changed.length > 0
          ? `Added back or updated: ${changed.map((t) => plural(result.restored[t], t)).join(', ')}.`
          : 'Nothing needed to change; the data already matched the backup.'}{' '}
        The data from before the restore was saved as <span className="font-mono break-all">{result.safety_backup}</span>
        .
      </p>
      {result.skipped.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">
            {result.skipped.length === 1 ? '1 item was' : `${result.skipped.length} items were`} not restored:
          </p>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-muted-foreground">
            {result.skipped.map((s) => (
              <li key={`${s.table}:${s.id}`} className="break-words">
                {TABLE_LABEL[s.table]?.[0] ?? s.table} {s.label || s.id}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
