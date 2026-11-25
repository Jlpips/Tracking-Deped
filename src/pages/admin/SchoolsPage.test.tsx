import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as sb from '@/lib/supabase'
import SchoolsPage from '@/pages/admin/SchoolsPage'
import { isMutation, type makeSupabaseFake } from '@/test/supabaseFake'

vi.mock('@/lib/supabase', async () => {
  const { makeSupabaseFake } = await import('@/test/supabaseFake')
  const fake = makeSupabaseFake()
  return { supabase: fake.client, fake }
})

const fake = (sb as unknown as { fake: ReturnType<typeof makeSupabaseFake> }).fake

const SCHOOLS = [
  { id: 's1', name: 'Anos ES', profiles: [{ count: 2 }], records: [{ count: 17 }] },
  { id: 's2', name: 'Calantas ES', profiles: [{ count: 1 }], records: [{ count: 0 }] },
]

let mutationResult: { error: { message: string; code?: string } | null }

beforeEach(() => {
  fake.calls.length = 0
  mutationResult = { error: null }
  fake.setResponder((_t, ops) => (isMutation(ops) ? mutationResult : { data: SCHOOLS, error: null }))
})

async function openRowMenu(name: string) {
  const row = (await screen.findByText(name)).closest('tr')!
  fireEvent.pointerDown(within(row).getByRole('button', { name: `Actions for ${name}` }), { button: 0, ctrlKey: false })
}

describe('SchoolsPage', () => {
  it('lists schools with user and record counts', async () => {
    render(<SchoolsPage />)
    const row = (await screen.findByText('Anos ES')).closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('17')).toBeInTheDocument()
  })

  it('adds a school (trimmed)', async () => {
    render(<SchoolsPage />)
    await screen.findByText('Anos ES')
    fireEvent.click(screen.getByRole('button', { name: 'Add school' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add school' })
    fireEvent.change(within(dialog).getByLabelText('School name'), { target: { value: '  Pinagbayanan ES ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save school' }))
    await waitFor(() => expect(fake.find('schools', 'insert')).toHaveLength(1))
    expect(fake.find('schools', 'insert')[0].ops).toContainEqual(['insert', { name: 'Pinagbayanan ES' }])
  })

  it('renames a school', async () => {
    render(<SchoolsPage />)
    await openRowMenu('Anos ES')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit school' })
    const input = within(dialog).getByLabelText('School name')
    expect(input).toHaveValue('Anos ES')
    fireEvent.change(input, { target: { value: 'Anos Elementary School' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save school' }))
    await waitFor(() => expect(fake.find('schools', 'update')).toHaveLength(1))
    const ops = fake.find('schools', 'update')[0].ops
    expect(ops).toContainEqual(['update', { name: 'Anos Elementary School' }])
    expect(ops).toContainEqual(['eq', 'id', 's1'])
  })

  it('shows "That name already exists." on a duplicate name', async () => {
    mutationResult = { error: { message: 'duplicate key', code: '23505' } }
    render(<SchoolsPage />)
    await screen.findByText('Anos ES')
    fireEvent.click(screen.getByRole('button', { name: 'Add school' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add school' })
    fireEvent.change(within(dialog).getByLabelText('School name'), { target: { value: 'Anos ES' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save school' }))
    expect(await within(dialog).findByText('That name already exists.')).toBeInTheDocument()
  })

  it('shows the "still used" message when delete is rejected with 23503', async () => {
    mutationResult = { error: { message: 'violates foreign key constraint', code: '23503' } }
    render(<SchoolsPage />)
    await openRowMenu('Anos ES')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText("This is still used by existing records, so it can't be deleted."),
    ).toBeInTheDocument()
    const del = fake.find('schools', 'delete')
    expect(del).toHaveLength(1)
    expect(del[0].ops).toContainEqual(['eq', 'id', 's1'])
  })
})
