# Current Sprint

**Sprint 2 — CLOSED 2026-04-26** · Released as v0.2.0.
**Sprint 3** — not yet opened.

---

## Active Items

*(Sprint 2 closed. Sprint 3 not yet planned.)*

---

## Sprint 2 Items (all done)

### [B-012] Trip member invite & accept — ✅ DONE
- **Tier**: Full
- **Status**: done (UAT PASS 2026-04-26)
- **R5 outcome**: 184/184 tests pass (139 baseline + 45 new). UAT PASS on AC #1–#7. Concurrency race + token_expired/token_revoked envelope codes verified.
- **Migration**: `0003_invitations.sql` shipped (revoked_at, indexes, RPCs).

### [B-019] Invitation-only access — remove public sign-up — ✅ DONE
- **Tier**: Full
- **Status**: done (UAT PASS 2026-04-26)
- **R5 outcome**: 248/248 tests pass. UAT PASS on AC #1–#10. R4: 0 CRITICAL, 2 HIGH security (timing-pad enumeration + orphan-user compensation w/ 3-retry+app_metadata flag) — both fixed.
- **Migration**: `0006_signup_invitation.sql` shipped (signup_consume_invitation RPC).

### [B-009] Google Places search proxy — ✅ DONE
- **Tier**: Full (L)
- **Status**: done (UAT PASS 2026-04-26)
- **R5 outcome**: 229/229 tests pass. UAT PASS on AC #1–#7. Cache-first ILIKE+7d TTL gap closed post-R5; response now `{results, source: 'cache'|'google'}`. R4: 0 CRITICAL, 2 HIGH + 2 MEDIUMs all fixed.
- **Migration**: `0004_places.sql` shipped.

### [B-010] Place detail cache & page — ✅ DONE
- **Tier**: Full
- **Status**: done (UAT PASS 2026-04-26)
- **R5 outcome**: 277/277 tests pass (29 new). UAT PASS. R4: 0 CRITICAL, 2 HIGH XSS hardening (structured PhotoAttribution, http/https scheme validation, photoRef path-traversal block, slim-row Zod re-validation, private cache) — all fixed.
- **Migration**: none (reuses `places` table 0004).

### [B-011] Bookmarks — ✅ DONE
- **Tier**: Full
- **Status**: done (UAT PASS 2026-04-26)
- **R5 outcome**: 348/348 tests pass (71 new across api/bookmarks, lib/bookmark-categories, validations/bookmarks). UAT PASS on AC #1–#16. R4: 0 CRITICAL; HIGH UX/safety fixes (TripPicker role filter via `trip_members!inner(role)` join, Zod-parsed bookmark/place rows, cross-trip mutation guard) — all fixed.
- **Migration**: `0007_bookmarks.sql` shipped (UNIQUE `(trip_id, place_id, category)`, RLS via `is_trip_member`, updated_at trigger).

---

## Sprint 2 Plan Summary

**Tracks (interleaved):**
- Track A (access): B-012 → B-019
- Track B (places): B-009 → B-010 → B-011

**Parallel windows:**
- B-012 + B-009 in R2/R3 (different domains, no shared files).
- B-010, B-011 sequenced after B-009 (shared `places` table + types).
- B-019 sequenced after B-012 (shared `/api/auth/signup`, `validations/auth.ts`).

**External dependencies:**
- `GOOGLE_PLACES_API_KEY` value (user provides before R5 of B-009; cache-only tests can run without).

---

## Blockers

*(none)*

---

## Completed This Sprint

- [B-012] Trip member invite & accept — UAT PASS 2026-04-26
- [B-019] Invitation-only access — UAT PASS 2026-04-26
- [B-009] Google Places search proxy — UAT PASS 2026-04-26
- [B-010] Place detail cache & page — UAT PASS 2026-04-26
- [B-011] Bookmarks — UAT PASS 2026-04-26

---

## Sprint 1 Outcome (closed 2026-04-24)

7 items shipped (B-001..B-006, B-018). Migrations: 0001_init, 0002_audit_log. 139 vitest tests passing. R4 fixed 2 CRITICAL + 9 HIGH + selected MEDIUM. Browser UAT checklist deferred to user (`docs/uat/sprint-1-browser-checklist.md`).

---

## Next

- R1 [product-manager] across all 5 items → confirm DoR + flag any AC gaps.
- Then R2 [solution-architect] for B-012 + B-009 in parallel.
