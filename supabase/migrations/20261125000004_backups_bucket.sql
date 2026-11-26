-- Task 10: private Storage bucket for backups.
-- Only the `backup` Edge Function (service role) reads or writes it. There are deliberately
-- no storage.objects policies, so signed-in browsers cannot list, read, or upload backups.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
