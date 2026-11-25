import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { saveRecord } from '@/lib/records'
import type { DtsRecord } from '@/lib/types'
import { RecordForm } from '@/pages/RecordForm'
import { makeAuth, makeProfile } from '@/test/auth'

vi.mock('@/lib/supabase', () => {
  const tables: Record<string, unknown[]> = {
    document_types: [
      { id: 't1', name: 'FORM 6 / LEAVE OF ABSENCE', office: 'HR 2 & 3', requires_leave_dates: true },
      { id: 't2', name: 'PAYMENTS', office: 'PERSONNEL (PAYROLL)', requires_leave_dates: false },
      { id: 't3', name: 'MOOE RELATED', office: 'ACCOUNTING OFFICE', requires_leave_dates: false },
    ],
    schools: [
      { id: 's2', name: 'Anos ES' },
      { id: 's1', name: 'Calantas ES' },
    ],
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({ order: () => Promise.resolve({ data: tables[table] ?? [], error: null }) }),
      }),
    },
  }
})

vi.mock('@/lib/records', async (orig) => ({
  ...(await orig<typeof import('@/lib/records')>()),
  saveRecord: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockUseAuth = vi.mocked(useAuth)
const mockSave = vi.mocked(saveRecord)

const SAVED: DtsRecord = {
  id: 'r9',
  school_id: 's2',
  created_by: 'u1',
  created_by_username: '108874',
  date: '2026-11-25',
  name: 'Zorayda M. Decena',
  honorific: 'Mrs',
  leave_type: 'Wellness Leave',
  description: null,
  contact: null,
  title: 'x',
  dts_number: '108874ABCDE-000001',
  document_type_id: 't1',
  date_from: '2026-12-02',
  date_to: '2026-12-03',
  excluded_date: null,
  created_at: '2026-11-25T00:00:00Z',
}

function renderForm(props: Partial<Parameters<typeof RecordForm>[0]> = {}) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  render(<RecordForm open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />)
  return { onSaved, onOpenChange }
}

async function chooseType(name: string) {
  const select = screen.getByLabelText('Document type') as HTMLSelectElement
  await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1))
  const option = Array.from(select.querySelectorAll('option')).find((o) => o.textContent === name)!
  fireEvent.change(select, { target: { value: option.value } })
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const title = () => (screen.getByLabelText('Title of the document') as HTMLTextAreaElement).value

beforeEach(() => {
  mockSave.mockReset()
  vi.mocked(toast.success).mockClear()
  mockUseAuth.mockReturnValue(makeAuth())
})

describe('RecordForm', () => {
  it('shows the office of the chosen type and the leave dates only when the type needs them', async () => {
    renderForm()
    await chooseType('PAYMENTS')
    expect(screen.getByText('PERSONNEL (PAYROLL)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Date from')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Date to')).not.toBeInTheDocument()

    await chooseType('FORM 6 / LEAVE OF ABSENCE')
    expect(screen.getByText('HR 2 & 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Date from')).toBeInTheDocument()
    expect(screen.getByLabelText('Date to')).toBeInTheDocument()
    expect(screen.getByLabelText('Excluded date')).toBeInTheDocument()
  })

  it('groups document types by office', async () => {
    renderForm()
    await chooseType('PAYMENTS')
    const groups = screen.getByLabelText('Document type').querySelectorAll('optgroup')
    expect(Array.from(groups).map((g) => g.label)).toEqual(['ACCOUNTING OFFICE', 'HR 2 & 3', 'PERSONNEL (PAYROLL)'])
    expect(screen.getByText('3 document types from the district route list, grouped by office.')).toBeInTheDocument()
  })

  it('rejects Date to before Date from without calling saveRecord', async () => {
    renderForm()
    await chooseType('FORM 6 / LEAVE OF ABSENCE')
    type('Name', 'Zorayda M. Decena')
    type('DTS number', '108874ABCDE-000001')
    type('Date from', '2026-12-03')
    type('Date to', '2026-12-02')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Date to must be on or after Date from.')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows the duplicate DTS error under the DTS number', async () => {
    mockSave.mockRejectedValue(new Error('This DTS number is already recorded.'))
    renderForm()
    await chooseType('PAYMENTS')
    type('Name', 'Zorayda M. Decena')
    type('DTS number', '108874ABCDE-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    const msg = await screen.findByText('This DTS number is already recorded.')
    expect(screen.getByLabelText('DTS number')).toHaveAttribute('aria-describedby', msg.id)
  })

  it('builds the title automatically and stops after "Edit manually"', async () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'admin', school_id: null, school: null }) }))
    renderForm()
    await chooseType('FORM 6 / LEAVE OF ABSENCE')
    const school = screen.getByLabelText('School') as HTMLSelectElement
    await waitFor(() => expect(school.querySelectorAll('option').length).toBeGreaterThan(1))
    fireEvent.change(school, { target: { value: 's2' } })
    fireEvent.change(screen.getByLabelText('Honorific'), { target: { value: 'Mrs' } })
    type('Name', 'Zorayda M. Decena')
    type('Date from', '2026-12-02')
    type('Date to', '2026-12-03')
    expect(screen.getByLabelText('Leave type')).toHaveValue('Wellness Leave')
    expect(title()).toBe('Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES')
    expect(screen.getByLabelText('Title of the document')).toHaveAttribute('readonly')

    fireEvent.click(screen.getByRole('button', { name: 'Edit manually' }))
    type('Title of the document', 'My own title')
    type('Name', 'Someone Else')
    expect(title()).toBe('My own title')

    fireEvent.click(screen.getByRole('button', { name: 'Use automatic title' }))
    expect(title()).toBe('Form 6- Wellness Leave - December 2-3, 2026 of Mrs Someone Else - Anos ES')
  })

  it('has no email field', async () => {
    renderForm()
    await chooseType('PAYMENTS')
    expect(screen.queryByLabelText(/email/i)).toBeNull()
  })

  it('uses the specified leave type for Others and requires it', async () => {
    renderForm()
    await chooseType('FORM 6 / LEAVE OF ABSENCE')
    fireEvent.change(screen.getByLabelText('Leave type'), { target: { value: 'Others' } })
    expect(screen.getByLabelText('Specify leave type')).toBeInTheDocument()

    type('Name', 'Zorayda M. Decena')
    type('DTS number', '108874ABCDE-000001')
    type('Date from', '2026-12-02')
    type('Date to', '2026-12-03')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Specify the leave type.')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()

    type('Specify leave type', 'Terminal Leave')
    expect(title().startsWith('Form 6- Terminal Leave')).toBe(true)
  })

  it('saves a school user record with the profile school and nulls for hidden fields', async () => {
    mockSave.mockResolvedValue(SAVED)
    const { onSaved, onOpenChange } = renderForm()
    await chooseType('PAYMENTS')
    expect(screen.getByLabelText('School')).toBeDisabled()
    expect(screen.getByText('Assigned to your account.')).toBeInTheDocument()
    type('Name', 'Juan Cruz')
    type('DTS number', '  108874ABCDE-000001 ')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        school_id: 's1',
        document_type_id: 't2',
        honorific: 'Mrs',
        name: 'Juan Cruz',
        dts_number: '108874ABCDE-000001',
        leave_type: null,
        description: null,
        date_from: null,
        date_to: null,
        excluded_date: null,
        title: 'Payments of Mrs Juan Cruz - Calantas ES',
      }),
    )
    expect(mockSave.mock.calls[0][0]).not.toHaveProperty('id')
    expect(toast.success).toHaveBeenCalledWith('Record saved')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('edits an existing record keeping its saved title and showing a custom leave type as Others', async () => {
    mockSave.mockResolvedValue(SAVED)
    const record: DtsRecord = {
      ...SAVED,
      school_id: 's1',
      leave_type: 'Terminal Leave',
      title: 'Saved custom title',
    }
    const { onSaved } = renderForm({ record })
    await waitFor(() => expect(screen.getByLabelText('Leave type')).toHaveValue('Others'))
    expect(screen.getByLabelText('Specify leave type')).toHaveValue('Terminal Leave')
    expect(title()).toBe('Saved custom title')
    type('Name', 'Changed Name')
    expect(title()).toBe('Saved custom title')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r9', leave_type: 'Terminal Leave', title: 'Saved custom title' }),
    )
  })
})
