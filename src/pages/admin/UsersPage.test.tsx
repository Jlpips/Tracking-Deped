import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { callAdminUsers } from '@/lib/adminUsers'
import * as sb from '@/lib/supabase'
import UsersPage from '@/pages/admin/UsersPage'
import { makeAuth, makeProfile } from '@/test/auth'
import type { makeSupabaseFake } from '@/test/supabaseFake'

vi.mock('@/lib/supabase', async () => {
  const { makeSupabaseFake } = await import('@/test/supabaseFake')
  const fake = makeSupabaseFake()
  return { supabase: fake.client, fake }
})
vi.mock('@/lib/adminUsers', async (orig) => ({
  ...(await orig<typeof import('@/lib/adminUsers')>()),
  callAdminUsers: vi.fn(),
}))
vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

const fake = (sb as unknown as { fake: ReturnType<typeof makeSupabaseFake> }).fake
const mockCall = vi.mocked(callAdminUsers)
const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001'

const SCHOOLS = [
  { id: 's1', name: 'Calantas ES' },
  { id: 's2', name: 'Anos ES' },
]
const PROFILES = [
  {
    user_id: ADMIN_ID,
    username: 'macalelon-admin',
    full_name: 'District Admin',
    role: 'admin',
    school_id: null,
    must_change_password: false,
    disabled: false,
    school: null,
  },
  {
    user_id: 'u1',
    username: '108874',
    full_name: 'School User 1',
    role: 'user',
    school_id: 's1',
    must_change_password: false,
    disabled: false,
    school: SCHOOLS[0],
  },
  {
    user_id: 'u3',
    username: '108871',
    full_name: 'School User 3',
    role: 'user',
    school_id: 's2',
    must_change_password: true,
    disabled: false,
    school: SCHOOLS[1],
  },
  {
    user_id: 'u4',
    username: '108872',
    full_name: 'School User 4',
    role: 'user',
    school_id: 's1',
    must_change_password: false,
    disabled: true,
    school: SCHOOLS[0],
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fake.calls.length = 0
  fake.setResponder((table) => ({ data: table === 'schools' ? SCHOOLS : PROFILES, error: null }))
  mockCall.mockReset()
  vi.mocked(useAuth).mockReturnValue(
    makeAuth({
      profile: makeProfile({ user_id: ADMIN_ID, username: 'macalelon-admin', role: 'admin', school_id: null, school: null }),
    }),
  )
})

async function openAddUser() {
  renderPage()
  await screen.findByText('School User 1')
  fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
  return screen.findByRole('dialog', { name: 'Add user' })
}

describe('UsersPage', () => {
  it('lists users with username, role, school, and status', async () => {
    renderPage()
    const row = (await screen.findByText('School User 1')).closest('tr')!
    expect(within(row).getByText('108874')).toBeInTheDocument()
    expect(within(row).getByText('User')).toBeInTheDocument()
    expect(within(row).getByText('Calantas ES')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(screen.getByText('School User 3').closest('tr')!).getByText('Must change password')).toBeInTheDocument()
    expect(within(screen.getByText('School User 4').closest('tr')!).getByText('Disabled')).toBeInTheDocument()
    expect(within(screen.getByText('District Admin').closest('tr')!).getByText('Admin')).toBeInTheDocument()
    // Profiles are read ordered by full name.
    const q = fake.calls.find((c) => c.table === 'profiles')!
    expect(q.ops).toContainEqual(['order', 'full_name'])
  })

  it('offers only "User" and "Admin" roles', async () => {
    const sheet = await openAddUser()
    const role = within(sheet).getByLabelText('Role')
    const options = within(role).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['User (school)', 'Admin'])
    expect(within(sheet).queryByText(/superadmin/i)).not.toBeInTheDocument()
  })

  it('hides the school picker for Admin', async () => {
    const sheet = await openAddUser()
    expect(within(sheet).getByLabelText('Assigned school')).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Role'), { target: { value: 'admin' } })
    expect(within(sheet).queryByLabelText('Assigned school')).not.toBeInTheDocument()
  })

  it('creates a user and shows the returned temporary password once', async () => {
    mockCall.mockResolvedValue({ user_id: 'new', username: '108875', temp_password: 'Kp7mQx2vRt9a' })
    const sheet = await openAddUser()
    fireEvent.change(within(sheet).getByLabelText('Full name'), { target: { value: 'School User 5' } })
    fireEvent.change(within(sheet).getByLabelText('Username'), { target: { value: '108875' } })
    fireEvent.change(within(sheet).getByLabelText('Assigned school'), { target: { value: 's2' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create user' }))

    const creds = await screen.findByRole('dialog', { name: 'User created' })
    expect(mockCall).toHaveBeenCalledWith({
      action: 'create',
      full_name: 'School User 5',
      username: '108875',
      role: 'user',
      school_id: 's2',
    })
    expect(within(creds).getByText('Kp7mQx2vRt9a')).toBeInTheDocument()
    expect(within(creds).getByText('108875')).toBeInTheDocument()
    expect(within(creds).getByText(/must change the password when they first sign in/)).toBeInTheDocument()
    expect(within(creds).getByRole('button', { name: 'Copy both' })).toBeInTheDocument()

    fireEvent.click(within(creds).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Kp7mQx2vRt9a')).not.toBeInTheDocument())
  })

  it('creates an admin without a school', async () => {
    mockCall.mockResolvedValue({ user_id: 'new', username: 'admin2', temp_password: 'Kp7mQx2vRt9a' })
    const sheet = await openAddUser()
    fireEvent.change(within(sheet).getByLabelText('Full name'), { target: { value: 'Admin 2' } })
    fireEvent.change(within(sheet).getByLabelText('Username'), { target: { value: 'admin2' } })
    fireEvent.change(within(sheet).getByLabelText('Role'), { target: { value: 'admin' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create user' }))
    await screen.findByRole('dialog', { name: 'User created' })
    expect(mockCall).toHaveBeenCalledWith({ action: 'create', full_name: 'Admin 2', username: 'admin2', role: 'admin' })
  })

  it('rejects a username with spaces before calling the server', async () => {
    const sheet = await openAddUser()
    fireEvent.change(within(sheet).getByLabelText('Full name'), { target: { value: 'X' } })
    fireEvent.change(within(sheet).getByLabelText('Username'), { target: { value: 'a b' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create user' }))
    expect(await within(sheet).findByText(/letters, numbers, dots, dashes, and underscores/)).toBeInTheDocument()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('shows the server error (e.g. duplicate username) in the sheet', async () => {
    mockCall.mockRejectedValue(new Error('That username is already taken.'))
    const sheet = await openAddUser()
    fireEvent.change(within(sheet).getByLabelText('Full name'), { target: { value: 'X' } })
    fireEvent.change(within(sheet).getByLabelText('Username'), { target: { value: '108874' } })
    fireEvent.change(within(sheet).getByLabelText('Assigned school'), { target: { value: 's1' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create user' }))
    expect(await within(sheet).findByText('That username is already taken.')).toBeInTheDocument()
  })

  it('edits a user without letting the username change', async () => {
    mockCall.mockResolvedValue({ ok: true })
    renderPage()
    const row = (await screen.findByText('School User 1')).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: 'Actions for 108874' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const sheet = await screen.findByRole('dialog', { name: 'Edit user' })
    expect(within(sheet).getByLabelText('Username')).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Full name'), { target: { value: 'Renamed' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save user' }))
    await waitFor(() =>
      expect(mockCall).toHaveBeenCalledWith({
        action: 'update',
        user_id: 'u1',
        full_name: 'Renamed',
        role: 'user',
        school_id: 's1',
      }),
    )
  })

  it('resets a password after confirming and shows the new temporary password', async () => {
    mockCall.mockResolvedValue({ username: '108874', temp_password: 'Zx8nWq3pLm4k' })
    renderPage()
    const row = (await screen.findByText('School User 1')).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: 'Actions for 108874' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset password' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }))
    const creds = await screen.findByRole('dialog', { name: 'Password reset' })
    expect(mockCall).toHaveBeenCalledWith({ action: 'reset_password', user_id: 'u1' })
    expect(within(creds).getByText('Zx8nWq3pLm4k')).toBeInTheDocument()
  })

  it('disables and enables accounts', async () => {
    mockCall.mockResolvedValue({ ok: true })
    renderPage()
    const row = (await screen.findByText('School User 1')).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: 'Actions for 108874' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable account' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disable account' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'set_disabled', user_id: 'u1', disabled: true }))

    const off = screen.getByText('School User 4').closest('tr')!
    fireEvent.pointerDown(within(off).getByRole('button', { name: 'Actions for 108872' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enable account' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'set_disabled', user_id: 'u4', disabled: false }))
  })

  it('never lists superadmins, including the signed-in superadmin', async () => {
    const SUPER_ID = 'a0000000-0000-4000-8000-000000000009'
    const superRow = {
      user_id: SUPER_ID,
      username: 'root',
      full_name: 'Aa Superadmin',
      role: 'superadmin',
      school_id: null,
      must_change_password: false,
      disabled: false,
      school: null,
    }
    // Like RLS: the caller's own row comes back unless the query filters superadmins out.
    fake.setResponder((table, ops) => {
      if (table === 'schools') return { data: SCHOOLS, error: null }
      const excludes = ops.some((o) => o[0] === 'neq' && o[1] === 'role' && o[2] === 'superadmin')
      return { data: excludes ? PROFILES : [superRow, ...PROFILES], error: null }
    })
    vi.mocked(useAuth).mockReturnValue(
      makeAuth({
        profile: makeProfile({ user_id: SUPER_ID, username: 'root', role: 'superadmin', school_id: null, school: null }),
      }),
    )
    renderPage()
    await screen.findByText('School User 1')
    const q = fake.calls.find((c) => c.table === 'profiles')!
    expect(q.ops).toContainEqual(['neq', 'role', 'superadmin'])
    expect(screen.queryByText('Aa Superadmin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actions for root' })).not.toBeInTheDocument()
    expect(screen.getByText(/Superadmins are not shown in this list/)).toBeInTheDocument()
  })

  it("doesn't offer disabling or a role change for your own account", async () => {
    renderPage()
    const row = (await screen.findByText('District Admin')).closest('tr')!
    fireEvent.pointerDown(within(row).getByRole('button', { name: 'Actions for macalelon-admin' }), {
      button: 0,
      ctrlKey: false,
    })
    await screen.findByRole('menuitem', { name: 'Edit' })
    expect(screen.queryByRole('menuitem', { name: 'Disable account' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const sheet = await screen.findByRole('dialog', { name: 'Edit user' })
    expect(within(sheet).getByLabelText('Role')).toBeDisabled()
  })
})
