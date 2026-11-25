import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { Caller } from '../_shared/auth.ts'
import { sampleBackup } from './testdata.ts'
import { backupFileName, isBackupName, NOT_A_BACKUP, parseBackup, validateRequest } from './logic.ts'

const SUPER: Caller = { userId: 'a0000000-0000-4000-8000-000000000009', role: 'superadmin', username: 'root' }
const ADMIN: Caller = { userId: 'a0000000-0000-4000-8000-000000000001', role: 'admin', username: 'macalelon-admin' }
const USER: Caller = { userId: 'a0000000-0000-4000-8000-000000000002', role: 'user', username: '108870' }

Deno.test('parseBackup rejects {} and {version: 2}', () => {
  assertThrows(() => parseBackup({}), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ ...sampleBackup(), version: 2 }), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ version: 2 }), Error, NOT_A_BACKUP)
})

Deno.test('parseBackup rejects non-objects and wrong shapes', () => {
  for (const bad of [null, undefined, 'x', 1, [], [sampleBackup()]]) {
    assertThrows(() => parseBackup(bad), Error, NOT_A_BACKUP)
  }
  const missingRecords: Record<string, unknown> = { ...sampleBackup() }
  delete missingRecords.records
  assertThrows(() => parseBackup(missingRecords), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ ...sampleBackup(), created_at: 5 }), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ ...sampleBackup(), schools: [{ id: 's1' }] }), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ ...sampleBackup(), records: [{ id: 'r1' }] }), Error, NOT_A_BACKUP)
  assertThrows(() => parseBackup({ ...sampleBackup(), profiles: ['u1'] }), Error, NOT_A_BACKUP)
  assertThrows(
    () => parseBackup({ ...sampleBackup(), document_types: [{ id: 'd1', name: 'X', office: 'Y' }] }),
    Error,
    NOT_A_BACKUP,
  )
})

Deno.test('parseBackup accepts a version 1 backup', () => {
  const b = parseBackup(sampleBackup())
  assertEquals(b.version, 1)
  assertEquals(b.records[0].dts_number, '108870ABCDE-000001')
  assertEquals(b.schools.length, 1)
})

Deno.test('backupFileName is backup-YYYYMMDD-HHmmss.json in UTC', () => {
  assertEquals(backupFileName(new Date('2026-11-25T03:04:05.678Z')), 'backup-20261125-030405.json')
  assertEquals(backupFileName(new Date('2026-01-02T23:59:09Z')), 'backup-20260102-235909.json')
})

Deno.test('isBackupName accepts only our file names', () => {
  assert(isBackupName('backup-20261125-030405.json'))
  assert(isBackupName('backup-20261125-030405-2.json'))
  for (const bad of ['', '../x.json', 'backup-2026.json', 'backup-20261125-030405.json/../a', 'x/backup-20261125-030405.json', 5, null]) {
    assert(!isBackupName(bad), String(bad))
  }
})

Deno.test('non-superadmin callers get 403 for every action', () => {
  for (const caller of [ADMIN, USER]) {
    for (const body of [{ action: 'create' }, { action: 'list' }, { action: 'download', name: 'backup-20261125-030405.json' }]) {
      const v = validateRequest(caller, body)
      assertEquals(v.ok, false)
      if (!v.ok) assertEquals(v.status, 403)
    }
    const v = validateRequest(caller, { action: 'restore', name: 'backup-20261125-030405.json', confirm: 'RESTORE' })
    assertEquals(v.ok ? 200 : v.status, 403)
  }
})

Deno.test('restore requires confirm === "RESTORE"', () => {
  for (const confirm of ['restore', 'RESTORE ', '', undefined, true]) {
    const v = validateRequest(SUPER, { action: 'restore', name: 'backup-20261125-030405.json', confirm })
    assertEquals(v.ok ? 200 : v.status, 400, String(confirm))
  }
})

Deno.test('restore needs exactly one of name or backup', () => {
  const both = validateRequest(SUPER, {
    action: 'restore',
    name: 'backup-20261125-030405.json',
    backup: sampleBackup(),
    confirm: 'RESTORE',
  })
  assertEquals(both.ok ? 200 : both.status, 400)
  const neither = validateRequest(SUPER, { action: 'restore', confirm: 'RESTORE' })
  assertEquals(neither.ok ? 200 : neither.status, 400)
})

Deno.test('restore with an invalid uploaded backup → 400', () => {
  const v = validateRequest(SUPER, { action: 'restore', backup: { version: 2 }, confirm: 'RESTORE' })
  assertEquals(v.ok, false)
  if (!v.ok) {
    assertEquals(v.status, 400)
    assertEquals(v.error, 'This file is not a DTS Tracker backup.')
  }
})

Deno.test('download and restore reject bad names', () => {
  const d = validateRequest(SUPER, { action: 'download', name: '../secrets.json' })
  assertEquals(d.ok ? 200 : d.status, 400)
  const r = validateRequest(SUPER, { action: 'restore', name: 'nope', confirm: 'RESTORE' })
  assertEquals(r.ok ? 200 : r.status, 400)
})

Deno.test('unknown or missing action → 400', () => {
  for (const body of [{}, { action: 'drop' }, null, 'create']) {
    const v = validateRequest(SUPER, body)
    assertEquals(v.ok ? 200 : v.status, 400)
  }
})

Deno.test('valid superadmin requests pass', () => {
  assertEquals(validateRequest(SUPER, { action: 'create' }), { ok: true, request: { action: 'create' } })
  assertEquals(validateRequest(SUPER, { action: 'list' }), { ok: true, request: { action: 'list' } })
  assertEquals(validateRequest(SUPER, { action: 'download', name: 'backup-20261125-030405.json' }), {
    ok: true,
    request: { action: 'download', name: 'backup-20261125-030405.json' },
  })
  const byName = validateRequest(SUPER, { action: 'restore', name: 'backup-20261125-030405.json', confirm: 'RESTORE' })
  assertEquals(byName, { ok: true, request: { action: 'restore', name: 'backup-20261125-030405.json' } })
  const upload = validateRequest(SUPER, { action: 'restore', backup: sampleBackup(), confirm: 'RESTORE' })
  assert(upload.ok && upload.request.action === 'restore' && upload.request.backup?.version === 1)
})
