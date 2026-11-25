# Macalelon District DTS Tracker — Design

Date: 2026-11-24 · Status: awaiting approval

## Intent and why
The Macalelon District currently tracks documents entered in the DTS using one Excel workbook ("MACALELON DISTRICT FIELD DTS MONITORING TOOL.xlsx") with one tab per school. We are replacing it with a small web app where each school has its own login, so schools encode their own records and the district office sees everything. (The user has not yet said what hurts most about Excel; the goals below follow from the workbook's structure and the "kanya-kanyang users" requirement.)

## Goals
- Each school logs in and sees/adds/edits only its own records.
- District office (admin) sees all records, can filter by school, and manages users.
- Replace Excel columns: Date, Name, Contact number, Title of document, DTS number, Document type, Office routed to, Date From, Date To, Excluded date. The Excel "DepEd email" column is dropped (user decision 2026-11-25: no email, use username); each record instead stores the username of whoever encoded it.
- "Dadalhin sa office" is filled automatically from the document type.
- Search and filter (school, document type, office, date range); export to CSV/Excel.
- One-time import of the existing workbook (one tab = one school).

## Non-goals (v1)
- No document status/approval workflow, no notifications (Excel has none; can be added later).
- No public sign-up, no file attachments, no DTS integration.

## Constraints
- Deployed on Vercel; data in Supabase (Postgres + Auth). Free tiers.
- Users are DepEd staff, many on phones/low bandwidth: simple, fast, mobile-friendly UI.
- Contains personal data (names, phone numbers): access must be enforced in the database, not only the UI.

## Approaches considered
1. **Supabase (Postgres + Auth + Row Level Security)** — chosen by the user. Login built in; per-school access rules live in the database; free tier; spreadsheet-like admin dashboard. Trade-off: free projects pause after a week of inactivity.
2. Neon Postgres + custom login — more code to write and secure; rejected.
3. Google Sheets as database — slow, API limits, no safe per-school access; rejected.

## Design
**Stack:** Vite + React + TypeScript + React Router + Supabase JS client, hosted on Vercel as a static site (Vite chosen over Next.js: login-only app, no SEO/server rendering needed, Supabase is the backend; needs a `vercel.json` rewrite for direct links). UI: Tailwind + **shadcn/ui** (user's request for a modern look): Table, Form, Dialog/Sheet, Select, Badge, Toast; light and dark mode.

**Data**
- `schools(id, name)`
- `profiles(user_id, school_id nullable, role: 'user' | 'admin' | 'superadmin')` — `user` must have an assigned school; admin/superadmin have none.
- Roles: **user** = own school's records only. **admin** = all records, manage users/schools/document types. **superadmin** = everything admin can, plus activity logs and backup/restore (only superadmin sees these).
- **Sign-in is by username, not email.** Admins and superadmins create accounts: username (e.g. School ID, unique, can't be changed), role, assigned school, and a temporary password they hand to the user. `profiles.must_change_password` is true on creation and on every admin password reset; the app forces a change-password screen at first sign-in before anything else. Implementation: Supabase Auth needs an email, so the app maps `username` → `username@dts.local` internally (never shown). Account creation and password reset run in a Supabase Edge Function using the service key (never in the browser). No self-signup, no email-based recovery: "forgot password" means asking the district office to reset it.
- **Superadmin is a hidden role:** it can't be created or seen from the UI. Superadmin accounts are made directly in Supabase; they are excluded from the Users list (even for superadmin) and from admin-visible data, and admins cannot assign or edit that role (enforced by RLS, not just the UI).
- `activity_logs(id, at, user_id, role, action, details)` — insert-only; readable by superadmin only. Logs create/edit/delete, login (incl. failed), export, backup/restore, user changes.
- Backup = downloadable JSON of records, users (no passwords), schools, document types; restore (from a stored backup or an uploaded backup file) requires typing RESTORE and auto-creates a backup first; it adds back and updates records from the backup and keeps records added after it. Runs in a Supabase Edge Function (service key never in the browser).
- `document_types(id, name, office, requires_leave_dates bool)` — admin-editable. Seeded with the full district route list (71 types, 11 offices) in `docs/route-list.csv`; Form 6 / Leave of Absence, Travel, Travel Abroad, and Authority to Travel / Locator Slip ask for Date from / Date to / Excluded date.
- `records(id, school_id, created_by, created_by_username, date, name, contact, title, dts_number, document_type_id, date_from, date_to, excluded_date, created_at)`; office is derived from the document type at display/export time.
- RLS: school users can select/insert/update/delete only rows where `school_id` = their own; admin can do everything.

**Screens**
- Login (username + password). No self-signup; admin creates accounts and assigns a school.
- Records list: table with search and filters, "Add record" button, edit/delete per row. Schools see their own; admin sees all with a School column.
- Add/Edit record form: Date defaults to today; choosing the document type shows the office automatically and reveals Date From/To/Excluded only for Form 6. Title is built automatically in the district format, e.g. "Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES" (from document type, leave type, dates, Mr/Mrs/Ms, name, school); the user can switch to editing it manually. DTS number must be unique.
- Admin: Users (create/disable, assign school), Schools, Document types.
- Export CSV of the current filtered view.

**Import:** a one-time script reads the workbook (exported .xlsx) and inserts rows per school tab; duplicates by DTS number are skipped and reported.

## Left to the builder
Fine visual styling within the shadcn/ui default look, table pagination, exact validation messages, how the excluded date(s) are entered (my call: a simple text field for now, since the workbook uses one cell).

## Open items for the user
- Full list of schools (tab names) and who the district admin(s) are.
