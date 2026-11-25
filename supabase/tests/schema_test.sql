begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- Tables
select has_table('public', 'schools', 'schools table exists');
select has_table('public', 'document_types', 'document_types table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'records', 'records table exists');
select has_table('public', 'activity_logs', 'activity_logs table exists');

-- Seed
select is((select count(*)::int from document_types), 71, '71 document types seeded');
select is((select count(distinct office)::int from document_types), 11, '11 distinct offices');
select results_eq(
  'select name from document_types where requires_leave_dates order by name',
  $$values ('AUTHORITY TO TRAVEL / LOCATOR SLIP'),('FORM 6 / LEAVE OF ABSENCE'),('TRAVEL'),('TRAVEL ABROAD')$$,
  'exactly four document types require leave dates'
);
select is((select office from document_types where name = 'PAYMENTS'), 'PERSONNEL (PAYROLL)', 'PAYMENTS routes to PERSONNEL (PAYROLL)');
select is((select office from document_types where name = 'AUTHORITY TO TRAVEL / LOCATOR SLIP'), 'ASDS', 'AUTHORITY TO TRAVEL / LOCATOR SLIP routes to ASDS');
select is((select office from document_types where name = 'NEW ACCOUNT / CHANGE SIGNATORIES'), 'CASHIER', 'NEW ACCOUNT / CHANGE SIGNATORIES routes to CASHIER');

-- Fixtures
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000a1', 'encoder@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'nobody@test.local', 'authenticated', 'authenticated');

insert into schools (id, name)
values ('00000000-0000-0000-0000-0000000000b1', 'Test Elementary School');

insert into profiles (user_id, username, full_name, role, school_id)
values ('00000000-0000-0000-0000-0000000000a1', 'encoder1', 'Encoder One', 'user', '00000000-0000-0000-0000-0000000000b1');

-- DTS number uniqueness (trimmed, case-insensitive)
select lives_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'T1', '108874-000025',
            (select id from document_types where name = 'PAYMENTS'))$$,
  'first record with DTS 108874-000025 inserts'
);
select throws_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'T2', ' 108874-000025 ',
            (select id from document_types where name = 'PAYMENTS'))$$,
  '23505', null,
  'padded duplicate DTS number is rejected'
);
select lives_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'T3', '108874gcnbr-000024',
            (select id from document_types where name = 'PAYMENTS'))$$,
  'record with DTS 108874gcnbr-000024 inserts'
);
select throws_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'T4', '108874GCNBR-000024 ',
            (select id from document_types where name = 'PAYMENTS'))$$,
  '23505', null,
  'upper-case padded duplicate DTS number is rejected'
);

-- Date range check
select throws_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id, date_from, date_to)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'Leave', 'DTS-RANGE-1',
            (select id from document_types where name = 'FORM 6 / LEAVE OF ABSENCE'), '2026-12-11', '2026-12-09')$$,
  '23514', null,
  'date_to before date_from is rejected'
);

-- Leave dates required
select throws_ok(
  $$insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id, date_from, date_to)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'x', 'Juan', 'Leave', 'DTS-LEAVE-1',
            (select id from document_types where name = 'FORM 6 / LEAVE OF ABSENCE'), null, '2026-12-09')$$,
  '23514', 'Date from and Date to are required for this document type',
  'Form 6 without date_from is rejected with clear message'
);

-- Referential integrity
select throws_ok(
  $$delete from document_types where name = 'PAYMENTS'$$,
  '23503', null,
  'referenced document type cannot be deleted'
);
select throws_ok(
  $$delete from schools where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '23503', null,
  'referenced school cannot be deleted'
);

-- Profile role/school consistency
select throws_ok(
  $$insert into profiles (user_id, username, full_name, role, school_id)
    values ('00000000-0000-0000-0000-0000000000a2', 'nobody', 'No Body', 'user', null)$$,
  '23514', null,
  'user role without school is rejected'
);

-- Creator username is derived, not client supplied
insert into records (school_id, created_by, created_by_username, name, title, dts_number, document_type_id)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'fake', 'Juan', 'Creator', 'DTS-CREATOR-1',
        (select id from document_types where name = 'PAYMENTS'));
select is(
  (select created_by_username from records where dts_number = 'DTS-CREATOR-1'),
  'encoder1',
  'created_by_username comes from the creator profile'
);

update records set created_by = '00000000-0000-0000-0000-0000000000a2', created_by_username = 'fake2'
where dts_number = 'DTS-CREATOR-1';
select is(
  (select created_by::text || '/' || created_by_username from records where dts_number = 'DTS-CREATOR-1'),
  '00000000-0000-0000-0000-0000000000a1/encoder1',
  'update cannot change created_by or created_by_username'
);

select hasnt_column('public', 'records', 'email', 'records has no email column');

select * from finish();
rollback;
