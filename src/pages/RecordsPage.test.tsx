import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { listAllRecords, listRecords } from '@/lib/records'
import type { DtsRecord } from '@/lib/types'
import RecordsPage from '@/pages/RecordsPage'
import { makeAuth, makeProfile } from '@/test/auth'

const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock('@/lib/supabase', () => {
  const tables: Record<string, unknown[]> = {
    document_types: [
      { id: 't1', name: 'FORM 6 / LEAVE OF ABSENCE', office: 'HR 2 & 3', requires_leave_dates: true },
      { id: 't2', name: 'MOOE RELATED', office: 'ACCOUNTING OFFICE', requires_leave_dates: false },
    ],
    schools: [{ id: 's1', name: 'Calantas ES' }],
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({ order: () => Promise.resolve({ data: tables[table] ?? [], error: null }) }),
      }),
      rpc: (...args: unknown[]) => rpc(...args),
    },
  }
})

vi.mock('@/lib/records', async (orig) => ({
  ...(await orig<typeof import('@/lib/records')>()),
  listRecords: vi.fn(),
  listAllRecords: vi.fn(),
  deleteRecord: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('@/auth/AuthProvider')>()),
  useAuth: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockList = vi.mocked(listRecords)
const mockListAll = vi.mocked(listAllRecords)

const RECORD: DtsRecord = {
  id: 'r1',
  school_id: 's1',
  created_by: 'u1',
  created_by_username: '108874',
  date: '2026-11-24',
  name: 'Teacher A',
  honorific: 'Mr',
  leave_type: 'Vacation Leave',
  description: null,
  contact: '0900 000 0001',
  title: 'Form 6 - Vacation Leave of Mr Teacher A - Calantas ES',
  dts_number: '108874GCNBR-000024',
  document_type_id: 't1',
  date_from: '2026-12-09',
  date_to: '2026-12-11',
  excluded_date: '2026-12-10',
  created_at: '2026-11-24T01:00:00Z',
  school: { id: 's1', name: 'Calantas ES' },
  document_type: { id: 't1', name: 'FORM 6 / LEAVE OF ABSENCE', office: 'HR 2 & 3', requires_leave_dates: true },
}

function renderPage(url = '/records') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RecordsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue({ rows: [RECORD], total: 1 })
  mockListAll.mockReset().mockResolvedValue([RECORD])
  rpc.mockClear()
})

describe('RecordsPage', () => {
  it('hides the School column and filter from school users', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    renderPage()
    expect(await screen.findByText(RECORD.title)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'School' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'School' })).not.toBeInTheDocument()
  })

  it('shows the School column and filter to admins', async () => {
    mockUseAuth.mockReturnValue(makeAuth({ profile: makeProfile({ role: 'admin', school_id: null, school: null }) }))
    renderPage()
    expect(await screen.findByText(RECORD.title)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'School' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'School' })).toBeInTheDocument()
    const row = screen.getByText(RECORD.title).closest('tr')!
    expect(within(row).getByText('Calantas ES')).toBeInTheDocument()
  })

  it('searches after the debounce and goes back to page 1', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    mockList.mockResolvedValue({ rows: [RECORD], total: 60 })
    renderPage('/records?page=2')
    await screen.findByText(RECORD.title)
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 25 }))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'Teacher' } })
    expect(mockList).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'Teacher' }))
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Teacher', page: 1 })),
    )
  })

  it('exports every row of the current filters as CSV with the header row first', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    let blob: Blob | undefined
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b
      return 'blob:x'
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderPage('/records?type=t1&office=HR+2+%26+3&from=2026-11-01')
    await screen.findByText(RECORD.title)
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(mockListAll).toHaveBeenCalledWith(
      expect.objectContaining({ documentTypeId: 't1', office: 'HR 2 & 3', from: '2026-11-01' }),
    )
    const text = await blob!.text()
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toBe(
      '"Date","Name","Contact number","Title of document","DTS number","Document type","Office routed to","Date from","Date to","Excluded date","Encoded by"',
    )
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.download).toMatch(/^dts-records-\d{4}-\d{2}-\d{2}\.csv$/)
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('log_activity', expect.objectContaining({ p_action: 'export.csv' })),
    )
    click.mockRestore()
  })

  it('shows the empty-state copy when nothing matches', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    mockList.mockResolvedValue({ rows: [], total: 0 })
    renderPage()
    expect(await screen.findByText('No matching records. Try a different filter.')).toBeInTheDocument()
  })

  it('opens the routing slip with the DTS number when a row is clicked', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    renderPage()
    fireEvent.click(await screen.findByText(RECORD.title))
    const slip = await screen.findByRole('dialog')
    expect(within(slip).getByText('Routing slip')).toBeInTheDocument()
    expect(within(slip).getByText(RECORD.dts_number)).toBeInTheDocument()
    expect(within(slip).getByText('Mr Teacher A')).toBeInTheDocument()
    expect(within(slip).getAllByText('HR 2 & 3').length).toBeGreaterThan(0)
    expect(within(slip).getByRole('button', { name: /Copy/ })).toBeInTheDocument()
  })

  it('shows the list error with a Retry button', async () => {
    mockUseAuth.mockReturnValue(makeAuth())
    mockList.mockRejectedValueOnce(new Error('Network down'))
    renderPage()
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(RECORD.title)).toBeInTheDocument()
  })
})
