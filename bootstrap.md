# Cook&Go — Project Bootstrap

> **Purpose**: One-shot bootstrapping guide to initialize the Cook&Go project with a 17-agent team, 8-round sprint pipeline, 8 mandatory quality gates, and full document structure.
>
> **How to use**: Follow the Bootstrap Checklist (Section 4) step by step. Section 2 contains the complete `CLAUDE.md` template — copy it as-is and customize the `[PLACEHOLDER]` fields. Section 3 contains skeleton templates for all project documents.

---

# Table of Contents

1. [Project Overview](#1-project-overview)
2. [CLAUDE.md Template](#2-claudemd-template)
3. [Document Templates](#3-document-templates)
4. [Bootstrap Checklist](#4-bootstrap-checklist)

---

# 1. Project Overview

- **Product**: Cook&Go — Product management platform for managing the Cook&Go mobile and web app
- **Project directory**: `/Users/george/cookandgo/`
- **Tech stack**: `[TO BE DEFINED — fill in during Sprint 0]`

---

# 2. CLAUDE.md Template

> Copy everything between the `--- BEGIN CLAUDE.md ---` and `--- END CLAUDE.md ---` markers into a file named `CLAUDE.md` at the project root. Then search-and-replace all `[PLACEHOLDER]` markers with project-specific values.

--- BEGIN CLAUDE.md ---

```markdown
# Cook&Go — CLAUDE.md

## Project Overview

Cook&Go is a product management platform for managing the Cook&Go mobile and web app. Tech stack: [PLACEHOLDER — e.g., Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui, Supabase, etc.].

## Git

When using git, always use `/usr/bin/git` (system git) instead of Homebrew git to avoid libcurl compatibility issues. If `git push` fails with a curl error, immediately fall back to `/usr/bin/git push` or `gh` CLI without asking.

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
- `[scrum-master] Sprint 0.5b has 4 active items. Next action: launch [frontend-engineer] for B-125.`
- `[frontend-engineer] Implementing i18n framework with next-intl. Files changed: ...`
- `[code-reviewer] Reviewing B-125. Found 2 HIGH issues: ...`
- `[tester] UAT results for B-125: PASS (5/5 test cases passed)`

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
| 6 | [backend-engineer] | R3 | Yes | [PLACEHOLDER — backend code paths, e.g., `app/src/app/api/`, `app/supabase/migrations/`] |
| 7 | [ai-ml-engineer] | R3 | Yes | [PLACEHOLDER — AI/ML code paths, e.g., `app/src/lib/ai/`] |
| 8 | [frontend-engineer] | R4 | Yes | [PLACEHOLDER — frontend code paths, e.g., `app/src/components/`, `app/src/app/`] |
| 9 | [seo-reviewer] | R5 | No | (reports findings) |
| 10 | [code-reviewer] | R5 | No | (reports findings) |
| 11 | [security-reviewer] | R5 | No | (reports findings) |
| 12 | [qa-reviewer] | R5 | No | (reports findings) |
| 13 | [test-engineer] | R6 | Yes | [PLACEHOLDER — test paths, e.g., `app/e2e/`, `app/src/__tests__/`] |
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
- [release-manager] runs once per sprint (not per item) — after Gate 7 retrospective passes, before SPRINT_ARCHIVE.md archiving. See "Sprint Close Sequence" below.

## Pipeline Tiers

**The pipeline is sized to the item.** Before starting R1, the [scrum-master] reads the effort tag from BACKLOG.md and declares the tier in the SPRINT.md item. The tier determines which rounds are mandatory.

### Tier 1: Fast Track (Effort: XS or S)
Small items — bug fixes, CSS tweaks, minor UI changes, copy updates, single-endpoint additions.

```
R1  — DEFINITION  ➡️ [product-manager] only (no data-analyst, no marketing-manager)
R3/4 — BUILD      🔀 Build agents as needed (backend only, frontend only, or both)
R5  — REVIEW      🔀 [code-reviewer] + [security-reviewer] only
→ DONE
```

**Skipped:** R2 Architecture · [data-analyst] · [marketing-manager] · [seo-reviewer] · [qa-reviewer] · R6 Testing (test-engineer + tester UAT) · R7 Close · R8 Post-Close

**Non-negotiable even on Fast Track:**
- [code-reviewer] and [security-reviewer] always run
- Existing test suite MUST pass — zero regressions before marking done
- All code standards apply: TypeScript strict, no TODOs

**Auto-upgrade rule:** If an XS/S item introduces new DB tables, new API routes, or cross-cutting security changes → upgrade to Full (M) tier before build.

### Tier 2: Full Pipeline (Effort: M or L)
Standard items — new features, refactors, multi-component changes, new API endpoints. Run all 8 rounds. All mandatory gates apply.

### Tier 3: Spike-First (Effort: XL)
High-complexity items — major architectural changes, new subsystems, unknowns that require discovery.

```
R0 — SPIKE    ➡️ [solution-architect] discovery spike (before R1)
               Output: feasibility, risk flags, major decisions, sub-item candidates
               Scrum-master reviews — may split item into smaller M/L items before R1
R1–R8 — Full pipeline (all rounds, all mandatory gates)
```

**Enforcement:**
- [scrum-master] MUST record `**Tier**` in the SPRINT.md item at creation
- Tier is determined by effort tag: XS/S → Fast Track · M/L → Full · XL → Spike-First
- If scope expands mid-sprint: [scrum-master] reassesses tier and updates SPRINT.md

## MANDATORY PIPELINE GATES — NEVER SKIP

**These gates are NON-NEGOTIABLE. No sprint item can be marked "done" without passing ALL gates. No exceptions, no shortcuts, no "we'll do it later."**

### Gate 1: Review Gate (R5)
After R3-R4 build rounds complete, you MUST launch ALL FOUR reviewers before proceeding:
- [seo-reviewer] — for any item with new/modified pages
- [code-reviewer] — for ALL items that involve code changes
- [security-reviewer] — for ALL items that involve code changes
- [qa-reviewer] — for ALL items that involve code changes

**Enforcement**: After build rounds complete, the IMMEDIATE next step is ALWAYS to launch the R5 reviewers. Do NOT ask the user "should we run reviews?" — just do it. Engineers MUST fix all CRITICAL and HIGH findings before R6.

### Gate 2: Testing Gate (R6)
After R5 review findings are resolved, you MUST run testing:
- [test-engineer] writes automated tests (e2e, integration, unit)
- [tester] performs manual UAT — PASS/FAIL/WARN/SKIP per test case

**Enforcement**: Do NOT skip testing. Do NOT mark items as done without test results. The [tester] UAT is the final quality gate.

### Gate 3: UAT Acceptance Gate
Before the [scrum-master] can close ANY sprint:
- Every sprint item must have [tester] UAT results recorded in SPRINT.md
- Every item must have UAT status: PASS
- If any item has UAT FAIL on core flows: it goes back to the responsible engineer, NOT to done

### Gate 4: Release Checklist (R7 Close)
The [scrum-master] verifies before closing:
- ✅ All R5 review findings resolved (no open CRITICAL/HIGH issues)
- ✅ All R6 automated tests passing
- ✅ UAT sign-off received from [tester] for every item
- ✅ No open blockers in SPRINT.md
- ✅ SOLUTION_DESIGN.md updated by [solution-architect]
- ✅ Database migrations reviewed and safe to deploy
- ✅ Rollback plan documented for all DB migrations and breaking API changes
- ✅ All new API endpoints documented in SOLUTION_DESIGN.md
- ✅ All new env vars added to `.env.example` with descriptions
- ✅ Runbook stubs written for any new background job, cron, or async pipeline
- ✅ Build deviations from R2 architecture plan documented
- ✅ User manual updated for user-facing features ([technical-writer])
- ✅ BACKLOG.md updated — all completed items set to `done`
- ✅ BACKLOG_BOARD.md updated — progress dashboard, item statuses, and status summary accurate
- ✅ SPRINT.md "Completed This Sprint" section reflects all finished items
- ✅ SPRINT_ARCHIVE.md updated — this sprint's completed items appended
- → If ANY check fails: route back to the responsible agent. Do NOT close the sprint.

### Gate 5: Backlog Accuracy (Every Item + Every Sprint Close)

**BACKLOG.md, BACKLOG_BOARD.md, and SPRINT.md must be 100% accurate at all times.**

**When work starts on an item:**
- [scrum-master] updates BACKLOG.md: item status `backlog` → `in-progress`
- [scrum-master] updates BACKLOG_BOARD.md: item ⬜ → 🔄
- [scrum-master] updates SPRINT.md: item status to current pipeline step

**Per-item rule (after every item is marked "done"):**
- [scrum-master] updates SPRINT.md (move item to "Completed This Sprint" with files changed)
- [scrum-master] updates BACKLOG.md (set item status from `in-progress` → `done`)
- [scrum-master] updates BACKLOG_BOARD.md (set item from 🔄 → ✅)

**Per-sprint rule (before closing any sprint):**
- [scrum-master] verifies ALL three documents are in sync
- Progress dashboard numbers in BACKLOG_BOARD.md match actual completed counts
- Status summary counts (Done / To Do / Icebox) are recalculated and accurate

### Gate 6: Sprint Readiness (Before Starting Any Sprint)

Before [scrum-master] kicks off R1 for the first item:
- ✅ All sprint items have passed Definition of Ready
- ✅ Total sprint effort is confirmed to fit within the sprint duration
- ✅ Any unresolved blockers from the previous sprint are acknowledged
- ✅ External dependencies confirmed available
- ✅ SPRINT.md "Active Items" section populated with all planned items
- ✅ BACKLOG.md items updated to `in-progress` as work begins

### Gate 7: Sprint Retrospective (After Every Sprint Close)

After all items are marked done and Gate 4 is verified:

```markdown
## Sprint Retrospective — Sprint [N]
### Velocity
- Planned: [N] items / [total effort]
- Completed: [N] items / [actual effort]
- Carried over: [N] items (with reason)

### What Went Well
- [Up to 3 bullets]

### What to Improve
- [Up to 3 bullets]

### Action Items for Next Sprint
- [ ] [Concrete improvement, assigned to specific agent or process change]
- [ ] [Max 3 items]
```

**Enforcement**: A sprint is NOT closed until the retrospective is written.

### Gate 8: Multi-Environment Promotion (Activates when staging/UAT env is provisioned)

> **INACTIVE until staging/UAT environments are provisioned. Once active, this gate is mandatory for every deployment.**

Before promoting any build from UAT → PROD:
- ✅ All [test-engineer] automated tests pass in the UAT environment
- ✅ [tester] UAT performed in the actual UAT deployment
- ✅ All environment variables verified in UAT
- ✅ DB migrations applied to UAT and validated
- ✅ [solution-architect] signed off on UAT → PROD promotion checklist

### Sprint Close Sequence

After all sprint items are marked "done":

```
1. Gate 4 — [scrum-master] verifies the release checklist
2. Gate 7 — [scrum-master] writes the sprint retrospective
3. RELEASE — [release-manager] executes the release process:
   a. Pre-flight verification (confirms Gate 4 + Gate 7 passed)
   b. Determines semantic version
   c. Compiles structured release notes from SPRINT.md
   d. Creates PR to main (user approval required before merge)
   e. Tags the release, creates GitHub Release
   f. Syncs develop with main
   g. Verifies deployment
   h. Documents rollback commands
4. ARCHIVE — [scrum-master] archives completed items to SPRINT_ARCHIVE.md
```

**Skip condition**: If a sprint contains zero code changes (documentation/process only), [scrum-master] may skip the release step with an explicit note.

### Definition of Done (MANDATORY for every sprint item)

A sprint item is "done" ONLY when ALL of these are true:
1. ☐ Code complete — no TODOs, no placeholder logic
2. ☐ [code-reviewer] reviewed — CRITICAL/HIGH findings fixed
3. ☐ [security-reviewer] reviewed — CRITICAL/HIGH findings fixed
4. ☐ [qa-reviewer] reviewed — CRITICAL/HIGH findings fixed
5. ☐ [seo-reviewer] reviewed (if item has UI pages)
6. ☐ [test-engineer] automated tests written and passing
7. ☐ [tester] UAT completed with PASS status
8. ☐ SPRINT.md updated with files changed and handoff notes
9. ☐ BACKLOG.md item status set to `done`
10. ☐ BACKLOG_BOARD.md item marked ✅ and progress dashboard updated
11. ☐ [solution-architect] updated SOLUTION_DESIGN.md (R7)
12. ☐ New API endpoints documented
13. ☐ New env vars added to `.env.example` with description
14. ☐ Rollback plan documented for any DB migrations or breaking API changes
15. ☐ User manual updated by [technical-writer] (if user-facing feature)

**Tier-specific DoD exceptions:**
- **Fast Track (XS/S)**: Items 1, 2, 3, 8, 9, 10 are mandatory. Items 4-7, 11-15 are skipped. Run existing test suite and confirm zero regressions.
- **Full (M/L) and Spike-First (XL)**: All items apply — no exceptions.

### Definition of Ready (MANDATORY before build rounds R3/R4)

A sprint item is "ready for build" ONLY when ALL of these are true:
1. ☐ User story written by [product-manager]
2. ☐ Acceptance criteria defined — clear, testable, no ambiguity
3. ☐ Priority (P0-P3) and effort (XS-XL) assigned
4. ☐ Dependencies identified and resolved
5. ☐ [data-analyst] tracking plan — analytics events, success metrics, KPIs defined
6. ☐ [solution-architect] architecture review complete
7. ☐ [marketing-manager] marketing mini-plan (if user-facing feature)
8. ☐ [product-manager] updated BUSINESS_PLAN.md if the feature affects roadmap, pricing, or competitive positioning
9. ☐ Performance acceptance criteria defined (if new API routes or pages)

**Tier-specific DoR exceptions:**
- **Fast Track (XS/S)**: Items 1-4 are mandatory. Items 5-9 are skipped. Exception: if the item touches auth or introduces new routes, item 6 is mandatory.
- **Full (M/L) and Spike-First (XL)**: All items apply.

## Round-by-Round Execution Details

### Round 1: Definition
- [product-manager]: Write/refine user story + acceptance criteria + priority + effort + dependencies
- [data-analyst] (parallel): Define event tracking plan, success metrics, KPIs
- [marketing-manager] (parallel, optional): Create marketing mini-plan
- PM integrates tracking requirements and marketing context into the user story

### Round 2: Architecture
- [solution-architect]: Evaluate feature against existing architecture in SOLUTION_DESIGN.md
- Produce: DB schema changes, API contract, security requirements, component structure
- **R2 Query Performance Checklist:**

| # | Check | What to verify |
|---|-------|---------------|
| Q-1 | All list queries bounded | Every query returning multiple rows must have `.limit()` OR pagination |
| Q-2 | No N+1 sequential queries | Use joins or batch queries — never loop + query |
| Q-3 | Pagination on list endpoints | Every list API route must accept `page`/`limit` params |
| Q-4 | Date-bounded analytics | Any aggregation query must be bounded by a date range |

### Round 3: Build (Backend + AI/ML)
- [backend-engineer]: API routes, migrations, schemas, types, auth guards
- [ai-ml-engineer]: AI agents, pipelines, orchestration, validation, prompts
- Produce complete working code with no TODOs, error handling, audit logging

### Round 4: Build (Frontend)
- [frontend-engineer]: Pages, components, hooks, forms, UX polish
- Depends on R3 API contracts — do not start until backend routes exist
- Must handle all states: loading, error, empty, success

### Round 5: Review (4 Reviewers in Parallel)
- [seo-reviewer]: Public pages only; technical SEO, content SEO
- [code-reviewer]: Architecture, patterns, scalability, performance, DRY — N+1 queries are always CRITICAL
- [security-reviewer]: Auth, data isolation, compliance, vulnerabilities — severity: CRITICAL/HIGH/MEDIUM/LOW
- [qa-reviewer]: TypeScript strictness, error handling, React patterns, edge cases, accessibility
- All report findings with file/line references — none write code
- Engineers fix CRITICAL and HIGH findings before R6

### Round 6: Testing (Sequential)
- [test-engineer]: Write e2e, integration, unit tests
- Cover: happy path, edge cases, data isolation, auth
- Then [tester] (UAT): Manual testing — PASS/FAIL/WARN/SKIP per test case
- All tests must pass before marking sprint item as done

### Round 7: Close
- [solution-architect]: Update SOLUTION_DESIGN.md with what was actually built
- Document: deviations from R2 plan, new API endpoints, new DB tables, new env vars, rollback plans

### Round 8: Post-Close (Optional)
- [marketing-manager]: Review completed features for marketing impact, update MARKETING_PLAN.md
- [technical-writer]: Update user manual chapters, update CHANGELOG.md
- Both agents run in PARALLEL

## Key Documents (Sources of Truth)

| Document | Owner | Purpose |
|----------|-------|---------|
| SPRINT.md | [scrum-master] | Living sprint board — active items, current sprint only |
| SPRINT_ARCHIVE.md | [scrum-master] | Historical completed items — all closed sprints |
| BACKLOG.md | [product-manager] | All user stories, priorities, sprint assignments |
| PRD.md | [product-manager] | Product requirements, personas, features, KPIs |
| SOLUTION_DESIGN.md | [solution-architect] | DB schema, API design, security model |
| BUSINESS_PLAN.md | [product-manager] | Revenue projections, go-to-market, competitive positioning |
| MARKETING_PLAN.md | [marketing-manager] | Campaign calendar, channels, messaging, budget |
| STRATEGIC_PLAN.md | [marketing-manager] | Market analysis, competitive positioning |
| docs/user-manual/ | [technical-writer] | User manual — how-to guides for all features |
| RELEASES.md | [release-manager] | Local reference copy of release notes |

## Non-Negotiable Rules

### Security
- [PLACEHOLDER — Define your multi-tenant / data isolation rules here]
- Application-level auth checks in API routes (defense-in-depth)
- All queries scoped to authenticated user / organization
- Never trust client-provided IDs for authorization decisions

### Privacy & Compliance
- [PLACEHOLDER — Define your privacy/compliance requirements: GDPR, CCPA, regional laws, etc.]
- No customer data in logs or error messages
- Parameterized queries only — never string-interpolate user input

### Code Quality
- TypeScript strict mode — no `any`, no unsafe `as` casts, no non-null assertions without validation
- No TODOs in committed code — complete working code or don't commit
- Audit logging for all mutations
- Rate limiting on auth and sensitive endpoints
- Error handling in try/catch; errors surfaced to users with appropriate status codes

### Frontend Standards
- Skeleton loaders for content areas (not spinners)
- Empty states: icon + message + prominent CTA
- Confirmation dialogs for destructive actions
- Mobile-first responsive design
- [PLACEHOLDER — Define localization requirements: languages, date formats, etc.]

### Performance Standards
- API response time: < 500ms P95 for standard CRUD operations
- Page LCP (Largest Contentful Paint): < 2.5s on mobile
- Database queries: no single query > 200ms under normal load
- N+1 queries: CRITICAL finding in [code-reviewer]
- Missing pagination on list endpoints: HIGH finding

### Testing Standards
- Deterministic tests (no flakiness)
- Page Object Model for e2e tests
- Test data factories with realistic data
- Regression tests for every confirmed bug — test-first approach
- [test-engineer] must run the full existing test suite after writing new tests

### Shared File Governance
- Files in shared directories (types/, validations/, auth/) are shared between engineers
- Cross-boundary edits must be called out by [code-reviewer] in R5
- When parallel agents risk editing the same files, [scrum-master] must sequence them

### Rollback & Incident Management
- Every DB migration must ship with a documented rollback procedure
- Every breaking API change must document the versioning or rollback strategy
- **Incident severity levels:**
  - **SEV1** — Data loss or complete service outage: halt all sprint work
  - **SEV2** — Major feature broken: fix before resuming sprint work
  - **SEV3** — Minor degradation: log and schedule for next sprint
- After SEV1/SEV2: [solution-architect] writes a post-mortem in SOLUTION_DESIGN.md

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

At the start of every session:
1. [scrum-master] reads SPRINT.md and BACKLOG.md
2. Identifies current sprint items and their pipeline stage
3. Determines which agent(s) should run next
4. Launches appropriate agent(s) — parallel when possible
5. Updates SPRINT.md after each round completes

## Pipeline Continuation Protocol

**CRITICAL**: After ANY agent completes work, you MUST check SPRINT.md and continue the pipeline to the next round. Do NOT stop after build rounds and wait for the user. The pipeline is automatic:

**Full / Spike-First continuation:**
- After R3/R4 completes → IMMEDIATELY launch R5 reviewers (all 4 in parallel)
- After R5 findings fixed → IMMEDIATELY launch R6 [test-engineer]
- After [test-engineer] → IMMEDIATELY launch R6 [tester] for UAT
- After [tester] UAT passes → IMMEDIATELY launch R7 [solution-architect] close
- After R7 → Launch R8 if applicable

**Fast Track continuation:**
- After R3/R4 → IMMEDIATELY launch [code-reviewer] + [security-reviewer] in parallel
- After R5 findings fixed → run existing test suite, confirm zero regressions → mark done

**Sprint close continuation:**
- After all items done → Gate 4 → Gate 7 → [release-manager] → archive

**Context discipline:** When routing to any next round, [scrum-master] MUST summarize — not quote — the prior round's output. The next agent reads SPRINT.md as its context contract.

### Cross-Item Parallelization Rules

| # | Rule | Limit |
|---|------|-------|
| P-1 | Max one L/XL item active at a time | L/XL items generate 7+ rounds |
| P-2 | S/XS items can run alongside any active item | Fast Track items have minimal context footprint |
| P-3 | Max two M items in parallel | Two is safe, three risks context pressure |
| P-4 | Interleave, don't overlap full pipelines | Complete R1-R5 of first before starting R1 of second |

## R5 Findings Persistence

After R5 reviewers complete, save deduplicated findings to `SPRINT_FINDINGS.md`:

```markdown
# Sprint N — R5 Findings (Deduplicated)
## CRITICAL (must fix before R6)
_None_
## HIGH (must fix before R6)
| # | File | Finding | Fix |
|---|------|---------|-----|
| 1 | `path/to/file.ts:line` | Description | Proposed fix |
## MEDIUM (fix if time permits)
...
## LOW (defer to future sprint)
...
```

## Pre-Existing Code Review Gate

Any code found in the repository that has NOT been through the R5 review pipeline MUST be flagged as "unreviewed" in SPRINT.md.

## Scope Change Control

Items may NOT be silently added to or removed from an active sprint. All mid-sprint scope changes require explicit [scrum-master] handling:

**Adding an item:** assess impact → identify what gets deprioritized → update SPRINT.md with rationale
**Removing an item:** return to BACKLOG.md with status `backlog` and deferral reason

## Blocker Escalation Protocol

Every blocker in SPRINT.md must include:
- **Description**: What is blocked and why
- **Owner**: Which agent or external party resolves it
- **Target resolution**: When it should be resolved

If unresolved when the responsible agent's round completes, present the user with three options:
1. **Resolve**: Provide the information needed
2. **Defer**: Move to next sprint with blocker documented
3. **Workaround**: Propose an alternative approach
```

--- END CLAUDE.md ---

## Key Documents (Sources of Truth)

| Document | Owner | Purpose |
|----------|-------|---------|
| SPRINT.md | [scrum-master] | Living sprint board — active items, current sprint only |
| SPRINT_ARCHIVE.md | [scrum-master] | Historical completed items — all closed sprints |
| BACKLOG.md | [product-manager] | All user stories, priorities, sprint assignments |
| PRD.md | [product-manager] | Product requirements, personas, features, KPIs |
| SOLUTION_DESIGN.md | [solution-architect] | DB schema, API design, security model |
| BUSINESS_PLAN.md | [product-manager] | Revenue projections, go-to-market, competitive positioning |
| MARKETING_PLAN.md | [marketing-manager] | Campaign calendar, channels, messaging, budget |
| STRATEGIC_PLAN.md | [marketing-manager] | Market analysis, competitive positioning |
| docs/user-manual/ | [technical-writer] | User manual — how-to guides for all features |
| RELEASES.md | [release-manager] | Local reference copy of release notes |

Agents MUST read relevant documents before producing output. Every agent's work builds on the context from prior rounds.

---

# 3. Document Templates

## 3.1 SPRINT.md

```markdown
# Current Sprint

*Sprint 0 — Project Definition. First sprint for Cook&Go.*

---

## Active Items

*(none yet — populate during Sprint 0 planning)*

---

## Completed This Sprint

*(none yet)*

---

## Execution Plan

*(to be defined during sprint planning)*

---

## Gate 6 — Sprint 0 Readiness Check

| # | Check | Status |
|---|-------|--------|
| 1 | All items have user story + AC | ⬜ |
| 2 | Priority + effort + dependencies assigned | ⬜ |
| 3 | External dependencies confirmed | ⬜ |
| 4 | Total effort scoped to sprint duration | ⬜ |
| 5 | SPRINT.md populated with all items | ⬜ |
| 6 | No unresolved blockers from previous sprint | ⬜ |

**Gate 6 Result: ⬜ PENDING**
```

## 3.2 BACKLOG.md

```markdown
# Cook&Go — Product Backlog

**Version:** 1.0
**Date:** [DATE]
**Author:** Product Management
**Status:** Active
**Changelog:** v1.0 — Initial backlog creation

---

## Backlog Legend

**Priority**
- **P0**: Critical — blocks launch or core value
- **P1**: High — essential for competitive product
- **P2**: Medium — important but not blocking
- **P3**: Nice-to-have — improves experience

**Effort**
- **XS**: < 2 hours
- **S**: 2-8 hours (half day to one day)
- **M**: 1-3 days
- **L**: 3-5 days (one week)
- **XL**: 5-10 days (one to two weeks)

**Status**
- **done**: Completed and verified
- **in-progress**: Currently being worked on
- **backlog**: Not started

---

## Phase A — Foundation

| ID | User Story | Priority | Effort | Status | Sprint | Dependencies | Acceptance Criteria |
|----|-----------|----------|--------|--------|--------|--------------|---------------------|
| B-001 | [To be defined] | | | backlog | | | |

---

## Icebox

| ID | User Story | Priority | Effort | Status | Dependencies | Notes |
|----|-----------|----------|--------|--------|--------------|-------|
```

## 3.3 BACKLOG_BOARD.md

```markdown
# Cook&Go — Product Board

**Updated:** [DATE] · **Version:** 1.0 · **Total Items:** 0

---

## Progress Dashboard

```
Overall Progress    ░░░░░░░░░░░░░░░░░░░░  0% (0/0)
```

### Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 | P0 — Critical (blocks launch) |
| 🟠 | P1 — High (must do) |
| 🟡 | P2 — Medium (plan for soon) |
| ⚪ | P3 — Nice-to-have |
| ✅ | Done |
| 🔄 | In Progress |
| ⬜ | To Do |

**Effort:** XS · S · M · L · XL

---

## Sprint 0 — Project Definition

> 0/0 done

*(items to be added during sprint planning)*

---

## Priority Distribution

| Priority | Count | % |
|----------|-------|---|
| 🔴 P0 Critical | 0 | 0% |
| 🟠 P1 High | 0 | 0% |
| 🟡 P2 Medium | 0 | 0% |
| ⚪ P3 Nice-to-have | 0 | 0% |

## Status Summary

| Status | Count | % |
|--------|-------|---|
| ✅ Done | 0 | 0% |
| 🔄 In Progress | 0 | 0% |
| ⬜ To Do | 0 | 0% |
| 🧊 Icebox | 0 | 0% |
```

## 3.4 SPRINT_ARCHIVE.md

```markdown
# Sprint Archive

Historical completed sprint items. Appended by [scrum-master] at the close of each sprint
(after retrospective). Read this file for history; read SPRINT.md for the active sprint only.

---

*(no sprints archived yet)*
```

## 3.5 SPRINT_FINDINGS.md

```markdown
# R5 Findings Log

Deduplicated R5 review findings, persisted here to survive context window compaction.
Updated by [scrum-master] after each R5 review round.

---

*(no findings yet)*
```

## 3.6 PRD.md

```markdown
# Cook&Go — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** [DATE]
**Author:** Product Management
**Status:** Draft
**Changelog:** v1.0 — Initial PRD creation

---

## 1. Product Vision and Strategy

### 1.1 Vision Statement
[One sentence capturing the core value proposition]

### 1.2 Strategic Context
[Market size, growth projections, segment analysis]

### 1.3 Problem Statement
[Customer pain points — 2-4 bullets]

### 1.4 Solution Overview
[How Cook&Go solves each pain point]

### 1.5 Competitive Positioning
[Market map — competitors and Cook&Go's unique position]

---

## 2. Target Personas

### 2.1 Persona A: [Name]
- **Profile**: [Role, company size, context]
- **Current tools**: [Existing tooling]
- **Core need**: [Direct quote if possible]
- **Decision driver**: [What matters most]
- **Subscription tier**: [If applicable]

---

## 3. Core Features and Requirements

### 3.1 [Feature Category]

#### F-XXX-01: [Feature Name]
- **Description**: [1-2 sentence overview]
- **Acceptance criteria**: [AC1, AC2, AC3]
- **Status**: [Planned / Built / Future]

---

## 4. Success Metrics and KPIs

| Metric | Target | Category |
|--------|--------|----------|
| [Metric name] | [Target value] | [Activation / Retention / Revenue] |

---

## 5. Constraints and Compliance

### 5.1 Data Privacy & Compliance
[GDPR, regional requirements]

### 5.2 Security Requirements
[Auth, encryption, audit logging]

### 5.3 Performance Constraints
[API latency, page load, query limits]

---

## 6. Non-Functional Requirements
[Availability, scalability, accessibility, mobile-first]
```

## 3.7 SOLUTION_DESIGN.md

```markdown
# Cook&Go — Solution Design

**Version:** 1.0
**Date:** [DATE]
**Owner:** [solution-architect]
**Status:** Draft

---

## 1. Project Structure

[PLACEHOLDER — directory structure, monorepo layout]

## 2. Database Schema

[PLACEHOLDER — tables, relationships, RLS policies]

## 3. Security Architecture

### 3.1 Authentication
[PLACEHOLDER — auth provider, session/JWT strategy]

### 3.2 Authorization
[PLACEHOLDER — RBAC, data isolation]

### 3.3 Compliance
[PLACEHOLDER — privacy requirements, data handling]

## 4. API Contracts

[PLACEHOLDER — documented per endpoint: method, path, auth, request/response schema, error codes]

## 5. Frontend Architecture

[PLACEHOLDER — component structure, state management, routing]

## 6. AI/ML Architecture

[PLACEHOLDER — if applicable: LLM integration, pipelines, prompts]

## 7. Performance Standards

| Metric | Target |
|--------|--------|
| API P95 | < 500ms |
| Page LCP | < 2.5s |
| DB query | < 200ms |

## 8. Deployment Architecture

[PLACEHOLDER — hosting, CI/CD, environments]

---

## Runbooks

*(added as async jobs/background processes are created)*

## Rollback Plans

*(added per sprint as DB migrations and breaking changes are introduced)*

## Incident Log

*(post-mortems for SEV1/SEV2 incidents)*

## Build Deviations

*(deviations from R2 architecture plans, documented at R7 close)*
```

## 3.8 BUSINESS_PLAN.md

```markdown
# Cook&Go — Business Plan

**Version:** 1.0
**Date:** [DATE]
**Author:** Product Management
**Status:** Draft

---

## 1. Executive Summary
[One paragraph: what, who, why, how]

## 2. Problem Statement
[Market pain points]

## 3. Solution
[How Cook&Go solves the problem]

## 4. Market Opportunity
[TAM / SAM / SOM analysis]

## 5. Business Model & Pricing
[Revenue model, pricing tiers]

## 6. Product Roadmap
[Phase 1 / Phase 2 / Phase 3 milestones]

## 7. Go-to-Market Strategy
[Launch plan, channels, positioning]

## 8. Competitive Advantages
[Differentiation, moats]

## 9. Financial Projections
[Revenue, costs, unit economics]

## 10. Risk Mitigation
[Key risks and mitigation strategies]
```

## 3.9 MARKETING_PLAN.md

```markdown
# Cook&Go — Marketing Plan

**Version:** 1.0
**Date:** [DATE]
**Owner:** [marketing-manager]
**Status:** Draft

---

## 1. Marketing Objectives
[SMART goals for Year 1]

## 2. Target Audience Segments
[Primary and secondary segments with profiles]

## 3. Brand Positioning & Messaging
[Value proposition, key messages, tone of voice]

## 4. Campaign Calendar
[Annual calendar with launch milestones]

## 5. Channel Strategy
[Owned / Earned / Paid channels with priorities]

## 6. Content Strategy
[Content pillars, formats, cadence]

## 7. Budget Allocation
[Channel-by-channel budget breakdown]

## 8. KPIs & Measurement
[Metrics per channel, reporting cadence]
```

## 3.10 STRATEGIC_PLAN.md

```markdown
# Cook&Go — Strategic Plan

**Version:** 1.0
**Date:** [DATE]
**Owner:** [marketing-manager]
**Status:** Draft

---

## 1. Executive Summary
[Market opportunity and strategic positioning]

## 2. Market Analysis
[Competitive landscape, market gaps, trends]

## 3. Target Market Definition
[Primary market segment, size, characteristics]

## 4. Competitive Positioning
[Where Cook&Go fits vs competitors]

## 5. USP & Messaging Framework
[Unique selling propositions, messaging pillars]

## 6. Brand Identity
[Name, visual identity, tone of voice]

## 7. Go-to-Market Phases
[Phase 1 / 2 / 3 with milestones and success criteria]
```

## 3.11 RELEASES.md

```markdown
# Cook&Go — Release Notes

Local reference copy. Source of truth: GitHub Releases.

---

*(no releases yet)*
```

## 3.12 CONTRIBUTING.md

```markdown
# Contributing to Cook&Go

## Development Setup
[PLACEHOLDER — how to set up the dev environment]

## Git Workflow
- Main branch: `main` (production)
- Development branch: `develop` (integration)
- Feature branches: `feature/B-XXX-description`
- Commit format: `type(scope): description` (e.g., `feat(api): add user endpoint`)

## Code Standards
- TypeScript strict mode
- No `any` types, no unsafe casts
- No TODOs in committed code
- All mutations must have audit logging

## Testing
- Run full test suite before marking any item as done
- Regression tests for every bug fix (test-first approach)
- Deterministic tests — no flakiness

## Pull Requests
- PRs require at least one review
- All CI checks must pass
- Squash merge to keep history clean
```

---

# 4. Bootstrap Checklist

Follow these steps to initialize the Cook&Go project:

### Step 1: Initialize the repository
```bash
cd /Users/george/cookandgo
git init
git checkout -b main
git checkout -b develop
```

### Step 2: Create CLAUDE.md
Copy the CLAUDE.md template from Section 2 into `/Users/george/cookandgo/CLAUDE.md`. Then customize:
- [ ] Fill in the **Project Overview** tech stack
- [ ] Fill in the **Agent Roster** file ownership paths (rows 6-8, 13)
- [ ] Fill in the **Security** rules (multi-tenant, data isolation)
- [ ] Fill in the **Privacy & Compliance** requirements
- [ ] Fill in the **Frontend Standards** localization requirements

### Step 3: Create all document skeletons
Create each file from the templates in Section 3:
- [ ] `SPRINT.md`
- [ ] `BACKLOG.md`
- [ ] `BACKLOG_BOARD.md`
- [ ] `SPRINT_ARCHIVE.md`
- [ ] `SPRINT_FINDINGS.md`
- [ ] `PRD.md`
- [ ] `SOLUTION_DESIGN.md`
- [ ] `BUSINESS_PLAN.md`
- [ ] `MARKETING_PLAN.md`
- [ ] `STRATEGIC_PLAN.md`
- [ ] `RELEASES.md`
- [ ] `CONTRIBUTING.md`

### Step 4: Create agents/ folder
```bash
mkdir -p /Users/george/cookandgo/agents
```
Create one `.md` file per agent (17 total). Each agent file should define:
- Role and responsibilities
- Which pipeline rounds the agent participates in
- Files the agent owns or may modify
- Input expectations (what context it needs from prior rounds)
- Output format (what it produces for the next round)
- Quality standards specific to the agent's domain

Agent files to create:
- [ ] `agents/scrum-master.md`
- [ ] `agents/product-manager.md`
- [ ] `agents/data-analyst.md`
- [ ] `agents/marketing-manager.md`
- [ ] `agents/solution-architect.md`
- [ ] `agents/backend-engineer.md`
- [ ] `agents/ai-ml-engineer.md`
- [ ] `agents/frontend-engineer.md`
- [ ] `agents/seo-reviewer.md`
- [ ] `agents/code-reviewer.md`
- [ ] `agents/security-reviewer.md`
- [ ] `agents/qa-reviewer.md`
- [ ] `agents/test-engineer.md`
- [ ] `agents/tester.md`
- [ ] `agents/content-creator.md`
- [ ] `agents/technical-writer.md`
- [ ] `agents/release-manager.md`

### Step 5: Create docs/ folder
```bash
mkdir -p /Users/george/cookandgo/docs/user-manual
```

### Step 6: Initial commit
```bash
git add -A
git commit -m "chore: bootstrap Cook&Go project with agent pipeline and document structure"
```

### Step 7: Run Sprint 0 — Project Definition
Sprint 0 is a definition-only sprint. Launch:
1. [product-manager] — Define initial PRD, personas, Phase A features, and populate BACKLOG.md
2. [marketing-manager] — Define STRATEGIC_PLAN.md and initial MARKETING_PLAN.md
3. [solution-architect] — Define initial SOLUTION_DESIGN.md (tech stack, DB schema, security model)
4. [product-manager] — Define BUSINESS_PLAN.md

After Sprint 0, you'll have all foundational documents populated and be ready for Sprint 1 (first build sprint).

---

*Generated from Launchli project template. All process rules, pipeline structure, gates, and agent definitions are reusable across projects.*
