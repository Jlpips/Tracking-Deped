const FORMULA_START = /^[=+\-@\t\r]/

function field(v: string | null): string {
  let s = v ?? ''
  if (FORMULA_START.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Excel-friendly CSV: UTF-8 BOM, CRLF, every field quoted, formula-looking cells neutralised. */
export function toCsv(headers: string[], rows: (string | null)[][]): string {
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(field).join(',')).join('\r\n')
}
