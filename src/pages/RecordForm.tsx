import { cn } from 'cn'
import { LockIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { saveRecord, type RecordInput } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { buildTitle, isForm6 as isForm6Type } from '@/lib/title'
import type { DocumentType, DtsRecord, School } from '@/lib/types'

export interface RecordFormProps {
  open: boolean
  onOpenChange(open: boolean): void
  record?: DtsRecord
  onSaved(record: DtsRecord): void
}

const HONORIFICS = ['Mr', 'Mrs', 'Ms', 'Dr'] as const
type Honorific = (typeof HONORIFICS)[number] | ''
const OTHERS = 'Others'
const DEFAULT_LEAVE = 'Wellness Leave'
const LEAVE_TYPES = [
  'Vacation Leave',
  'Mandatory/Forced Leave',
  'Sick Leave',
  'Wellness Leave',
  'Special Privilege Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Solo Parent Leave',
  'Study Leave',
  '10-Day VAWC Leave',
  'Rehabilitation Privilege',
  'Special Leave Benefits for Women',
  'Special Emergency (Calamity) Leave',
  'Adoption Leave',
]

const DTS_DUPLICATE = 'This DTS number is already recorded.'
const DATE_ORDER = 'Date to must be on or after Date from.'
const DATES_REQUIRED = 'Date from and Date to are required for this document type.'

const AUTO_HINT = 'Filled in automatically from the document type, leave type, dates, name, and school.'
const MANUAL_HINT = 'Edited manually. Click “Use automatic title” to rebuild it.'

/** Native <select> styled like the shadcn Input: works with phone pickers and is easy to label. */
const SELECT_CLASS =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30'

type Field =
  | 'school'
  | 'date'
  | 'dts'
  | 'name'
  | 'docType'
  | 'leaveOther'
  | 'dateFrom'
  | 'dateTo'
  | 'title'
type Errors = Partial<Record<Field, string>>

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadOptions<T>(table: 'document_types' | 'schools'): Promise<T[] | null> {
  try {
    const { data, error } = await supabase.from(table).select('*').order('name')
    return error || !data ? null : (data as T[])
  } catch {
    return null
  }
}

export function RecordForm({ open, onOpenChange, record, onSaved }: RecordFormProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{record ? 'Edit record' : 'Add record'}</SheetTitle>
          <SheetDescription>
            {record ? 'Change the details of this DTS record.' : 'Encode a document received for DTS routing.'}
          </SheetDescription>
        </SheetHeader>
        {/* Sheet content unmounts when closed, so the form state starts fresh on every open. */}
        {open && (
          <RecordFormBody
            key={record?.id ?? 'new'}
            record={record}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              toast.success('Record saved')
              onSaved(saved)
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function RecordFormBody({
  record,
  onCancel,
  onSaved,
}: {
  record?: DtsRecord
  onCancel(): void
  onSaved(record: DtsRecord): void
}) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'

  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [schools, setSchools] = useState<School[]>([])

  const storedLeave = record?.leave_type ?? null
  const leaveInList = storedLeave === null || LEAVE_TYPES.includes(storedLeave)

  const [schoolId, setSchoolId] = useState(record?.school_id ?? (isAdmin ? '' : (profile?.school_id ?? '')))
  const [date, setDate] = useState(record?.date ?? todayIso())
  const [dts, setDts] = useState(record?.dts_number ?? '')
  const [honorific, setHonorific] = useState<Honorific>(
    record ? ((record.honorific ?? '') as Honorific) : 'Mrs',
  )
  const [name, setName] = useState(record?.name ?? '')
  const [contact, setContact] = useState(record?.contact ?? '')
  const [docTypeId, setDocTypeId] = useState(record?.document_type_id ?? '')
  const [leave, setLeave] = useState(leaveInList ? (storedLeave ?? DEFAULT_LEAVE) : OTHERS)
  const [leaveOther, setLeaveOther] = useState(leaveInList ? '' : (storedLeave ?? ''))
  const [description, setDescription] = useState(record?.description ?? '')
  const [dateFrom, setDateFrom] = useState(record?.date_from ?? '')
  const [dateTo, setDateTo] = useState(record?.date_to ?? '')
  const [excluded, setExcluded] = useState(record?.excluded_date ?? '')
  // Editing keeps the saved title until the user asks for the automatic one.
  const [manualTitle, setManualTitle] = useState<string | null>(record ? record.title : null)

  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    loadOptions<DocumentType>('document_types').then((rows) => {
      if (!live) return
      if (rows) setDocTypes(rows)
      else setFormError('Could not load the document types. Check your connection and try again.')
    })
    if (isAdmin) {
      loadOptions<School>('schools').then((rows) => {
        if (!live) return
        if (rows) setSchools(rows)
        else setFormError('Could not load the schools. Check your connection and try again.')
      })
    }
    return () => {
      live = false
    }
  }, [isAdmin])

  const docType = docTypes.find((t) => t.id === docTypeId)
  const isForm6 = isForm6Type(docType?.name)
  const requiresDates = docType?.requires_leave_dates ?? false
  const leaveType = leave === OTHERS ? leaveOther.trim() : leave
  const schoolName = isAdmin
    ? (schools.find((s) => s.id === schoolId)?.name ?? record?.school?.name ?? '…')
    : (profile?.school?.name ?? record?.school?.name ?? '…')

  const groups = useMemo(() => {
    const byOffice = new Map<string, DocumentType[]>()
    for (const t of docTypes) byOffice.set(t.office, [...(byOffice.get(t.office) ?? []), t])
    return [...byOffice.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [docTypes])

  const autoTitle = docType
    ? buildTitle({
        docTypeName: docType.name,
        description: isForm6 ? undefined : description,
        honorific,
        name,
        leaveType: isForm6 ? leaveType : undefined,
        dateFrom: requiresDates ? dateFrom : undefined,
        dateTo: requiresDates ? dateTo : undefined,
        schoolName,
        requiresDates,
      })
    : ''
  const title = manualTitle ?? autoTitle

  function validate(): Errors {
    const e: Errors = {}
    if (isAdmin && !schoolId) e.school = 'Choose a school.'
    if (!date) e.date = 'Enter the date.'
    if (!dts.trim()) e.dts = 'Enter the DTS number.'
    if (!name.trim()) e.name = 'Enter the name.'
    if (!docType) e.docType = 'Choose a document type.'
    if (isForm6 && leave === OTHERS && !leaveOther.trim()) e.leaveOther = 'Specify the leave type.'
    if (requiresDates) {
      if (!dateFrom) e.dateFrom = 'Enter Date from.'
      if (!dateTo) e.dateTo = 'Enter Date to.'
      else if (dateFrom && dateTo < dateFrom) e.dateTo = DATE_ORDER
    }
    if (docType && !title.trim()) e.title = 'Enter the title of the document.'
    return e
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0 || !docType) return

    const input: RecordInput = {
      ...(record ? { id: record.id } : {}),
      school_id: schoolId,
      date,
      dts_number: dts.trim(),
      honorific: honorific || null,
      name: name.trim(),
      contact: contact.trim() || null,
      document_type_id: docType.id,
      leave_type: isForm6 ? leaveType : null,
      description: isForm6 ? null : description.trim() || null,
      date_from: requiresDates ? dateFrom : null,
      date_to: requiresDates ? dateTo : null,
      excluded_date: requiresDates ? excluded.trim() || null : null,
      title: title.trim(),
    }

    setSaving(true)
    try {
      const saved = await saveRecord(input)
      onSaved(saved)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message === DTS_DUPLICATE) setErrors({ dts: message })
      else if (message === DATE_ORDER || message === DATES_REQUIRED) setErrors({ dateTo: message })
      else setFormError(message || 'Could not save the record.')
    } finally {
      setSaving(false)
    }
  }

  const encodedBy = record?.created_by_username ?? profile?.username ?? ''

  return (
    <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isAdmin ? (
          <FormField id="rf-school" label="School" error={errors.school}>
            {(a) => (
              <select
                {...a}
                className={SELECT_CLASS}
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                <option value="">Choose a school</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : (
          <FormField id="rf-school" label="School" hint="Assigned to your account.">
            {(a) => (
              <div className="relative">
                <Input {...a} value={profile?.school?.name ?? record?.school?.name ?? ''} disabled className="pr-8" />
                <LockIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            )}
          </FormField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="rf-date" label="Date" error={errors.date}>
            {(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          <FormField id="rf-dts" label="DTS number" error={errors.dts}>
            {(a) => (
              <Input
                {...a}
                className="font-mono"
                placeholder="108874XXXXX-000025"
                autoComplete="off"
                value={dts}
                onChange={(e) => setDts(e.target.value)}
              />
            )}
          </FormField>
        </div>

        <FormField id="rf-name" label="Name" error={errors.name}>
          {(a) => (
            <div className="flex gap-2">
              <select
                aria-label="Honorific"
                className={cn(SELECT_CLASS, 'w-20 flex-none')}
                value={honorific}
                onChange={(e) => setHonorific(e.target.value as Honorific)}
              >
                <option value="">—</option>
                {HONORIFICS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <Input
                {...a}
                placeholder="e.g. Zorayda M. Decena"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
        </FormField>

        <FormField id="rf-contact" label="Contact number">
          {(a) => (
            <Input {...a} type="tel" inputMode="tel" value={contact} onChange={(e) => setContact(e.target.value)} />
          )}
        </FormField>

        <FormField
          id="rf-type"
          label="Document type"
          error={errors.docType}
          hint={`${docTypes.length} document types from the district route list, grouped by office.`}
        >
          {(a) => (
            <select {...a} className={SELECT_CLASS} value={docTypeId} onChange={(e) => setDocTypeId(e.target.value)}>
              <option value="">Choose a document type</option>
              {groups.map(([office, types]) => (
                <optgroup key={office} label={office}>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </FormField>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Routed to office</div>
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/50 px-2.5 py-1.5 text-sm">
            <span className="font-medium">{docType?.office ?? '—'}</span>
            <span className="ml-auto text-xs text-muted-foreground">Automatic</span>
          </div>
        </div>

        {isForm6 && (
          <FormField id="rf-leave" label="Leave type">
            {(a) => (
              <select {...a} className={SELECT_CLASS} value={leave} onChange={(e) => setLeave(e.target.value)}>
                {LEAVE_TYPES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                <option value={OTHERS}>Others</option>
              </select>
            )}
          </FormField>
        )}
        {isForm6 && leave === OTHERS && (
          <FormField
            id="rf-leave-other"
            label="Specify leave type"
            error={errors.leaveOther}
            hint="Not in the list? Type it here. It will be used in the title."
          >
            {(a) => (
              <Input
                {...a}
                placeholder="e.g. Terminal Leave"
                value={leaveOther}
                onChange={(e) => setLeaveOther(e.target.value)}
              />
            )}
          </FormField>
        )}

        {docType && !isForm6 && (
          <FormField
            id="rf-description"
            label={
              <>
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </>
            }
            hint="Used in the title instead of the document type name."
          >
            {(a) => (
              <Input
                {...a}
                placeholder="e.g. Salary Differential, MOOE Liquidation"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </FormField>
        )}

        {requiresDates && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="rf-from" label="Date from" error={errors.dateFrom}>
                {(a) => <Input {...a} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />}
              </FormField>
              <FormField id="rf-to" label="Date to" error={errors.dateTo}>
                {(a) => <Input {...a} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />}
              </FormField>
            </div>
            <FormField id="rf-excluded" label="Excluded date">
              {(a) => <Input {...a} value={excluded} onChange={(e) => setExcluded(e.target.value)} />}
            </FormField>
          </>
        )}

        <FormField
          id="rf-title"
          label="Title of the document"
          error={errors.title}
          hint={manualTitle === null ? AUTO_HINT : MANUAL_HINT}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setManualTitle(manualTitle === null ? autoTitle : null)}
            >
              {manualTitle === null ? 'Edit manually' : 'Use automatic title'}
            </Button>
          }
        >
          {(a) => (
            <textarea
              {...a}
              rows={2}
              readOnly={manualTitle === null}
              value={title}
              onChange={(e) => setManualTitle(e.target.value)}
              className={cn(
                'w-full min-w-0 resize-y rounded-lg border border-input px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm',
                manualTitle === null ? 'bg-muted/60 text-foreground' : 'bg-transparent dark:bg-input/30',
              )}
            />
          )}
        </FormField>

        {formError && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t p-4">
        <span className="mr-auto text-xs text-muted-foreground">
          Encoded by <span className="font-mono">{encodedBy}</span> (automatic)
        </span>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save record'}
        </Button>
      </div>
    </form>
  )
}

type ControlProps = {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/** Label + control + hint + error, wiring ids so the error is announced with the field. */
function FormField({
  id,
  label,
  hint,
  error,
  action,
  children,
}: {
  id: string
  label: ReactNode
  hint?: string
  error?: string
  action?: ReactNode
  children(props: ControlProps): ReactNode
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
