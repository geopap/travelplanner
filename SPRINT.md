# Current Sprint

*Sprint 1 — Foundation: Auth + Trips + Itinerary skeleton.*

**Start date:** 2026-04-24
**Target duration:** 2 weeks (approx.)
**Total effort:** 6 × M + 1 × S ≈ 6 M-equivalents

---

## Active Items

### [B-001] Auth — Sign up
- **Tier**: Full
- **Status**: definition (R1 — data-analyst tracking plan)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase anon + service-role keys in `app/.env.local` (owner: user)
- **Feature Context**: New-user sign-up with email/password, rate-limited, Supabase Auth + `profiles` row on confirmation.
- **Handoff Notes**: PM definition complete in BACKLOG B-001. R2 must specify migration for `profiles`, session cookie config, rate-limit layer decision.
- **Files Changed**: *(none yet)*
- **Parallel Opportunity**: R3 backend can share session/cookie helpers with B-002/B-003/B-018; frontend R4 shares auth forms.

### [B-002] Auth — Sign in
- **Tier**: Full
- **Status**: definition (R1)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase keys
- **Feature Context**: Sign-in with generic-error message, session creation, rate limit + lockout.
- **Handoff Notes**: Pair with B-001 in build rounds — shared auth form component.
- **Files Changed**: *(none yet)*

### [B-003] Auth — Sign out & password reset
- **Tier**: Fast Track (S — but touches auth, so [solution-architect] review is mandatory per DoR exception)
- **Status**: definition (R1)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase keys (password-reset email uses Supabase default)
- **Feature Context**: Sign-out clears cookie; forgot-password triggers Supabase reset email.
- **Handoff Notes**: Pair with B-001/B-002 in build.

### [B-004] Trips CRUD
- **Tier**: Full
- **Status**: definition (R1)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase keys
- **Feature Context**: Create/list/edit/delete trips; `trips` table + `trip_members` auto-seed trigger; date-range validation; delete with name-typed confirmation.
- **Handoff Notes**: Auto-generates `trip_days` on create/edit (shared with B-005).
- **Files Changed**: *(none yet)*

### [B-005] Trip days — day view
- **Tier**: Full
- **Status**: definition (R1)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase keys, depends on B-004
- **Feature Context**: `/trips/[id]/itinerary` page lists all `trip_days`; inline-editable day title; empty-state CTA.

### [B-006] Itinerary items CRUD
- **Tier**: Full
- **Status**: definition (R1)
- **Assigned To**: [data-analyst], then [solution-architect] R2
- **Blockers**: Supabase keys, depends on B-005
- **Feature Context**: Typed items (transport/lodging/activity/meal/note) with time, cost, currency, notes. Server sets `trip_id` + `day_id` from URL.

### [B-018] Session protection & route guards
- **Tier**: Fast Track (S)
- **Status**: definition (R1)
- **Assigned To**: [solution-architect] R2 mandatory (auth-touching)
- **Blockers**: Supabase keys
- **Feature Context**: Middleware + server-side session guards on all `/trips/**` routes; 401 JSON for API, redirect for pages.

---

## Completed This Sprint

*(none yet)*

---

## Execution Plan

### Phase 1 — R1 Definition refinement (this turn)
- [product-manager] work from Sprint 0 already wrote user stories + ACs in BACKLOG.md → PM R1 confirmed complete, no re-run needed
- [data-analyst] writes tracking plan for all 7 items in one pass → events, success metrics, KPIs
- [marketing-manager] skipped — foundation items, no user-facing marketing angle yet

### Phase 2 — R2 Architecture (next)
- [solution-architect] produces: `0001_init.sql` migration (6 core tables from SOLUTION_DESIGN §2 Sprint 1 scope), API contract refinements for Sprint 1 endpoints, session + RLS interactions, rate-limit approach decision

### Phase 3 — R3/R4 Build
- [backend-engineer] — migration + API routes + Supabase server/browser client helpers + validations + session guards
- [frontend-engineer] — auth pages, trips list + detail, day view, item form, route guards

### Phase 4 — R5 Review (4 reviewers in parallel) → fix → R6 test → R7 close

---

## Gate 6 — Sprint 1 Readiness Check

| # | Check | Status |
|---|-------|--------|
| 1 | All items have user story + AC | ✅ (in BACKLOG.md) |
| 2 | Priority + effort + dependencies assigned | ✅ |
| 3 | External dependencies confirmed | 🔄 Supabase keys pending in `.env.local` (user owns) · Places key ready (user-reported, Sprint 2) |
| 4 | Total effort scoped to sprint duration | ✅ (6 M-eq fits 2 weeks) |
| 5 | SPRINT.md populated with all items | ✅ |
| 6 | No unresolved blockers from previous sprint | ✅ (Sprint 0 clean) |

**Gate 6 Result: 🟡 CONDITIONAL — R1+R2 can proceed; R3 migration run blocked until Supabase keys present in `app/.env.local`.**

---

## Blockers

### Supabase keys
- **Description:** `app/.env.local` needs `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` before R3 backend can run migrations or test auth flows
- **Owner:** User (keys from Supabase dashboard → Settings → API)
- **Target resolution:** Before R3 build round starts
