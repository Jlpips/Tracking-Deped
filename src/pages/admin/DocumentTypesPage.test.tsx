import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as sb from '@/lib/supabase'
import DocumentTypesPage from '@/pages/admin/DocumentTypesPage'
import { isMutation, type makeSupabaseFake } from '@/test/supabaseFake'

vi.mock('@/lib/supabase', async () => {
  const { makeSupabaseFake } = await import('@/test/supabaseFake')
  const fake = makeSupabaseFake()
  return { supabase: fake.client, fake }
})

const fake = (sb as unknown as { fake: ReturnType<typeof makeSupabaseFake> }).fake

const TYPES = [
  { id: 't1', name: 'FORM 6 / LEAVE OF ABSENCE', office: 'HR 2 & 3', requires_leave_dates: true },
  { id: 't2', name: 'MOOE RELATED', office: 'ACCOUNTING OFFICE', requires_leave_dates: false },
  { id: 't3', name: 'TRAVEL', office: 'ASDS', requires_leave_dates: false },
]

let mutationResult: { error: { message: string; code?: string } | null }

beforeEach(() => {
  fake.calls.length = 0
  mutationResult = { error: null }
  fake.setResponder((_t, ops) => (isMutation(ops) ? mutationResult : { data: TYPES, error: null }))
})

describe('DocumentTypesPage', () => {
  it('lists types with office and whether they ask for dates', async () => {
    render(<DocumentTypesPage />)
    const row = (await screen.findByText('FORM 6 / LEAVE OF ABSENCE')).closest('tr')!
    expect(within(row).getByText('HR 2 & 3')).toBeInTheDocument()
    expect(within(row).getByText('Yes')).toBeInTheDocument()
    expect(within(screen.getByText('MOOE RELATED').closest('tr')!).getByText('No')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Routed to office' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Asks for dates?' })).toBeInTheDocument()
  })

  it('filters by document type or office', async () => {
    render(<DocumentTypesPage />)
    await screen.findByText('MOOE RELATED')
    fireEvent.change(screen.getByPlaceholderText('Search document type or office'), { target: { value: 'accounting' } })
    expect(screen.getByText('MOOE RELATED')).toBeInTheDocument()
    expect(screen.queryByText('TRAVEL')).not.toBeInTheDocument()
    expect(screen.getByText('1 shown')).toBeInTheDocument()
  })

  it('saves name and office in upper case, with the dates flag', async () => {
    render(<DocumentTypesPage />)
    await screen.findByText('MOOE RELATED')
    fireEvent.click(screen.getByRole('button', { name: 'Add type' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add document type' })
    fireEvent.change(within(dialog).getByLabelText('Document type'), { target: { value: ' Travel Order ' } })
    fireEvent.change(within(dialog).getByLabelText('Routed to office'), { target: { value: 'asds' } })
    fireEvent.click(within(dialog).getByLabelText('Has Date from, Date to, and Excluded date'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save document type' }))
    await waitFor(() => expect(fake.find('document_types', 'insert')).toHaveLength(1))
    expect(fake.find('document_types', 'insert')[0].ops).toContainEqual([
      'insert',
      { name: 'TRAVEL ORDER', office: 'ASDS', requires_leave_dates: true },
    ])
  })

  it('shows the "still used" message when delete is rejected with 23503', async () => {
    mutationResult = { error: { message: 'violates foreign key constraint', code: '23503' } }
    render(<DocumentTypesPage />)
    const row = (await screen.findByText('TRAVEL')).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: 'Actions for TRAVEL' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText("This is still used by existing records, so it can't be deleted."),
    ).toBeInTheDocument()
  })
})
