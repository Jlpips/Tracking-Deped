begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- Fixtures (as postgres; auth.role() is null so the superadmin guard allows them)
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-00000000c0a1', 'ua@test.local',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c0b1', 'ub@test.local',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c0ad', 'adm@test.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c05a', 'sup@test.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c05b', 'sup2@test.local', 'authenticated', 'authenticated');

insert into schools (id, name)
values
  ('00000000-0000-0000-0000-00000000d00a', 'RLS School A'),
  ('00000000-0000-0000-0000-00000000d00b', 'RLS School B');

insert into profiles (user_id, username, full_name, role, school_id)
values
  ('00000000-0000-0000-0000-00000000c0a1', 'ua',   'User A',       'user',       '00000000-0000-0000-0000-00000000d00a'),
  ('00000000-0000-0000-0000-00000000c0b1', 'ub',   'User B',       'user',       '00000000-0000-0000-0000-00000000d00b'),
  ('00000000-0000-0000-0000-00000000c0ad', 'adm',  'Admin',        'admin',      null),
  ('00000000-0000-0000-0000-00000000c05a', 'sup',  'Super',        'superadmin', null),
  ('00000000-0000-0000-0000-00000000c05b', 'sup2', 'Super Two',    'superadmin', null);

insert into records (id, school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
values
  ('00000000-0000-0000-0000-00000000e00a', '00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000c0a1', 'x',
   'Juan A', 'Rec A', 'RLS-A-1', (select id from document_types where name = 'PAYMENTS')),
  ('00000000-0000-0000-0000-00000000e00b', '00000000-0000-0000-0000-00000000d00b', '00000000-0000-0000-0000-00000000c0b1', 'x',
   'Juan B', 'Rec B', 'RLS-B-1', (select id from document_types where name = 'PAYMENTS'));

insert into activity_logs (user_id, username, role, action)
values ('00000000-0000-0000-0000-00000000c0a1', 'ua', 'user', 'test');

-- RLS is on everywhere
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.schools'::regclass, 'public.document_types'::regclass, 'public.profiles'::regclass,
                         'public.records'::regclass, 'public.activity_logs'::regclass)),
          'RLS enabled on all five tables');

select ok(
  not has_function_privilege('anon', 'public.my_role()', 'execute')
  and not has_function_privilege('anon', 'public.my_school()', 'execute')
  and not has_function_privilege('anon', 'public.is_admin()', 'execute')
  and not has_function_privilege('anon', 'public.complete_password_change()', 'execute')
  and has_function_privilege('authenticated', 'public.complete_password_change()', 'execute'),
  'helpers executable by authenticated, not anon'
);

-- ===== ua (user, school A) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0a1","role":"authenticated"}';

select is(my_role(), 'user', 'my_role() for ua is user');
select is((select count(*)::int from records), 1, 'ua selects 1 record');
select is((select school_id from records), '00000000-0000-0000-0000-00000000d00a'::uuid, 'ua record is from school A');
select throws_ok(
  $$insert into records (school_id, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-00000000d00b', 'X', 'X', 'RLS-UA-B', (select id from document_types where name = 'PAYMENTS'))$$,
  '42501', null,
  'ua cannot insert a record for school B'
);
select lives_ok(
  $$insert into records (school_id, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-00000000d00a', 'X', 'X', 'RLS-UA-A', (select id from document_types where name = 'PAYMENTS'))$$,
  'ua can insert a record for school A'
);
with u as (update records set title = 'hacked' where id = '00000000-0000-0000-0000-00000000e00b' returning 1)
select is(count(*)::int, 0, 'ua updating school B record affects 0 rows') from u;
with d as (delete from records where id = '00000000-0000-0000-0000-00000000e00b' returning 1)
select is(count(*)::int, 0, 'ua deleting school B record affects 0 rows') from d;
select throws_ok(
  $$update records set school_id = '00000000-0000-0000-0000-00000000d00b' where id = '00000000-0000-0000-0000-00000000e00a'$$,
  '42501', null,
  'ua cannot move a school A record to school B'
);
select results_eq(
  'select username from profiles order by username',
  $$values ('ua')$$,
  'ua sees only own profile'
);
select is((select count(*)::int from activity_logs), 0, 'ua selects 0 activity_logs');
select ok((select count(*) from schools) >= 2 and (select count(*) from document_types) = 71,
          'ua can read schools and document types');
select throws_ok(
  $$insert into schools (name) values ('Rogue School')$$,
  '42501', null,
  'ua cannot insert schools'
);
with u as (update profiles set role = 'admin', school_id = null where user_id = '00000000-0000-0000-0000-00000000c0a1' returning 1)
select is(count(*)::int, 0, 'ua cannot update own profile directly') from u;
select lives_ok('select complete_password_change()', 'ua calls complete_password_change()');

-- ===== adm (admin) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0ad","role":"authenticated"}';

select is((select count(*)::int from records where dts_number in ('RLS-A-1', 'RLS-B-1')), 2, 'adm selects both school records');
select results_eq(
  'select username from profiles order by username',
  $$values ('adm'), ('ua'), ('ub')$$,
  'adm sees ua, ub, adm but no superadmin profiles'
);
select is((select count(*)::int from activity_logs), 0, 'adm selects 0 activity_logs');
select lives_ok($$insert into schools (name) values ('Admin Added School')$$, 'adm can insert schools');

-- ===== sup (superadmin) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c05a","role":"authenticated"}';

select results_eq(
  'select username from profiles order by username',
  $$values ('adm'), ('sup'), ('ua'), ('ub')$$,
  'sup sees ua, ub, adm and own row, but not other superadmins'
);
select is((select count(*)::int from activity_logs), 1, 'sup can select activity_logs');
with u as (update profiles set full_name = 'Renamed' where user_id = '00000000-0000-0000-0000-00000000c05a' returning 1)
select is(count(*)::int, 0, 'sup cannot update own profile directly (no update policy)') from u;
select lives_ok('select complete_password_change()', 'sup can complete own password change');

-- ===== anon =====
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from records), 0, 'anon selects 0 records');

-- ===== back to postgres: verify flags, disable ua =====
reset role;
reset request.jwt.claims;

select is(
  (select must_change_password from profiles where user_id = '00000000-0000-0000-0000-00000000c0a1'),
  false, 'complete_password_change() cleared ua flag'
);
select is(
  (select must_change_password from profiles where user_id = '00000000-0000-0000-0000-00000000c05a'),
  false, 'complete_password_change() cleared sup flag'
);

update profiles set disabled = true where user_id = '00000000-0000-0000-0000-00000000c0a1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0a1","role":"authenticated"}';

select is((select count(*)::int from records), 0, 'disabled ua selects 0 records');
select throws_ok(
  $$insert into records (school_id, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-00000000d00a', 'X', 'X', 'RLS-UA-DIS', (select id from document_types where name = 'PAYMENTS'))$$,
  '42501', null,
  'disabled ua cannot insert records'
);

-- ===== service_role and the superadmin guard =====
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$update profiles set role = 'superadmin', school_id = null where user_id = '00000000-0000-0000-0000-00000000c0a1'$$,
  '42501', 'superadmin accounts can only be managed in the Supabase dashboard',
  'service_role cannot promote a user to superadmin'
);
select throws_ok(
  $$delete from profiles where user_id = '00000000-0000-0000-0000-00000000c05b'$$,
  '42501', 'superadmin accounts can only be managed in the Supabase dashboard',
  'service_role cannot delete a superadmin profile'
);

-- Own-row exception covers only must_change_password
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c05b","role":"service_role"}';
select throws_ok(
  $$update profiles set full_name = 'Renamed', must_change_password = false where user_id = '00000000-0000-0000-0000-00000000c05b'$$,
  '42501', 'superadmin accounts can only be managed in the Supabase dashboard',
  'own-row exception does not allow changing other superadmin fields'
);

-- SQL editor / migrations path (no JWT) may manage superadmins
reset role;
reset request.jwt.claims;
select lives_ok(
  $$update profiles set full_name = 'Super Renamed' where user_id = '00000000-0000-0000-0000-00000000c05b'$$,
  'postgres without JWT can manage superadmin profiles'
);

select * from finish();
rollback;
