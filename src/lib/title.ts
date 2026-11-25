const ACRONYMS = new Set(
  'AIP APP SIP ALS WAP ERF EFS BEIS EBEIS BERF CTC DTR ITR ELLNA GAD GSIS IPCRF OPCRF NTP LAC LFIFA LRN LIS MOA MOOE NEAP NOSI NOSA NSBI POW PSDS SHS SPED SDS ASDS SGOD CID HR'.split(
    ' ',
  ),
)

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const EMPTY = '…'

/** Title Case for an upper-case document type name, keeping known acronyms upper-case. */
function titleCaseTypeName(name: string): string {
  return name.replace(/[A-Za-z0-9]+/g, (word) => {
    const upper = word.toUpperCase()
    if (upper === 'DEPED') return 'DepEd'
    if (ACRONYMS.has(upper)) return upper
    return upper.charAt(0) + upper.slice(1).toLowerCase()
  })
}

function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

/**
 * Formats a YYYY-MM-DD range for titles:
 * `October 23, 2026`, `December 2-3, 2026`, `November 30 - December 2, 2026`,
 * `December 30, 2026 - January 2, 2027`.
 */
export function formatDateRange(from: string, to?: string): string {
  const a = parseIsoDate(from)
  if (!to || to === from) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`
  const b = parseIsoDate(to)
  if (a.y !== b.y) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} - ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
  if (a.m !== b.m) return `${MONTHS[a.m - 1]} ${a.d} - ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`
  return `${MONTHS[a.m - 1]} ${a.d}-${b.d}, ${a.y}`
}

/** True for the Form 6 (leave) document type, e.g. `FORM 6 / LEAVE OF ABSENCE`. */
export function isForm6(docTypeName: string | null | undefined): boolean {
  return /^FORM\s*6\b/.test((docTypeName ?? '').trim().toUpperCase())
}

export function buildTitle(v: {
  docTypeName: string
  description?: string
  honorific?: 'Mr' | 'Mrs' | 'Ms' | 'Dr' | ''
  name: string
  leaveType?: string
  dateFrom?: string
  dateTo?: string
  schoolName: string
  requiresDates: boolean
}): string {
  const typeName = v.docTypeName.trim().toUpperCase()
  let label: string
  if (isForm6(typeName)) {
    label = `Form 6- ${v.leaveType?.trim() || EMPTY}`
  } else if (v.description?.trim()) {
    label = v.description.trim()
  } else if (typeName.includes('LOCATOR SLIP')) {
    label = 'Locator Slip'
  } else {
    label = titleCaseTypeName(v.docTypeName.trim())
  }

  const dates = v.requiresDates && v.dateFrom ? ` - ${formatDateRange(v.dateFrom, v.dateTo)}` : ''
  const person = `${v.honorific ? `${v.honorific} ` : ''}${v.name.trim() || EMPTY}`
  return `${label}${dates} of ${person} - ${v.schoolName}`
}
