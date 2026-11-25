import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { callBackup } from '@/lib/backup'
import BackupPage from '@/pages/system/BackupPage'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
vi.mock('@/lib/backup', async (orig) => ({
  ...(await orig<typeof import('@/lib/backup')>()),
  callBackup: vi.fn(),
}))

const mockCall = vi.mocked(callBackup)
const NAME = 'backup-20261124-101500.json'
const LIST = [
  { name: NAME, created_at: '2026-11-24T10:15:00Z', size: 2048 },
  { name: 'backup-20261117-090000.json', created_at: '2026-11-17T09:00:00Z', size: 1536 },
]

function validBackup() {
  return {
    version: 1,
    created_at: '2026-11-20T00:00:00Z',
    schools: [{ id: 's1', name: 'Anos ES' }],
    document_types: [{ id: 'd1', name: 'TRAVEL', office: 'ASDS', requires_leave_dates: true }],
    profiles: [{ user_id: 'u1', username: '108870', full_name: 'User', role: 'user', school_id: 's1' }],
    records: [
      {
        id: 'r1',
        school_id: 's1',
        created_by: 'u1',
        document_type_id: 'd1',
        dts_number: 'X-1',
        title: 'T',
        name: 'N',
        date: '2026-11-20',
      },
    ],
  }
}

const RESULT = {
  restored: { schools: 0, document_types: 0, profiles: 0, records: 1 },
  skipped: [],
  safety_backup: 'backup-20261125-000000.json',
}

beforeEach(() => {
  mockCall.mockReset()
  mockCall.mockImplementation(async (body) => {
    if (body.action === 'list') return LIST
    if (body.action === 'create') return { name: 'backup-20261125-000000.json', size: 100 }
    if (body.action === 'download') return { url: 'http://127.0.0.1:54321/storage/v1/object/sign/backups/x?token=t' }
    if (body.action === 'restore') return RESULT
    return null
  })
})

async function openRestoreFor(name: string) {
  const row = (await screen.findByText(name)).closest('tr')!
  fireEvent.pointerDown(within(row).getByRole('button', { name: `Actions for ${name}` }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }))
  return screen.findByRole('dialog', { name: 'Restore data?' })
}

function chooseFile(content: string, name = 'my-backup.json') {
  const input = screen.getByLabelText(/choose a file/i) as HTMLInputElement
  const file = new File([content], name, { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('BackupPage', () => {
  it('lists stored backups with size', async () => {
    render(<BackupPage />)
    const row = (await screen.findByText(NAME)).closest('tr')!
    expect(within(row).getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('backup-20261117-090000.json')).toBeInTheDocument()
    expect(mockCall).toHaveBeenCalledWith({ action: 'list' })
  })

  it('creates a backup and reloads the list', async () => {
    render(<BackupPage />)
    await screen.findByText(NAME)
    fireEvent.click(screen.getByRole('button', { name: 'Create backup now' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'create' }))
    await waitFor(() => expect(mockCall.mock.calls.filter((c) => c[0].action === 'list')).toHaveLength(2))
  })

  it('keeps "Restore data" disabled until the input is exactly RESTORE', async () => {
    render(<BackupPage />)
    const dialog = await openRestoreFor(NAME)
    expect(within(dialog).getByText(NAME)).toBeInTheDocument()
    const input = within(dialog).getByLabelText('Type RESTORE to confirm')
    const button = within(dialog).getByRole('button', { name: 'Restore data' })
    expect(button).toBeDisabled()
    for (const value of ['restore', 'RESTORE ', ' RESTORE', 'RESTOR']) {
      fireEvent.change(input, { target: { value } })
      expect(button).toBeDisabled()
    }
    fireEvent.change(input, { target: { value: 'RESTORE' } })
    expect(button).toBeEnabled()
  })

  it('restores a stored backup by name and shows the result', async () => {
    render(<BackupPage />)
    const dialog = await openRestoreFor(NAME)
    fireEvent.change(within(dialog).getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore data' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'restore', name: NAME, confirm: 'RESTORE' }))
    expect(await screen.findByText(/backup-20261125-000000\.json/)).toBeInTheDocument()
  })

  it('shows the server error inside the dialog when restore fails', async () => {
    mockCall.mockImplementation(async (body) => {
      if (body.action === 'list') return LIST
      throw new Error('Backup not found.')
    })
    render(<BackupPage />)
    const dialog = await openRestoreFor(NAME)
    fireEvent.change(within(dialog).getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore data' }))
    expect(await within(dialog).findByText('Backup not found.')).toBeInTheDocument()
  })

  it('rejects a file that is not a backup before sending anything', async () => {
    render(<BackupPage />)
    await screen.findByText(NAME)
    chooseFile('{"hello": "world"}', 'notes.json')
    expect(await screen.findByText('This file is not a DTS Tracker backup.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore…' })).toBeDisabled()
    chooseFile('not json at all', 'broken.json')
    expect(await screen.findByText('This file is not a DTS Tracker backup.')).toBeInTheDocument()
    expect(mockCall.mock.calls.some((c) => c[0].action === 'restore')).toBe(false)
  })

  it('restores from an uploaded file with the parsed backup', async () => {
    render(<BackupPage />)
    await screen.findByText(NAME)
    const backup = validBackup()
    chooseFile(JSON.stringify(backup), 'flash-drive.json')
    const restoreBtn = screen.getByRole('button', { name: 'Restore…' })
    await waitFor(() => expect(restoreBtn).toBeEnabled())
    fireEvent.click(restoreBtn)
    const dialog = await screen.findByRole('dialog', { name: 'Restore data?' })
    expect(within(dialog).getByText('flash-drive.json')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore data' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'restore', backup, confirm: 'RESTORE' }))
  })

  it('downloads through a signed URL', async () => {
    const assign = vi.fn()
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      assign(this.href)
    })
    render(<BackupPage />)
    const row = (await screen.findByText(NAME)).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: `Actions for ${NAME}` }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Download' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'download', name: NAME }))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(assign.mock.calls[0][0]).toContain('/storage/v1/object/sign/backups/x?token=t')
    spy.mockRestore()
  })
})
