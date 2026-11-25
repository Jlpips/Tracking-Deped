import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as sb from '@/lib/supabase'
import ActivityLogsPage from '@/pages/system/ActivityLogsPage'
import type { makeSupabaseFake, Op } from '@/test/supabaseFake'

vi.mock('@/lib/supabase', async () => {
  const { makeSupabaseFake } = await import('@/test/supabaseFake')
  const fake = makeSupabaseFake()
  return { supabase: fake.client, fake }
})

const fake = (sb as unknown as { fake: ReturnType<typeof makeSupabaseFake> }).fake

const LOGS = [
  {
    id: 3,
    at: '2026-11-24T01:42:00Z',
    user_id: 'u1',
    username: '108874',
    role: 'user',
    action: 'records.insert',
    details: { id: 'r1', dts_number: '108874GCNBR-000024' },
  },
  {
    id: 2,
    at: '2026-11-23T07:10:00Z',
    user_id: 'su',
    username: 'root',
    role: 'superadmin',
    action: 'backup.create',
    details: { name: 'backup-20261123-071000.json', counts: { records: 142, schools: 3 } },
  },
  { id: 1, at: '2026-11-22T06:20:00Z', user_id: null, username: null, role: null, action: 'login.failed', details: { username: '108874' } },
]

let rows: unknown[]

beforeEach(() => {
  fake.calls.length = 0
  rows = LOGS
  fake.setResponder(() => ({ data: rows, error: null }))
})

const lastLogsOps = (): Op[] => fake.calls.filter((c) => c.table === 'activity_logs').at(-1)!.ops

describe('ActivityLogsPage', () => {
  it('renders log rows from the query, newest first, 50 per page', async () => {
    render(<ActivityLogsPage />)
    const added = await screen.findByText('Added record')
    const row = added.closest('tr')!
    expect(within(row).getByText('108874')).toBeInTheDocument()
    expect(within(row).getByText('108874GCNBR-000024')).toBeInTheDocument()

    const backupRow = screen.getByText('Created backup').closest('tr')!
    expect(within(backupRow).getByText('root')).toBeInTheDocument()
    expect(within(backupRow).getByText(/backup-20261123-071000\.json/)).toBeInTheDocument()
    expect(within(backupRow).getByText(/records 142/)).toBeInTheDocument()

    const failed = screen.getByText('Failed sign-in').closest('tr')!
    expect(within(failed).getByText('Unknown')).toBeInTheDocument()

    const ops = lastLogsOps()
    expect(ops).toContainEqual(['order', 'at', { ascending: false }])
    // 51 rows asked for: the extra one tells whether there is a next page.
    expect(ops).toContainEqual(['range', 0, 50])
  })

  it('searches username or action with an escaped ilike', async () => {
    render(<ActivityLogsPage />)
    await screen.findByText('Added record')
    fireEvent.change(screen.getByPlaceholderText('Search user or action'), { target: { value: 'adm_in' } })
    await waitFor(() =>
      expect(lastLogsOps()).toContainEqual(['or', 'username.ilike."%adm\\\\_in%",action.ilike."%adm\\\\_in%"']),
    )
  })

  it('filters by action group', async () => {
    render(<ActivityLogsPage />)
    await screen.findByText('Added record')
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'backups' } })
    await waitFor(() => expect(lastLogsOps()).toContainEqual(['or', 'action.like."backup.%"']))
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'settings' } })
    await waitFor(() =>
      expect(lastLogsOps()).toContainEqual(['or', 'action.like."schools.%",action.like."document\\\\_types.%"']),
    )
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'signin' } })
    await waitFor(() => expect(lastLogsOps()).toContainEqual(['or', 'action.like."login%",action.eq.logout']))
  })

  it('pages with Next and Previous', async () => {
    rows = Array.from({ length: 51 }, (_, i) => ({ ...LOGS[0], id: 100 - i }))
    render(<ActivityLogsPage />)
    await screen.findAllByText('Added record')
    expect(screen.getAllByText('Added record')).toHaveLength(50)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastLogsOps()).toContainEqual(['range', 50, 100]))
    rows = LOGS
  })

  it('shows the load error', async () => {
    fake.setResponder(() => ({ data: null, error: { message: 'permission denied' } }))
    render(<ActivityLogsPage />)
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })
})
