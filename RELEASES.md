# TravelPlanner — Release Notes

Local reference copy. Source of truth: GitHub Releases.

---

## v0.4.0 — Sprint 4: Money, Profiles, Japan import (2026-04-28)

Sprint 4 adds per-trip expense tracking with per-member balance computation, a full profile management page with avatar upload, and a one-shot Trello import script that seeds the 26-day Japan 2026 trip.

### Highlights
- **B-014 Budget & expenses** — New `expenses` table (trip-scoped, role-gated). 6 endpoints: `POST/GET /api/trips/[id]/expenses` (paginated), `GET/PATCH/DELETE /api/trips/[id]/expenses/[expenseId]`, `GET /api/trips/[id]/expenses/balances`. Per-member balance computation via `get_trip_balances` RPC. `get_trip_expense_total` RPC for budget overview widget. All mutations audit-logged. Viewer role read-only enforced at RLS + app layer.
- **B-016 Japan 2026 Trello import script** — One-shot importer at `app/scripts/import-trello.ts`. Supports `--dry-run` mode; idempotent via `source_card_id` column on items/accommodations/bookmarks. Migrates checklist items as itinerary sub-items, attachments as notes, labels as categories. Covers the full 26-day Japan trip from a Trello export JSON.
- **B-017 Profile management** — `/settings/profile` page with display name + bio editing, avatar upload/replace/delete via Supabase Storage (`avatars` bucket). `PATCH /api/profile` endpoint. Member lists across all trip views now render avatar thumbnails with initials fallback.

### Database
- Migration `0011_trello_import.sql`: `source_card_id` column on `itinerary_items`, `accommodations`, `bookmarks`; relaxes `bookmarks.place_id` NOT NULL; widens `transportation.mode` CHECK to include `other`. Rollback: `0011_trello_import_rollback.sql`.
- Migration `0012_expenses.sql`: `expenses` table + RLS + `tg_expense_within_trip` trigger (date-range guard) + `get_trip_balances` RPC. Rollback: `0012_expenses_rollback.sql`.
- Migration `0013_avatars_storage.sql`: `avatars` Storage bucket + 4 RLS policies on `storage.objects` (owner upload/replace/delete; member read). Rollback: `0013_avatars_storage_rollback.sql`.
- Migration `0014_expense_review_fixes.sql`: `get_trip_expense_total` RPC + tightened `expenses_update` policy `WITH CHECK`. Rollback: `0014_expense_review_fixes_rollback.sql`.

### Quality
- 584/584 vitest tests passing (+116 new this sprint).
- 0 CRITICAL/HIGH R4 findings outstanding (all resolved pre-R5).
- `tsc --noEmit` clean.
- All 3 items UAT PASS.

### Known WARNs (non-blocking, deferred)
- Transport-mode regex in import script does not yet handle all freeform Trello label strings — follow-up filed.
- Storage bucket validation shape returns a slightly wider type than the declared interface — follow-up filed.

---

## v0.3.0 — Sprint 3: Itinerary Depth + Role Management (2026-04-28)

Sprint 3 adds structured transportation and accommodation records to trip itineraries, and completes member role management — giving owners full control over collaborator permissions.

### Features
- **B-007 Transportation fields** — New `transportation` table linked 1:1 to `itinerary_items` (type='transport'). Fields: mode, carrier, confirmation, departure/arrival location + datetime (UTC). Atomic create/update via SECURITY DEFINER RPCs `create_transport_item` / `update_transport_item`. `validations/itinerary-items.ts` refactored to discriminated union. Trip overview gains a transport summary section (departure-time order). `GET /api/trips/[id]/transportation` paginated endpoint.
- **B-008 Accommodations** — New `accommodations` table (FK to trips, independent of itinerary_items). Spans multiple days; check-in/out indicators surfaced on day views via `trip_day_accommodation_indicators` VIEW (`security_invoker=true`). `indicator_type ∈ {check_in, in_stay, check_out, same_day}` — no N+1. Optional `place_id` link with free-text `hotel_name` fallback. Full CRUD at `/api/trips/[id]/accommodations[/[id]]`; standalone `/api/trips/[id]/day-indicators` endpoint. Note: place-picker not yet wired (filed as follow-up); hotel-name path satisfies AC-1.
- **B-013 Member role management** — No new tables; operates on existing `trip_members`. Migration replaces RLS policies: owner can update/delete other members; editor/viewer self-leave allowed; owner self-demotion blocked (409 `cannot_demote_sole_owner`). `PATCH /api/trips/[id]/members/[userId]` for role change; `DELETE` for removal. Active-session eviction: `lib/utils/eviction.ts` + `EvictionListener` component detect 403 `not_a_member` on trip-scoped paths → toast + `/trips` redirect. GET /members returns 403 for both not-found and forbidden (anti-enumeration).

### Database
- Migration `0008_transportation.sql`: `transportation` table + 1:1 FK to `itinerary_items` + `create_transport_item` / `update_transport_item` RPCs + RLS. Rollback: `0008_transportation_rollback.sql`.
- Migration `0009_accommodations.sql`: `accommodations` table + trip-range trigger `tg_accommodation_within_trip` + `trip_day_accommodation_indicators` VIEW. Rollback: `0009_accommodations_rollback.sql`.
- Migration `0010_member_role_mgmt.sql`: replaces `trip_members_delete` RLS policy + immutable-cols trigger + owner-self-delete guard + `change_member_role` RPC + `trip_members(trip_id,role)` index + cascade regression guard. Rollback: `0010_member_role_mgmt_rollback.sql`.

### Quality
- 468/468 vitest tests passing (120 new this sprint).
- R4 findings resolved: 2 CRITICAL + 9 HIGH (code-reviewer 2C+8H; security-reviewer 0C+1H).
- All 3 items UAT PASS (B-008 PASS-with-WARN on AC-6 N+1 assertion — non-blocking follow-up filed).

### Follow-ups carried forward
- `place_id` resolver for accommodation place picker (`POST /api/places/resolve`) — filed as follow-up item.
- B-008 AC-6 N+1 `fromCalls` assertion missing in test suite — filed as small follow-up.
- Ownership transfer flow — deferred to backlog.

---

## v0.2.0 — Sprint 2: Access Control + Places (2026-04-26)

Sprint 2 closes out platform access hardening and the Google Places foundation. The app is now invitation-only, fully supports collaborative trip planning via email invitations, and lets users search, view, and bookmark real-world places from Google.

### Features
- **B-012 Trip member invite & accept** — Owner generates a 48h single-use invite token; invitee accepts via `/invite/[token]`; `trip_members` row created with chosen role. Concurrency-safe (ON CONFLICT guard), token_expired/token_revoked envelope codes.
- **B-019 Invitation-only sign-up** — Public `/sign-up` removed; account creation gated on a valid invitation token; `signup_consume_invitation` RPC atomically creates user + member row; anti-enumeration shape preserved; timing-safe token comparison.
- **B-009 Google Places search proxy** — `/api/places/search` authenticates caller, checks `places` cache (ILIKE + 7-day TTL), falls back to Google Places API; rate-limited 30 req/min per user; response includes `source: 'cache'|'google'`; API key server-side only.
- **B-010 Place detail cache & page** — `/api/places/[googlePlaceId]` caches full details (photos, hours, rating, website) in `places.cached_details` JSONB; 7-day TTL; XSS hardening: structured PhotoAttribution, http/https scheme validation, photoRef path-traversal block, private cache header.
- **B-011 Bookmarks** — Bookmark any place to a trip with category (restaurant/sight/museum/shopping); RLS via `is_trip_member()`; UNIQUE `(trip_id, place_id, category)` guard; grouped/sorted Places tab; role-gated writes.

### New environment variable
- `GOOGLE_PLACES_API_KEY` — server-side only; added to `.env.example`.

### Database
- Migration `0003_invitations.sql`: `revoked_at` column + indexes + invitation RPCs. Rollback: `0003_invitations_rollback.sql`.
- Migration `0004_places.sql`: `places` cache table + GIN index on `cached_details`. Rollback: `0004_places_rollback.sql`.
- Migration `0006_signup_invitation.sql`: `signup_consume_invitation` RPC for atomic sign-up + invite consume. Rollback: `0006_signup_invitation_rollback.sql`.
- Migration `0007_bookmarks.sql`: `bookmarks` table + UNIQUE constraint + RLS + `updated_at` trigger. Rollback: `0007_bookmarks_rollback.sql`.

### Quality
- 348/348 vitest tests passing (209 new this sprint).
- R4 findings resolved: 0 CRITICAL, all HIGH fixed across 5 items.
- All 5 items UAT PASS.

---

## v0.1.0 — Sprint 1: Foundation (2026-04-24)

First tagged release. Authenticated trip planner skeleton with day-by-day itinerary.

### Features
- Email/password sign-up, sign-in, sign-out, password reset (Supabase Auth).
- Password-reset completion enforces JWT `aal==='aal1'` + `amr` contains `method==='recovery'`; global sign-out after reset.
- Trip CRUD with owner-member auto-seed, date-shrink guard, name-typed delete confirm.
- Trip days auto-generated per calendar day; inline-editable day titles.
- Itinerary items CRUD (transport/lodging/activity/meal/note) with paginated listing and filters.
- Server-side session guard (`proxy.ts`, Next 16) — 401 JSON for API, redirect for pages, fail-closed.

### Database
- Migration `0001_init.sql`: 6 tables (profiles, trips, trip_members, trip_invitations, trip_days, itinerary_items), `is_trip_member()` helper, 22 RLS policies, owner-seed + updated_at triggers.
- Migration `0002_audit_log.sql`: append-only `audit_log` with service-role-only writes.

### Security
- RLS on every table + app-level `checkTripAccess` (defense-in-depth).
- Anti-enumeration: signup returns uniform `{ok:true}` 200.
- In-memory per-IP rate limiting on auth endpoints (Upstash deferred).
- `import 'server-only'` on `audit.ts` and `service.ts`.

### Quality
- 139 vitest tests passing (unit + integration + proxy/session-guard).
- 9/9 API smoke UAT PASS.
- R4 findings resolved: 2 CRITICAL, 9 HIGH, selected MEDIUM.
- 36-case browser UAT checklist at `docs/uat/sprint-1-browser-checklist.md` — deferred to user.

### Pipeline
- Simplified from 17-agent / 8-round to 10-agent / 5-round for personal-project scope.
- Dropped: ai-ml-engineer, content-creator, data-analyst, marketing-manager, qa-reviewer, seo-reviewer, technical-writer.

### Deferred to Sprint 2+
- Google Places proxy + bookmarks.
- Transportation + accommodations structured fields.
- Trip-member invitations.
- Leaflet day map.
- Japan 2026 Trello import script.
- Playwright e2e.
- Upstash distributed rate limiting.
