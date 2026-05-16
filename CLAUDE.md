# TravelPlanner — CLAUDE.md

## Project Overview

TravelPlanner is a personal travel planning app. Users create trips, define dates, and manage the full plan: flights, transfers, hotels, daily itinerary, bookmarked restaurants/places (with details pulled from Google Places), cost tracking against a per-trip budget, and collaboration with invited trip partners.

**Tech stack**: Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, Supabase (Postgres + Auth + RLS), Leaflet + react-leaflet, Google Places API. **No i18n in v1** (English only; date formatting via `Intl.DateTimeFormat`, currency configurable per trip).

**Project directory**: `/Users/george/travelplanner/`. The Next.js application lives in `app/`. Supabase migrations live in `app/supabase/migrations/`.

**Personal-project scope**: No analytics/tracking, no marketing/SEO/content, no user manual. Single environment (Vercel production). The user is the sole user and the sole UAT tester.

**Public/private split**: The public repo (`geopap/travelplanner`) holds the app, schema, PRD, and SOLUTION_DESIGN. Personal planning/operations docs — `SPRINT.md`, `SPRINT_ARCHIVE.md`, `BACKLOG.md`, `app/docs/uat/sprint-*` — live in the private companion repo `geopap/travelplanner-private`, cloned locally into `./private/` (gitignored). **All references to those filenames in this document refer to `private/<filename>`** (e.g. "update SPRINT.md" means `private/SPRINT.md`). Agents read/write them only via the `private/` path.

## Git

When using git, always use `/usr/bin/git` (system git) instead of Homebrew git to avoid libcurl compatibility issues. If `git push` fails with a curl error, immediately fall back to `/usr/bin/git push` or `gh` CLI without asking.

Remote: `https://github.com/geopap/travelplanner.git`. Branches: `main` (production), `develop` (integration), `feature/B-XXX-description` for work.

## Debugging

When debugging, investigate all potential causes before applying a fix. Don't assume the first issue found is the only one — check for cascading problems (missing env vars, missing seed data, incorrect headers, type mismatches). List ALL potential causes, then propose a fix plan.

## Sprint Workflow

Never start sprint execution or launch agents until the user explicitly says to proceed. Planning and execution are separate phases — wait for approval between them.

## General Rules

Always confirm you are reading files from the correct project directory before reporting status or making changes. Check the current working directory first.

## Agent Bracket Notation — MANDATORY

**Every message, reply, and status update MUST start with the relevant agent name in brackets.**

**Format**: `[agent-name] <message>`

**Rules**:
- Start EVERY response with `[agent-name]` — no exceptions
- When reporting on another agent's output, use their bracket: `[security-reviewer] found 3 issues`
- When orchestrating, lead with `[scrum-master]`

## 10-Agent Roster

| # | Agent | Round | Writes Code? | Files Owned |
|---|-------|-------|-------------|-------------|
| 1 | [scrum-master] | All | No | SPRINT.md |
| 2 | [product-manager] | R1 | No | PRD.md, BACKLOG.md |
| 3 | [solution-architect] | R2 | No | SOLUTION_DESIGN.md |
| 4 | [backend-engineer] | R3 | Yes | `app/src/app/api/`, `app/supabase/migrations/`, `app/src/lib/supabase/`, `app/src/lib/validations/` |
| 5 | [frontend-engineer] | R3 | Yes | `app/src/components/`, `app/src/app/` (non-api), `app/src/lib/hooks/`, `app/src/lib/utils/` |
| 6 | [code-reviewer] | R4 | No | (findings) |
| 7 | [security-reviewer] | R4 | No | (findings) |
| 8 | [test-engineer] | R5 | Yes | `app/e2e/`, `app/src/__tests__/` |
| 9 | [tester] | R5 | No | (UAT reports) |
| 10 | [release-manager] | Sprint Close | No | GitHub Releases via `gh` |

## Agent Model Assignments

**[scrum-master] MUST use these model assignments when launching agents.**

### Opus (6 agents) — Architecture, security, all engineers
- [scrum-master] — pipeline orchestration
- [solution-architect] — schema + API contracts
- [security-reviewer] — auth/RLS correctness
- [backend-engineer] — auth guards, data isolation
- [frontend-engineer] — state, responsive UI
- [test-engineer] — edge cases, isolation tests

### Sonnet (4 agents) — Structured output, checklists
- [product-manager] — user stories, ACs, backlog
- [code-reviewer] — checklist-driven review (TS strict, patterns, perf, a11y — absorbs former qa-reviewer scope)
- [tester] — scripted UAT PASS/FAIL
- [release-manager] — checklist-driven release

## Sprint Execution Pipeline (5 Rounds)

Execute this pipeline for every sprint item. The [scrum-master] orchestrates.

```
R1 — DEFINITION     ➡️ [product-manager]
R2 — ARCHITECTURE   ➡️ [solution-architect]  (skipped on Fast Track)
R3 — BUILD           🔀 [backend-engineer] + [frontend-engineer]  (parallel when API contracts stable; else backend first)
R4 — REVIEW          🔀 [code-reviewer] + [security-reviewer]  (parallel)
R5 — TESTING        ➡️ [test-engineer] → [tester]
```

**Sprint-level step (after all items complete):**
```
SPRINT CLOSE — Gate 4 release checklist → [release-manager] release → archive
```

**Rules:**
- [solution-architect] updates SOLUTION_DESIGN.md **inline during R2 and at sprint close** (no separate R7).
- Parallel agents (🔀) launched simultaneously via multiple Agent tool calls in one message.
- Review agents report findings only — engineers fix CRITICAL/HIGH before R5.
- All automated tests pass before [tester] UAT.
- [release-manager] runs once per sprint.

## Pipeline Tiers

**Sized to the item.** [scrum-master] declares tier in SPRINT.md before R1.

### Tier 1: Fast Track (XS/S) — DEFAULT
Bug fixes, CSS tweaks, copy updates, single-endpoint additions.

```
R1 — [product-manager]
R3 — Build
R4 — [code-reviewer] + [security-reviewer]
R5 — [tester] smoke (skip test-engineer unless logic-heavy)
→ DONE
```

**Skipped:** R2 architecture, test-engineer (unless new logic paths).
**Non-negotiable:** code-reviewer + security-reviewer always run. Existing test suite must pass.
**Auto-upgrade:** If item adds DB tables, new API routes, or cross-cutting auth changes → upgrade to Full.

### Tier 2: Full Pipeline (M/L)
All 5 rounds, all mandatory gates.

### Tier 3: Spike-First (XL)
R0 discovery spike by [solution-architect] → then Full.

**Enforcement:**
- `**Tier**` recorded in SPRINT.md at item creation.
- XS/S → Fast Track · M/L → Full · XL → Spike-First.

## MANDATORY PIPELINE GATES

### Gate 1: Review (R4)
Launch both reviewers in parallel after build. Engineers fix all CRITICAL and HIGH before R5.

### Gate 2: Testing (R5)
[test-engineer] writes automated tests; [tester] performs UAT — PASS/FAIL/WARN/SKIP per case.

### Gate 3: UAT Acceptance
Every sprint item must have [tester] UAT status PASS in SPRINT.md before sprint can close.

### Gate 4: Release Checklist (Sprint Close)
[scrum-master] verifies:
- ✅ All R4 findings resolved
- ✅ All R5 tests passing + UAT PASS
- ✅ No open blockers
- ✅ SOLUTION_DESIGN.md updated (schema, endpoints, env vars)
- ✅ DB migrations reviewed + rollback documented
- ✅ New env vars added to `.env.example`
- ✅ BACKLOG.md items set to `done`
- ✅ SPRINT.md "Completed This Sprint" accurate
- ✅ SPRINT_ARCHIVE.md updated

### Gate 5: Backlog Accuracy
BACKLOG.md and SPRINT.md must be 100% accurate at all times.

### Gate 6: Sprint Readiness
Before R1 of the first item:
- ✅ All items passed Definition of Ready
- ✅ Total effort fits sprint duration
- ✅ External dependencies (Supabase, Google Places) confirmed
- ✅ SPRINT.md "Active Items" populated

### Sprint Close Sequence

```
1. Gate 4 — [scrum-master] verifies release checklist
2. RELEASE — [release-manager] executes release (version, notes, PR, tag, deploy)
3. ARCHIVE — [scrum-master] archives to SPRINT_ARCHIVE.md
4. MIGRATION NOTICE — [scrum-master] surfaces a clear, prominent "Migrations to apply" list
```

### Migration Notice (mandatory at every sprint close)

After release and archive, the [scrum-master] **must** post a final user-facing notice listing every new migration shipped in the sprint, in numeric apply order, with a one-line purpose per migration. Phrase as a TODO for the user, not a passive note. Do this even if the sprint shipped only one migration. Suggest a `select tablename from pg_tables where schemaname='public'` sanity check so the user can confirm prior-sprint migrations were also applied.

Template:

```
## Migrations to apply (run before using the new build)

Apply these to Supabase in order (CLI `supabase db push` or paste into Studio SQL Editor):

1. `app/supabase/migrations/000X_<name>.sql` — <one-line purpose>
2. `app/supabase/migrations/000Y_<name>.sql` — <one-line purpose>

Sanity check (run after applying):
- `select tablename from pg_tables where schemaname='public' order by tablename;` — expected new tables: <list>
- Expected new RPCs/functions: <list>

Rollbacks live next to each migration as `*_rollback.sql`.
```

### Definition of Done

1. ☐ Code complete — no TODOs
2. ☐ [code-reviewer] — CRITICAL/HIGH fixed
3. ☐ [security-reviewer] — CRITICAL/HIGH fixed
4. ☐ [test-engineer] automated tests passing (Full/Spike tiers)
5. ☐ [tester] UAT PASS
6. ☐ SPRINT.md updated
7. ☐ BACKLOG.md item `done`
8. ☐ SOLUTION_DESIGN.md updated (R2 architect, at close)
9. ☐ New env vars in `.env.example`
10. ☐ Rollback plan for DB migrations / breaking API changes

**Fast Track (XS/S):** Items 1, 2, 3, 5, 6, 7 mandatory. Existing test suite must pass (no regressions).
**Full (M/L) and Spike-First (XL):** All items.

### Definition of Ready (before R3)

1. ☐ User story written
2. ☐ Acceptance criteria clear, testable
3. ☐ Priority + effort + dependencies assigned
4. ☐ Dependencies resolved
5. ☐ [solution-architect] architecture review (Full/Spike tiers)
6. ☐ Performance AC defined (new API or pages)

**Fast Track (XS/S):** Items 1-4 mandatory. Item 5 mandatory if touching auth or new routes.

## Round-by-Round Execution Details

### Round 1: Definition
[product-manager]: user story + AC + priority + effort + dependencies.

### Round 2: Architecture
[solution-architect]: DB schema changes, API contract, security requirements, component structure.
**R2 Query Performance Checklist:**
| # | Check |
|---|-------|
| Q-1 | All list queries bounded (`.limit()` or pagination) |
| Q-2 | No N+1 sequential queries (joins or batching) |
| Q-3 | Pagination on list endpoints (`page`/`limit`) |
| Q-4 | Date-bounded analytics queries |

### Round 3: Build
- [backend-engineer]: API routes, migrations, schemas, types, auth guards.
- [frontend-engineer]: Pages, components, hooks, forms, UX polish. Parallel with backend once API contracts are locked in R2; else sequence backend first.
- Complete working code, no TODOs, error handling, all states (loading/error/empty/success).

### Round 4: Review (Parallel)
- [code-reviewer]: Architecture, patterns, performance, DRY, TypeScript strictness, error handling, React patterns, accessibility. N+1 = CRITICAL.
- [security-reviewer]: Auth, data isolation, vulnerabilities — CRITICAL/HIGH/MEDIUM/LOW.
- Reviewers report findings only. Engineers fix CRITICAL + HIGH before R5.

### Round 5: Testing (Sequential)
- [test-engineer]: e2e, integration, unit tests — happy path, edge cases, data isolation, auth.
- [tester] UAT: PASS/FAIL/WARN/SKIP per test case.
- All tests pass before marking done.

## Key Documents (Sources of Truth)

| Document | Owner | Purpose |
|----------|-------|---------|
| SPRINT.md | [scrum-master] | Living sprint board — active items only |
| SPRINT_ARCHIVE.md | [scrum-master] | Historical completed items |
| BACKLOG.md | [product-manager] | All user stories, priorities, sprint assignments |
| PRD.md | [product-manager] | Product requirements, personas, features |
| SOLUTION_DESIGN.md | [solution-architect] | DB schema, API design, security model |
| RELEASES.md | [release-manager] | Local reference copy of release notes |

## Non-Negotiable Rules

### Security (data isolation model)

TravelPlanner is multi-tenant at the **trip** level. Every trip has members (`trip_members`) with roles: `owner`, `editor`, `viewer`.

- Authentication: Supabase Auth (email/password v1; OAuth later).
- Authorization: RLS on every table; trip-scoped resources accessible only to current `trip_members`.
- Writes restricted by role: `viewer` cannot write; `editor` can CRUD trip content; `owner` manages members and can delete the trip.
- Application-level auth checks in every API route (defense-in-depth).
- Never trust client-provided `trip_id` — always verify membership server-side.
- Invitation tokens: single-use, expiring, crypto-random.
- Google Places API key: server-side only.

### Privacy & Compliance
- Users can export and delete their data.
- No PII in logs or error messages.
- Parameterized queries only.
- Google Places data cached per attribution rules (TTL + attribution where required).

### Code Quality
- TypeScript strict mode — no `any`, no unsafe `as` casts, no non-null assertions without validation.
- No TODOs in committed code.
- Audit logging for all mutations.
- Rate limiting on auth, invitations, and Google Places proxy endpoints.
- Error handling in try/catch; appropriate status codes.

### Frontend Standards
- Skeleton loaders for content areas (not spinners).
- Empty states: icon + message + prominent CTA.
- Confirmation dialogs for destructive actions.
- Mobile-first responsive design.
- v1 English only; date formatting via `Intl.DateTimeFormat`; currency configurable per trip (ISO 4217).

### Performance Standards
- API response time: < 500ms P95 for standard CRUD.
- Page LCP: < 2.5s on mobile.
- DB queries: no single query > 200ms under normal load.
- N+1 queries: CRITICAL finding.
- Missing pagination on list endpoints: HIGH finding.
- Google Places proxy: cache hits < 50ms; API calls rate-limited.

### Testing Standards
- Deterministic tests.
- Page Object Model for e2e.
- Test data factories.
- Regression tests for every confirmed bug — test-first.
- Full suite runs after every new test.

### Shared File Governance
Files in `app/src/lib/types/`, `app/src/lib/validations/`, `app/src/lib/supabase/` are shared. Cross-boundary edits flagged by [code-reviewer] in R4. [scrum-master] sequences parallel agents that touch shared files.

### Rollback & Incident Management
- Every DB migration ships with a documented rollback.
- Every breaking API change documents versioning/rollback.
- **SEV1** — Data loss/outage: halt sprint work.
- **SEV2** — Major feature broken: fix before resuming.
- **SEV3** — Minor: log and schedule.
- After SEV1/SEV2: [solution-architect] writes post-mortem in SOLUTION_DESIGN.md.

## Sprint Item Status Flow

**Full / Spike-First (M/L/XL):**
```
requirements → architecture → backend → frontend →
code-review → security-review → test-engineer → tester → done
```

**Fast Track (XS/S):**
```
requirements → backend/frontend → code-review → security-review → tester-smoke → done
```

Format per active item in SPRINT.md:
```markdown
### [B-XXX] Feature Name
- **Tier**: [Fast Track / Full / Spike-First]
- **Status**: [current step]
- **Assigned To**: [active agent(s)]
- **Blockers**: [any, owner]
- **Feature Context**: [2-3 bullets]
- **Handoff Notes**: [context for next agent]
- **Files Changed**: [accumulated list]
- **Parallel Opportunity**: [which agents can run simultaneously]
```

## Session Start Protocol

1. [scrum-master] reads SPRINT.md and BACKLOG.md.
2. Identifies current sprint items and pipeline stage.
3. Determines which agent(s) run next.
4. Launches agents — parallel when possible.
5. Updates SPRINT.md after each round.

## Pipeline Continuation Protocol

**CRITICAL**: After ANY agent completes, check SPRINT.md and continue to the next round. Do NOT stop after build rounds and wait for the user (unless there's an external blocker).

**Full / Spike-First continuation:**
- After R3 build → IMMEDIATELY launch R4 reviewers in parallel
- After R4 findings fixed → IMMEDIATELY launch R5 [test-engineer]
- After [test-engineer] → IMMEDIATELY launch [tester] UAT
- After UAT PASS → update SOLUTION_DESIGN.md and mark item done

**Fast Track:**
- After R3 → IMMEDIATELY launch [code-reviewer] + [security-reviewer]
- After fixes → existing test suite → zero regressions → tester smoke → done

**Sprint close:**
- All items done → Gate 4 → [release-manager] → archive

**Context discipline:** Summarize — don't quote — prior round output. SPRINT.md is the context contract.

### Cross-Item Parallelization Rules

| # | Rule |
|---|------|
| P-1 | Max one L/XL item active at a time |
| P-2 | S/XS items can run alongside any active item |
| P-3 | Max two M items in parallel |
| P-4 | Interleave, don't overlap full pipelines |

## R4 Findings Persistence

After R4 reviewers complete, findings are tracked inline in SPRINT.md under the item's Handoff Notes (no separate file — personal project). Format:

```markdown
**R4 Findings:**
- CRITICAL: [file:line] description → fix owner
- HIGH: [file:line] description → fix owner
- MEDIUM/LOW: deferred
```

## Pre-Existing Code Review Gate

Any code in the repo not through R4 must be flagged as "unreviewed" in SPRINT.md.

## Scope Change Control

Items may NOT be silently added to or removed from an active sprint.
- **Adding:** assess impact → identify what gets deprioritized → update SPRINT.md.
- **Removing:** return to BACKLOG.md with status `backlog` and deferral reason.

## Blocker Escalation Protocol

Every blocker in SPRINT.md must include Description, Owner, Target resolution.

If unresolved when the responsible agent's round completes, present three options:
1. **Resolve**: Provide the information
2. **Defer**: Move to next sprint
3. **Workaround**: Propose an alternative
