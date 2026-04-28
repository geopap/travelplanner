# Sprint Archive

Historical completed sprint items. Appended by [scrum-master] at the close of each sprint
(after retrospective). Read this file for history; read SPRINT.md for the active sprint only.

---

## Sprint 1 — Foundation (closed 2026-04-24)

**Window:** 2026-04-24 (single-session bootstrap + build + review + test + close)
**Pipeline:** Simplified 10-agent, 5-round (R1 Define → R2 Architect → R3 Build → R4 Review → R5 Test)
**Release:** v0.1.0 — see RELEASES.md / GitHub Releases

### Items

| ID | Title | Tier | Outcome |
|----|-------|------|---------|
| B-001 | Auth — Sign up | Full | ✅ done |
| B-002 | Auth — Sign in | Full | ✅ done |
| B-003 | Auth — Sign out & password reset | Fast Track (+architect review) | ✅ done |
| B-004 | Trips CRUD | Full | ✅ done |
| B-005 | Trip days — day view | Full | ✅ done |
| B-006 | Itinerary items CRUD | Full | ✅ done |
| B-018 | Session protection & route guards | Fast Track | ✅ done |

### Deliverables

- **Migrations:** `0001_init.sql` (profiles, trips, trip_members, trip_invitations, trip_days, itinerary_items + `is_trip_member()` + RLS) · `0002_audit_log.sql`
- **API routes:** `/api/auth/{signup,signin,signout,password-reset,password-reset/complete}`, `/api/trips`, `/api/trips/[id]`, `/api/trips/[id]/days`, `/api/trips/[id]/items`
- **Pages:** `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/trips`, `/trips/new`, `/trips/[id]`, `/trips/[id]/edit`, `/trips/[id]/itinerary`
- **Session guard:** `app/src/proxy.ts` (Next 16 rename from middleware.ts), fail-closed on `getUser()` errors
- **Audit log:** `logAudit()` → structured console + `audit_log` insert, `import 'server-only'`
- **Rate limiting:** in-memory per-IP (Upstash deferred to Phase B)
- **Tests:** 139 vitest tests (unit + integration + proxy), all passing (~1s)
- **UAT:** 9/9 API smoke PASS; 36-case browser checklist deferred to user

### Notable decisions

- **Pipeline simplification (mid-sprint):** dropped ai-ml-engineer, content-creator, data-analyst, marketing-manager, qa-reviewer, seo-reviewer, technical-writer; dropped BUSINESS/MARKETING/STRATEGIC/TRACKING/BACKLOG_BOARD/SPRINT_FINDINGS docs. Rationale: personal project, single environment, no analytics/marketing scope.
- **Fast Track as default tier** for XS/S items; Full only for M/L with schema or cross-cutting auth.
- **Defense-in-depth:** RLS on every table + app-level `checkTripAccess` in every API route; never trust client `trip_id`.
- **Anti-enumeration:** signup returns uniform `{ok:true}` 200 regardless of whether email exists.
- **Password-reset completion:** enforces JWT `aal==='aal1'` + `amr` contains `method==='recovery'` before `updateUser`; then global sign-out via service-role admin.

### Issues resolved during sprint

- Migration 42P01 — fixed by reordering: tables → functions → triggers → policies in single transaction.
- R4 CRITICAL: frontend calling nested `/days/[dayId]/items` route while backend shipped flat `/items?day_id=` — collapsed to flat (source of truth: backend).
- R4 HIGH: `as MemberRole` cast replaced with runtime union validation.
- R4 HIGH: proxy `getUser()` unhandled rejection → wrapped in try/catch, fail-closed.

### Deferred to Sprint 2+

- Browser UAT walkthrough (email delivery, cookie inspection, UX flows) — user.
- Upstash rate limiting (currently in-memory).
- Playwright e2e suite (Sprint 2).
- Japan Trello import script (B-016).
- Google Places proxy + bookmarks (B-009, B-010, B-011).

---

## Sprint 2 — Access Control + Places (closed 2026-04-26)

**Window:** 2026-04-26 (single-session — opened and closed same day)
**Theme:** Lock platform access (invitation-only) + Google Places foundation (search → detail → bookmarks).
**Pipeline:** 10-agent, 5-round Full pipeline for all 5 items.
**Release:** v0.2.0 — see RELEASES.md / GitHub Releases

### Items

| ID | Title | Tier | Outcome |
|----|-------|------|---------|
| B-012 | Trip member invite & accept | Full | done |
| B-019 | Invitation-only sign-up | Full | done |
| B-009 | Google Places search proxy | Full (L) | done |
| B-010 | Place detail cache & page | Full | done |
| B-011 | Bookmarks | Full | done |

### Deliverables

- **Migrations:** `0003_invitations.sql` (revoked_at, indexes, invite RPCs) · `0004_places.sql` (places cache table + GIN index) · `0006_signup_invitation.sql` (signup_consume_invitation RPC) · `0007_bookmarks.sql` (bookmarks + UNIQUE + RLS + trigger). All 4 have rollback files.
- **API routes:** `/api/trips/[id]/invitations`, `/api/invite/[token]` (validate + accept), `/api/auth/signup` (invite-gated), `/api/places/search`, `/api/places/[googlePlaceId]`, `/api/trips/[id]/bookmarks`, `/api/trips/[id]/bookmarks/[bookmarkId]`
- **Pages:** `/invite/[token]` (validate → sign-up form or accept), `/places/[id]` (place detail), `/trips/[id]/places` (bookmark tab), `/trips/[id]/members` (invite UI)
- **New env var:** `GOOGLE_PLACES_API_KEY` (server-side only; in `.env.example`)
- **Tests:** 348 vitest tests (209 new this sprint), all passing
- **UAT:** All 5 items UAT PASS (2026-04-26)

### Notable decisions

- **Invitation-only sign-up (B-019):** `signup_consume_invitation` RPC runs atomically — user creation + invite consume in one DB transaction; timing-safe constant-time comparison guards against enumeration.
- **Google Places cache strategy:** ILIKE match on name + `google_place_id` lookup; 7-day TTL; `source: 'cache'|'google'` in response; GIN index on `cached_details` for JSONB queries.
- **XSS hardening on place details (B-010):** structured `PhotoAttribution` type, http/https scheme validation on URLs, photoRef path-traversal block, `Cache-Control: private` on detail responses.
- **Bookmarks cross-trip guard (B-011):** mutation endpoints re-validate `trip_id` from URL against membership — client-supplied `trip_id` in body ignored.

### Issues resolved during sprint

- B-019 R4 HIGH: timing-pad enumeration risk → constant-time token comparison added.
- B-019 R4 HIGH: orphan-user on partial failure → 3-retry compensation loop + `app_metadata` flag.
- B-009: cache-first gap (stale ILIKE hit returning expired rows) → TTL-filtered query added post-R5.
- B-010 R4 HIGH (x2): XSS via raw photo attribution HTML + unvalidated redirect URLs → structured type + scheme validation.
- B-011 R4 HIGH: `TripPicker` showed all user trips including ones where viewer role → `trip_members!inner(role)` join filter added.

### Deferred to Sprint 3+

- Playwright e2e suite (still deferred).
- Transportation structured fields (B-007).
- Accommodations (B-008).
- Member role management (B-013).
- Budget & expenses (B-014).
- Upstash distributed rate limiting.

---

## Sprint 3 — Itinerary Depth + Role Management (closed 2026-04-28)

**Window:** 2026-04-28 (single-session)
**Theme:** Structured transportation + accommodations for trip itineraries; full member role management for collaborative trips.
**Pipeline:** 10-agent, 5-round Full pipeline for all 3 items.
**Release:** v0.3.0 — tag `v0.3.0` · see RELEASES.md

### Items

| ID | Title | Tier | Outcome |
|----|-------|------|---------|
| B-007 | Transportation fields | Full | done |
| B-008 | Accommodations | Full | done (PASS-with-WARN: AC-6 N+1 assertion follow-up filed) |
| B-013 | Member role management | Full (auto-upgraded from S) | done |

### Deliverables

- **Migrations:**
  - `0008_transportation.sql` — `transportation` table + 1:1 FK to `itinerary_items` + `create_transport_item`/`update_transport_item` RPCs + RLS. Rollback: `0008_transportation_rollback.sql`.
  - `0009_accommodations.sql` — `accommodations` table + trip-range trigger + `trip_day_accommodation_indicators` VIEW (`security_invoker=true`). Rollback: `0009_accommodations_rollback.sql`.
  - `0010_member_role_mgmt.sql` — Replaces trip_members RLS delete policy; adds immutable-cols trigger; owner-self-delete guard; `change_member_role` RPC; `trip_members(trip_id,role)` index; cascade regression guard. Rollback: `0010_member_role_mgmt_rollback.sql`.
- **API routes (new):** `GET /api/trips/[id]/transportation`, `GET+POST /api/trips/[id]/accommodations`, `GET+PATCH+DELETE /api/trips/[id]/accommodations/[id]`, `GET /api/trips/[id]/day-indicators`, `GET+PATCH+DELETE /api/trips/[id]/members/[userId]`
- **New components:** `TransportFields`, `TransportSummary`, `AccommodationForm`, `AccommodationsList`, `AccommodationsSummary`, `RemoveAccommodationDialog`, `StayIndicator`, `AccommodationsTabClient`, `MembersList`, `MemberRoleControls`, `RemoveMemberDialog`, `EvictionListener`
- **New hooks:** `useTransportation`, `useAccommodations`, `useDayIndicators`, `useMembers`
- **Notable refactor:** `validations/itinerary-items.ts` → discriminated union (transport | lodging | activity | meal | note)
- **Eviction interceptor:** `lib/utils/eviction.ts` + `lib/utils/api-client.ts` extension → 403 `not_a_member` on trip-scoped paths triggers toast + `/trips` redirect
- **Tests:** 468 vitest tests (120 new this sprint), all passing
- **UAT:** B-007 PASS, B-008 PASS-with-WARN, B-013 PASS (2026-04-28)

### R4 Findings Resolved

- 2 CRITICAL fixed (code-reviewer)
- 9 HIGH fixed (8 code-reviewer + 1 security-reviewer)

### Notable Decisions

- **RPC approach for atomicity (B-007):** Supabase JS client cannot wrap multi-table inserts in a transaction; SECURITY DEFINER RPCs `create_transport_item` / `update_transport_item` ensure `itinerary_items` + `transportation` are written atomically.
- **Discriminated union refactor (B-007):** `validations/itinerary-items.ts` converted to discriminated union so type-specific fields are validated at the schema level, not with optional spread.
- **Accommodations as independent entity (B-008):** Accommodations are NOT children of `itinerary_items` — they span multiple days. Day indicators are computed via a VIEW rather than N+1 per-day queries.
- **Day-indicator VIEW (B-008):** `trip_day_accommodation_indicators` uses `security_invoker=true` (inherits caller's RLS context); returns typed rows without N+1.
- **3-layer defense for role management (B-013):** RLS policy + SECURITY DEFINER RPC (`change_member_role`) + application-level `checkTripAccess` — sole-owner self-demotion blocked at all three layers.
- **Eviction interceptor (B-013):** `api-client.ts` extended (not replaced) to intercept 403 `not_a_member` on trip-scoped paths and evict the session client-side before redirect. `EvictionListener` mounted globally in `app/layout.tsx`.
- **Architect path reconciliation (B-007):** R2 spec proposed nested `[tripId]/days/[dayId]/items` paths; build reconciled to existing flat `/api/trips/[id]/items` structure — functionally equivalent. SOLUTION_DESIGN.md updated at sprint close.

### Follow-ups Carried Forward

- `place_id` resolver for accommodation place picker — `POST /api/places/resolve` (google_place_id → internal UUID) not yet built; hotel-name path satisfies AC-1. Filed as follow-up.
- B-008 AC-6 N+1 `fromCalls` assertion missing in automated tests — non-blocking; filed as small follow-up item.
- Ownership transfer flow — deferred to backlog.

### Deferred to Sprint 4+

- Playwright e2e suite (still deferred).
- Budget & expenses (B-014).
- Japan 2026 Trello import script (B-016).
- Upstash distributed rate limiting.
- Leaflet day map.

---

## Sprint 4 — Money, Profiles, Japan import (closed 2026-04-28)

**Window:** 2026-04-28 (single-session R1→close, mirroring prior sprints)
**Pipeline:** Full (10-agent, 5-round) for B-014 + B-016; Fast Track + targeted R2 for B-017
**Release:** [v0.4.0](https://github.com/geopap/travelplanner/releases/tag/v0.4.0)

### Items

| ID | Title | Tier | Outcome |
|----|-------|------|---------|
| B-014 | Budget & expenses | Full | ✅ done — UAT PASS |
| B-016 | Japan 2026 Trello import script | Full | ✅ done — UAT PASS-with-WARN |
| B-017 | Profile management | Fast Track + light R2 | ✅ done — UAT PASS-with-WARN |

### Deliverables

- **Migrations:**
  - `0011_trello_import.sql` — `source_card_id` column on `itinerary_items`/`accommodations`/`bookmarks`; relax `bookmarks.place_id`; widen `transportation.mode` CHECK to include `'other'`.
  - `0012_expenses.sql` — `expenses` table + indexes + `tg_expense_within_trip` trigger + RLS + `get_trip_balances()` RPC.
  - `0013_avatars_storage.sql` — `avatars` Storage bucket (public-read, 2MB, jpg/png/webp) + 4 path-scoped RLS policies on `storage.objects`.
  - `0014_expense_review_fixes.sql` — `get_trip_expense_total()` RPC (replaces unbounded JS-side aggregate fetch) + `expenses_update` policy `with check` tightening.
- **API routes added:** `/api/trips/[id]/expenses`, `/api/trips/[id]/expenses/[expenseId]`, `/api/trips/[id]/balances`, `/api/profile`.
- **Pages added:** `/trips/[id]/budget`, `/settings/profile`, `/settings` layout.
- **Components added:** `expenses/{ExpenseForm, ExpensesList, ExpensesSummary, ExpensesTabClient, RemoveExpenseDialog}`, `profile/{InitialsAvatar, ProfileForm}`.
- **Hooks added:** `useExpenses`, `useBalances`.
- **Validations added:** `expenses.ts`, `profile.ts`.
- **Types added:** `expenses.ts`, `profile.ts`. TransportMode widened to include `'other'`.
- **Script added:** `app/scripts/import-trello.ts` (one-shot Trello importer, idempotent via `source_card_id`, `--dry-run` flag, anon-key guard). Trello data committed at `app/scripts/data/japan-2026.json`. `npm run import:trello` script added.
- **Env vars:** `SUPABASE_SERVICE_ROLE_KEY` (server-only, importer use) documented in `.env.example`.

### Quality

- **Tests:** 584 passing (37 files), +116 new from R5.
- **R4 outcomes:** 4 HIGH fixed (2 B-016: transport-mode default + userEmail PII; 2 B-014: unbounded `total_spent` aggregate). MEDIUM cleanups: dead prop, unused import, unsafe `as` casts → Zod, cache-buster persisted to DB. LOWs deferred per CLAUDE.md gate.
- **TransportMode reconciliation:** DB CHECK + Zod enum + TS type now agreed (all include `'other'`).
- **`tsc --noEmit`:** clean.

### Notes for next sprint

- **WARN (B-016):** `inferTransportMode` regex order matches `flight` keyword "airport" before `bus`, so "Bus to airport" → flight. Cosmetic in one-shot import; user can manually correct post-import. Recommended fix: reorder regex priority. → Sprint 5 follow-up.
- **WARN (B-017):** Server-side MIME re-validation delegated to Storage bucket policy (`allowed_mime_types`); the security outcome is correct but error shape differs from app routes. Architect-approved in R2. No follow-up planned.
- **B-008 AC-6 carryover** — N+1 `fromCalls` assertion still missing for accommodations. Tiny follow-up.
- **Browser UAT** — 7 SKIP items deferred to user via `app/docs/uat/sprint-4-browser-checklist.md` (consistent with Sprint 1–3 pattern).

### Deferred to Sprint 5+

- Leaflet day map (B-015) — slotted for Sprint 5.
- Playwright e2e suite (carryover).
- Upstash distributed rate limiting.
- Ownership transfer flow.
- Place picker → `place_id` resolver for accommodations form.
- `inferTransportMode` regex priority fix.
