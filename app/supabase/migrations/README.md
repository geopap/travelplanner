# Supabase Migrations

This directory holds forward-only SQL migrations applied to the Supabase Postgres database.

## Numbering scheme

```
NNNN_description.sql
```

- `NNNN` is a four-digit sequence number, zero-padded, starting at `0001`.
- `description` is a short, lowercase, underscore-separated summary of what the migration does (e.g. `0001_init.sql`, `0002_places_and_fk.sql`).
- Migrations are applied in numeric order. Never renumber a migration that has been applied in any environment.

## Applying migrations

From the repo root:

```bash
cd app
npx supabase db push
```

This diffs the local `supabase/migrations/` directory against the linked remote project and applies unapplied migrations in order. Run against a branch project during development; run against production only after QA sign-off and a point-in-time-recovery snapshot.

## Creating a new migration

```bash
cd app
npx supabase migration new <short_description>
```

This creates an empty, correctly numbered `NNNN_<short_description>.sql` file. Edit the file, wrap the DDL in a single `begin; ... commit;` block, and include a rollback block at the bottom (see Rollback policy below).

## Rollback policy

Rollbacks are **manual**. Every migration file MUST include a commented rollback block at the bottom in this form:

```sql
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   drop table if exists public.<table> cascade;
--   ...
-- commit;
```

Rules:
- The rollback block is always commented out — it is reference documentation, not executable by `supabase db push`.
- To roll back: copy the block into the Supabase SQL editor (or `psql`), uncomment it, and run inside a transaction.
- Shared resources (like `pgcrypto`) are deliberately NOT dropped in rollbacks — later migrations may still need them.
- If a migration is destructive (drops columns, renames tables), the rollback block must also include the forward-data-recovery steps or explicitly state `-- DATA LOSS: no automatic recovery`.

## Conventions

- All DDL lives in `public`. RLS is enabled on every table.
- Shared helper functions (`is_trip_member`, `tg_set_updated_at`, etc.) use `create or replace` so re-runs are idempotent.
- Tables use `create table` (not `create table if not exists`) — migrations are not intended to re-run; idempotency on tables would mask mistakes.
- Indexes, policies, and triggers are created inline with each table definition.
- FK order is maintained: reference tables before referring tables.

## Sprint 1 baseline

`0001_init.sql` establishes: `profiles`, `trips`, `trip_members`, `trip_invitations`, `trip_days`, `itinerary_items` + the three helper functions + `pgcrypto`. See `docs/architecture/sprint-1-build-spec.md` for the buildable spec derived from this baseline.
