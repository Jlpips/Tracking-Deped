import { describe, expect, it } from 'vitest'
import { excelSerialToIso, mapHeader, parseSheet, toIsoDate } from './parseSheet.ts'

const HEADER = [
  'DATE',
  'NAME',
  'DEPED EMAIL',
  'CONTACT NUMBER',
  'TITLE',
  'DTS',
  'DOCUMENT TYPE',
  'DADALHIN SA OFFICE',
  'DATE FROM',
  'DATE TO',
  'EXCLUDED DATE',
]

function row(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    DATE: 46000,
    NAME: 'Juan Dela Cruz',
    'DEPED EMAIL': 'juan@deped.gov.ph',
    'CONTACT NUMBER': '09171234567',
    TITLE: 'Teacher I',
    DTS: '108874-1',
    'DOCUMENT TYPE': 'service record',
    'DADALHIN SA OFFICE': 'HR',
    'DATE FROM': null,
    'DATE TO': null,
    'EXCLUDED DATE': null,
    ...overrides,
  }
  return HEADER.map((h) => base[h])
}

describe('parseSheet', () => {
  it('finds the header on row 3 and maps the data rows', () => {
    const result = parseSheet('  Macalelon Central School ', [
      ['DIVISION OF QUEZON'],
      ['Macalelon District'],
      HEADER,
      row(),
    ])
    expect(result.school).toBe('Macalelon Central School')
    expect(result.errors).toEqual([])
    expect(result.records).toEqual([
      {
        row: 4,
        date: '2025-12-09',
        name: 'Juan Dela Cruz',
        contact: '09171234567',
        title: 'Teacher I',
        dts_number: '108874-1',
        document_type: 'SERVICE RECORD',
        date_from: null,
        date_to: null,
        excluded_date: null,
      },
    ])
  })

  it('converts serial 46000 to 2025-12-09 and M/D/YYYY text to ISO', () => {
    expect(excelSerialToIso(46000)).toBe('2025-12-09')
    expect(toIsoDate(46000)).toBe('2025-12-09')
    expect(toIsoDate('12/9/2025')).toBe('2025-12-09')
    expect(toIsoDate(' 1/5/2026 ')).toBe('2026-01-05')
    expect(toIsoDate('2025-12-09')).toBe('2025-12-09')
    expect(toIsoDate('2/30/2025')).toBeNull()
    expect(toIsoDate('soon')).toBeNull()
  })

  it('skips blank rows', () => {
    const result = parseSheet('S', [
      HEADER,
      [],
      [null, '', '   ', undefined],
      row({ DTS: 'A-1' }),
      [],
      row({ DTS: 'A-2' }),
    ])
    expect(result.errors).toEqual([])
    expect(result.records.map((r) => [r.row, r.dts_number])).toEqual([
      [4, 'A-1'],
      [6, 'A-2'],
    ])
  })

  it('reports a row without DTS number with its 1-based row number', () => {
    const result = parseSheet('S', [['title'], HEADER, row({ DTS: '  ' }), row({ DTS: 'B-1' })])
    expect(result.records.map((r) => r.dts_number)).toEqual(['B-1'])
    expect(result.errors).toEqual([{ row: 3, reason: 'Missing DTS number', kind: 'invalid' }])
  })

  it('reports a row without document type', () => {
    const result = parseSheet('S', [HEADER, row({ 'DOCUMENT TYPE': null })])
    expect(result.records).toEqual([])
    expect(result.errors).toEqual([{ row: 2, reason: 'Missing document type', kind: 'invalid' }])
  })

  it('reports a normalised duplicate DTS number in the same sheet', () => {
    const result = parseSheet('S', [HEADER, row({ DTS: ' 108874-1 ' }), row({ DTS: '108874-1' })])
    expect(result.records.map((r) => r.dts_number)).toEqual(['108874-1'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(3)
    expect(result.errors[0].kind).toBe('duplicate')
    expect(result.errors[0].reason).toMatch(/duplicate/i)
    expect(result.errors[0].reason).toContain('row 2')
  })

  it('treats DTS numbers case-insensitively when checking duplicates', () => {
    const result = parseSheet('S', [HEADER, row({ DTS: 'ab-1' }), row({ DTS: 'AB-1' })])
    expect(result.records).toHaveLength(1)
    expect(result.errors[0].kind).toBe('duplicate')
  })

  it('converts leave dates and keeps excluded date as text', () => {
    const result = parseSheet('S', [
      HEADER,
      row({ 'DATE FROM': '1/5/2026', 'DATE TO': 46030, 'EXCLUDED DATE': 46027 }),
      row({ DTS: 'X-2', 'EXCLUDED DATE': ' Jan 6 and 7 ' }),
    ])
    expect(result.errors).toEqual([])
    expect(result.records[0]).toMatchObject({
      date_from: '2026-01-05',
      date_to: '2026-01-08',
      excluded_date: '1/5/2026',
    })
    expect(result.records[1].excluded_date).toBe('Jan 6 and 7')
  })

  it('reports an unparseable date as a row error', () => {
    const result = parseSheet('S', [HEADER, row({ DATE: 'yesterday' })])
    expect(result.records).toEqual([])
    expect(result.errors).toEqual([{ row: 2, reason: 'Invalid DATE: "yesterday"', kind: 'invalid' }])
  })

  it('converts numeric cells in text columns to strings', () => {
    const result = parseSheet('S', [HEADER, row({ DTS: 108874, 'CONTACT NUMBER': 9171234567 })])
    expect(result.records[0].dts_number).toBe('108874')
    expect(result.records[0].contact).toBe('9171234567')
  })

  it('reports a sheet without a recognisable header row', () => {
    const result = parseSheet('Notes', [['just some notes'], ['nothing here']])
    expect(result.records).toEqual([])
    expect(result.errors).toEqual([{ row: 0, reason: 'Header row not found', kind: 'invalid' }])
  })
})

describe('mapHeader', () => {
  it('maps the workbook labels case-insensitively and ignores email and office columns', () => {
    expect(
      mapHeader([
        ' date ',
        'Name',
        'DepEd Email',
        'Contact Number',
        'Title',
        'DTS No.',
        'Document Type',
        'Dadalhin sa Office',
        'From',
        'To',
        'Excluded',
      ]),
    ).toEqual({
      date: 0,
      name: 1,
      contact: 3,
      title: 4,
      dts_number: 5,
      document_type: 6,
      date_from: 8,
      date_to: 9,
      excluded_date: 10,
    })
  })

  it('does not let DATE capture DATE FROM / DATE TO / EXCLUDED DATE', () => {
    expect(mapHeader(['DATE FROM', 'DATE TO', 'EXCLUDED DATE', 'DATE'])).toEqual({
      date_from: 0,
      date_to: 1,
      excluded_date: 2,
      date: 3,
    })
  })

  it('matches TO only as a whole word', () => {
    const map = mapHeader(['TITLE', 'TOTAL', 'CONTACT', 'DOCUMENT TYPE', 'TO'])
    expect(map).toEqual({ title: 0, contact: 2, document_type: 3, date_to: 4 })
  })

  it('does not treat an OFFICE or EMAIL column as anything', () => {
    expect(mapHeader(['OFFICE', 'EMAIL ADDRESS', 'NAME OF OFFICE'])).toEqual({})
  })
})
