import { buildTitle, formatDateRange } from './title'

const base = { schoolName: 'Anos ES', requiresDates: false, name: 'X' }

describe('formatDateRange', () => {
  it('formats a single day', () => {
    expect(formatDateRange('2026-10-23')).toBe('October 23, 2026')
    expect(formatDateRange('2026-10-23', '2026-10-23')).toBe('October 23, 2026')
    expect(formatDateRange('2026-10-23', '')).toBe('October 23, 2026')
  })
  it('formats ranges within a month, across months and across years', () => {
    expect(formatDateRange('2026-12-02', '2026-12-03')).toBe('December 2-3, 2026')
    expect(formatDateRange('2026-11-30', '2026-12-02')).toBe('November 30 - December 2, 2026')
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('December 30, 2026 - January 2, 2027')
  })
})

describe('buildTitle', () => {
  it('builds the Form 6 sample title', () => {
    expect(
      buildTitle({
        docTypeName: 'FORM 6 / LEAVE OF ABSENCE',
        honorific: 'Mrs',
        name: 'Zorayda M. Decena',
        leaveType: 'Wellness Leave',
        dateFrom: '2026-12-02',
        dateTo: '2026-12-03',
        schoolName: 'Anos ES',
        requiresDates: true,
      }),
    ).toBe('Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES')
  })
  it('uses a single date for one day', () => {
    expect(
      buildTitle({ ...base, docTypeName: 'FORM 6 / LEAVE OF ABSENCE', honorific: 'Mr', leaveType: 'Sick Leave', dateFrom: '2026-10-23', dateTo: '2026-10-23', requiresDates: true }),
    ).toBe('Form 6- Sick Leave - October 23, 2026 of Mr X - Anos ES')
  })
  it('handles cross-month and cross-year ranges', () => {
    expect(
      buildTitle({ ...base, docTypeName: 'TRAVEL', honorific: 'Ms', dateFrom: '2026-11-30', dateTo: '2026-12-02', requiresDates: true }),
    ).toBe('Travel - November 30 - December 2, 2026 of Ms X - Anos ES')
    expect(
      buildTitle({ ...base, docTypeName: 'TRAVEL ABROAD', dateFrom: '2026-12-30', dateTo: '2027-01-02', requiresDates: true }),
    ).toBe('Travel Abroad - December 30, 2026 - January 2, 2027 of X - Anos ES')
  })
  it('labels Authority to Travel as Locator Slip', () => {
    expect(
      buildTitle({ docTypeName: 'AUTHORITY TO TRAVEL / LOCATOR SLIP', honorific: 'Mr', name: 'Juan Dela Cruz', dateFrom: '2026-11-21', dateTo: '2026-11-21', schoolName: 'Calantas ES', requiresDates: true }),
    ).toBe('Locator Slip - November 21, 2026 of Mr Juan Dela Cruz - Calantas ES')
  })
  it('uses the description as the label when given', () => {
    expect(
      buildTitle({ docTypeName: 'PAYMENTS', description: 'Salary Differential', honorific: 'Mrs', name: 'Teacher C', schoolName: 'Calantas ES', requiresDates: false }),
    ).toBe('Salary Differential of Mrs Teacher C - Calantas ES')
  })
  it('title-cases the type name keeping acronyms', () => {
    expect(buildTitle({ ...base, docTypeName: 'MOOE RELATED' })).toBe('MOOE Related of X - Anos ES')
    expect(buildTitle({ ...base, docTypeName: 'DEPED EMAIL', honorific: '' })).toBe('DepEd Email of X - Anos ES')
    expect(buildTitle({ ...base, docTypeName: 'AIP/APP/SIP-ONLINE 2025' })).toBe('AIP/APP/SIP-Online 2025 of X - Anos ES')
    expect(buildTitle({ ...base, docTypeName: 'IPCRF (NTP)' })).toBe('IPCRF (NTP) of X - Anos ES')
  })
  it('omits dates when the type does not require them or Date from is empty', () => {
    expect(buildTitle({ ...base, docTypeName: 'TRAVEL', dateFrom: '2026-11-30', requiresDates: false })).toBe('Travel of X - Anos ES')
    expect(buildTitle({ ...base, docTypeName: 'TRAVEL', dateFrom: '', requiresDates: true })).toBe('Travel of X - Anos ES')
  })
  it('uses an ellipsis for an empty name or leave type', () => {
    expect(buildTitle({ ...base, docTypeName: 'FORM 6 / LEAVE OF ABSENCE', name: '  ', leaveType: '' })).toBe('Form 6- … of … - Anos ES')
  })
  it('ignores a blank description', () => {
    expect(buildTitle({ ...base, docTypeName: 'GAD', description: '   ' })).toBe('GAD of X - Anos ES')
  })
})
