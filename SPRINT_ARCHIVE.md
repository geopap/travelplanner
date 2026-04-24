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
