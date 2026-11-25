-- Task 3: Row Level Security and superadmin guard.
-- Records contain personal data, so per-school isolation is enforced here in the database.
-- With RLS on and no matching policy, anon and disabled users see nothing.

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can read profiles without recursion)
-- ---------------------------------------------------------------------------

-- Role of the current user; null when the profile is missing or disabled.
create function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p
  where p.user_id = auth.uid() and not p.disabled;
$$;

-- School of the current user; null when the profile is missing, disabled, or not a school user.
create function public.my_school()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.school_id from public.profiles p
  where p.user_id = auth.uid() and not p.disabled;
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'superadmin'), false);
$$;

-- The only client-side profile write: clear one's own first-login flag.
create function public.complete_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where user_id = auth.uid();
$$;

revoke execute on function public.my_role() from public, anon;
revoke execute on function public.my_school() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.complete_password_change() from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_school() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.complete_password_change() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.schools enable row level security;
alter table public.document_types enable row level security;
alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.activity_logs enable row level security;

-- ---------------------------------------------------------------------------
-- records: school users see/write only their school; admins see/write all.
-- ---------------------------------------------------------------------------
create policy records_school_select on public.records
  for select to authenticated
  using ((select public.my_role()) = 'user' and school_id = (select public.my_school()));
create policy records_school_insert on public.records
  for insert to authenticated
  with check ((select public.my_role()) = 'user' and school_id = (select public.my_school()));
create policy records_school_update on public.records
  for update to authenticated
  using ((select public.my_role()) = 'user' and school_id = (select public.my_school()))
  with check ((select public.my_role()) = 'user' and school_id = (select public.my_school()));
create policy records_school_delete on public.records
  for delete to authenticated
  using ((select public.my_role()) = 'user' and school_id = (select public.my_school()));

create policy records_admin_all on public.records
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- schools, document_types: any active user reads; admins write.
-- ---------------------------------------------------------------------------
create policy schools_select on public.schools
  for select to authenticated
  using ((select public.my_role()) is not null);
create policy schools_admin_insert on public.schools
  for insert to authenticated
  with check ((select public.is_admin()));
create policy schools_admin_update on public.schools
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy schools_admin_delete on public.schools
  for delete to authenticated
  using ((select public.is_admin()));

create policy document_types_select on public.document_types
  for select to authenticated
  using ((select public.my_role()) is not null);
create policy document_types_admin_insert on public.document_types
  for insert to authenticated
  with check ((select public.is_admin()));
create policy document_types_admin_update on public.document_types
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy document_types_admin_delete on public.document_types
  for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- profiles: own row, or admins see non-superadmin rows. No write policies:
-- writes go through Edge Functions (service role) or complete_password_change().
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or ((select public.is_admin()) and role <> 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- activity_logs: superadmin reads only. Rows are written by triggers (Task 4).
-- ---------------------------------------------------------------------------
create policy activity_logs_superadmin_select on public.activity_logs
  for select to authenticated
  using ((select public.my_role()) = 'superadmin');

-- ---------------------------------------------------------------------------
-- Superadmin guard: superadmin profiles can only be created, changed or removed
-- from the SQL editor / migrations (no API JWT role). The one exception is a
-- user clearing their own must_change_password flag (complete_password_change()).
-- ---------------------------------------------------------------------------
create function public.profiles_guard_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op <> 'DELETE' and new.role = 'superadmin')
     or (tg_op <> 'INSERT' and old.role = 'superadmin') then

    if coalesce(auth.role(), '') not in ('authenticated', 'service_role', 'anon') then
      return case when tg_op = 'DELETE' then old else new end;
    end if;

    if tg_op = 'UPDATE'
       and old.user_id = auth.uid()
       and (to_jsonb(new) - 'must_change_password') = (to_jsonb(old) - 'must_change_password') then
      return new;
    end if;

    raise exception 'superadmin accounts can only be managed in the Supabase dashboard'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger profiles_guard_superadmin
before insert or update or delete on public.profiles
for each row execute function public.profiles_guard_superadmin();
