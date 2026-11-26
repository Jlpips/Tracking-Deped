-- Activity logging. Rows are written by the database (triggers + security definer RPCs)
-- so the browser cannot skip them. activity_logs has no insert/update/delete policies;
-- only superadmins can read it (see 20261125000002_rls.sql).
-- Edge Functions write their own rows (backup.*, user.*) with the service key.

-- ---------------------------------------------------------------------------
-- Data-change trigger: '<table>.<insert|update|delete>' with a minimal identifier
-- payload. Never logs full rows or anything password-related.
-- ---------------------------------------------------------------------------
create function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_details jsonb;
  v_uid uuid := auth.uid();
  v_username text;
  v_role text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- Separate branches: a record's fields are resolved when each expression runs.
  if tg_table_name = 'records' then
    v_details := jsonb_build_object('id', v_row.id, 'dts_number', v_row.dts_number);
  elsif tg_table_name = 'profiles' then
    v_details := jsonb_build_object('user_id', v_row.user_id, 'username', v_row.username);
  elsif tg_table_name in ('schools', 'document_types') then
    v_details := jsonb_build_object('id', v_row.id, 'name', v_row.name);
  else
    v_details := '{}'::jsonb;
  end if;

  if v_uid is not null then
    select p.username, p.role into v_username, v_role
    from public.profiles p
    where p.user_id = v_uid;
  end if;

  insert into public.activity_logs (user_id, username, role, action, details)
  values (v_uid, v_username, v_role, tg_table_name || '.' || lower(tg_op), v_details);

  return null;
end;
$$;

revoke execute on function public.log_change() from public, anon, authenticated;

create trigger records_log_change
after insert or update or delete on public.records
for each row execute function public.log_change();

create trigger profiles_log_change
after insert or update or delete on public.profiles
for each row execute function public.log_change();

create trigger schools_log_change
after insert or update or delete on public.schools
for each row execute function public.log_change();

create trigger document_types_log_change
after insert or update or delete on public.document_types
for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- Client-reported events for a signed-in user.
-- ---------------------------------------------------------------------------
create function public.log_activity(p_action text, p_details jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'log_activity requires a signed-in user'
      using errcode = '28000';
  end if;

  if p_action is null or p_action not in ('login', 'logout', 'export.csv') then
    raise exception 'Unsupported activity action: %', p_action
      using errcode = '22023';
  end if;

  select p.username, p.role into v_username, v_role
  from public.profiles p
  where p.user_id = v_uid;

  insert into public.activity_logs (user_id, username, role, action, details)
  values (v_uid, v_username, v_role, p_action, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke execute on function public.log_activity(text, jsonb) from public, anon, authenticated;
grant execute on function public.log_activity(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Failed sign-in attempts (called before a session exists, so anon may call it).
-- ---------------------------------------------------------------------------
create function public.log_failed_login(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_logs (user_id, username, role, action, details)
  values (null, null, null, 'login.failed', jsonb_build_object('username', left(p_username, 64)));
end;
$$;

revoke execute on function public.log_failed_login(text) from public, anon, authenticated;
grant execute on function public.log_failed_login(text) to anon, authenticated;
