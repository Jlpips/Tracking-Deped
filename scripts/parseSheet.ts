// Pure parsing for the one-time workbook import (Task 11). No I/O here:
// scripts/import-workbook.ts reads the file and talks to Supabase.

export type Field =
  | 'date'
  | 'name'
  | 'contact'
  | 'title'
  | 'dts_number'
  | 'document_type'
  | 'date_from'
  | 'date_to'
  | 'excluded_date'

export type HeaderMap = Partial<Record<Field, number>>

export interface ParsedRecord {
  /** 1-based row number in the sheet. */
  row: number
  date: string
  name: string
  contact: string | null
  title: string
  dts_number: string
  /** Trimmed + uppercased, ready to match document_types.name. */
  document_type: string
  date_from: string | null
  date_to: string | null
  excluded_date: string | null
}

export interface SheetError {
  /** 1-based row number; 0 for a sheet-level problem. */
  row: number
  reason: string
  kind: 'invalid' | 'duplicate'
}

export interface ParsedSheet {
  school: string
  records: ParsedRecord[]
  errors: SheetError[]
}

/** Trim + uppercase: the same normalisation as the DB unique index upper(btrim(dts_number)). */
export function normaliseDts(dts: string): string {
  return dts.trim().toUpperCase()
}

function words(label: string): string[] {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** Classify one header label. Order matters: more specific labels first. */
function classify(label: unknown): Field | null {
  if (typeof label !== 'string') return null
  const w = words(label)
  if (w.length === 0) return null
  const has = (word: string) => w.includes(word)
  if (has('EMAIL') || has('OFFICE')) return null
  if (has('EXCLUDED')) return 'excluded_date'
  if (has('DTS')) return 'dts_number'
  if (w.some((word, i) => word === 'DOCUMENT' && w[i + 1] === 'TYPE')) return 'document_type'
  if (has('FROM')) return 'date_from'
  if (has('TO')) return 'date_to'
  if (has('CONTACT')) return 'contact'
  if (has('TITLE')) return 'title'
  if (has('NAME')) return 'name'
  if (has('DATE')) return 'date'
  return null
}

/** Map header labels to column indexes. The first column for a field wins. */
export function mapHeader(labels: unknown[]): HeaderMap {
  const map: HeaderMap = {}
  labels.forEach((label, index) => {
    const field = classify(label)
    if (field && map[field] === undefined) map[field] = index
  })
  return map
}

const MS_PER_DAY = 86_400_000
// 1900 date system: serial 1 = 1900-01-01, with Excel's fictitious 1900-02-29 (serial 60).
// Counting from 1899-12-30 is correct for every serial after 60, i.e. any real DTS date.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function serialToUtcDate(serial: number): Date {
  return new Date(EXCEL_EPOCH + Math.floor(serial) * MS_PER_DAY)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function excelSerialToIso(serial: number): string {
  const d = serialToUtcDate(serial)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Excel serial, Date, M/D/YYYY (or M/D/YY) text, or YYYY-MM-DD text → YYYY-MM-DD; null if unparseable. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 60 ? excelSerialToIso(value) : null
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return validIso(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return validIso(year, Number(m[1]), Number(m[2]))
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const s = String(value).trim()
  return s === '' ? null : s
}

function isBlank(row: unknown[] | undefined): boolean {
  return !row || row.every((cell) => text(cell) === null)
}

/** excluded_date is free text; a serial becomes M/D/YYYY text. */
function excludedText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 60) {
    const d = serialToUtcDate(value)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
  }
  return text(value)
}

/**
 * A PH mobile number (09XXXXXXXXX) typed into a numeric Excel cell loses its leading 0;
 * restore it for 10-digit numbers starting with 9. Other values are kept as text.
 */
function contactText(value: unknown): string | null {
  if (typeof value === 'number' && /^9\d{9}$/.test(String(value))) return `0${value}`
  return text(value)
}

const REQUIRED_FOR_HEADER: Field[] = ['dts_number', 'document_type']

export function parseSheet(sheetName: string, rows: unknown[][]): ParsedSheet {
  const school = sheetName.trim()
  const records: ParsedRecord[] = []
  const errors: SheetError[] = []

  let headerIndex = -1
  let header: HeaderMap = {}
  for (let i = 0; i < rows.length; i++) {
    const candidate = mapHeader(rows[i] ?? [])
    if (REQUIRED_FOR_HEADER.every((f) => candidate[f] !== undefined)) {
      headerIndex = i
      header = candidate
      break
    }
  }
  if (headerIndex === -1) {
    errors.push({ row: 0, reason: 'Header row not found', kind: 'invalid' })
    return { school, records, errors }
  }

  const cell = (row: unknown[], field: Field) => {
    const index = header[field]
    return index === undefined ? undefined : row[index]
  }

  const firstSeen = new Map<string, number>()

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlank(row)) continue
    const rowNumber = i + 1
    const invalid = (reason: string) => errors.push({ row: rowNumber, reason, kind: 'invalid' })

    const dts = text(cell(row, 'dts_number'))
    if (!dts) {
      invalid('Missing DTS number')
      continue
    }
    const key = normaliseDts(dts)
    const earlier = firstSeen.get(key)
    if (earlier !== undefined) {
      errors.push({
        row: rowNumber,
        reason: `Duplicate DTS number ${dts} (first seen on row ${earlier})`,
        kind: 'duplicate',
      })
      continue
    }
    firstSeen.set(key, rowNumber)

    const documentType = text(cell(row, 'document_type'))
    if (!documentType) {
      invalid('Missing document type')
      continue
    }

    const name = text(cell(row, 'name'))
    if (!name) {
      invalid('Missing name')
      continue
    }
    const title = text(cell(row, 'title'))
    if (!title) {
      invalid('Missing title')
      continue
    }

    const rawDate = cell(row, 'date')
    if (text(rawDate) === null) {
      invalid('Missing DATE')
      continue
    }
    const date = toIsoDate(rawDate)
    if (!date) {
      invalid(`Invalid DATE: "${text(rawDate)}"`)
      continue
    }

    let dateFrom: string | null = null
    let dateTo: string | null = null
    let badRange = false
    for (const [field, label] of [
      ['date_from', 'FROM'],
      ['date_to', 'TO'],
    ] as const) {
      const raw = cell(row, field)
      if (text(raw) === null) continue
      const iso = toIsoDate(raw)
      if (!iso) {
        invalid(`Invalid ${label} date: "${text(raw)}"`)
        badRange = true
        break
      }
      if (field === 'date_from') dateFrom = iso
      else dateTo = iso
    }
    if (badRange) continue
    if (dateFrom && dateTo && dateTo < dateFrom) {
      invalid(`TO date ${dateTo} is before FROM date ${dateFrom}`)
      continue
    }

    records.push({
      row: rowNumber,
      date,
      name,
      contact: contactText(cell(row, 'contact')),
      title,
      dts_number: dts,
      document_type: documentType.toUpperCase(),
      date_from: dateFrom,
      date_to: dateTo,
      excluded_date: excludedText(cell(row, 'excluded_date')),
    })
  }

  return { school, records, errors }
}
