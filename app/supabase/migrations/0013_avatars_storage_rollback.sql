-- 0013_avatars_storage_rollback.sql  |  Sprint 4  |  B-017
--
-- Reverses 0013_avatars_storage.sql. Drops the four RLS policies on
-- storage.objects and removes the 'avatars' bucket row.
--
-- WARNING: Deleting the bucket row will fail if any objects remain. Operators
-- must empty the bucket first (`delete from storage.objects where bucket_id =
-- 'avatars'`) if a hard rollback is required.

begin;

-- 1. Drop policies
drop policy if exists avatars_delete_own  on storage.objects;
drop policy if exists avatars_update_own  on storage.objects;
drop policy if exists avatars_insert_own  on storage.objects;
drop policy if exists avatars_select_public on storage.objects;

-- 2. Remove bucket row
delete from storage.buckets where id = 'avatars';

commit;
