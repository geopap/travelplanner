-- 0024_harden_trips_insert_policy.sql  |  Hotfix (B-045 follow-up)  |  2026-07-15
--
-- Context: while diagnosing B-045 (1h-idle JWT expiry causing 42501 RLS
-- violations on INSERT), an earlier uncommitted draft of this migration
-- relaxed trips_insert to `to public with check (true)` on the theory that
-- `auth.uid()` doesn't resolve under ES256 signing keys. That diagnosis was
-- wrong: the 42501s came from an EXPIRED access token (PostgREST then runs
-- the request as `anon`, so `auth.uid()` is null and WITH-CHECK fails). With
-- the requireFreshSession() guard now refreshing stale sessions before any
-- mutation, the ownership check evaluates correctly — and the wide-open
-- policy would have let the anon role insert arbitrary trips rows.
--
-- Change: recreate trips_insert with the original ownership invariant,
-- hardened two ways:
--   * `to authenticated` — the anon role can never match the policy.
--   * `(select auth.uid())` — wrapped in a scalar subquery so Postgres
--     evaluates it once per statement (initplan) instead of per row.
--
-- This migration is also the remediation path if the insecure draft was
-- ever applied: running it replaces whatever trips_insert policy exists
-- with the secure version.
--
-- Rollback: see 0024_harden_trips_insert_policy_rollback.sql

begin;

drop policy if exists trips_insert on public.trips;

create policy trips_insert on public.trips
  as permissive
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

commit;
