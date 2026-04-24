# TravelPlanner — Release Notes

Local reference copy. Source of truth: GitHub Releases.

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
