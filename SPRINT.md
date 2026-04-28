# Current Sprint

**Sprint 3 — OPENED 2026-04-28**
**Goal:** Itinerary depth (transport + lodging) + member role management. Unblocks B-016 Japan import for Sprint 4.

---

## Active Items

### [B-007] Transportation fields
- **Tier**: Full
- **Status**: build complete — awaiting R4 review
- **Assigned To**: [code-reviewer] + [security-reviewer]
- **Frontend files**: components/itinerary/TransportFields.tsx, components/trip-overview/TransportSummary.tsx, lib/hooks/useTransportation.ts, lib/utils/format.ts (added formatDateTime, localInputToIsoWithOffset, isoToLocalInputValue); modified ItineraryItemForm.tsx, ItineraryView.tsx, DayCard.tsx, ItineraryItemCard.tsx, TripOverview.tsx.
- **Backend files**: 0008_transportation.sql + rollback, validations/transportation.ts, types/transportation.ts, api/trips/[id]/transportation/route.ts (GET); modified: validations/itinerary-items.ts (discriminated union), api/trips/[id]/items/{route,[itemId]/route}.ts, lib/types/domain.ts, lib/audit.ts, lib/api/response.ts.
- **Backend note**: routes live at `/api/trips/[id]/items/...` (existing flat structure); architect's nested `[tripId]/days/[dayId]/items` path was reconciled to existing layout — functionally equivalent. Audit metadata excludes booking confirmation per privacy note. tsc --noEmit clean.
- **R2 outcome**: `transportation` table redesigned with `itinerary_item_id` 1:1 FK + denormalized `trip_id`. Atomicity via SECURITY DEFINER RPCs `create_transport_item` / `update_transport_item` (Supabase JS cannot wrap multi-insert client-side). Migration `0008_transportation.sql` + rollback. API extends `POST/PATCH /api/trips/[id]/days/[dayId]/items`; adds `GET /api/trips/[id]/transportation` paginated. `validations/itinerary-items.ts` becomes a discriminated union — refactor required first.
- **Engineering decisions accepted**: RPC approach (not Edge Function) for atomic create/update.
- **Blockers**: none
- **Feature Context**:
  - New `transportation` table linked 1:1 to `itinerary_items` (type='transport').
  - Fields: mode, carrier, confirmation, departure/arrival location + datetime (UTC).
  - Trip overview gains a transport summary section (departure-time order).
- **Handoff Notes**: AC already drafted in BACKLOG.md (sprint 2 plan); R1 confirms DoR and flags gaps.
- **Files Changed**: (pending)
- **Parallel Opportunity**: R3 backend can run parallel with B-013 backend (different domains).

### [B-008] Accommodations
- **Tier**: Full
- **Status**: build complete — awaiting R4 review
- **Assigned To**: [code-reviewer] + [security-reviewer]
- **Frontend files**: components/accommodations/{AccommodationForm,AccommodationsList,AccommodationsSummary,RemoveAccommodationDialog,StayIndicator,AccommodationsTabClient}.tsx, app/trips/[id]/accommodations/page.tsx, lib/hooks/{useAccommodations,useDayIndicators}.ts; modified TripOverview.tsx, ItineraryView.tsx, DayCard.tsx.
- **Frontend gap (non-blocking)**: place-picker not wired — form accepts hotel name only. Resolution requires either `POST /api/places/resolve` (google_place_id → internal UUID) or accepting google_place_id on POST /accommodations. Filed as follow-up; AC-1 still satisfied via hotel-name path.
- **Backend files**: 0009_accommodations.sql + rollback, validations/accommodations.ts, types/accommodations.ts, api/trips/[id]/accommodations/route.ts (GET+POST), api/trips/[id]/accommodations/[accommodationId]/route.ts (GET+PATCH+DELETE), api/trips/[id]/day-indicators/route.ts (GET); modified: lib/api/response.ts, lib/audit.ts.
- **Backend note**: Indicator endpoint shipped as standalone `GET /day-indicators` for clean React-Query cache. Notes capped 4000 chars (task brief). View `trip_day_accommodation_indicators` returns `{check_in, in_stay, check_out, same_day}` per day.
- **R2 outcome**: `accommodations` table — nullable `hotel_name`, `place_id IS NOT NULL OR hotel_name IS NOT NULL` CHECK, trip-range trigger `tg_accommodation_within_trip`. Day-view indicators via `security_invoker=true` VIEW `trip_day_accommodation_indicators` returning rows with `indicator_type ∈ {check_in, in_stay, check_out, same_day}` — no N+1. Migration `0009_accommodations.sql` + rollback. Endpoints: standard CRUD `/api/trips/[id]/accommodations[/[id]]`.
- **Blockers**: none
- **Feature Context**:
  - New `accommodations` table (FK to `trips`, NOT a child of `itinerary_items`).
  - Spans multiple days; surfaces check-in/out indicators on relevant day views.
  - Optional `place_id` link for hotel; falls back to free-text name.
- **Handoff Notes**: AC drafted. R1 confirms DoR. Sequenced after B-007 backend in R3 to avoid shared-file conflicts on day view + overview.
- **Files Changed**: (pending)
- **Parallel Opportunity**: R3 frontend can run parallel with B-013 frontend.

### [B-013] Member role management
- **Tier**: Full (auto-upgraded from S — touches RLS / role auth)
- **Status**: build complete — awaiting R4 review
- **Assigned To**: [code-reviewer] + [security-reviewer]
- **Frontend files**: components/members/{MembersList,MemberRoleControls,RemoveMemberDialog}.tsx, lib/hooks/useMembers.ts, lib/utils/eviction.ts, components/app/EvictionListener.tsx; modified lib/utils/api-client.ts (eviction interceptor for 403 not_a_member on trip-scoped paths), app/trips/[id]/members/page.tsx, app/layout.tsx (mounts EvictionListener globally).
- **Note**: existing wrapper is `lib/utils/api-client.ts` (architect's spec referenced `lib/api/client.ts`); extended existing one. Architect to update SOLUTION_DESIGN at sprint close.
- **Backend files**: 0010_member_role_mgmt.sql + rollback (RLS replaces, immutable-cols trigger, owner-self-delete trigger, sole-owner RPC `change_member_role`, trip_members(trip_id,role) index, cascade regression guard), validations/members.ts, types/members.ts, api/trips/[id]/members/[userId]/route.ts (PATCH+DELETE), api/trips/[id]/members/route.ts (GET list paginated joining profiles); modified: lib/api/response.ts, lib/audit.ts.
- **Backend note**: GET /members returns 403 `not_a_member` for both not-found and forbidden (no leak). `accepted_at ASC NULLS LAST` ordering. Frontend gap: `lib/api/client.ts` must detect 403 `not_a_member` on trip-scoped paths → toast + `/trips` redirect (AC-9 frontend portion).
- **R2 outcome**: No new tables. Migration `0010_member_role_mgmt.sql` REPLACES `trip_members_delete` policy: owner can delete others (multi-owner allowed), editor/viewer self-leave, owner self-delete REJECTED at DB layer. Adds `PATCH /api/trips/[id]/members/[userId]` (role change). Active-session eviction handled in `lib/api/client.ts` — 403 `not_a_member` on trip-scoped paths triggers toast + `/trips` redirect. Cascade-regression guard verifies `created_by`/`added_by`/`paid_by` ON DELETE SET NULL (already in baseline).
- **Engineering decisions accepted**: sole-owner self-demotion blocked with 409 `cannot_demote_sole_owner` (defense-in-depth alongside the multi-owner allowance).
- **Blockers**: none
- **Feature Context**:
  - No new tables — operates on existing `trip_members`.
  - Migration adds RLS policies for owner UPDATE/DELETE on other members.
  - Self-removal blocked at app + DB layer; ownership transfer deferred.
- **Handoff Notes**: AC drafted. R1 confirms DoR.
- **Files Changed**: (pending)
- **Parallel Opportunity**: Independent track — runs alongside B-007/B-008 in R3.

---

## Sprint 3 Plan Summary

**Tracks (interleaved):**
- Track A (itinerary): B-007 → B-008
- Track B (membership): B-013 (independent)

**Parallel windows:**
- R3: B-007 backend + B-013 backend (no shared files).
- R3: B-008 backend after B-007 backend lands (shared `itinerary_items` validation + day view).
- R4: code-reviewer + security-reviewer in parallel per item.

**External dependencies:** none (Supabase + Postgres only).

**Effort:** M + M + S (lighter than Sprint 2).

---

## Blockers

*(none)*

---

## Completed This Sprint

- [B-007] Transportation fields — UAT PASS 2026-04-28
- [B-008] Accommodations — UAT PASS-with-WARN 2026-04-28 (AC-6 N+1 fromCalls assertion missing — non-blocking; queued as a small follow-up)
- [B-013] Member role management — UAT PASS 2026-04-28

---

## Sprint 2 Outcome (closed 2026-04-26)

5 items shipped (B-009, B-010, B-011, B-012, B-019). Migrations: 0003–0007. 348/348 vitest tests passing. Released as v0.2.0.

---

## Sprint 1 Outcome (closed 2026-04-24)

7 items shipped (B-001..B-006, B-018). Migrations: 0001_init, 0002_audit_log. 139 vitest tests passing. R4 fixed 2 CRITICAL + 9 HIGH + selected MEDIUM. Browser UAT checklist deferred to user (`docs/uat/sprint-1-browser-checklist.md`).

---

## Next

- R1 [product-manager] across B-007, B-008, B-013 → confirm DoR + flag any AC gaps.
- Then R2 [solution-architect] for all three items.
- Then R3 build with parallel windows above.
