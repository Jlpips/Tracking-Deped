// Sample backup shared by the backup function's tests.
import type { Backup } from './logic.ts'

export function sampleBackup(): Backup {
  return {
    version: 1,
    created_at: '2026-11-25T01:02:03.000Z',
    schools: [{ id: 's1', name: 'Anos ES' }],
    document_types: [{ id: 'd1', name: 'TRAVEL', office: 'ASDS', requires_leave_dates: true }],
    profiles: [
      {
        user_id: 'u1',
        username: '108870',
        full_name: 'School User',
        role: 'user',
        school_id: 's1',
        must_change_password: false,
        disabled: false,
      },
    ],
    records: [
      {
        id: 'r1',
        school_id: 's1',
        created_by: 'u1',
        created_by_username: '108870',
        date: '2026-11-20',
        name: 'Juan Dela Cruz',
        honorific: 'Mr',
        leave_type: null,
        description: null,
        contact: null,
        title: 'Travel to Lucena',
        dts_number: '108870ABCDE-000001',
        document_type_id: 'd1',
        date_from: '2026-11-21',
        date_to: '2026-11-22',
        excluded_date: null,
        created_at: '2026-11-20T00:00:00+00:00',
        updated_at: '2026-11-20T00:00:00+00:00',
      },
    ],
  }
}
