-- 0013_avatars_storage.sql  |  Sprint 4  |  B-017
--
-- Adds the public 'avatars' Supabase Storage bucket and the four RLS policies
-- that scope writes to the caller's own folder (`{user_id}/...`) while keeping
-- reads public (avatars must render in member lists without signed URLs).
--
-- Storage enforces the 2 MB size cap and MIME allow-list at upload time, so the
-- application layer does not need to re-validate bytes/content-type.
--
-- Path convention: `{user_id}/avatar.<ext>` — `storage.foldername(name)[1]`
-- resolves to the user_id segment used in the RLS predicates below.
--
-- Rollback: see `0013_avatars_storage_rollback.sql`.

begin;

-- ============================================================================
-- 1. Bucket
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- ============================================================================
-- 2. RLS policies on storage.objects (bucket-scoped)
-- ============================================================================

-- Public read: anyone (including unauthenticated) can fetch avatar objects.
drop policy if exists avatars_select_public on storage.objects;
create policy avatars_select_public on storage.objects
  for select using (bucket_id = 'avatars');

-- Caller may insert only into their own `{auth.uid()}/...` folder.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Caller may update only objects inside their own folder.
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Caller may delete only objects inside their own folder.
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
