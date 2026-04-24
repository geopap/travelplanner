# Current Sprint

*No active sprint — Sprint 1 closed 2026-04-24. Next sprint to be defined from BACKLOG.*

---

## Active Items

*(none)*

---

## Completed This Sprint (Sprint 1 — closed 2026-04-24)

- **[B-001] Auth — Sign up** ✅ Full pipeline · all gates passed
- **[B-002] Auth — Sign in** ✅ Full pipeline · rate-limit verified
- **[B-003] Auth — Sign out & password reset** ✅ Fast Track · JWT claim enforcement (aal1 + amr.recovery), global signOut
- **[B-004] Trips CRUD** ✅ Full pipeline · RLS + owner seed trigger, date-shrink guard
- **[B-005] Trip days — day view** ✅ Full pipeline · auto-seed, inline title edit
- **[B-006] Itinerary items CRUD** ✅ Full pipeline · server-side trip_id/day_id, pagination + filters
- **[B-018] Session protection & route guards** ✅ Fast Track · proxy.ts fail-closed, 401 JSON / redirect split

**Sprint 1 metrics:**
- Migrations: 0001_init (6 tables, 3 functions, 22 RLS policies), 0002_audit_log
- Automated tests: 139 (vitest) — all passing
- API smoke UAT: 9/9 PASS
- Browser UAT: deferred to user (36-case checklist at `docs/uat/sprint-1-browser-checklist.md`)
- R4 findings resolved: 2 CRITICAL + 9 HIGH + selected MEDIUM

---

## Blockers

*(none)*

---

## Next

- User walks through `docs/uat/sprint-1-browser-checklist.md` (email delivery, session cookie inspection, UX flows).
- [scrum-master] reads BACKLOG Phase 2 items (B-007 Transportation, B-008 Accommodations, B-009 Google Places proxy, B-010, B-011 Bookmarks) to scope Sprint 2.
