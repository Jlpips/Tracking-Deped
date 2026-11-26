begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Fixtures (as postgres, no JWT: the log triggers must not fail without auth.uid())
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000aa0a1', 'act-ua@test.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000aa05a', 'act-sup@test.local', 'authenticated', 'authenticated');

insert into schools (id, name)
values ('00000000-0000-0000-0000-0000000ad00a', 'Activity School A');

insert into profiles (user_id, username, full_name, role, school_id)
values
  ('00000000-0000-0000-0000-0000000aa0a1', 'act_ua',  'Act User', 'user',       '00000000-0000-0000-0000-0000000ad00a'),
  ('00000000-0000-0000-0000-0000000aa05a', 'act_sup', 'Act Super', 'superadmin', null);

-- ===== Fixture inserts were logged with no user =====
select is(
  (select count(*)::int from activity_logs
   where action = 'schools.insert' and user_id is null
     and details = jsonb_build_object('id', '00000000-0000-0000-0000-0000000ad00a', 'name', 'Activity School A')),
  1, 'schools.insert logged with {id, name} and null user when no JWT'
);
select is(
  (select count(*)::int from activity_logs
   where action = 'profiles.insert' and user_id is null
     and details = jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000aa0a1', 'username', 'act_ua')),
  1, 'profiles.insert logged with {user_id, username} only'
);

-- ===== Privileges =====
select ok(
  has_function_privilege('authenticated', 'public.log_activity(text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.log_activity(text, jsonb)', 'execute'),
  'log_activity executable by authenticated only'
);
select ok(
  has_function_privilege('anon', 'public.log_failed_login(text)', 'execute')
  and has_function_privilege('authenticated', 'public.log_failed_login(text)', 'execute'),
  'log_failed_login executable by anon and authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.log_change()', 'execute')
  and not has_function_privilege('authenticated', 'public.log_change()', 'execute'),
  'log_change() not directly executable by API roles'
);
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('public.log_change()'::regprocedure, 'public.log_activity(text, jsonb)'::regprocedure,
                 'public.log_failed_login(text)'::regprocedure)),
  'log functions are security definer'
);

-- ===== ua (user, school A) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000aa0a1","role":"authenticated"}';

select lives_ok(
  $$insert into records (id, school_id, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-0000000ae00a', '00000000-0000-0000-0000-0000000ad00a', 'Juan', 'Act Rec',
            'ACT-1', (select id from document_types where name = 'PAYMENTS'))$$,
  'ua inserts a record'
);
select lives_ok(
  $$update records set title = 'Act Rec 2' where id = '00000000-0000-0000-0000-0000000ae00a'$$,
  'ua updates the record'
);
select lives_ok(
  $$select log_activity('export.csv', '{"rows":3}')$$,
  'ua can log export.csv'
);
select lives_ok($$select log_activity('login')$$, 'ua can log login with default details');
select throws_ok(
  $$select log_activity('anything')$$,
  '22023', null,
  'log_activity rejects unknown actions'
);
select is((select count(*)::int from activity_logs), 0, 'ua still cannot select activity logs');

-- No JWT subject: log_activity refuses
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select log_activity('logout')$$, '28000', null, 'log_activity requires a signed-in user');

-- ===== anon =====
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select lives_ok($$select log_failed_login('108874')$$, 'anon can log a failed login');
select lives_ok($$select log_failed_login(repeat('x', 100))$$, 'anon can log a failed login with a long username');
select throws_ok($$select log_activity('login')$$, '42501', null, 'anon cannot call log_activity');

-- ===== Verify as postgres =====
reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from activity_logs
   where action = 'records.insert'
     and user_id = '00000000-0000-0000-0000-0000000aa0a1'
     and username = 'act_ua' and role = 'user'
     and details = jsonb_build_object('id', '00000000-0000-0000-0000-0000000ae00a', 'dts_number', 'ACT-1')),
  1, 'records.insert logged once with user_id = ua, username/role and {id, dts_number}'
);
select is(
  (select count(*)::int from activity_logs
   where action = 'records.update' and user_id = '00000000-0000-0000-0000-0000000aa0a1'
     and details = jsonb_build_object('id', '00000000-0000-0000-0000-0000000ae00a', 'dts_number', 'ACT-1')),
  1, 'records.update logged'
);
select is(
  (select count(*)::int from activity_logs
   where action = 'export.csv' and user_id = '00000000-0000-0000-0000-0000000aa0a1'
     and username = 'act_ua' and details = '{"rows":3}'::jsonb),
  1, 'export.csv logged with details'
);
select is(
  (select count(*)::int from activity_logs
   where action = 'login.failed' and user_id is null and details = '{"username":"108874"}'::jsonb),
  1, 'login.failed logged with {username} and no user'
);
select is(
  (select count(*)::int from activity_logs
   where action = 'login.failed' and details->>'username' = repeat('x', 64)),
  1, 'login.failed username truncated to 64 chars'
);

delete from records where id = '00000000-0000-0000-0000-0000000ae00a';
select is(
  (select count(*)::int from activity_logs
   where action = 'records.delete' and user_id is null
     and details = jsonb_build_object('id', '00000000-0000-0000-0000-0000000ae00a', 'dts_number', 'ACT-1')),
  1, 'records.delete logged from OLD'
);

select * from finish();
rollback;
