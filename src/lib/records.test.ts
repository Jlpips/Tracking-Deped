import type { DtsRecord } from './types'

type Call = [string, ...unknown[]]
type Result = { data?: unknown; error?: unknown; count?: number | null }

const mock = vi.hoisted(() => {
  const state = { calls: [] as Call[][], results: [] as Result[] }
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'or', 'order', 'range', 'single']
  function from(table: string) {
    const calls: Call[] = [['from', table]]
    state.calls.push(calls)
    const builder: Record<string, unknown> = {}
    for (const m of methods) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args])
        return builder
      }
    }
    builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.results.shift() ?? { data: null, error: null }).then(resolve, reject)
    return builder
  }
  return { state, from }
})

vi.mock('./supabase', () => ({ supabase: { from: mock.from } }))

import {
  deleteRecord,
  listAllRecords,
  listRecords,
  RECORD_EXPORT_HEADERS,
  recordExportRow,
  saveRecord,
} from './records'

const SELECT = '*, school:schools(*), document_type:document_types(*)'
const SELECT_INNER = '*, school:schools(*), document_type:document_types!inner(*)'

function rec(over: Partial<DtsRecord> = {}): DtsRecord {
  return {
    id: 'r1',
    school_id: 's1',
    created_by: 'u1',
    created_by_username: '108874',
    date: '2026-11-25',
    name: 'Zorayda M. Decena',
    honorific: 'Mrs',
    leave_type: 'Wellness Leave',
    description: null,
    contact: '09171234567',
    title: 'Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES',
    dts_number: '108874-000025',
    document_type_id: 'd1',
    date_from: '2026-12-02',
    date_to: '2026-12-03',
    excluded_date: null,
    created_at: '2026-11-25T01:00:00Z',
    school: { id: 's1', name: 'Anos ES' },
    document_type: { id: 'd1', name: 'FORM 6 / LEAVE OF ABSENCE', office: 'HR 2 & 3', requires_leave_dates: true },
    ...over,
  }
}

const input = {
  school_id: 's1',
  date: '2026-11-25',
  name: 'X',
  honorific: 'Mrs',
  leave_type: null,
  description: null,
  contact: null,
  title: 'T',
  dts_number: '  108874-000025 ',
  document_type_id: 'd1',
  date_from: null,
  date_to: null,
  excluded_date: null,
}

beforeEach(() => {
  mock.state.calls = []
  mock.state.results = []
})

describe('listRecords', () => {
  it('selects with embeds, exact count, ordering and the page range', async () => {
    mock.state.results.push({ data: [rec()], error: null, count: 31 })
    const out = await listRecords({ page: 2, pageSize: 25 })
    expect(out).toEqual({ rows: [rec()], total: 31 })
    const calls = mock.state.calls[0]
    expect(calls[0]).toEqual(['from', 'records'])
    expect(calls).toContainEqual(['select', SELECT, { count: 'exact' }])
    const orders = calls.filter((c) => c[0] === 'order')
    expect(orders.slice(0, 2)).toEqual([
      ['order', 'date', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
    ])
    expect(calls).toContainEqual(['range', 25, 49])
    expect(calls.some((c) => c[0] === 'or' || c[0] === 'eq')).toBe(false)
  })

  it('applies school, type, office and date filters', async () => {
    mock.state.results.push({ data: [], error: null, count: 0 })
    await listRecords({
      schoolId: 's1',
      documentTypeId: 'd1',
      office: 'HR 2 & 3',
      from: '2026-11-01',
      to: '2026-11-30',
      page: 1,
      pageSize: 25,
    })
    const calls = mock.state.calls[0]
    expect(calls).toContainEqual(['select', SELECT_INNER, { count: 'exact' }])
    expect(calls).toContainEqual(['eq', 'school_id', 's1'])
    expect(calls).toContainEqual(['eq', 'document_type_id', 'd1'])
    expect(calls).toContainEqual(['eq', 'document_type.office', 'HR 2 & 3'])
    expect(calls).toContainEqual(['gte', 'date', '2026-11-01'])
    expect(calls).toContainEqual(['lte', 'date', '2026-11-30'])
    expect(calls).toContainEqual(['range', 0, 24])
  })

  it('searches name, title and DTS number with ilike', async () => {
    mock.state.results.push({ data: [], error: null, count: 0 })
    await listRecords({ q: ' decena ', page: 1, pageSize: 25 })
    expect(mock.state.calls[0]).toContainEqual([
      'or',
      'name.ilike."%decena%",title.ilike."%decena%",dts_number.ilike."%decena%"',
    ])
  })

  it('escapes LIKE wildcards, backslashes and quotes in q', async () => {
    mock.state.results.push({ data: [], error: null, count: 0 })
    await listRecords({ q: '50%_a\\b"c', page: 1, pageSize: 25 })
    const or = mock.state.calls[0].find((c) => c[0] === 'or')!
    // LIKE escaping: % -> \%, _ -> \_, \ -> \\. PostgREST quoting then doubles every backslash and escapes ".
    // Expected raw text: "%50\\%\\_a\\\\b\"c%"
    const p = String.raw`"%50\\%\\_a\\\\b\"c%"`
    expect(or[1]).toBe(`name.ilike.${p},title.ilike.${p},dts_number.ilike.${p}`)
  })

  it('ignores a blank q', async () => {
    mock.state.results.push({ data: [], error: null, count: 0 })
    await listRecords({ q: '   ', page: 1, pageSize: 25 })
    expect(mock.state.calls[0].some((c) => c[0] === 'or')).toBe(false)
  })

  it('throws on error', async () => {
    mock.state.results.push({ data: null, error: { message: 'boom' }, count: null })
    await expect(listRecords({ page: 1, pageSize: 25 })).rejects.toThrow('boom')
  })
})

describe('listAllRecords', () => {
  it('fetches in pages of 1000 until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => rec({ id: `a${i}` }))
    mock.state.results.push({ data: full, error: null }, { data: [rec({ id: 'last' })], error: null })
    const rows = await listAllRecords({ office: 'ASDS' })
    expect(rows).toHaveLength(1001)
    expect(mock.state.calls).toHaveLength(2)
    expect(mock.state.calls[0]).toContainEqual(['range', 0, 999])
    expect(mock.state.calls[1]).toContainEqual(['range', 1000, 1999])
    expect(mock.state.calls[0]).toContainEqual(['select', SELECT_INNER])
    expect(mock.state.calls[0]).toContainEqual(['eq', 'document_type.office', 'ASDS'])
  })

  it('throws on error', async () => {
    mock.state.results.push({ data: null, error: { message: 'boom' } })
    await expect(listAllRecords({})).rejects.toThrow('boom')
  })
})

describe('saveRecord', () => {
  it('inserts a trimmed DTS number and returns the saved row', async () => {
    mock.state.results.push({ data: rec(), error: null })
    const saved = await saveRecord(input)
    expect(saved).toEqual(rec())
    const calls = mock.state.calls[0]
    expect(calls[0]).toEqual(['from', 'records'])
    expect(calls).toContainEqual(['insert', { ...input, dts_number: '108874-000025' }])
    expect(calls).toContainEqual(['select', SELECT])
    expect(calls).toContainEqual(['single'])
    expect(calls.some((c) => c[0] === 'update')).toBe(false)
  })

  it('updates by id when id is present', async () => {
    mock.state.results.push({ data: rec(), error: null })
    await saveRecord({ ...input, id: 'r1' })
    const calls = mock.state.calls[0]
    expect(calls).toContainEqual(['update', { ...input, dts_number: '108874-000025' }])
    expect(calls).toContainEqual(['eq', 'id', 'r1'])
    expect(calls.some((c) => c[0] === 'insert')).toBe(false)
  })

  it('maps 23505 to the duplicate DTS message', async () => {
    mock.state.results.push({ data: null, error: { code: '23505' } })
    await expect(saveRecord(input)).rejects.toThrow('This DTS number is already recorded.')
  })

  it('maps 23514 to the date order message', async () => {
    mock.state.results.push({
      data: null,
      error: { code: '23514', message: 'new row for relation "records" violates check constraint "records_date_range_check"' },
    })
    await expect(saveRecord(input)).rejects.toThrow('Date to must be on or after Date from.')
  })

  it('maps the leave-dates-required trigger error to its own message', async () => {
    mock.state.results.push({
      data: null,
      error: { code: '23514', message: 'Date from and Date to are required for this document type' },
    })
    await expect(saveRecord(input)).rejects.toThrow('Date from and Date to are required for this document type.')
  })

  it('passes other errors through', async () => {
    mock.state.results.push({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(saveRecord(input)).rejects.toThrow('permission denied')
  })
})

describe('deleteRecord', () => {
  it('deletes by id', async () => {
    mock.state.results.push({ data: null, error: null })
    await deleteRecord('r1')
    expect(mock.state.calls[0]).toEqual([['from', 'records'], ['delete'], ['eq', 'id', 'r1']])
  })

  it('throws on error', async () => {
    mock.state.results.push({ data: null, error: { message: 'nope' } })
    await expect(deleteRecord('r1')).rejects.toThrow('nope')
  })
})

describe('export rows', () => {
  it('has the 11 headers in order', () => {
    expect(RECORD_EXPORT_HEADERS).toEqual([
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
    ])
  })

  it('lines a row up with the headers', () => {
    const r = rec({ excluded_date: 'Dec 2 PM' })
    const row = recordExportRow(r, false)
    expect(row).toHaveLength(RECORD_EXPORT_HEADERS.length)
    const byHeader = Object.fromEntries(RECORD_EXPORT_HEADERS.map((h, i) => [h, row[i]]))
    expect(byHeader).toEqual({
      Date: '2026-11-25',
      Name: 'Zorayda M. Decena',
      'Contact number': '09171234567',
      'Title of document': r.title,
      'DTS number': '108874-000025',
      'Document type': 'FORM 6 / LEAVE OF ABSENCE',
      'Office routed to': 'HR 2 & 3',
      'Date from': '2026-12-02',
      'Date to': '2026-12-03',
      'Excluded date': 'Dec 2 PM',
      'Encoded by': '108874',
    })
  })

  it('puts School first when withSchool', () => {
    const row = recordExportRow(rec(), true)
    expect(row).toHaveLength(RECORD_EXPORT_HEADERS.length + 1)
    expect(row[0]).toBe('Anos ES')
    expect(row.slice(1)).toEqual(recordExportRow(rec(), false))
  })
})
