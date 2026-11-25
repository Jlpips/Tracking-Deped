import { supabase } from './supabase'
import type { DtsRecord } from './types'

export type RecordFilters = {
  schoolId?: string
  documentTypeId?: string
  office?: string
  from?: string
  to?: string
  q?: string
  page: number
  pageSize: number
}

export type RecordInput = Omit<
  DtsRecord,
  'id' | 'created_by' | 'created_by_username' | 'created_at' | 'school' | 'document_type'
> & { id?: string }

const SELECT = '*, school:schools(*), document_type:document_types(*)'
// !inner turns the embed into an inner join so filtering on document_type.office drops non-matching rows.
const SELECT_INNER = '*, school:schools(*), document_type:document_types!inner(*)'
const EXPORT_PAGE_SIZE = 1000

export const RECORD_EXPORT_HEADERS = [
  'Date',
  'Name',
  'Contact number',
  'Title of document',
  'DTS number',
  'Document type',
  'Office routed to',
  'Date from',
  'Date to',
  'Excluded date',
  'Encoded by',
]

/** One export row in RECORD_EXPORT_HEADERS order, with the school name first when `withSchool`. */
export function recordExportRow(r: DtsRecord, withSchool: boolean): (string | null)[] {
  const row = [
    r.date,
    r.name,
    r.contact,
    r.title,
    r.dts_number,
    r.document_type?.name ?? null,
    r.document_type?.office ?? null,
    r.date_from,
    r.date_to,
    r.excluded_date,
    r.created_by_username,
  ]
  return withSchool ? [r.school?.name ?? null, ...row] : row
}

/** Builds a quoted PostgREST `ilike` value matching `q` literally anywhere in the column. */
function containsPattern(q: string): string {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return `"${like.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}

type Filters = Omit<RecordFilters, 'page' | 'pageSize'>

function buildQuery(f: Filters, count: boolean) {
  const select = f.office ? SELECT_INNER : SELECT
  let query = count
    ? supabase.from('records').select(select, { count: 'exact' })
    : supabase.from('records').select(select)
  if (f.schoolId) query = query.eq('school_id', f.schoolId)
  if (f.documentTypeId) query = query.eq('document_type_id', f.documentTypeId)
  if (f.office) query = query.eq('document_type.office', f.office)
  if (f.from) query = query.gte('date', f.from)
  if (f.to) query = query.lte('date', f.to)
  const q = f.q?.trim()
  if (q) {
    const p = containsPattern(q)
    query = query.or(`name.ilike.${p},title.ilike.${p},dts_number.ilike.${p}`)
  }
  return query
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
}

export async function listRecords(f: RecordFilters): Promise<{ rows: DtsRecord[]; total: number }> {
  const start = (f.page - 1) * f.pageSize
  const { data, error, count } = await buildQuery(f, true).range(start, start + f.pageSize - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as DtsRecord[], total: count ?? 0 }
}

export async function listAllRecords(f: Filters): Promise<DtsRecord[]> {
  const all: DtsRecord[] = []
  for (let start = 0; ; start += EXPORT_PAGE_SIZE) {
    const { data, error } = await buildQuery(f, false).range(start, start + EXPORT_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as DtsRecord[]
    all.push(...rows)
    if (rows.length < EXPORT_PAGE_SIZE) return all
  }
}

const LEAVE_DATES_REQUIRED = 'Date from and Date to are required for this document type'

function saveError(error: { code?: string; message?: string }): Error {
  if (error.code === '23505') return new Error('This DTS number is already recorded.')
  if (error.code === '23514') {
    if (error.message?.includes(LEAVE_DATES_REQUIRED)) return new Error(`${LEAVE_DATES_REQUIRED}.`)
    return new Error('Date to must be on or after Date from.')
  }
  return new Error(error.message ?? 'Could not save the record.')
}

export async function saveRecord(input: RecordInput): Promise<DtsRecord> {
  const { id, ...fields } = input
  const payload = { ...fields, dts_number: fields.dts_number.trim() }
  const table = supabase.from('records')
  const { data, error } = await (id
    ? table.update(payload).eq('id', id).select(SELECT).single()
    : table.insert(payload).select(SELECT).single())
  if (error) throw saveError(error)
  return data as DtsRecord
}

export async function deleteRecord(id: string): Promise<void> {
  const { error } = await supabase.from('records').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
