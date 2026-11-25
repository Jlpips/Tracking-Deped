import { describe, expect, it } from 'vitest'
import { checkImportCreator, leaveDateProblem } from './importChecks.ts'

describe('checkImportCreator', () => {
  const admin = { user_id: 'u1', username: 'import', role: 'admin', disabled: false }

  it('accepts an enabled admin', () => {
    expect(checkImportCreator('import', admin)).toEqual({ ok: true, user_id: 'u1', username: 'import' })
  })

  it('refuses when no profile has that username', () => {
    const r = checkImportCreator('nobody', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/No account with username "nobody"/)
  })

  it('refuses a superadmin', () => {
    const r = checkImportCreator('boss', { ...admin, username: 'boss', role: 'superadmin' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/superadmin/i)
  })

  it('refuses a school user', () => {
    const r = checkImportCreator('school1', { ...admin, username: 'school1', role: 'user' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/school user/i)
  })

  it('refuses a disabled admin', () => {
    const r = checkImportCreator('import', { ...admin, disabled: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/disabled/i)
  })
})

describe('leaveDateProblem', () => {
  const leave = { name: 'APPLICATION FOR LEAVE', requires_leave_dates: true }
  const other = { name: 'PAYMENTS', requires_leave_dates: false }

  it('requires both dates for leave types', () => {
    expect(leaveDateProblem(leave, { date_from: '2025-01-01', date_to: null })).toMatch(/FROM and TO dates are required/)
  })

  it('accepts a valid range', () => {
    expect(leaveDateProblem(leave, { date_from: '2025-01-01', date_to: '2025-01-01' })).toBeNull()
    expect(leaveDateProblem(other, { date_from: null, date_to: null })).toBeNull()
  })

  it('rejects TO before FROM, for any document type', () => {
    expect(leaveDateProblem(leave, { date_from: '2025-01-05', date_to: '2025-01-02' })).toBe(
      'TO date 2025-01-02 is before FROM date 2025-01-05',
    )
    expect(leaveDateProblem(other, { date_from: '2025-01-05', date_to: '2025-01-02' })).toMatch(/is before FROM/)
  })
})
