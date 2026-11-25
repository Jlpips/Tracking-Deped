// One-time import of the district's old Excel workbook (one tab per school).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/import-workbook.ts <path.xlsx> [--dry-run]
//
// --dry-run parses, matches document types, checks duplicates against the DB and prints the
// report, but writes nothing (not even schools). Keys come from the environment only.

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { normaliseDts, parseSheet, type ParsedRecord } from './parseSheet.ts'

interface Problem {
  school: string
  row: number
  dts: string | null
  reason: string
}

interface SchoolSummary {
  school: string
  existing: boolean
  parsed: number
  imported: number
  duplicates: number
  errors: number
}

interface Candidate {
  school: string
  record: ParsedRecord
  documentTypeId: string
}

type RealtimeTransport = NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']

class NoWebSocket {
  constructor() {
    throw new Error('Realtime is not used by the import script')
  }
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run')
  const positional = argv.filter((a) => !a.startsWith('--'))
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--dry-run')
  if (unknown.length) fail(`Unknown option(s): ${unknown.join(', ')}`)
  if (positional.length !== 1) {
    fail('Usage: npx tsx scripts/import-workbook.ts <path.xlsx> [--dry-run]')
  }
  return { path: positional[0], dryRun }
}

/** Sheet rows as a 2-D array whose index i is sheet row i+1, even if the used range starts lower. */
function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  if (!ws['!ref']) return []
  const range = XLSX.utils.decode_range(ws['!ref'])
  range.s.r = 0
  range.s.c = 0
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range,
  })
}

async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) fail(`Could not load ${label}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < size) return out
  }
}

async function main() {
  const { path, dryRun } = parseArgs(process.argv.slice(2))

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.')
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(readFileSync(path), { type: 'buffer' })
  } catch (e) {
    fail(`Could not read workbook ${path}: ${(e as Error).message}`)
  }

  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // This script never uses Realtime. supabase-js refuses to start on Node < 22 without a
    // WebSocket implementation, so hand it a placeholder that fails loudly if ever opened.
    realtime: { transport: NoWebSocket as unknown as NonNullable<RealtimeTransport> },
  })

  // created_by = the first superadmin; the records trigger sets created_by_username from it.
  const { data: admins, error: adminError } = await db
    .from('profiles')
    .select('user_id, username')
    .eq('role', 'superadmin')
    .order('created_at', { ascending: true })
    .limit(1)
  if (adminError) fail(`Could not look up the superadmin: ${adminError.message}`)
  const superadmin = admins?.[0]
  if (!superadmin) fail('No superadmin profile exists. Create the superadmin account before importing.')

  const docTypes = await fetchAll<{ id: string; name: string; requires_leave_dates: boolean }>(
    'document types',
    (from, to) => db.from('document_types').select('id, name, requires_leave_dates').order('name').range(from, to),
  )
  const docTypeByName = new Map(docTypes.map((d) => [d.name.trim().toUpperCase(), d]))

  const schools = await fetchAll<{ id: string; name: string }>('schools', (from, to) =>
    db.from('schools').select('id, name').order('name').range(from, to),
  )
  const schoolByName = new Map(schools.map((s) => [s.name.trim().toUpperCase(), s]))

  const existingDts = await fetchAll<{ dts_number: string }>('existing DTS numbers', (from, to) =>
    db.from('records').select('dts_number').order('id').range(from, to),
  )
  const dbDts = new Set(existingDts.map((r) => normaliseDts(r.dts_number)))

  const problems: Problem[] = []
  const duplicates: Problem[] = []
  const summaries: SchoolSummary[] = []
  const candidatesBySchool = new Map<string, Candidate[]>()
  // Normalised DTS -> where it first appeared in this file (across all tabs).
  const seenInFile = new Map<string, string>()

  for (const sheetName of workbook.SheetNames) {
    const parsed = parseSheet(sheetName, sheetRows(workbook.Sheets[sheetName]))
    const school = parsed.school
    const summary: SchoolSummary = {
      school,
      existing: schoolByName.has(school.toUpperCase()),
      parsed: parsed.records.length,
      imported: 0,
      duplicates: 0,
      errors: 0,
    }

    if (parsed.errors.some((e) => e.row === 0)) {
      problems.push({ school, row: 0, dts: null, reason: 'Tab skipped: header row not found (no DTS / DOCUMENT TYPE columns)' })
      continue
    }
    summaries.push(summary)

    for (const e of parsed.errors) {
      const entry = { school, row: e.row, dts: null, reason: e.reason }
      if (e.kind === 'duplicate') {
        summary.duplicates++
        duplicates.push(entry)
      } else {
        summary.errors++
        problems.push(entry)
      }
    }

    const candidates: Candidate[] = []
    for (const record of parsed.records) {
      const key = normaliseDts(record.dts_number)
      const where = `${school} row ${record.row}`
      const earlier = seenInFile.get(key)
      if (earlier) {
        summary.duplicates++
        duplicates.push({ school, row: record.row, dts: record.dts_number, reason: `Duplicate of ${earlier}` })
        continue
      }
      seenInFile.set(key, where)
      if (dbDts.has(key)) {
        summary.duplicates++
        duplicates.push({ school, row: record.row, dts: record.dts_number, reason: 'Already in the database' })
        continue
      }
      const docType = docTypeByName.get(record.document_type)
      if (!docType) {
        summary.errors++
        problems.push({ school, row: record.row, dts: record.dts_number, reason: `Unknown document type "${record.document_type}"` })
        continue
      }
      if (docType.requires_leave_dates && (!record.date_from || !record.date_to)) {
        summary.errors++
        problems.push({
          school,
          row: record.row,
          dts: record.dts_number,
          reason: `FROM and TO dates are required for ${docType.name}`,
        })
        continue
      }
      candidates.push({ school, record, documentTypeId: docType.id })
    }
    candidatesBySchool.set(school, candidates)
    if (dryRun) summary.imported = candidates.length
  }

  if (!dryRun) {
    for (const summary of summaries) {
      const candidates = candidatesBySchool.get(summary.school) ?? []
      // Don't create a school for a tab that imports nothing (e.g. a stray Summary/Template tab).
      if (candidates.length === 0) continue
      let school = schoolByName.get(summary.school.toUpperCase())
      if (!school) {
        const { data, error } = await db.from('schools').insert({ name: summary.school }).select('id, name').single()
        if (error || !data) {
          summary.errors += candidates.length
          problems.push({ school: summary.school, row: 0, dts: null, reason: `Could not create school: ${error?.message}` })
          continue
        }
        school = data
        schoolByName.set(summary.school.toUpperCase(), data)
      }
      const schoolId = school.id
      const toRow = ({ record, documentTypeId }: Candidate) => ({
        school_id: schoolId,
        created_by: superadmin.user_id,
        date: record.date,
        name: record.name,
        honorific: null,
        leave_type: null,
        description: null,
        contact: record.contact,
        title: record.title,
        dts_number: record.dts_number,
        document_type_id: documentTypeId,
        date_from: record.date_from,
        date_to: record.date_to,
        excluded_date: record.excluded_date,
      })

      // Small batches; if a batch fails, retry its rows one by one so one bad row is reported, not fatal.
      const batchSize = 50
      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize)
        const { error } = await db.from('records').insert(batch.map(toRow))
        if (!error) {
          summary.imported += batch.length
          continue
        }
        for (const candidate of batch) {
          const { error: rowError } = await db.from('records').insert(toRow(candidate))
          if (rowError) {
            summary.errors++
            problems.push({
              school: summary.school,
              row: candidate.record.row,
              dts: candidate.record.dts_number,
              reason: `Insert failed${rowError.code ? ` (${rowError.code})` : ''}: ${rowError.message}`,
            })
          } else {
            summary.imported++
          }
        }
      }
    }
  }

  // ---- Report ----
  const verb = dryRun ? 'Would import' : 'Imported'
  console.log(`\n${dryRun ? 'DRY RUN - nothing was written.' : 'IMPORT COMPLETE.'}`)
  console.log(`Workbook: ${path}`)
  console.log(`Records created by superadmin: ${superadmin.username}\n`)
  console.table(
    summaries.map((s) => ({
      School: s.school,
      'School exists': s.existing
        ? 'yes'
        : !candidatesBySchool.get(s.school)?.length
          ? 'no (not created: nothing to import)'
          : dryRun
            ? 'no (would create)'
            : 'no (created)',
      'Parsed rows': s.parsed,
      [verb]: s.imported,
      'Duplicates skipped': s.duplicates,
      Problems: s.errors,
    })),
  )
  const total = (k: 'imported' | 'duplicates' | 'errors') => summaries.reduce((n, s) => n + s[k], 0)
  console.log(
    `Totals: ${verb.toLowerCase()} ${total('imported')}, duplicates skipped ${total('duplicates')}, problems ${problems.length}`,
  )

  const list = (title: string, items: Problem[]) => {
    if (!items.length) return
    items.sort((a, b) => a.school.localeCompare(b.school) || a.row - b.row)
    console.log(`\n${title} (${items.length}):`)
    for (const p of items) {
      const where = p.row ? `row ${p.row}` : 'tab'
      console.log(`  [${p.school}] ${where}${p.dts ? ` DTS ${p.dts}` : ''}: ${p.reason}`)
    }
  }
  list('Duplicates skipped', duplicates)
  list('Problems (not imported)', problems)
}

main().catch((e) => fail((e as Error).stack ?? String(e)))
