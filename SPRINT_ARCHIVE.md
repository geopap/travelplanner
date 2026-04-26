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
