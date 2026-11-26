import { FunctionsHttpError } from '@supabase/supabase-js'
import { callBackup, formatBytes, looksLikeBackup, MAX_BACKUP_BYTES, readBackupFile, toBrowserUrl } from '@/lib/backup'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const invoke = vi.mocked(supabase.functions.invoke)

const BACKUP = {
  version: 1,
  created_at: '2026-11-20T00:00:00Z',
  schools: [],
  document_types: [],
  profiles: [],
  records: [],
}

beforeEach(() => invoke.mockReset())

describe('callBackup', () => {
  it('invokes the backup function and returns data', async () => {
    invoke.mockResolvedValue({ data: [{ name: 'b' }], error: null } as never)
    await expect(callBackup({ action: 'list' })).resolves.toEqual([{ name: 'b' }])
    expect(invoke).toHaveBeenCalledWith('backup', { body: { action: 'list' } })
  })

  it("surfaces the function's JSON error message", async () => {
    const res = new Response(JSON.stringify({ error: 'Only superadmins can manage backups.' }), { status: 403 })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(res) } as never)
    await expect(callBackup({ action: 'create' })).rejects.toThrow('Only superadmins can manage backups.')
  })
})

describe('looksLikeBackup / readBackupFile', () => {
  it('accepts a version 1 backup and rejects other shapes', () => {
    expect(looksLikeBackup(BACKUP)).toBe(true)
    expect(looksLikeBackup({})).toBe(false)
    expect(looksLikeBackup({ ...BACKUP, version: 2 })).toBe(false)
    expect(looksLikeBackup({ ...BACKUP, records: [{ id: 'r1' }] })).toBe(false)
  })

  it('reads a valid file', async () => {
    const file = new File([JSON.stringify(BACKUP)], 'b.json')
    await expect(readBackupFile(file)).resolves.toEqual(BACKUP)
  })

  it('rejects bad JSON, wrong shape, and files over 20 MB', async () => {
    const msg = 'This file is not a DTS Tracker backup.'
    await expect(readBackupFile(new File(['nope'], 'a.json'))).rejects.toThrow(msg)
    await expect(readBackupFile(new File(['{"version":1}'], 'a.json'))).rejects.toThrow(msg)
    const big = new File([JSON.stringify(BACKUP)], 'big.json')
    Object.defineProperty(big, 'size', { value: MAX_BACKUP_BYTES + 1 })
    await expect(readBackupFile(big)).rejects.toThrow(msg)
  })
})

describe('toBrowserUrl', () => {
  it('moves a signed URL from the internal host to the app’s Supabase URL', () => {
    expect(toBrowserUrl('http://kong:8000/storage/v1/object/sign/backups/b.json?token=t&download=b.json', 'http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321/storage/v1/object/sign/backups/b.json?token=t&download=b.json',
    )
    expect(toBrowserUrl('https://x.supabase.co/storage/v1/object/sign/backups/b.json?token=t', 'https://x.supabase.co/')).toBe(
      'https://x.supabase.co/storage/v1/object/sign/backups/b.json?token=t',
    )
  })
})

it('formatBytes', () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(2048)).toBe('2.0 KB')
  expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
})
