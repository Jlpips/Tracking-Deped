-- Limits on the two logging RPCs so callers cannot flood activity_logs.
--   * log_failed_login (callable by anon): global throttle of 30 'login.failed' rows per
--     minute, and at most one row per username every 10 seconds. Skipped calls succeed
--     silently so sign-in is never blocked or slowed by logging.
--   * log_activity: details payload capped at 2048 bytes.
-- Also removes table privileges the API roles never need.

create index if not exists activity_logs_action_at_idx
  on public.activity_logs (action, at desc);

create or replace function public.log_activity(p_action text, p_details jsonb default '{}')
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

  if pg_column_size(p_details) > 2048 then
    raise exception 'details too large'
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

create or replace function public.log_failed_login(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Stored usernames are cut to 64 chars (well under the 100-char ceiling).
  v_username text := left(p_username, 64);
begin
  -- Global throttle: at most 30 failed-login rows per minute.
  if (select count(*) from public.activity_logs
      where action = 'login.failed' and at > now() - interval '1 minute') >= 30 then
    return;
  end if;

  -- Per-username dedupe: one row per username every 10 seconds.
  if exists (select 1 from public.activity_logs
             where action = 'login.failed'
               and at > now() - interval '10 seconds'
               and details->>'username' is not distinct from v_username) then
    return;
  end if;

  insert into public.activity_logs (user_id, username, role, action, details)
  values (null, null, null, 'login.failed', jsonb_build_object('username', v_username));
end;
$$;

revoke execute on function public.log_failed_login(text) from public, anon, authenticated;
grant execute on function public.log_failed_login(text) to anon, authenticated;

-- API roles never need these table privileges.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
