import { actionKind, actionLabel, formatDetails } from '@/lib/activityLogs'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

describe('actionLabel', () => {
  it('gives friendly labels and falls back to the raw action', () => {
    expect(actionLabel('records.insert')).toBe('Added record')
    expect(actionLabel('login.failed')).toBe('Failed sign-in')
    expect(actionLabel('backup.restore')).toBe('Restored backup')
    expect(actionLabel('something.new')).toBe('something.new')
  })
})

describe('actionKind', () => {
  it.each([
    ['records.insert', 'create'],
    ['user.create', 'create'],
    ['records.update', 'edit'],
    ['user.reset_password', 'edit'],
    ['schools.delete', 'delete'],
    ['user.disable', 'delete'],
    ['backup.create', 'system'],
    ['export.csv', 'system'],
    ['login', 'login'],
    ['logout', 'login'],
    ['login.failed', 'fail'],
  ])('%s → %s', (action, kind) => expect(actionKind(action)).toBe(kind))
})

describe('formatDetails', () => {
  it('shows identifiers bare, hides ids, and flattens nested objects', () => {
    expect(formatDetails({ id: 'r1', dts_number: '108874GCNBR-000024' })).toBe('108874GCNBR-000024')
    expect(formatDetails({ name: 'backup-1.json', counts: { records: 142, document_types: 71 } })).toBe(
      'backup-1.json · counts: records 142, document types 71',
    )
    expect(formatDetails({ user_id: 'u', username: 'x', changes: ['full_name', 'role'] })).toBe('x · changes: full_name, role')
    expect(formatDetails({ id: 'only-id' })).toBe('id: only-id')
    expect(formatDetails(null)).toBe('')
  })
})
