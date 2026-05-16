# TravelPlanner — Release Notes

Local reference copy. Source of truth: GitHub Releases.

---

## v0.8.0 — Day-view repair + place-detail/places-list wiring (2026-05-16)

Sprint 8 roots out the silent item-drop bug in the itinerary day view, introduces Trello pairing diagnostics and live backfill tooling, and wires up a cluster of "plan from anywhere" surfaces: "Bookmarks for this day" on each day card, "Planned on …" chips on place detail, "Add to Itinerary" from bookmark rows and place detail, "Add a place" dialog on the Places list, and an All / Planned / Not Planned segmented filter. First migration-free sprint.

### Shipped

- **B-030 Trello pairing diagnostic + live backfill** — New `--diagnose` flag on `import-trello.ts` generates a per-date `date | bookmarks | paired_items | gap` table (read-only). Ran successfully against Japan 2026: 101 bookmarks backfilled, 0 errors. Branch C regression test added (`planBackfillCard` planner).
- **B-030 Branch B — Unscheduled itinerary section** — Root-cause fix for the silent item-drop bug in `ItineraryView.tsx` (items with `null` or stale `day_id` were discarded during bucketing). New `UNSCHEDULED_KEY` bucket + `UnscheduledSection` component with per-row day picker (PATCH existing route); viewers see rows read-only.
- **B-031 "Bookmarks for this day" section** — New collapsible section on each day card between the items list and the map. New endpoint `GET /api/trips/[id]/days/[dayId]/bookmarks` (viewer-or-higher; existence-hiding 404). New shared `app/src/lib/bookmarks/pairing.ts` helper with `isPaired`, `buildPairingOrClause`, `getDayPairingKeys`, `getPairedBookmarkIdsForDay` — the canonical OR predicate, single-source.
- **B-032 "Planned on dd.mm.yyyy" chips** — Chip group on `/places/[id]?trip=<uuid>` header showing every scheduled day; chips link to `#day-<dayNumber>` anchors. Server-side formatted; uses existing `itinerary_items_trip_place_idx` index.
- **B-033 "Add to Itinerary" pill** — Entry points on `BookmarkItem` rows and `PlaceDetailView` header. Day selector (required), time pickers (optional), type selector (transport excluded). Server-side title resolution from `places.name`; `source_card_id` never written (user-scheduled vs Trello-paired distinction preserved).
- **B-034 Inline transport/accommodations CTAs** — `TransportSummary` and `AccommodationsSummary` headers restructured to `flex items-baseline justify-between`; "Manage" links inline with `<h2>`. Duplicate bottom-of-overview row flagged for follow-up.
- **B-035 IG/TT URL caption-mode hint** — `ImportPasteForm` detects Instagram/TikTok hosts pre-submit and shows an inline banner with "Switch to caption mode". New `ExtractInputCaptionWithUrl` union variant in validator; stashed URL persisted as `import_sources.source_url` for traceability.
- **B-037 "Add a place" dialog** — "Add a place" button above the Places category tab bar (editor/owner only). Dialog reuses `PlaceSearchInput` + `POST /api/trips/[id]/bookmarks`; pre-hydrates Places cache; 409 `bookmark_exists` surfaces inline.
- **B-038 All / Planned / Not Planned filter** — Segmented `role="radiogroup"` below the "Add a place" button, above category tabs. URL: `?plan=<all|planned|notplanned>`; trip-wide split counts in labels; tab badge counts respect active filter. Consumes `getBookmarksWithPlannedFlag` from shared `pairing.ts`.
- **S7 follow-ups folded in** — Trip-context plumbing through `BookmarkItem`, "Back to trip" link in `PlaceDetailView`, `RelinkPlaceDialog` z-[1100].

### Stats

- **994/994 vitest tests passing** (+166 net new vs v0.7.0; 69 test files)
- **0 CRITICAL / 0 HIGH** from R4 (code-reviewer + security-reviewer)
- 1 HIGH fixed during R4: H-1 `ItineraryView.tsx` silent item drop in `onReassigned` (refetch fallback added)
- 1 Security MEDIUM fixed: Sec-M-1 collapsed two distinct 400 bodies in POST items title-default path to a single generic message
- `tsc --noEmit` clean; `next build` green
- All 8/8 items UAT PASS (incl. Branch B)

### Database

No migrations this sprint. All schema requirements covered by existing indexes from prior sprints (0011, 0023).

### Deferred to follow-up

**Code-reviewer findings (7 MEDIUM + 5 LOW):**
- M-1: `pairing.ts` internal DRY — `getDayPairingKeys` / `getTripPairingKeys` share identical row-normalisation loops (extract `normalisePairingKeyRows` private helper)
- M-2: `AddToItineraryDialog.tsx:331` unsafe `as AddToItineraryType` cast on select value
- M-3: `ItineraryView.tsx:656,667,669` `item.title` aria-label null guard ("Assign day for null" on screen readers)
- M-4: `role="dialog"` placed on backdrop overlay div rather than inner content box — affects `RelinkPlaceDialog`, `AddToItineraryDialog`, `AddPlaceDialog` (pre-existing from S7)
- L-1: `getBookmarksWithPlannedFlag` RT2 uses `as TripBookmarkRow[]` cast without Zod validation
- L-2: `ImportPasteForm.tsx:128` `stashedSourceUrl as string` assertion (acceptable as-is)
- L-3: PostgREST FK hint `places!bookmarks_place_id_fkey` — verify against Supabase Studio
- L-4: `UnscheduledSection` inlined in `ItineraryView.tsx` (consider extraction to own file)
- L-5: `toAddToItineraryCategory` mapper in `PlaceDetailView.tsx` instead of colocated with dialog

**Security-reviewer findings (2 MEDIUM + 3 LOW — code MEDIUM fixed above):**
- Sec-M-2: PATCH `place_id` parity — when PATCH supplies `place_id` and no `title`, title not backfilled from `places.name` (data-quality gap, no security risk)
- Sec-M-3: B-031 `.limit(200)` on bookmark fetch silently truncates if > 200 bookmarks paired to a single day (unreachable in practice; no data leak)
- Sec-L-1 through Sec-L-5: all recorded as confirmations / hardening notes; no exploitability identified

---

## v0.7.0 — Place-link polish + flight number (2026-05-16)

Sprint 7 adds re-linking bookmarks/itinerary items to the correct Google Place when the original pick was wrong, a mini-map on the place detail page, tabbed category filtering on the Places tab, and flight number on transportation records.

### Highlights
- **B-026 Bookmark/itinerary relink** — `POST /api/trips/[id]/bookmarks/relink` with `RelinkPlaceDialog` + `RelinkTriggerPill`. New `place_id_locked` boolean on bookmarks; locked records are skipped by automated re-enrichment. Membership check enforced inside `relink_place` RPC (CRITICAL finding fixed). Rollback: `0023_place_id_locked_rollback.sql`.
- **B-027 Mini-map on place detail** — `<PlaceMiniMap>` / `<PlaceMiniMapInner>` (SSR-safe via `next/dynamic`) render a single-marker Leaflet map on `/places/[id]`. "Open in Maps" pill links to `maps.google.com/?q=<lat>,<lng>`. No new endpoint; coordinates from existing `places.cached_details`.
- **B-028 ARIA tabs — Places page** — `<BookmarkList>` refactored to ARIA-compliant tab panel (`role=tablist/tab/tabpanel`, `aria-selected`, keyboard nav). Category filter now scoped client-side; no extra round-trips.
- **B-029 Flight number** — `flight_number varchar(20)` column on `transportation` (nullable); exposed in `TransportFields`, `TransportationTabClient`, `TransportSummary`, import script, and all validation schemas. `tg_transport_updated_at` trigger updated. Rollback: `0022_transportation_flight_number_rollback.sql`.

### Database
- Migration `0022_transportation_flight_number.sql`: adds `flight_number` column to `transportation`; updates `create_transport_item` / `update_transport_item` RPCs. Rollback: `0022_transportation_flight_number_rollback.sql`.
- Migration `0023_place_id_locked.sql`: adds `place_id_locked boolean not null default false` to `bookmarks`; new `relink_place` SECURITY DEFINER RPC with in-function membership check. Rollback: `0023_place_id_locked_rollback.sql`.

### Quality
- 814/814 vitest tests passing (+49 new: `bookmarks-relink`, `place-mini-map`, `bookmark-list-tabs`, `places-relink` validations).
- 1 CRITICAL fixed (relink_place RPC in-function membership check); 1 MEDIUM + 5 LOW deferred.
- All 4 items UAT PASS.

### Known follow-ups (deferred)
- 1 MEDIUM (optimistic-lock race on concurrent relink) + 5 LOW findings deferred to next sprint.
- `place-resolver.ts` shared module — future dependents through R2 (carried from S6).

---

## v0.6.0 — Day-view completeness: Trello items, hotel markers, interactive chips (2026-05-16)

Makes the day view the canonical "what's happening today" surface. Promotes labeled Trello cards to day items (B-022, with a one-shot `--backfill` against the Japan 2026 trip), adds hotel markers + place-enrichment to the day-view map (B-023), and turns the accommodation indicator chips into interactive entry points (B-024). Bundles four out-of-sprint commits (transport CRUD page, budget total includes bookings, expense auto-sync from bookings) that landed on the branch between v0.5.0 and S6 start.

### Highlights
- **B-022 Day-anchor labeled Trello imports** — Restaurants → `meal`; Attractions/Museums/Shopping → `activity`. Same-pass `place_id` lookup from the paired bookmark; idempotent via `(trip_id, source_card_id)`. `--backfill` walks existing bookmarks and inserts missing items; `--backfill --dry-run` emits stable `[plan]` lines.
- **B-023 Accommodations on day map + hotel enrichment** — New endpoint `GET /api/trips/[id]/days/[dayId]/map` returning `{ items, accommodations }` in one round-trip. `<AccommodationForm>` gains an optional place picker; backend resolves `google_place_id` → internal `places.id` via a new shared `lib/supabase/place-resolver.ts`. One-shot CLI script `enrich-accommodations.ts` applies a conservative 3-of-3 confidence rule (substring + `business_status='OPERATIONAL'` + top-2 disambiguation) to bulk-link hotels.
- **B-024 Interactive accommodation indicators** — Chips on each day card are now `<button>`s that open a detail modal with full hotel info, Edit (reuses `AccommodationForm`), and Delete (reuses `RemoveAccommodationDialog`). Mobile bottom sheet < 640 px; focus trap + Esc-close + focus-return. Multi-chip days each open their own modal keyed by `accommodation_id`.
- **B-025 Expense test repair** — Pure fixture fix; restored the suite from 682 + 11 failing to green.
- **Out-of-sprint bundle** — Trip-level Manage Transport page (B-?). Budget `total_spent` now includes accommodation/transport/itinerary-item costs. New `expenses.source_kind` / `source_id` columns + per-table triggers that auto-sync booking costs into the expenses list.

### Database
- Migration `0020_budget_includes_bookings.sql` (from out-of-sprint commit `b4bc4a2`): `get_trip_expense_total` RPC widened to include accommodation / transportation / itinerary-item costs from base-currency rows. Rollback: `0020_budget_includes_bookings_rollback.sql`.
- Migration `0021_expenses_from_bookings.sql` (from out-of-sprint commit `56b07c1`): new `expenses.source_kind` + `source_id` columns + unique partial index `(source_kind, source_id) where source_kind is not null`; new trigger functions on `accommodations`, `transportation`, `itinerary_items` that INSERT/UPDATE/DELETE the matching expense row; `get_trip_expense_total` reverted to expenses-only since bookings now flow through expenses (avoids double-count); backfill block at end. Rollback: `0021_expenses_from_bookings_rollback.sql`.
- B-022 / B-023 / B-024 introduce **no migrations** (`itinerary_items.place_id` from S5/0018 + `accommodations.place_id` from S3/0009 + `bookmarks.source_card_id` from S4/0011 cover the schema needs).

### Quality
- 758/758 vitest tests passing (+65 new this sprint across B-022, B-023, B-024, B-025 fixes).
- 0 CRITICAL / 0 HIGH R4 findings outstanding (B-022: 2 HIGH unsafe-cast remediated; B-024: 1 HIGH a11y boundary remediated; B-023: 3 MEDIUM remediated).
- `tsc --noEmit` clean; `next build` green.
- All 4 items UAT PASS.

### New environment variables
- None for S6 items themselves. The B-023 enrichment script reads existing `SUPABASE_SERVICE_ROLE_KEY`. Optional `ENRICH_BASE_URL` and `ENRICH_SESSION_COOKIE` for the network-fallback proxy path.

### Known follow-ups (deferred)
- `place-resolver.ts` is now a shared module; per CLAUDE.md Shared File Governance, future dependents should pass through R2 architecture review.
- LOWs not addressed: module-level `ACCOMMODATION_ICON` singleton in `DayMap.tsx`; `day-map-section.test.ts` `plottable` mirror slightly stricter than `toMapItems`.
- Ownership-transfer flow — still un-filed; carried forward.

---

## v0.5.0 — Day-view map, social-media import (2026-05-16)

Closes Phase A by shipping the Leaflet-based day-view map and delivers the first Phase B feature — social-media URL/text import with Claude-Haiku-powered place extraction. Also clears the Sprint 4 carry-over transport-keyword bug.

### Highlights
- **B-015 Leaflet map — day view** — Collapsible map section on each day card rendering markers for itinerary items with linked places. Auto-fit bounds, OSM tiles + attribution, SSR-safe via `next/dynamic({ ssr: false })`. Place picker added to the item form (non-transport types) using the existing `<PlaceSearchInput>` + Places cache. Collapse state persisted per (trip, day) in `localStorage`. Read-only for viewer role.
- **B-020 `inferTransportMode` keyword priority fix** — Sprint 4 carry-over. Reordered `TRANSPORT_KEYWORDS` so bus/train/ferry/car evaluate before flight; removed `airport` from the flight regex so "Bus to airport" correctly returns `bus` and "Airport transfer" falls through to `other`. 4 parametrised regression tests added.
- **B-021 Social-media import** — `POST /api/trips/[id]/import/extract` accepts a URL (YouTube transcript → cheerio meta fallback; X/Twitter via oEmbed; generic web OG-scrape with SSRF-guarded `safeFetch`) or pasted text (e.g. Instagram/TikTok captions), runs Claude Haiku 4.5 with forced tool-use for structured extraction, persists an `import_sources` row, and returns places + tips for user review. `POST /api/trips/[id]/import/[sourceId]/save` resolves each place against the Places cache and batch-inserts `bookmarks` (with `import_source_id` back-link); optionally creates a single "Tips from <hostname>" note on day 1. `GET /api/trips/[id]/import/[sourceId]` powers the review-screen deep-link. Rate limit 20/hr/user, 24h duplicate-URL guard, zero-results guard, editor-gated.

### Database
- Migration `0017_import_sources.sql`: new `import_sources` table (id, trip_id, source_type, source_url, raw_text, status, extracted_json, created_by) + RLS (viewer SELECT; editor INSERT/UPDATE/DELETE with `created_by = auth.uid()` on INSERT) + `bookmarks.import_source_id` nullable FK (ON DELETE SET NULL). Rollback: `0017_import_sources_rollback.sql`.
- Migration `0018_itinerary_items_place_id.sql`: `itinerary_items.place_id uuid null references places(id) on delete set null` + partial index `idx_itinerary_items_place_id`. Rollback: `0018_itinerary_items_place_id_rollback.sql`.
- Migration `0019_import_sources_recent_url_idx.sql`: partial composite index `import_sources_trip_url_recent_idx(trip_id, source_url, created_at desc) where source_url is not null` — backs the AC-12 duplicate-URL guard. Rollback: `0019_import_sources_recent_url_idx_rollback.sql`.

### Security
- **SSRF guard** (`app/src/lib/extract/sources.ts` `safeFetch`): blocks non-http(s) schemes; rejects literal-IP URLs in loopback / link-local (incl. `169.254.169.254`) / RFC1918 / CGNAT / multicast / reserved ranges (IPv4) and `::`/`::1`/`fc00::/7`/`fe80::/10`/`ff00::/8` (IPv6); DNS-resolves hostnames and blocks if ANY resolved address is in a blocked range (rebinding defence); walks redirects manually with re-validation at each hop (`MAX_REDIRECTS=3`); 10s `AbortController` timeout.
- Prompt-injection bounded by forced `tool_use` + strict zod schema validation; injected content rendered as plain text only (no `dangerouslySetInnerHTML`).
- `ANTHROPIC_API_KEY` server-side only; never returned in responses or error bodies.

### Quality
- 686/686 vitest tests passing (+102 new this sprint: 16 `safe-fetch.test.ts`, 25 `import-extract`, 18 `import-save`, 11 `import-get`, 7 `claude-extract`, 14 `items-with-place`, 7 `day-map-section`, plus minor fixture updates).
- 0 CRITICAL/HIGH R4 findings outstanding (1 CRITICAL SSRF + 1 HIGH index from security-reviewer remediated in R4; 3 R4 LOW/MEDIUM findings on B-015 remediated post-UAT).
- `tsc --noEmit` clean; `next build` green.
- All 3 items UAT PASS.

### New environment variables
- `ANTHROPIC_API_KEY` — server-side only; required for B-021 `/extract`.

### Known follow-ups (deferred)
- B-021 `save/route.ts` three-write atomicity (bookmarks → note → status flip) — documented with inline comment; will migrate to a single RPC when invited-members ship.
- In-memory rate limit will need Postgres/Upstash backing once multi-user activation occurs.
- B-021 `import_duplicate_blocked` audit entry — trivial, deferred.

---

## v0.4.0 — Budget & expenses, profiles, Trello import (2026-04-28)

Adds per-trip expense tracking with per-member balance computation, a full profile management page with avatar upload, and a Trello import script that hydrates a trip from a Trello export JSON.

### Highlights
- **B-014 Budget & expenses** — New `expenses` table (trip-scoped, role-gated). 6 endpoints: `POST/GET /api/trips/[id]/expenses` (paginated), `GET/PATCH/DELETE /api/trips/[id]/expenses/[expenseId]`, `GET /api/trips/[id]/expenses/balances`. Per-member balance computation via `get_trip_balances` RPC. `get_trip_expense_total` RPC for budget overview widget. All mutations audit-logged. Viewer role read-only enforced at RLS + app layer.
- **B-016 Trello import script** — Importer at `app/scripts/import-trello.ts` with `--dry-run` mode. Idempotent via `source_card_id` column on items/accommodations/bookmarks. Migrates checklist items as itinerary sub-items, attachments as notes, labels as categories.
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
- Trello import script.
- Playwright e2e.
- Upstash distributed rate limiting.
