# Macalelon District DTS Tracker

A web app for tracking documents (DTS numbers) sent by schools in the Macalelon district.
Schools add records; district admins see, filter and export them; superadmins also see
activity logs and make backups.

- **Front end:** React + Vite, hosted on Vercel.
- **Back end:** Supabase (Postgres database, sign-in, file storage for backups, and two
  Edge Functions: `admin-users` and `backup`).

People sign in with a **username**, not an email. Behind the scenes the app turns a username
into the sign-in email `<username>@dts.local`. No emails are ever sent.

There are three roles:

| Role | Can do |
| --- | --- |
| `user` (school account) | Add and see records for their own school. |
| `admin` (district office) | Everything above for all schools, plus manage users, schools and document types. |
| `superadmin` | Everything above, plus activity logs and backup/restore. Managed only in the Supabase dashboard. |

All commands below are for **Windows PowerShell**, run from the project folder.

---

## 1. What you need

- **Node.js 20.19 or newer** (22 LTS is fine) and npm.
- **Git.**
- **Docker Desktop**, installed and running. It is needed only to run Supabase on your own
  computer (local development and the database tests). It is not needed to deploy.
- A **Supabase** account (free tier is enough) and a **Vercel** account, for going live.

The Supabase CLI and Deno are installed with the project, so you do not install them
separately. Always call them through `npx`: `npx supabase ...`, `npx deno ...`.

```powershell
npm install
```

---

## 2. Run it on your own computer

1. Start Docker Desktop and wait until it says it is running.
2. Start the local Supabase stack. The first run downloads several Docker images and takes a while.
   It also applies everything in `supabase/migrations`, including the default document types.

   ```powershell
   npx supabase start
   ```

3. Show the local URLs and keys:

   ```powershell
   npx supabase status
   ```

4. Create a file named `.env.development.local` in the project folder (copy `.env.example`)
   and fill in the **API URL** and the **Publishable key** from the status output:

   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key from npx supabase status>
   ```

   This file is ignored by Git. Never commit it.

5. In a second PowerShell window, serve the Edge Functions (needed for user management and backups):

   ```powershell
   npx supabase functions serve
   ```

6. Start the app:

   ```powershell
   npm run dev
   ```

   Open http://localhost:5173.

7. Create a superadmin to sign in with. Follow [section 4](#4-create-the-first-superadmin),
   but use local Supabase Studio at http://127.0.0.1:54323 instead of the online dashboard.

Useful extras:

- `npx supabase db reset` wipes the local database and re-applies all migrations. You will
  need to create the superadmin again afterwards.
- `npx supabase stop` stops the local stack.

---

## 3. Run the tests

| What | Command | Needs |
| --- | --- | --- |
| Front end and import script (Vitest) | `npm test` | Nothing extra |
| Database schema, security rules, logs, storage (pgTAP, `supabase/tests`) | `npm run test:db` | Local Supabase running (`npx supabase start`) |
| Edge Functions (Deno, `supabase/functions`) | `npm run test:fn` | Nothing extra |

Also useful before deploying:

```powershell
npm run lint
npm run build
```

---

## 4. Create the first superadmin

Superadmin accounts cannot be created from the app. Create them in the Supabase dashboard.
Do this once for the live project (and again locally after a `db reset`).

1. In the Supabase dashboard open **Authentication → Users → Add user → Create new user**.
   - Email: `<username>@dts.local` (for example `jdelacruz@dts.local`). Use lowercase.
     Usernames may contain only letters, numbers, dots, dashes and underscores.
   - Password: a temporary password. The person must change it at first sign-in.
   - Tick **Auto Confirm User**.
2. Open the **SQL Editor** and run this, replacing the three placeholders:

   ```sql
   insert into public.profiles (user_id, username, full_name, role, must_change_password)
   select id, '<username>', '<Full Name>', 'superadmin', true
   from auth.users
   where email = '<username>@dts.local';
   ```

   It should say `1 row` inserted. If it says `0 rows`, the email in step 1 does not match.
   Leave `school_id` out: only school (`user`) accounts have a school.
3. Sign in to the app with `<username>` and the temporary password. The app asks for a new password.

Notes:

- Superadmins **do not appear in the app's Users list**, and admins cannot edit, reset or
  disable them. Manage them only in the dashboard:
  - **Reset a superadmin's password:** do not use "Send password recovery"; `@dts.local`
    addresses do not receive email. In the SQL Editor, set a temporary password and force a change
    at next sign-in:

    ```sql
    update auth.users
    set encrypted_password = extensions.crypt('<temp password>', extensions.gen_salt('bf'))
    where email = '<username>@dts.local';

    update public.profiles set must_change_password = true where username = '<username>';
    ```

  - **Someone leaves (disable a superadmin):** in the SQL Editor run
    `update public.profiles set disabled = true where username = '<username>';`
    and also **ban** the user under Authentication → Users → the user, for a full lock-out.
    Do this instead of deleting.
  - **Deleting a superadmin** under Authentication → Users only works for an account that never
    created any records. For everyone else the
    delete fails, so disable them as above.
- Keep at least two superadmins if you can, so one person leaving does not lock you out.

---

## 5. Deploy (go live)

You need: a Supabase project, a Vercel account, and this repository on GitHub.
Use placeholders like `<project-ref>` below; the real values come from your dashboards.

> **Keys - read this first.**
> The **publishable key** (also called anon key) is safe to put in the web app.
> The **secret / service_role key** gives full access to everything. Never put it in Vercel,
> never in any `VITE_` variable, never in a file in this repository. It is used only by the
> Edge Functions (Supabase provides it to them automatically) and, once, by the import script
> in your own PowerShell window.

### 5.1 Supabase project

1. Create a new project at https://supabase.com/dashboard. Choose a strong database password
   and keep it safe; the CLI asks for it. Pick the region closest to the Philippines (e.g. Singapore).
2. Find the **project ref**: it is the part of the project URL `https://<project-ref>.supabase.co`
   (also under Project Settings → General).
3. Link this folder to the project and push the database:

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   `db push` applies the files in `supabase/migrations`: tables and default document types,
   security rules, activity logging, the private `backups` storage bucket, and limits on the
   logging functions.

4. Deploy the two Edge Functions:

   ```powershell
   npx supabase functions deploy admin-users
   npx supabase functions deploy backup
   ```

   No extra secrets are needed. Supabase gives the functions `SUPABASE_URL`, the publishable/anon
   key and the service_role key automatically (`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`).
   The functions also accept `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` if those are set
   instead. If you ever **disable the legacy API keys**, check that both functions still work (see
   the go-live checklist); if a function log says `Missing environment variable`, set the missing
   one under Edge Functions → Secrets.

   `supabase/config.jsonc` turns off Supabase's gateway JWT check (`verify_jwt: false`) for both
   functions. This is deliberate. That older check does not work with the newer JWT signing keys
   and publishable/secret keys, and both functions check the signed-in user and their role
   themselves. They reject anyone who is not signed in as an admin (or, for `backup`, a superadmin).

5. In the dashboard, **Authentication** settings:
   - **Sign In / Providers:** turn **off** "Allow new users to sign up". All accounts are created
     by admins (or, for superadmins, in the dashboard). Keep the Email provider itself enabled,
     because sign-in uses it.
   - Keep **"Confirm email"** and **"Secure email change"** **on** (the defaults for a new cloud
     project). Accounts made by admins in the app are confirmed automatically, so this does not
     get in anyone's way. It matters because the sign-in email *is* the username
     (`<username>@dts.local`): with confirmations off, a signed-in user could change their own
     sign-in email from the browser and so change the username they appear as. With them on, the
     change needs a confirmation email that `@dts.local` addresses can never receive.
   - **URL Configuration:** set **Site URL** to your Vercel address (step 5.2), for example
     `https://<your-app>.vercel.app`.
6. Create the first superadmin ([section 4](#4-create-the-first-superadmin)).

### 5.2 Vercel

1. In Vercel: **Add New → Project → Import** the GitHub repository.
2. Framework preset: **Vite**. Build command `npm run build` and output folder `dist`
   (Vercel fills these in).
3. Under **Environment Variables** add exactly two (from Supabase → Project Settings → API Keys / Data API):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the **publishable** key (starts with `sb_publishable_`), or the legacy `anon` key |

4. Deploy. `vercel.json` already sends every path to `index.html`, so links like `/records`
   work after a page refresh.
5. Copy the Vercel URL into Supabase **Site URL** (step 5.1.5) if you have not yet.

If you change an environment variable later, redeploy in Vercel; `VITE_` values are built into the app.

### 5.3 Updating later

After pulling new code: run `npx supabase db push` if there are new migrations, redeploy
any changed function, and push to GitHub (Vercel rebuilds automatically).

---

## 6. Go-live checklist

Do this once after deploying, on a phone-sized browser window (about 360 px wide, or a real phone):

- [ ] Superadmin signs in with the temporary password and is made to set a new one.
- [ ] Superadmin opens **Users** and creates an **admin** account. The username and temporary
      password are shown once; copy them.
- [ ] Sign in as that admin (private/incognito window), set a new password.
- [ ] Admin checks **Schools** and **Document types**, then creates a **school user** for one school.
- [ ] Sign in as the school user; it must force a password change.
- [ ] School user adds a **Form 6** record (leave dates are required for this type).
- [ ] Admin sees the record, filters by school, exports **CSV** and opens it in Excel.
- [ ] Superadmin opens **Activity logs** and sees the entries for the steps above.
- [ ] Admin creates a **second school user** for a different school. Sign in as that user and
      confirm they **cannot** see the first school's record.
- [ ] Admin **disables** a test user who is signed in on another browser or phone. On that
      device, reload the page: the user must be signed out with an "account disabled"
      message and must not be able to sign in again.
- [ ] Confirm sign-ups are off: Authentication → Sign In / Providers shows "Allow new users to
      sign up" **off**.
- [ ] Superadmin opens **Backup & restore**, makes a backup and downloads it.
- [ ] Both Edge Functions work with this project's API keys: creating a user (admin-users) and
      making a backup (backup) both succeeded above. If either fails, open Edge Functions →
      the function → **Logs**. `Missing environment variable` usually means the legacy keys
      were disabled; see section 5.1 step 4.
- [ ] Run the workbook import if needed ([section 8](#8-import-the-old-excel-workbook)).

---

## 7. Supabase free tier: pausing

On the free plan, Supabase **pauses a project after about 7 days with no activity**. While
paused, the app cannot sign anyone in.

- To resume: open the Supabase dashboard, select the project and click **Restore project**.
  It takes a few minutes.
- A paused free project can only be restored from the dashboard **for a limited time** after it
  was paused (90 days at the time of writing). Check the current limit in Supabase's docs before
  relying on it, and do not leave the project paused.
- Normal daily use by schools keeps the project awake.

### Backups: what protects against what

**In-app backup** (**Backup & restore**) protects against **bad edits and deletes inside this
same project**: a wrong restore, a deleted record, a school renamed by mistake. Make one every
week and download it. It does **not** contain sign-in accounts (passwords live in Supabase Auth),
so it **cannot rebuild a lost project**: restored into a brand-new project, every profile would be
skipped (no matching sign-in account) and therefore every record too.

**Against losing the whole project** (deleted, locked out, paused too long), keep a **full
database dump**, made by a superadmin on a computer with this repository and the Supabase CLI,
after `npx supabase login` and `npx supabase link --project-ref <project-ref>` (section 5.1).
Do it **every week** (or at least monthly) and keep the files **off-site**, not only on the same
laptop:

```powershell
npx supabase db dump --remote -f schema.sql                      # tables, rules, functions
npx supabase db dump --remote --data-only --use-copy -f data.sql # all data, INCLUDING sign-in accounts (auth schema)
npx supabase db dump --remote --role-only -f roles.sql           # database roles
```

(Older CLI versions spell `--remote` as `--linked`. The CLI asks for the database password.)
`--data-only` already includes the `auth` schema (sign-in accounts and password hashes), so
treat `data.sql` like a password file: keep it private. If you want the accounts in their own
file, `npx supabase db dump --remote --data-only --schema auth -f auth_data.sql` dumps only them.

Also export a **CSV of all records** weekly (Records page → Export CSV with no filters). It is a
human-readable copy you can open in Excel even if nothing else works.

**Restoring a full dump into a new project (outline):**

1. Create a new Supabase project. Get its database connection string (Project Settings →
   Database → Connection string, "Session pooler" or direct).
2. Load the three files in one go with `psql` (installed with PostgreSQL), for example:
   `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c "SET session_replication_role = replica" -f data.sql -d "<connection string>"`.
   (`session_replication_role = replica` stops the activity-log triggers from firing while data loads.)
3. The files of old in-app backups are **not** in the dump (only their database entries), so
   download any you want to keep while the old project still works.
4. Deploy the Edge Functions and point Vercel at the new project (section 5), then run the
   go-live checklist. Follow Supabase's "Backup and restore using the CLI" guide for details.

---

## 8. Import the old Excel workbook

This is a one-time job that copies the district's old workbook (one tab per school) into the
database. Script: `scripts/import-workbook.ts`.

Before you start:

- The project is deployed (section 5) and an **admin account** exists to own the imported
  records. Every imported record shows this account as **"Encoded by"**, so use the district
  admin's account or create a dedicated admin named e.g. `import` (Users → add user, role
  `admin`). The script refuses superadmin accounts (they are hidden from other users and must
  not appear on records), school users, and disabled accounts.
- Get the **secret / service_role key** from Supabase → Project Settings → API Keys.
  Put it **only** in your PowerShell window as shown below. Do not save it in any file and do not commit it.
  Close the window when done.

**Step 1 - dry run (writes nothing):**

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role key>"
npx tsx scripts/import-workbook.ts "C:\path\to\workbook.xlsx" --created-by import --dry-run
```

Replace `import` with the admin username you chose. `--created-by` is required; the dry run
already checks that the account exists, is an admin and is not disabled, and stops with a
message otherwise.

**Step 2 - read the report.** It lists, per tab, how many rows would be imported and every problem row. Look for:

- **Duplicates:** the same DTS number twice in the workbook, or already in the database. Only the first copy is imported.
- **Unknown document types:** the type in the sheet does not match any type in **Document types**.
  Either fix the sheet or add the type in the app, then dry-run again.
- **Form 6 (and other leave types) without FROM/TO dates:** these rows are rejected. Fill in the dates in the sheet.
- **TO date before FROM date:** these rows are rejected. Fix the dates in the sheet.
- **Missing name, title, date or DTS number:** these rows are rejected.
- **Tabs skipped:** a tab with no header row containing both "DTS" and "DOCUMENT TYPE".
- **Dates:** spot-check a few. Dates typed as text are read as month/day/year; if the workbook used
  day/month, fix those cells first.
- **Contact numbers:** spot-check that mobile numbers kept their leading `0` (e.g. `09171234567`).

Fix the workbook and repeat the dry run until the report looks right.

**Step 3 - real import:** run the same command without `--dry-run`:

```powershell
npx tsx scripts/import-workbook.ts "C:\path\to\workbook.xlsx" --created-by import
```

It creates any missing schools (named after the tabs) and inserts the records. Running it again
is safe: rows already in the database are skipped as duplicates. Afterwards, make a backup.

---

## 9. For admins

Admins use the **Users**, **Schools** and **Document types** pages.

- **Create a school account:** Users → add user. Enter a username, full name, role `user` and
  the school. The app shows the username and a **temporary password once**; use the copy button
  and give them to the person. They must change the password at first sign-in. You can also create
  other `admin` accounts (no school).
- **Forgot password:** Users → the user's menu (⋯) → **Reset password**. The old password stops
  working and a new temporary password is shown once. Resetting does **not** sign the person out
  of devices where they are already signed in. If you suspect someone else is using the account,
  **Disable** it (that is the lock-out tool; it stops open sessions too), then enable it again
  and reset the password when it is safe.
- **Someone leaves:** **Disable** the account instead of deleting it. Their records stay. You can
  enable it again later. You cannot disable your own account.
- **Usernames cannot be changed.** If one is wrong, disable the account and create a new one.
- **Schools:** add or rename schools. A school that still has users or records cannot be deleted.
- **Document types:** add or edit types and mark which ones need leave dates (FROM/TO). A type
  used by records cannot be deleted.

## 10. For superadmins

Superadmins see everything admins see, plus:

- **Activity logs:** who created, changed or deleted records, users, schools and document types,
  and every backup and restore.
- **Backup & restore:**
  - **Create backup now** saves the schools, document types, user profiles and records to Supabase
    storage. Download it and keep a copy elsewhere (weekly). It undoes mistakes inside this
    project; it cannot rebuild a lost project. For that, keep the full database dump described in
    [section 7](#backups-what-protects-against-what).
  - **Restore** from a stored backup or an uploaded file. You must type `RESTORE` to confirm.
  - Before restoring, the app **automatically makes a safety backup**, so a mistaken restore can be undone
    by restoring that safety backup.
  - Restore puts rows that are in the backup back to how they were. **Records added after the
    backup are kept**, not deleted.
  - Superadmin accounts are never included in or changed by a backup/restore. Accounts whose
    sign-in was deleted are skipped.
- **Superadmin accounts** themselves are managed only in the Supabase dashboard (section 4).

---

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The React app. |
| `supabase/migrations/` | Database tables, security rules, activity logging, backups bucket. |
| `supabase/functions/admin-users/` | Edge Function: create users, reset passwords, disable accounts. |
| `supabase/functions/backup/` | Edge Function: make, list, download and restore backups. |
| `supabase/tests/` | Database tests (pgTAP). |
| `scripts/import-workbook.ts` | One-time Excel import. |
| `.env.example` | The two environment variables the app needs. |
| `vercel.json` | Sends all paths to the app so page refreshes work. |
