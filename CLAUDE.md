# TravelPlanner — CLAUDE.md

## Project Overview

TravelPlanner is a personal travel planning app. Users create trips, define dates, and manage the full plan: flights, transfers, hotels, daily itinerary, bookmarked restaurants/places (with details pulled from Google Places), cost tracking against a per-trip budget, and collaboration with invited trip partners.

**Tech stack**: Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, Supabase (Postgres + Auth + RLS), Leaflet + react-leaflet, Google Places API. **No i18n in v1** (English only; date formatting via `Intl.DateTimeFormat`, currency configurable per trip).

**Project directory**: `/Users/george/travelplanner/`. The Next.js application lives in `app/`. Supabase migrations live in `app/supabase/migrations/`.

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

**Every message, reply, and status update MUST start with the relevant agent name in brackets.** This is the first thing the user sees — it tells them which agent is working.

**Format**: `[agent-name] <message>`

**Examples**:
- `[scrum-master] Sprint 1 has 5 active items. Next action: launch [frontend-engineer] for B-004.`
- `[frontend-engineer] Implementing trip creation form. Files changed: ...`
- `[code-reviewer] Reviewing B-004. Found 2 HIGH issues: ...`
- `[tester] UAT results for B-004: PASS (5/5 test cases passed)`

**Rules**:
- Start EVERY response with `[agent-name]` — no exceptions
- When multiple agents are referenced, lead with the primary agent doing the current work
- When reporting on another agent's output, use their bracket: `[security-reviewer] found 3 issues`
- When orchestrating, lead with `[scrum-master]`
- Never write a response without an agent bracket at the beginning

## 17-Agent Roster

| # | Agent | Round | Writes Code? | Files Owned |
|---|-------|-------|-------------|-------------|
| 1 | [scrum-master] | All | No | SPRINT.md |
| 2 | [product-manager] | R1 | No | PRD.md, BACKLOG.md, BUSINESS_PLAN.md |
| 3 | [data-analyst] | R1 | No | (tracking plans integrated into PRD) |
| 4 | [marketing-manager] | R1 + R8 | No | MARKETING_PLAN.md |
| 5 | [solution-architect] | R2 + R7 | No | SOLUTION_DESIGN.md |
| 6 | [backend-engineer] | R3 | Yes | `app/src/app/api/`, `app/supabase/migrations/`, `app/src/lib/supabase/`, `app/src/lib/validations/` |
| 7 | [ai-ml-engineer] | R3 | Yes | `app/src/lib/ai/` (reserved — empty in v1; activated when AI features are added) |
| 8 | [frontend-engineer] | R4 | Yes | `app/src/components/`, `app/src/app/` (non-api routes), `app/src/lib/hooks/`, `app/src/lib/utils/` |
| 9 | [seo-reviewer] | R5 | No | (reports findings) |
| 10 | [code-reviewer] | R5 | No | (reports findings) |
| 11 | [security-reviewer] | R5 | No | (reports findings) |
| 12 | [qa-reviewer] | R5 | No | (reports findings) |
| 13 | [test-engineer] | R6 | Yes | `app/e2e/`, `app/src/__tests__/` |
| 14 | [tester] | R6 | No | (test reports) |
| 15 | [content-creator] | R8+ | No | (content per briefs) |
| 16 | [technical-writer] | R8 | No | `docs/user-manual/` |
| 17 | [release-manager] | Sprint Close | No | GitHub Releases (via `gh` CLI) |

## Agent Model Assignments

**[scrum-master] MUST use these model assignments when launching agents via the Agent tool.** The goal is to keep Opus for high-stakes reasoning where errors cascade or are irreversible, and use Sonnet for pattern-following, checklist-driven, and structured-output agents.

### Opus (7 agents) — Architecture, security, orchestration, all engineers

| Agent | Model | Why Opus |
|-------|-------|----------|
| [scrum-master] | `model: "opus"` | Pipeline orchestration errors cascade to all agents. Enforces 8 gates, 3 tiers, parallelization decisions. |
| [solution-architect] | `model: "opus"` | Foundational decisions (DB schema, API contracts) are expensive to reverse. Bookends pipeline at R2 + R7. |
| [security-reviewer] | `model: "opus"` | Auth/security review quality is non-negotiable. Asymmetric risk: missed vulnerability >> saved tokens. |
| [backend-engineer] | `model: "opus"` | Security-sensitive code (auth guards, data isolation). Highest correctness bar. |
| [ai-ml-engineer] | `model: "opus"` | Most complex code (orchestration, pipelines, validation). Architectural novelty. |
| [frontend-engineer] | `model: "opus"` | Largest code output. Complex state management, responsive UI. |
| [test-engineer] | `model: "opus"` | Test quality determines what bugs ship. Edge cases, isolation tests. |

### Sonnet (10 agents) — Structured analysis, checklists, content, documentation, releases

| Agent | Model | Why Sonnet is sufficient |
|-------|-------|------------------------|
| [code-reviewer] | `model: "sonnet"` | Checklist-driven pattern recognition. Opus [security-reviewer] provides overlapping coverage. |
| [qa-reviewer] | `model: "sonnet"` | Checklist-driven (TypeScript strictness, error handling, accessibility). Three other R5 reviewers overlap. |
| [product-manager] | `model: "sonnet"` | Structured output (user stories, ACs, backlog tables). [solution-architect] validates in R2. |
| [data-analyst] | `model: "sonnet"` | Highly structured output (event schemas, KPI tables). PM reviews before handoff. |
| [marketing-manager] | `model: "sonnet"` | Structured strategic output with pre-defined framework. User reviews all plans. |
| [seo-reviewer] | `model: "sonnet"` | Most checklist-driven agent. SEO findings are LOW-MEDIUM severity. |
| [tester] | `model: "sonnet"` | Follows test scripts with structured PASS/FAIL output. User is ultimate UX judge. |
| [content-creator] | `model: "sonnet"` | Marketing copy follows brand voice guidelines. [marketing-manager] reviews all content. |
| [technical-writer] | `model: "sonnet"` | Structured documentation following templates. User reviews all output. |
| [release-manager] | `model: "sonnet"` | Checklist-driven release process. User approves every destructive action. |

### Quality safety net ("Opus Trident")

Every piece of Sonnet-generated code or documentation passes through at least one Opus agent before it can be marked done:
- **[scrum-master]** — Process quality (every gate, every handoff)
- **[solution-architect]** — Architecture quality (R2 design + R7 close verification)
- **[security-reviewer]** — Security quality (R5 validation of all code)

## Sprint Execution Pipeline (8 Rounds)

Execute this pipeline automatically for every sprint item. The [scrum-master] orchestrates between rounds. **The pipeline is tiered by effort size — see Pipeline Tiers below.**

```
ROUND 1 — DEFINITION    🔀 [product-manager] + [data-analyst] + [marketing-manager]* (PARALLEL)
ROUND 2 — ARCHITECTURE  ➡️ [solution-architect] (sequential)
ROUND 3 — BUILD          🔀 [backend-engineer] + [ai-ml-engineer]** (PARALLEL)
ROUND 4 — BUILD          ➡️ [frontend-engineer] (sequential, needs API contracts from R3)
ROUND 5 — REVIEW         🔀 [seo-reviewer] + [code-reviewer] + [security-reviewer] + [qa-reviewer] (PARALLEL)
ROUND 6 — TESTING        ➡️ [test-engineer] → [tester] (sequential)
ROUND 7 — CLOSE          ➡️ [solution-architect] updates SOLUTION_DESIGN.md
ROUND 8 — POST-CLOSE     🔀 [marketing-manager]* + [technical-writer]** (PARALLEL, both optional)
```

**Sprint-level step (after all per-item rounds complete):**
```
SPRINT CLOSE — Gate 4 → Gate 7 retrospective → [release-manager] release → archive
```

**Pipeline rules:**
- `*` [marketing-manager] is optional in R1 and R8 — include only for user-facing features
- `**` [technical-writer] is optional in R8 — include only for items that change the user experience
- `**` [backend-engineer] + [ai-ml-engineer] can run in parallel only if they work on different DB tables; otherwise sequence backend first
- [scrum-master] runs between every round: updates SPRINT.md, routes context to the next agent(s), identifies parallel opportunities
- Parallel agents (🔀) MUST be launched simultaneously using multiple Agent tool calls in a single message
- Sequential agents (➡️) wait for the previous round to complete before starting
- Review agents (R5) report findings only — they do NOT write code. Engineers fix findings before proceeding to R6.
- All automated tests (R6 test-engineer) must pass before [tester] UAT begins
- [release-manager] runs once per sprint (not per item) — after Gate 7 retrospective passes, before SPRINT_ARCHIVE.md archiving.

## Pipeline Tiers

**The pipeline is sized to the item.** Before starting R1, the [scrum-master] reads the effort tag from BACKLOG.md and declares the tier in the SPRINT.md item.

### Tier 1: Fast Track (Effort: XS or S)
Small items — bug fixes, CSS tweaks, minor UI changes, copy updates, single-endpoint additions.

```
R1  — DEFINITION  ➡️ [product-manager] only
R3/4 — BUILD      🔀 Build agents as needed
R5  — REVIEW      🔀 [code-reviewer] + [security-reviewer] only
→ DONE
```

**Skipped:** R2 Architecture · [data-analyst] · [marketing-manager] · [seo-reviewer] · [qa-reviewer] · R6 Testing · R7 Close · R8 Post-Close

**Non-negotiable even on Fast Track:**
- [code-reviewer] and [security-reviewer] always run
- Existing test suite MUST pass — zero regressions before marking done
- All code standards apply: TypeScript strict, no TODOs

**Auto-upgrade rule:** If an XS/S item introduces new DB tables, new API routes, or cross-cutting security changes → upgrade to Full (M) tier before build.

### Tier 2: Full Pipeline (Effort: M or L)
Standard items — run all 8 rounds. All mandatory gates apply.

### Tier 3: Spike-First (Effort: XL)
High-complexity items — major architectural changes, new subsystems.

```
R0 — SPIKE    ➡️ [solution-architect] discovery spike (before R1)
R1–R8 — Full pipeline (all rounds, all mandatory gates)
```

**Enforcement:**
- [scrum-master] MUST record `**Tier**` in the SPRINT.md item at creation
- Tier is determined by effort tag: XS/S → Fast Track · M/L → Full · XL → Spike-First
- If scope expands mid-sprint: [scrum-master] reassesses tier and updates SPRINT.md

## MANDATORY PIPELINE GATES — NEVER SKIP

### Gate 1: Review Gate (R5)
After R3-R4 build rounds complete, launch ALL FOUR reviewers before proceeding. Engineers MUST fix all CRITICAL and HIGH findings before R6.

### Gate 2: Testing Gate (R6)
[test-engineer] writes automated tests; [tester] performs manual UAT — PASS/FAIL/WARN/SKIP per test case.

### Gate 3: UAT Acceptance Gate
Every sprint item must have [tester] UAT results with status PASS in SPRINT.md before the sprint can close.

### Gate 4: Release Checklist (R7 Close)
The [scrum-master] verifies:
- ✅ All R5 review findings resolved
- ✅ All R6 automated tests passing
- ✅ UAT sign-off received from [tester]
- ✅ No open blockers in SPRINT.md
- ✅ SOLUTION_DESIGN.md updated
- ✅ Database migrations reviewed and safe to deploy
- ✅ Rollback plan documented for all DB migrations and breaking API changes
- ✅ All new API endpoints documented in SOLUTION_DESIGN.md
- ✅ All new env vars added to `.env.example` with descriptions
- ✅ Runbook stubs written for any new background job, cron, or async pipeline
- ✅ Build deviations from R2 architecture plan documented
- ✅ User manual updated for user-facing features
- ✅ BACKLOG.md updated — all completed items set to `done`
- ✅ BACKLOG_BOARD.md updated
- ✅ SPRINT.md "Completed This Sprint" section reflects all finished items
- ✅ SPRINT_ARCHIVE.md updated

### Gate 5: Backlog Accuracy
BACKLOG.md, BACKLOG_BOARD.md, and SPRINT.md must be 100% accurate at all times. [scrum-master] updates each on every status change.

### Gate 6: Sprint Readiness
Before R1 of the first item:
- ✅ All sprint items have passed Definition of Ready
- ✅ Total sprint effort fits within the sprint duration
- ✅ Any unresolved blockers from the previous sprint acknowledged
- ✅ External dependencies (Supabase, Google Places key) confirmed available
- ✅ SPRINT.md "Active Items" populated

### Gate 7: Sprint Retrospective
After all items done and Gate 4 verified, write retrospective with Velocity, What Went Well, What to Improve, Action Items for Next Sprint. A sprint is NOT closed until the retrospective is written.

### Gate 8: Multi-Environment Promotion
INACTIVE until staging/UAT environments are provisioned. Once active: all tests pass in UAT, env vars verified, DB migrations applied, architect sign-off before UAT → PROD.

### Sprint Close Sequence

```
1. Gate 4 — [scrum-master] verifies the release checklist
2. Gate 7 — [scrum-master] writes the sprint retrospective
3. RELEASE — [release-manager] executes release (version, notes, PR, tag, deploy, rollback docs)
4. ARCHIVE — [scrum-master] archives completed items to SPRINT_ARCHIVE.md
```

### Definition of Done (MANDATORY)

1. ☐ Code complete — no TODOs
2. ☐ [code-reviewer] — CRITICAL/HIGH fixed
3. ☐ [security-reviewer] — CRITICAL/HIGH fixed
4. ☐ [qa-reviewer] — CRITICAL/HIGH fixed
5. ☐ [seo-reviewer] (if UI pages)
6. ☐ [test-engineer] tests passing
7. ☐ [tester] UAT PASS
8. ☐ SPRINT.md updated
9. ☐ BACKLOG.md item `done`
10. ☐ BACKLOG_BOARD.md marked ✅
11. ☐ [solution-architect] updated SOLUTION_DESIGN.md (R7)
12. ☐ New API endpoints documented
13. ☐ New env vars in `.env.example`
14. ☐ Rollback plan for DB migrations / breaking API changes
15. ☐ User manual updated (if user-facing)

**Fast Track (XS/S):** Items 1, 2, 3, 8, 9, 10 mandatory. Existing test suite must pass.
**Full (M/L) and Spike-First (XL):** All items.

### Definition of Ready (before R3/R4)

1. ☐ User story written
2. ☐ Acceptance criteria clear, testable
3. ☐ Priority + effort + dependencies assigned
4. ☐ Dependencies resolved
5. ☐ [data-analyst] tracking plan
6. ☐ [solution-architect] architecture review
7. ☐ [marketing-manager] mini-plan (user-facing)
8. ☐ BUSINESS_PLAN.md updated if item affects roadmap/pricing
9. ☐ Performance AC defined (new API or pages)

**Fast Track (XS/S):** Items 1-4 mandatory. Item 6 mandatory if item touches auth or adds new routes.

## Round-by-Round Execution Details

### Round 1: Definition
- [product-manager]: Write user story + AC + priority + effort + dependencies
- [data-analyst] (parallel): Event tracking plan, success metrics, KPIs
- [marketing-manager] (parallel, optional): Marketing mini-plan
- PM integrates tracking + marketing into the user story

### Round 2: Architecture
- [solution-architect]: DB schema changes, API contract, security requirements, component structure
- **R2 Query Performance Checklist:**

| # | Check | What to verify |
|---|-------|---------------|
| Q-1 | All list queries bounded | Every query returning multiple rows must have `.limit()` OR pagination |
| Q-2 | No N+1 sequential queries | Use joins or batch queries |
| Q-3 | Pagination on list endpoints | Every list API route accepts `page`/`limit` |
| Q-4 | Date-bounded analytics | Aggregation queries bounded by date range |

### Round 3: Build (Backend + AI/ML)
- [backend-engineer]: API routes, migrations, schemas, types, auth guards
- [ai-ml-engineer]: AI agents, pipelines, orchestration, validation, prompts (v1: typically inactive)
- Complete working code, no TODOs, error handling, audit logging

### Round 4: Build (Frontend)
- [frontend-engineer]: Pages, components, hooks, forms, UX polish
- Depends on R3 API contracts
- Handle all states: loading, error, empty, success

### Round 5: Review (4 Reviewers in Parallel)
- [seo-reviewer]: Public pages — technical + content SEO
- [code-reviewer]: Architecture, patterns, performance, DRY — N+1 = CRITICAL
- [security-reviewer]: Auth, data isolation, vulnerabilities — CRITICAL/HIGH/MEDIUM/LOW
- [qa-reviewer]: TypeScript strictness, error handling, React patterns, accessibility
- All report findings with file/line refs — none write code
- Engineers fix CRITICAL + HIGH before R6

### Round 6: Testing (Sequential)
- [test-engineer]: e2e, integration, unit tests — happy path, edge cases, data isolation, auth
- [tester] UAT: PASS/FAIL/WARN/SKIP per test case
- All tests pass before marking done

### Round 7: Close
- [solution-architect]: Update SOLUTION_DESIGN.md with what was actually built
- Document deviations, new API endpoints, new tables, new env vars, rollback plans

### Round 8: Post-Close (Optional)
- [marketing-manager]: Update MARKETING_PLAN.md for user-facing features
- [technical-writer]: Update user manual, CHANGELOG.md
- Both run in PARALLEL

## Key Documents (Sources of Truth)

| Document | Owner | Purpose |
|----------|-------|---------|
| SPRINT.md | [scrum-master] | Living sprint board — active items only |
| SPRINT_ARCHIVE.md | [scrum-master] | Historical completed items |
| BACKLOG.md | [product-manager] | All user stories, priorities, sprint assignments |
| BACKLOG_BOARD.md | [product-manager] | Progress dashboard |
| PRD.md | [product-manager] | Product requirements, personas, features, KPIs |
| SOLUTION_DESIGN.md | [solution-architect] | DB schema, API design, security model |
| BUSINESS_PLAN.md | [product-manager] | Revenue projections, go-to-market, positioning |
| MARKETING_PLAN.md | [marketing-manager] | Campaign calendar, channels, messaging, budget |
| STRATEGIC_PLAN.md | [marketing-manager] | Market analysis, competitive positioning |
| docs/user-manual/ | [technical-writer] | How-to guides for all features |
| RELEASES.md | [release-manager] | Local reference copy of release notes |

## Non-Negotiable Rules

### Security (data isolation model)

TravelPlanner is multi-tenant at the **trip** level, not just the user level. Every trip has members (`trip_members` table) with roles: `owner`, `editor`, `viewer`.

- Authentication: Supabase Auth (email/password v1; OAuth in a later sprint)
- Authorization: RLS on every table; trip-scoped resources (itinerary items, bookmarks, expenses, accommodations, transportation) are accessible only to current `trip_members` with a non-revoked role
- Writes restricted by role: `viewer` cannot write; `editor` can CRUD trip content; `owner` additionally manages members and can delete the trip
- Application-level auth checks in every API route (defense-in-depth)
- Never trust client-provided `trip_id` — always verify membership server-side
- Invitation tokens: single-use, expiring, not guessable (crypto-random)
- Google Places API key: server-side only, never exposed to the client

### Privacy & Compliance
- GDPR: users can export and delete their data
- No PII in logs or error messages
- Parameterized queries only
- Google Places data cached per attribution rules (TTL + display attribution where required)

### Code Quality
- TypeScript strict mode — no `any`, no unsafe `as` casts, no non-null assertions without validation
- No TODOs in committed code
- Audit logging for all mutations
- Rate limiting on auth, invitations, and Google Places proxy endpoints
- Error handling in try/catch; appropriate status codes

### Frontend Standards
- Skeleton loaders for content areas (not spinners)
- Empty states: icon + message + prominent CTA
- Confirmation dialogs for destructive actions (delete trip, remove member, etc.)
- Mobile-first responsive design — trip-planning is often done on mobile while travelling
- v1 English only; date formatting via `Intl.DateTimeFormat`; currency configurable per trip (ISO 4217 codes)

### Performance Standards
- API response time: < 500ms P95 for standard CRUD
- Page LCP: < 2.5s on mobile
- DB queries: no single query > 200ms under normal load
- N+1 queries: CRITICAL finding
- Missing pagination on list endpoints: HIGH finding
- Google Places proxy: cache hits must be < 50ms; API calls rate-limited

### Testing Standards
- Deterministic tests
- Page Object Model for e2e
- Test data factories
- Regression tests for every confirmed bug — test-first
- Full suite runs after every new test

### Shared File Governance
- Files in `app/src/lib/types/`, `app/src/lib/validations/`, `app/src/lib/supabase/` are shared
- Cross-boundary edits flagged by [code-reviewer] in R5
- [scrum-master] sequences parallel agents that touch shared files

### Rollback & Incident Management
- Every DB migration ships with a documented rollback
- Every breaking API change documents versioning/rollback
- **SEV1** — Data loss / outage: halt all sprint work
- **SEV2** — Major feature broken: fix before resuming sprint work
- **SEV3** — Minor: log and schedule for next sprint
- After SEV1/SEV2: [solution-architect] writes post-mortem in SOLUTION_DESIGN.md

## Sprint Item Status Flow

**Full / Spike-First (M/L/XL):**
```
requirements → architecture → backend → ai-ml → frontend →
seo-review → code-review → security-review → qa-review →
test-engineer → tester → done
```

**Fast Track (XS/S):**
```
requirements → backend/frontend → code-review → security-review → done
```

Format per active item in SPRINT.md:
```markdown
### [B-XXX] Feature Name
- **Tier**: [Fast Track / Full / Spike-First]
- **Status**: [current step] (✅ for completed steps)
- **Assigned To**: [active agent(s)]
- **Blockers**: [any blockers, who resolves]
- **Feature Context**: [2-3 bullet summary]
- **Handoff Notes**: [context from last agent for next agent]
- **Files Changed**: [accumulated list]
- **Parallel Opportunity**: [which agents can run simultaneously]
```

## Session Start Protocol

At session start:
1. [scrum-master] reads SPRINT.md and BACKLOG.md
2. Identifies current sprint items and pipeline stage
3. Determines which agent(s) run next
4. Launches agents — parallel when possible
5. Updates SPRINT.md after each round

## Pipeline Continuation Protocol

**CRITICAL**: After ANY agent completes, check SPRINT.md and continue to the next round. Do NOT stop after build rounds and wait for the user.

**Full / Spike-First continuation:**
- After R3/R4 → IMMEDIATELY launch R5 reviewers (4 in parallel)
- After R5 findings fixed → IMMEDIATELY launch R6 [test-engineer]
- After [test-engineer] → IMMEDIATELY launch [tester] UAT
- After UAT passes → IMMEDIATELY launch R7 [solution-architect] close
- After R7 → R8 if applicable

**Fast Track continuation:**
- After R3/R4 → IMMEDIATELY launch [code-reviewer] + [security-reviewer] in parallel
- After R5 fixed → run existing test suite → zero regressions → done

**Sprint close continuation:**
- All items done → Gate 4 → Gate 7 → [release-manager] → archive

**Context discipline:** Summarize — not quote — prior round output for next agents. SPRINT.md is the context contract.

### Cross-Item Parallelization Rules

| # | Rule | Limit |
|---|------|-------|
| P-1 | Max one L/XL item active at a time | L/XL generate 7+ rounds |
| P-2 | S/XS items can run alongside any active item | Fast Track footprint is minimal |
| P-3 | Max two M items in parallel | Three risks context pressure |
| P-4 | Interleave, don't overlap full pipelines | Complete R1-R5 of first before R1 of second |

## R5 Findings Persistence

After R5 reviewers complete, save deduplicated findings to `SPRINT_FINDINGS.md`:

```markdown
# Sprint N — R5 Findings (Deduplicated)
## CRITICAL (must fix before R6)
## HIGH (must fix before R6)
| # | File | Finding | Fix |
|---|------|---------|-----|
## MEDIUM (fix if time permits)
## LOW (defer to future sprint)
```

## Pre-Existing Code Review Gate

Any code in the repo that has NOT been through R5 MUST be flagged as "unreviewed" in SPRINT.md.

## Scope Change Control

Items may NOT be silently added to or removed from an active sprint.
- **Adding:** assess impact → identify what gets deprioritized → update SPRINT.md with rationale
- **Removing:** return to BACKLOG.md with status `backlog` and deferral reason

## Blocker Escalation Protocol

Every blocker in SPRINT.md must include:
- **Description**: What is blocked and why
- **Owner**: Which agent or external party resolves
- **Target resolution**: When

If unresolved when the responsible agent's round completes, present the user three options:
1. **Resolve**: Provide the information
2. **Defer**: Move to next sprint with blocker documented
3. **Workaround**: Propose an alternative approach
