export type Role = 'user' | 'admin' | 'superadmin'

export interface Profile {
  user_id: string
  username: string
  full_name: string
  role: Role
  school_id: string | null
  must_change_password: boolean
  disabled: boolean
}

export interface School {
  id: string
  name: string
}

export interface DocumentType {
  id: string
  name: string
  office: string
  requires_leave_dates: boolean
}

export interface DtsRecord {
  id: string
  school_id: string
  created_by: string
  created_by_username: string
  date: string
  name: string
  honorific: string | null
  leave_type: string | null
  description: string | null
  contact: string | null
  title: string
  dts_number: string
  document_type_id: string
  date_from: string | null
  date_to: string | null
  excluded_date: string | null
  created_at: string
  school?: School
  document_type?: DocumentType
}
