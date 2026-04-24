# Current Sprint

*Sprint 1 — Foundation: Auth + Trips + Itinerary skeleton.*

**Start date:** 2026-04-24
**Target duration:** 2 weeks (approx.)
**Total effort:** 6 × M + 1 × S ≈ 6 M-equivalents

---

## Active Items

### [B-001] Auth — Sign up
- **Tier**: Full
- **Status**: architecture ✅ → ready for R3 build (blocked on Supabase keys)
- **Assigned To**: [backend-engineer] + [frontend-engineer] (R3)
- **Blockers**: Supabase anon + service-role keys in `app/.env.local` (owner: user)
- **Feature Context**: New-user sign-up with email/password, rate-limited, Supabase Auth + `profiles` row on confirmation.
- **Handoff Notes**: R2 spec in `docs/architecture/sprint-1-build-spec.md`. Migration 0001 covers `profiles`. Rate-limit in-memory for Sprint 1 (Upstash Phase B).
- **Files Changed**: `app/supabase/migrations/0001_init.sql`

### [B-002] Auth — Sign in
- **Tier**: Full
- **Status**: architecture ✅ → ready for R3
- **Assigned To**: [backend-engineer] + [frontend-engineer]
- **Blockers**: Supabase keys
- **Feature Context**: Sign-in with generic-error message, session creation, rate limit + lockout.
- **Handoff Notes**: Shares auth form component with B-001.

### [B-003] Auth — Sign out & password reset
- **Tier**: Fast Track (S — but auth-touching, so [solution-architect] review done)
- **Status**: architecture ✅ → ready for R3
- **Assigned To**: [backend-engineer] + [frontend-engineer]
- **Blockers**: Supabase keys
- **Feature Context**: Sign-out clears cookie; forgot-password triggers Supabase reset email.

### [B-004] Trips CRUD
- **Tier**: Full
- **Status**: architecture ✅ → ready for R3
- **Assigned To**: [backend-engineer] + [frontend-engineer]
- **Blockers**: Supabase keys
- **Feature Context**: Create/list/edit/delete trips; `trips` + auto-seed owner `trip_members` trigger; date-range validation; name-typed delete confirm.
- **Handoff Notes**: Auto-generates `trip_days` on create/edit (shared with B-005).

### [B-005] Trip days — day view
- **Tier**: Full
- **Status**: architecture ✅ → ready for R3 (depends on B-004)
- **Assigned To**: [backend-engineer] + [frontend-engineer]
- **Blockers**: Supabase keys, B-004
- **Feature Context**: `/trips/[id]/itinerary` lists `trip_days`; inline-editable day title; empty-state CTA.

### [B-006] Itinerary items CRUD
- **Tier**: Full
- **Status**: architecture ✅ → ready for R3 (depends on B-005)
- **Assigned To**: [backend-engineer] + [frontend-engineer]
- **Blockers**: Supabase keys, B-005
- **Feature Context**: Typed items (transport/lodging/activity/meal/note) with time, cost, currency, notes. Server sets `trip_id` + `day_id` from URL.

### [B-018] Session protection & route guards
- **Tier**: Fast Track (S)
- **Status**: architecture ✅ → ready for R3
- **Assigned To**: [backend-engineer]
- **Blockers**: Supabase keys
- **Feature Context**: Middleware + server-side session guards on all `/trips/**` routes; 401 JSON for API, redirect for pages.

---

## Completed This Sprint

*(none yet)*

---

## Execution Plan (simplified pipeline)

### Phase 1 — R1 Definition ✅
[product-manager] stories + ACs complete in BACKLOG.md.

### Phase 2 — R2 Architecture ✅
[solution-architect] delivered `0001_init.sql`, `docs/architecture/sprint-1-build-spec.md`, RLS policies, API contracts.

### Phase 3 — R3 Build (BLOCKED on Supabase keys)
- [backend-engineer] — migration + API routes + Supabase client helpers + validations + session guards
- [frontend-engineer] — auth pages, trips list + detail, day view, item form, route guards
- Run in parallel once keys land.

### Phase 4 — R4 Review
[code-reviewer] + [security-reviewer] in parallel.

### Phase 5 — R5 Testing
[test-engineer] → [tester] UAT.

### Phase 6 — Sprint Close
Gate 4 checklist → [release-manager] release → archive.

---

## Gate 6 — Sprint 1 Readiness Check

| # | Check | Status |
|---|-------|--------|
| 1 | All items have user story + AC | ✅ |
| 2 | Priority + effort + dependencies assigned | ✅ |
| 3 | External dependencies confirmed | 🔄 Supabase keys pending · Places key ready (Sprint 2) |
| 4 | Total effort scoped to sprint duration | ✅ |
| 5 | SPRINT.md populated with all items | ✅ |
| 6 | No unresolved blockers from previous sprint | ✅ |

**Gate 6 Result: 🟡 CONDITIONAL — R1+R2 done; R3 blocked on Supabase keys.**

---

## Blockers

### Supabase keys
- **Description:** `app/.env.local` needs `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` before R3 backend can run migrations or test auth flows.
- **Owner:** User (Supabase dashboard → Settings → API)
- **Target resolution:** Before R3 build starts
