begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixture user for log_activity
insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-0000000bb0a1', 'lim-ua@test.local', 'authenticated', 'authenticated');
insert into schools (id, name)
values ('00000000-0000-0000-0000-0000000bd00a', 'Limits School A');
insert into profiles (user_id, username, full_name, role, school_id)
values ('00000000-0000-0000-0000-0000000bb0a1', 'lim_ua', 'Lim User', 'user', '00000000-0000-0000-0000-0000000bd00a');

-- Start from a clean slate for login.failed rows (rolled back at the end).
delete from activity_logs where action = 'login.failed';

-- ===== Dedupe: same username within 10 seconds is stored once =====
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select lives_ok($$select log_failed_login('dup_user')$$, 'first failed login for dup_user');
select lives_ok($$select log_failed_login('dup_user')$$, 'repeat failed login for dup_user does not error');
reset role;
select is(
  (select count(*)::int from activity_logs where action = 'login.failed' and details->>'username' = 'dup_user'),
  1, 'same username within 10 s is logged once'
);

-- A different username is still logged
set local role anon;
select lives_ok($$select log_failed_login('other_user')$$, 'other username logs');
reset role;
select is(
  (select count(*)::int from activity_logs where action = 'login.failed' and details->>'username' = 'other_user'),
  1, 'different username is logged'
);

-- An older failure for the same username (beyond 10 s) does not block a new row
update activity_logs set at = now() - interval '11 seconds'
where action = 'login.failed' and details->>'username' = 'dup_user';
set local role anon;
select log_failed_login('dup_user');
reset role;
select is(
  (select count(*)::int from activity_logs where action = 'login.failed' and details->>'username' = 'dup_user'),
  2, 'same username after 10 s is logged again'
);

-- ===== Global throttle: >= 30 failures in the last minute -> silently skipped =====
insert into activity_logs (action, details)
select 'login.failed', jsonb_build_object('username', 'flood_' || g)
from generate_series(1, 30) g;
set local role anon;
select lives_ok($$select log_failed_login('throttled_user')$$, 'throttled call does not error');
reset role;
select is(
  (select count(*)::int from activity_logs where action = 'login.failed' and details->>'username' = 'throttled_user'),
  0, 'failed login is not stored once 30 rows exist in the last minute'
);

-- ===== log_activity details size cap =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000bb0a1","role":"authenticated"}';
select throws_ok(
  $$select log_activity('export.csv', jsonb_build_object('x', repeat(md5(random()::text), 200)))$$,
  '22023', 'details too large',
  'log_activity rejects details over 2048 bytes'
);
select lives_ok(
  $$select log_activity('export.csv', '{"rows":5,"filters":{"q":"abc"}}')$$,
  'log_activity accepts small details'
);

-- ===== No direct writes to activity_logs =====
select throws_ok(
  $$insert into activity_logs (action, details) values ('login', '{}')$$,
  '42501', null,
  'authenticated cannot insert into activity_logs directly'
);
reset role;

-- ===== Table privileges: no truncate/references/trigger for API roles =====
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  'anon/authenticated have no truncate, references or trigger on public tables'
);

select * from finish();
rollback;
