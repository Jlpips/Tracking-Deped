# Macalelon District DTS Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Excel "MACALELON DISTRICT FIELD DTS MONITORING TOOL" with a web app where each school logs in and encodes its own DTS records, and the district office sees, filters, and exports everything.

**Architecture:** Static Vite + React SPA on Vercel talking directly to Supabase. Per-school access is enforced in Postgres with Row Level Security; anything that needs the service key (creating users, resetting passwords, backup/restore) runs in Supabase Edge Functions. Activity logging is done by database triggers plus two small RPCs, so the browser cannot skip it.

**Tech Stack:** Vite, React 18, TypeScript, React Router 6, Tailwind CSS, shadcn/ui, @supabase/supabase-js v2, Vitest + Testing Library, Supabase CLI (local Postgres + pgTAP via `supabase test db`), Deno for Edge Functions, `xlsx` (SheetJS) for the import script.

**Spec:** `docs/superpowers/specs/2026-11-24-dts-tracker-design.md` · Visual reference: `mockup/index.html` (layout, labels, copy, colours — rebuild it with shadcn/ui components, don't copy its CSS).

## Global Constraints

- Hosting: Vercel (static) + Supabase free tier. No other backend.
- The Supabase service-role key never reaches the browser; only Edge Functions and the import script use it.
- Sign-in is by **username**; the app maps `username` → `${username}@dts.local` internally and never shows that address.
- Roles: `user` (own school only, must have a school), `admin` (everything, no school), `superadmin` (admin + activity logs + backup/restore; hidden: never listed, never assignable from the app).
- `must_change_password` is true on account creation and every admin reset; the change-password screen blocks everything else until done.
- No self-signup, no email recovery. Login page copy for forgotten passwords: "Forgot your password? Ask the district office to reset it."
- Seed document types: all 71 rows of the district route list in `docs/route-list.csv` (source: "MACALELON DISTRICT FIELD DTS MONITORING TOOL.pdf"), names and offices exactly as written there (uppercase). Four types require dates (`requires_leave_dates = true`; UI label "Dates"): `FORM 6 / LEAVE OF ABSENCE`, `TRAVEL`, `TRAVEL ABROAD`, `AUTHORITY TO TRAVEL / LOCATOR SLIP` (user decision 2026-11-25). 11 offices: ACCOUNTING OFFICE, ADMIN OFFICE, ASDS, CASHIER, CID, EFS, HR 2 & 3, PERSONNEL (PAYROLL), PLANNING, SDS, SGOD.
- Record columns, in this order everywhere (form, table export, import): Date, Name, Contact number, Title of document, DTS number, Document type, Office routed to (derived), Date from, Date to, Excluded date, Encoded by (username, automatic).
- **No email anywhere in the UI or data.** Records have no email field; people are identified by username. (The `@dts.local` mapping exists only inside Supabase Auth and is never shown or typed.)
- Mobile-friendly: every screen usable at 360 px wide; light and dark mode.
- Restore requires typing `RESTORE` and creates a backup automatically first.
- Prerequisites on the dev machine: Node 20+, Docker Desktop (for `supabase start`), Supabase CLI, Deno 1.4x+.

## Review Focus

1. **DTS number typed with different case or stray spaces** (`108874-000025 ` vs `108874-000025`) → treated as the same number and rejected as a duplicate. Test in Task 2.
2. **A disabled account whose session is still open** → it can no longer read or write anything; RLS checks `disabled`, not just the login. Test in Task 3.
3. **Form 6 with Date to earlier than Date from** → rejected by the database and shown as a form error. Tests in Tasks 2 and 8.
4. **CSV export with commas, quotes, line breaks, `ñ`, or cells starting `=`, `+`, `-`, `@`** → opens correctly in Excel (UTF-8 BOM, quoted, formula-neutralised). Test in Task 5.
5. **Deleting a document type or school that records still use** → blocked with a clear message, never silently deleting records. Tests in Tasks 2 and 9.

---

## File Structure

```
supabase/
  config.toml                         (supabase init)
  migrations/
    20261125000001_schema.sql         tables, constraints, seed
    20261125000002_rls.sql            helper fns, RLS policies, superadmin guard
    20261125000003_activity.sql       activity_logs triggers + RPCs
  tests/
    schema_test.sql  rls_test.sql  activity_test.sql    (pgTAP)
  functions/
    _shared/auth.ts                   getCaller(req) -> {userId, role}
    _shared/cors.ts
    admin-users/index.ts              create / reset / update / set-disabled
    admin-users/logic.ts              pure validation (Deno-tested)
    admin-users/logic_test.ts
    backup/index.ts                   create / list / download / restore
    backup/logic.ts  backup/logic_test.ts
scripts/import-workbook.ts            one-time Excel import
src/
  main.tsx  App.tsx  routes.tsx
  lib/supabase.ts                     client
  lib/username.ts                     usernameToEmail
  lib/title.ts                        buildTitle
  lib/csv.ts                          toCsv
  lib/records.ts                      listRecords / saveRecord / deleteRecord + RecordFilters
  lib/types.ts                        DB row types
  auth/AuthProvider.tsx               session + profile context
  auth/guards.tsx                     RequireAuth, RequireRole
  pages/LoginPage.tsx  ChangePasswordPage.tsx
  pages/RecordsPage.tsx               list, filters, export, routing slip
  pages/RecordForm.tsx                add/edit sheet
  pages/admin/UsersPage.tsx  SchoolsPage.tsx  DocumentTypesPage.tsx
  pages/system/ActivityLogsPage.tsx  BackupPage.tsx
  components/AppShell.tsx             sidebar nav + who-am-I + logout
  components/ui/*                     shadcn generated
vercel.json  .env.example  README.md
```

Shared types (Task 5 defines them in `src/lib/types.ts`; every UI task uses them):

```ts
export type Role = 'user' | 'admin' | 'superadmin';
export interface Profile { user_id: string; username: string; full_name: string; role: Role; school_id: string | null; must_change_password: boolean; disabled: boolean; }
export interface School { id: string; name: string; }
export interface DocumentType { id: string; name: string; office: string; requires_leave_dates: boolean; }
export interface DtsRecord { id: string; school_id: string; created_by: string; created_by_username: string; date: string; name: string; honorific: string | null; leave_type: string | null; description: string | null; contact: string | null; title: string; dts_number: string; document_type_id: string; date_from: string | null; date_to: string | null; excluded_date: string | null; created_at: string; school?: School; document_type?: DocumentType; }
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.ts`, `components.json`, `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`, `src/test/setup.ts`, `vercel.json`, `.env.example`, `.gitignore`, `supabase/config.toml`

**Interfaces:**
- Produces: `npm run dev | build | test`, `@/` path alias → `src/`, shadcn components importable from `@/components/ui/*`, env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

- [ ] **Step 1:** `git init` in the project root; `.gitignore` covers `node_modules`, `dist`, `.env*` (except `.env.example`), `supabase/.temp`, `*.xlsx`.
- [ ] **Step 2:** `npm create vite@latest . -- --template react-ts` (keep `docs/` and `mockup/`), add Tailwind, run `npx shadcn@latest init` and add: `button input label select table dialog sheet badge dropdown-menu sonner card tabs alert-dialog`. Fonts: Public Sans (body) and IBM Plex Mono (DTS numbers), as in the mockup.
- [ ] **Step 3:** Add Vitest (`jsdom`, `@testing-library/react`, `@testing-library/jest-dom`). Write `src/App.test.tsx`: renders `<App />` and expects text `DTS Tracker`.
- [ ] **Step 4:** `npm test` → FAIL (no such text), then make `App` render the title → PASS.
- [ ] **Step 5:** `vercel.json`: `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`. `supabase init`. `.env.example` lists the two `VITE_` vars.
- [ ] **Step 6:** `npm run build` succeeds. Commit `chore: scaffold vite + shadcn + supabase`.

---

### Task 2: Database schema and seed

**Files:**
- Create: `supabase/migrations/20261125000001_schema.sql`, `supabase/tests/schema_test.sql`

**Interfaces:**
- Produces tables (all `id uuid default gen_random_uuid()` unless noted):
  - `schools(id, name text unique not null)`
  - `document_types(id, name text unique not null, office text not null, requires_leave_dates bool not null default false)`
  - `profiles(user_id uuid pk references auth.users on delete cascade, username text unique not null, full_name text not null, role text not null check in ('user','admin','superadmin'), school_id uuid references schools on delete restrict, must_change_password bool not null default true, disabled bool not null default false, created_at timestamptz default now())` with check `(role = 'user') = (school_id is not null)`.
  - `records(id, school_id uuid not null references schools on delete restrict, created_by uuid not null default auth.uid() references auth.users, created_by_username text not null, date date not null default current_date, name text not null, honorific text check (honorific in ('Mr','Mrs','Ms','Dr')), leave_type text, description text, contact text, title text not null, dts_number text not null, document_type_id uuid not null references document_types on delete restrict, date_from date, date_to date, excluded_date text, created_at timestamptz default now(), updated_at timestamptz default now())`
  - Trigger `records_set_creator` (BEFORE INSERT): sets `created_by_username` from `profiles.username` of `created_by`, ignoring any client value; BEFORE UPDATE keeps the original `created_by`/`created_by_username` (stored on the row so school users can see who encoded a record without reading other people's profiles).
  - Unique index `records_dts_number_key on records (upper(btrim(dts_number)))`.
  - Check `date_to is null or date_from is null or date_to >= date_from`.
  - Trigger `records_require_leave_dates` (BEFORE INSERT/UPDATE): if the record's document type has `requires_leave_dates`, `date_from` and `date_to` must be non-null, else raise `'Date from and Date to are required for this document type'`.
  - `activity_logs(id bigint identity pk, at timestamptz default now(), user_id uuid, username text, role text, action text not null, details jsonb not null default '{}')`
- Seed rows: generate the `insert into document_types` statement from `docs/route-list.csv` (71 rows) into the migration; don't hand-type it. Schools are not seeded (list still open; import creates them).

- [ ] **Step 1: Write the failing pgTAP test** `schema_test.sql`:
  - `has_table` for all five tables.
  - Seed: `select is(count(*)::int, 71) from document_types`; `select is(count(distinct office)::int, 11) from document_types`; `results_eq('select name from document_types where requires_leave_dates order by name', $$values ('AUTHORITY TO TRAVEL / LOCATOR SLIP'),('FORM 6 / LEAVE OF ABSENCE'),('TRAVEL'),('TRAVEL ABROAD')$$)`; spot-check `PAYMENTS` → `PERSONNEL (PAYROLL)`, `AUTHORITY TO TRAVEL / LOCATOR SLIP` → `ASDS`, `NEW ACCOUNT / CHANGE SIGNATORIES` → `CASHIER`.
  - Insert record `dts_number '108874-000025'`; `throws_ok` inserting `' 108874-000025 '` lower/upper variant with SQLSTATE `23505` (Review Focus 1).
  - `throws_ok` Form 6 record with `date_from '2026-12-11', date_to '2026-12-09'` → `23514` (Review Focus 3).
  - `throws_ok` Form 6 record with null `date_from` → message above.
  - `throws_ok` deleting a document type and a school that a record references → `23503` (Review Focus 5).
  - `throws_ok` profile `role 'user'` with null school → `23514`.
  - Inserting a record with `created_by_username 'fake'` stores the creator's real username; `has_column('records','email')` is false (`hasnt_column`).
- [ ] **Step 2:** `supabase start && supabase test db` → FAIL (tables missing).
- [ ] **Step 3:** Write the migration as specified above.
- [ ] **Step 4:** `supabase db reset && supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): schema, constraints, seed document types`.

---

### Task 3: Row Level Security and superadmin guard

**Files:**
- Create: `supabase/migrations/20261125000002_rls.sql`, `supabase/tests/rls_test.sql`

**Interfaces:**
- Consumes: Task 2 tables.
- Produces SQL helpers (all `stable security definer set search_path = public`, granted to `authenticated`):
  - `my_role() returns text` — role of `auth.uid()`, **null if the profile is `disabled`**.
  - `my_school() returns uuid`
  - `is_admin() returns bool` — `my_role() in ('admin','superadmin')`
  - `complete_password_change() returns void` — sets own `must_change_password = false` (the only client-side profile write).
- Policies:
  - `records`: user → select/insert/update/delete where `school_id = my_school()` (insert/update `with check` the same); admin → all. Nothing for a null role.
  - `schools`, `document_types`: any active (non-null role) user selects; admin inserts/updates/deletes.
  - `profiles`: select own row, or (is_admin() and `role <> 'superadmin'`). No insert/update/delete policies (writes go through Edge Functions / RPC).
  - `activity_logs`: select only when `my_role() = 'superadmin'`; no insert/update/delete policies.
- Trigger `profiles_guard_superadmin` BEFORE INSERT/UPDATE/DELETE on `profiles`: if `NEW.role = 'superadmin'` or `OLD.role = 'superadmin'`, raise `'superadmin accounts can only be managed in the Supabase dashboard'` unless `coalesce(auth.role(), '') not in ('authenticated','service_role','anon')` (i.e. allowed only from the SQL editor / migrations). Exception: allow the UPDATE that only flips `must_change_password` on one's own row.

- [ ] **Step 1: Write failing tests** `rls_test.sql`. Fixture: schools A and B; users `ua` (user, A), `ub` (user, B), `adm` (admin), `sup` (superadmin); one record per school. Switch identity with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`. Assert:
  - `ua` selects 1 record (school A); `adm` selects 2.
  - `ua` inserting a record with `school_id = B` → `throws_ok` `42501`; updating B's record affects 0 rows.
  - `ua` sees only own profile; `adm` and `sup` see profiles of `ua`, `ub`, `adm` but **not** `sup`.
  - `adm` selects 0 `activity_logs`; `sup` can select.
  - After `update profiles set disabled = true where user_id = ua` (as postgres), `ua` selects 0 records and inserting fails (Review Focus 2).
  - As `service_role`, updating `ua` to `role 'superadmin'` → throws guard message.
  - `ua` calling `complete_password_change()` sets own flag false.
- [ ] **Step 2:** `supabase test db` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `supabase db reset && supabase test db` → all PASS.
- [ ] **Step 5:** Commit `feat(db): row level security and superadmin guard`.

---

### Task 4: Activity logging

**Files:**
- Create: `supabase/migrations/20261125000003_activity.sql`, `supabase/tests/activity_test.sql`

**Interfaces:**
- Produces:
  - Trigger fn `log_change()` AFTER INSERT/UPDATE/DELETE on `records`, `profiles`, `schools`, `document_types`: inserts `action` = `'<table>.<insert|update|delete>'`, `details = {id, dts_number?/name?/username?}` (no passwords, no full row), `user_id = auth.uid()`, `username`/`role` from profiles.
  - `log_activity(p_action text, p_details jsonb default '{}') returns void` — security definer, `authenticated` only; `p_action` must be one of `'login','logout','export.csv'`.
  - `log_failed_login(p_username text) returns void` — security definer, granted to `anon`; inserts `action 'login.failed'`, `details {username}`; truncates username to 64 chars.
  - Edge Functions write their own rows (`backup.create`, `backup.restore`, `user.create`, `user.reset_password`, `user.disable`, `user.enable`) with the service key.

- [ ] **Step 1: Failing tests:** as `ua`, insert a record → one `activity_logs` row `records.insert` with `user_id = ua`; `log_activity('export.csv', '{"rows":3}')` inserts; `log_activity('anything')` throws; as `anon`, `log_failed_login('108874')` inserts `login.failed`; `ua` still cannot select logs.
- [ ] **Step 2:** `supabase test db` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(db): activity log triggers and RPCs`.

---

### Task 5: Frontend data layer and pure helpers

**Files:**
- Create: `src/lib/{supabase,username,title,csv,records,types}.ts`, tests `src/lib/*.test.ts`

**Interfaces:**
- Produces:
  - `supabase` client from `VITE_` env vars.
  - `usernameToEmail(username: string): string` → `trim().toLowerCase() + '@dts.local'`; throws `'Invalid username'` if empty or contains anything other than `[a-z0-9._-]` after normalising.
  - `buildTitle(v: { docTypeName: string; description?: string; honorific?: 'Mr' | 'Mrs' | 'Ms' | 'Dr' | ''; name: string; leaveType?: string; dateFrom?: string; dateTo?: string; schoolName: string; requiresDates: boolean }): string` — "Format B", chosen by the user 2026-11-25 from their sample `Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES`. Form 6: `Form 6- <Leave type>[ - <DATES>] of [<Hon> ]<Name> - <School>` (note: no space before the first dash, as in the sample). Other types: `<LABEL>[ - <DATES>] of [<Hon> ]<Name> - <School>`; LABEL = description if given, else `Locator Slip` for Authority to Travel / Locator Slip, else the type name in Title Case keeping acronyms upper-case (AIP APP SIP ALS WAP ERF EFS BEIS EBEIS BERF CTC DTR ITR ELLNA GAD GSIS IPCRF OPCRF NTP LAC LFIFA LRN LIS MOA MOOE NEAP NOSI NOSA NSBI POW PSDS SHS SPED SDS ASDS SGOD CID HR; `DEPED` → `DepEd`). DATES only when `requiresDates` and Date from is set: `October 23, 2026`; same month `December 2-3, 2026`; across months `November 30 - December 2, 2026`; across years `December 30, 2026 - January 2, 2027`. Name is used as typed. Leave types (full names): Vacation Leave, Mandatory/Forced Leave, Sick Leave, Wellness Leave, Special Privilege Leave, Maternity Leave, Paternity Leave, Solo Parent Leave, Study Leave, 10-Day VAWC Leave, Rehabilitation Privilege, Special Leave Benefits for Women, Special Emergency (Calamity) Leave, Adoption Leave. The form keeps the title automatic until "Edit manually"; "Use automatic title" rebuilds it.
  - `toCsv(headers: string[], rows: (string | null)[][]): string` — starts with `﻿`, CRLF line endings, every field quoted, `"` doubled, fields starting with `= + - @` prefixed with `'`.
  - `type RecordFilters = { schoolId?: string; documentTypeId?: string; office?: string; from?: string; to?: string; q?: string; page: number; pageSize: number }`
  - `listRecords(f: RecordFilters): Promise<{ rows: DtsRecord[]; total: number }>` — selects with `school:schools(*), document_type:document_types(*)`, `count: 'exact'`, order `date desc, created_at desc`; `q` does `ilike` on name, title, dts_number (escape `%`/`_`); `office` filters via `document_types.office`.
  - `listAllRecords(f: Omit<RecordFilters,'page'|'pageSize'>): Promise<DtsRecord[]>` — for export, fetches in pages of 1000.
  - `saveRecord(input: Omit<DtsRecord,'id'|'created_by'|'created_by_username'|'created_at'|'school'|'document_type'> & { id?: string }): Promise<DtsRecord>` — maps Postgres `23505` to `Error('This DTS number is already recorded.')`, `23514` to `Error('Date to must be on or after Date from.')`.
  - `deleteRecord(id: string): Promise<void>`
  - `RECORD_EXPORT_HEADERS` = the 11 column names from Global Constraints (plus leading `School` for admins).

- [ ] **Step 1: Failing tests:**
  - `usernameToEmail(' 108874 ') === '108874@dts.local'`; `usernameToEmail('a b')` throws.
  - `buildTitle({docTypeName:'FORM 6 / LEAVE OF ABSENCE', honorific:'Mrs', name:'Zorayda M. Decena', leaveType:'Wellness Leave', dateFrom:'2026-12-02', dateTo:'2026-12-03', schoolName:'Anos ES', requiresDates:true}) === 'Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES'`; one day → `October 23, 2026`; cross-month → `Travel - November 30 - December 2, 2026 of Ms X - Anos ES`; cross-year `December 30, 2026 - January 2, 2027`; Locator Slip → `Locator Slip - November 21, 2026 of Mr Juan Dela Cruz - Calantas ES`; `PAYMENTS` + description `Salary Differential` → `Salary Differential of Mrs Teacher C - Calantas ES`; `MOOE RELATED` without description → `MOOE Related of X - Anos ES`.
  - `toCsv(['A','B'], [['x,"y"\nz','=SUM(1)'],['Peñafrancia', null]]) === '﻿"A","B"\r\n"x,""y""\nz","\'=SUM(1)"\r\n"Peñafrancia",""'` (Review Focus 4).
  - `saveRecord` with a mocked client returning `{error:{code:'23505'}}` rejects with the DTS message.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: data layer, title builder, csv export`.

---

### Task 6: Auth — login, forced password change, guards, app shell

**Files:**
- Create: `src/auth/AuthProvider.tsx`, `src/auth/guards.tsx`, `src/pages/LoginPage.tsx`, `src/pages/ChangePasswordPage.tsx`, `src/components/AppShell.tsx`, `src/routes.tsx`, tests `src/auth/guards.test.tsx`, `src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `supabase`, `usernameToEmail`, `Profile`.
- Produces:
  - `useAuth(): { session: Session | null; profile: Profile | null; loading: boolean; signIn(username: string, password: string): Promise<void>; signOut(): Promise<void>; refreshProfile(): Promise<void> }`
  - `<RequireAuth>`: no session → `/login`; `profile.must_change_password` → `/change-password` (for every route except that one); profile null after load (disabled/missing) → sign out with message "Your account is disabled. Contact the district office."
  - `<RequireRole roles={Role[]}>` → otherwise redirect `/records`.
  - Routes: `/login`, `/change-password`, `/records`, `/admin/users`, `/admin/schools`, `/admin/document-types` (admin, superadmin), `/system/logs`, `/system/backup` (superadmin).
  - AppShell sidebar per mockup: Records; group "Admin" (Users, Schools, Document types) for admin/superadmin; group "System" (Activity logs, Backup) for superadmin only; who-am-I block with full name, school or "District Admin", log-out button.
- Behaviour: `signIn` failure calls `log_failed_login(username)` and shows "Wrong username or password."; success calls `log_activity('login')`. Change-password: new password ≥ 8 chars, matches confirm, differs from current; `supabase.auth.updateUser({password})` then `complete_password_change()` then `refreshProfile()`.

- [ ] **Step 1: Failing tests** (mock `useAuth`):
  - With `must_change_password: true`, visiting `/records` renders "Change your password".
  - Role `user` visiting `/admin/users` lands on `/records`; role `admin` visiting `/system/logs` lands on `/records`.
  - Sidebar for `admin` shows "Users" and not "Activity logs"; for `superadmin` shows both.
  - LoginPage: rejected `signIn` shows "Wrong username or password."; page contains "Ask the district office to reset it".
- [ ] **Step 2:** FAIL. **Step 3:** implement (labels/copy from mockup). **Step 4:** PASS.
- [ ] **Step 5:** Manual check against local Supabase: create a user in Studio with `must_change_password = true`, sign in by username, get forced to change password, then land on Records.
- [ ] **Step 6:** Commit `feat: username login, forced password change, role guards`.

---

### Task 7: Records list, filters, export, routing slip

**Files:**
- Create: `src/pages/RecordsPage.tsx`, `src/pages/RecordsPage.test.tsx`

**Interfaces:**
- Consumes: `listRecords`, `listAllRecords`, `deleteRecord`, `toCsv`, `RECORD_EXPORT_HEADERS`, `useAuth`, `RecordForm` (Task 8, `open/onOpenChange/record?/onSaved`).
- Behaviour:
  - Filters (kept in URL search params so links/back button work): search box ("Search name, title, or DTS number", debounced 300 ms), School select (admin only), Document type, Office, Date from/to. Page size 25 with prev/next and "x–y of N".
  - Columns as mockup: Date, School (admin only), Document (title + name), DTS number (mono), Office (badge), Dates (`from – to`, "excl. …" line), row menu: View routing slip, Edit, Delete (alert-dialog confirm).
  - Clicking a row opens the routing slip sheet: all 11 fields read-only (including "Encoded by" username), DTS number on top, "Copy" button for the DTS number.
  - "Export CSV" exports the **current filtered view** (all pages), filename `dts-records-YYYY-MM-DD.csv`, then `log_activity('export.csv', {rows, filters})`.
  - Empty state: "No matching records. Try a different filter."

- [ ] **Step 1: Failing tests** (mock `@/lib/records`):
  - As `user`: no School column/filter; as `admin`: School column present.
  - Typing in search calls `listRecords` with `q` after debounce and `page: 1`.
  - Export calls `listAllRecords` with the active filters and triggers a download whose CSV first line is the header row.
  - Empty result shows the empty-state copy.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: records list with filters, export, routing slip`.

---

### Task 8: Add/Edit record form

**Files:**
- Create: `src/pages/RecordForm.tsx`, `src/pages/RecordForm.test.tsx`

**Interfaces:**
- Consumes: `saveRecord`, `buildTitle`, `useAuth`, document types and schools (select from Supabase).
- Produces: `<RecordForm open: boolean; onOpenChange(o: boolean): void; record?: DtsRecord; onSaved(r: DtsRecord): void />` (a shadcn Sheet).
- Behaviour:
  - Fields/labels as mockup: Date (default today), School (admin only; user's school is fixed and not shown as editable), Name (with a Mr/Mrs/Ms/Dr dropdown before it, default Mrs), Contact number, Document type, Routed to office (read-only, from the chosen type), Leave type (Form 6 only, dropdown of the full leave names, default Wellness Leave), Description (optional, non-Form-6 types), Date from / Date to / Excluded date (shown and required only when `requires_leave_dates`), Title of the document (automatic via `buildTitle`, read-only until "Edit manually"; editing an existing record keeps its saved title until "Use automatic title"), DTS number (placeholder `108874XXXXX-000025`).
  - Client validation: required fields; Date to ≥ Date from; trims DTS number. Server errors from `saveRecord` shown under the relevant field (DTS → DTS number field, dates → Date to).
  - Success: toast "Record saved", `onSaved`.

- [ ] **Step 1: Failing tests:**
  - Choosing `PAYMENTS` shows "PERSONNEL (PAYROLL)" and hides Date from/to; choosing Form 6 shows them and "HR 2 & 3".
  - Form 6 with Date to before Date from shows "Date to must be on or after Date from." and does not call `saveRecord` (Review Focus 3).
  - `saveRecord` rejecting with the duplicate message shows it under DTS number.
  - Choosing Mrs, name `Zorayda M. Decena`, Form 6, Wellness Leave, Date from 2026-12-02, Date to 2026-12-03, school Anos ES shows title `Form 6- Wellness Leave - December 2-3, 2026 of Mrs Zorayda M. Decena - Anos ES`; after "Edit manually" and typing, changing the name no longer changes the title.
  - The form has no email field (`queryByLabelText(/email/i)` is null).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: add/edit record form`.

---

### Task 9: Admin — users (Edge Function), schools, document types

**Files:**
- Create: `supabase/functions/_shared/{auth,cors}.ts`, `supabase/functions/admin-users/{index,logic,logic_test}.ts`, `src/pages/admin/{UsersPage,SchoolsPage,DocumentTypesPage}.tsx`, `src/lib/adminUsers.ts`, tests `src/pages/admin/*.test.tsx`

**Interfaces:**
- `getCaller(req: Request): Promise<{ userId: string; role: Role; username: string }>` — verifies the JWT with the anon client, loads profile with the service client; throws 401 if missing/disabled.
- Edge Function `admin-users`, POST body `{ action: 'create' | 'update' | 'reset_password' | 'set_disabled', ... }`, caller must be admin/superadmin:
  - `create {username, full_name, role: 'user'|'admin', school_id?}` → creates auth user `usernameToEmail(username)` with a generated temp password (12 chars, no ambiguous `0O1lI`), inserts profile with `must_change_password true`; returns `{ username, temp_password }`.
  - `update {user_id, full_name?, role?, school_id?}` — username never changes.
  - `reset_password {user_id}` → new temp password, `must_change_password true`; returns `{ username, temp_password }`.
  - `set_disabled {user_id, disabled}` → profile flag + auth `ban_duration` `'876000h'` / `'none'`.
  - Every action writes an `activity_logs` row.
- `validateRequest(caller, body, target?): { ok: true } | { ok: false; status: number; error: string }` in `logic.ts` (pure).
- Client: `callAdminUsers(body): Promise<any>` via `supabase.functions.invoke('admin-users', { body })`.
- UI: Users table (Name, Username, Role, School, Status) per mockup; Add/Edit user sheet; after create/reset show a dialog with the username and temporary password plus a Copy button and the note that they must change it on first sign-in. Schools and Document types: simple tables with add/edit/delete dialogs; delete errors with code `23503` show "This is still used by existing records, so it can't be deleted."

- [ ] **Step 1: Failing Deno tests** `logic_test.ts`: caller role `user` → 403; `role: 'superadmin'` in body → 400; target profile is superadmin → 404 (treat as not found); `role 'user'` without `school_id` → 400; `role 'admin'` with `school_id` → 400; username `'a b'` → 400; admin creating a valid user → ok.
- [ ] **Step 2:** `deno test supabase/functions/admin-users` → FAIL. **Step 3:** implement `logic.ts` and `index.ts`. **Step 4:** PASS.
- [ ] **Step 5: Failing UI tests:** Role select offers only "User" and "Admin"; School select disabled/hidden for Admin; after create, the credentials dialog shows the returned temp password; deleting a school that rejects with `23503` shows the "still used" message (Review Focus 5).
- [ ] **Step 6:** FAIL → implement → PASS.
- [ ] **Step 7:** Manual: `supabase functions serve`, create a user from the UI, sign in as them, forced password change works, disable them and confirm their open session loses access.
- [ ] **Step 8:** Commit `feat: admin user management, schools, document types`.

---

### Task 10: Superadmin — activity logs and backup/restore

**Files:**
- Create: `supabase/functions/backup/{index,logic,logic_test}.ts`, `src/pages/system/{ActivityLogsPage,BackupPage}.tsx`, tests alongside.

**Interfaces:**
- Edge Function `backup`, caller must be superadmin (else 403), private Storage bucket `backups` (created in a migration `20261125000004_backups_bucket.sql`, no client policies):
  - `create` → JSON `{ version: 1, created_at, schools, document_types, profiles (no auth data/passwords), records }` saved as `backup-YYYYMMDD-HHmmss.json`; returns `{ name, size }`.
  - `list` → `[{ name, created_at, size }]` newest first.
  - `download {name}` → signed URL (60 s).
  - `restore {name?, backup?, confirm}` → exactly one of `name` (a stored backup) or `backup` (the parsed JSON of a file the superadmin uploaded; max 20 MB, checked with `parseBackup`) — user decision 2026-11-25: upload allowed; requires `confirm === 'RESTORE'`; first runs `create` (auto-backup), then in order: upsert schools, document_types, profiles (only for user_ids that exist in auth; others reported as skipped), records (upsert by id). Does not delete rows absent from the backup (user decision 2026-11-25: records added after the backup are kept). Returns `{ restored: {table: count}, skipped: [...] , safety_backup: name }`.
- `parseBackup(json: unknown): Backup` in `logic.ts` — throws `'Not a DTS Tracker backup'` on wrong shape/version.
- UI: Activity logs table (When, User, Role, Action, Details) with search ("Search user or action") and action filter, 50 per page. Backup page per mockup: "Create backup", "Restore from file" (file picker / drop zone, `.json` only, parsed in the browser and rejected early if `parseBackup`-shaped checks fail), list (Backup, Created, Size), Download, Restore → dialog with input labelled "Type RESTORE to confirm"; Restore button disabled until it matches exactly.

- [ ] **Step 1: Failing Deno tests:** `parseBackup` rejects `{}` and `{version:2}`; restore with `confirm: 'restore'` → 400; restore with both or neither of `name`/`backup` → 400; non-superadmin caller → 403.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Failing UI tests:** Restore button disabled for `restore` and `RESTORE ` until exactly `RESTORE`; logs page as `admin` redirects (covered by guard) — here just assert it renders rows from a mocked query.
- [ ] **Step 4:** FAIL → implement → PASS.
- [ ] **Step 5:** Manual: create backup, delete a record and add a new one, restore → deleted record is back, the new one is still there, and a safety backup appears in the list. Repeat using a downloaded backup file via "Restore from file".
- [ ] **Step 6:** Commit `feat: superadmin activity logs and backup/restore`.

---

### Task 11: One-time workbook import

**Files:**
- Create: `scripts/import-workbook.ts`, `scripts/import-workbook.test.ts`, `scripts/parseSheet.ts`

**Interfaces:**
- `parseSheet(sheetName: string, rows: unknown[][]): { school: string; records: ParsedRecord[]; errors: { row: number; reason: string }[] }` — finds the header row by matching column names case-insensitively (`DATE`, `NAME`, `CONTACT`, `TITLE`, `DTS`, `DOCUMENT TYPE`, `FROM`, `TO`, `EXCLUDED`; the workbook's `DEPED EMAIL` column is ignored and not imported), converts Excel serial dates and `M/D/YYYY` text to ISO, skips blank rows, and reports rows missing DTS number or document type.
- CLI: `npx tsx scripts/import-workbook.ts <path.xlsx> [--dry-run]` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env. One tab = one school (created if missing); unknown document types are **reported, not created**; duplicates by normalised DTS number (in DB or earlier in the file) are skipped and listed; `created_by` = the first superadmin (`created_by_username` shows as that superadmin). Prints a summary per school.

- [ ] **Step 1: Failing Vitest tests** with an in-memory sheet: header on row 3 is found; serial `46000` → `2025-12-09`; blank rows skipped; row without DTS reported with its 1-based row number; DTS `' 108874-1 '` and `'108874-1'` in one sheet → second reported as duplicate.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Run with `--dry-run` against the real workbook once the user provides it; review the report with the user before the real run.
- [ ] **Step 4:** Commit `feat: one-time excel import script`.

---

### Task 12: Deploy and handover docs

**Files:**
- Create: `README.md`

- [ ] **Step 1:** README covers: local dev (`supabase start`, `.env.local`, `npm run dev`), running all tests (`npm test`, `supabase test db`, `deno test supabase/functions`), creating the first superadmin (create auth user `<name>@dts.local` in the Supabase dashboard, then `insert into profiles ... role 'superadmin', must_change_password true` in the SQL editor), deploying (`supabase link`, `supabase db push`, `supabase functions deploy admin-users backup`, Vercel project with the two `VITE_` env vars), the free-tier pause after 7 days of inactivity and how to resume, and running the import.
- [ ] **Step 2:** Deploy to a Supabase project + Vercel preview; on a phone-width browser (360 px) walk through: superadmin sign-in → create admin → admin creates school user → school user forced password change → add Form 6 record → admin sees it, filters, exports CSV and opens it in Excel → superadmin sees the log entries and makes a backup.
- [ ] **Step 3:** Commit `docs: setup, deploy, and admin handover`.

---

## Open items (from the spec, still needed from the user)

- Full list of schools and the district admin(s) — supplied by the workbook import or entered in the Schools screen.
- The workbook file itself, for Task 11 step 3.
