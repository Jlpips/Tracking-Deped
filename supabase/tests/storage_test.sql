begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select is(
  (select count(*)::int from storage.buckets where id = 'backups'),
  1,
  'backups bucket exists'
);
select is(
  (select public from storage.buckets where id = 'backups'),
  false,
  'backups bucket is private'
);
-- Only the backup Edge Function (service role) may touch it: no client policies mention the bucket.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage'
     and (coalesce(qual, '') ilike '%backups%' or coalesce(with_check, '') ilike '%backups%')),
  0,
  'no storage policies grant access to backups'
);

select * from finish();
rollback;
