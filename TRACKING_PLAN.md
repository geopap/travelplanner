# TravelPlanner — Analytics Tracking Plan

**Version:** 1.0 (Sprint 1 scope)
**Owner:** [data-analyst]
**Status:** Active
**Date:** 2026-04-24

---

## 1. Goals

This tracking plan defines the analytics instrumentation required for Sprint 1 of TravelPlanner, covering the foundational auth flow (B-001–B-003), trip CRUD (B-004), day view (B-005), itinerary item CRUD (B-006), and route guards (B-018). It enables the product team to measure every PRD §4 KPI that is addressable in Sprint 1 — specifically activation rate, sign-up completion, time-to-first-trip, itinerary engagement, and authentication error rate — without waiting for backend telemetry tooling to mature.

The plan establishes a lightweight, provider-agnostic event taxonomy that ships with a stub implementation in Sprint 1 and can be swapped for a production provider (PostHog, Mixpanel) in a later sprint with no changes to call sites. Every event is designed to support funnel analysis (sign-up → trip create → first item added), activation tracking (did the user perform the core value action within 7 days?), and error monitoring (auth failure rates, guard redirects). Events are deliberately sparse in Sprint 1: only what is needed to answer the five metrics below is instrumented; over-instrumentation is deferred until there is an audience to analyze.

---

## 2. Event Taxonomy

Every event follows the naming convention `{domain}_{action}` in snake_case. Payloads are typed in TypeScript (see §5). No PII — no email addresses, display names, or passwords — appears in any event payload. User identity is represented exclusively by the Supabase UUID (`user_id`), which is pseudonymous.

### 2.1 Auth domain

Covers B-001 (sign up), B-002 (sign in), B-003 (sign out + password reset), and B-018 (route guards).

| Event | Trigger | Required properties | Optional properties | Item |
|-------|---------|---------------------|---------------------|------|
| `auth_signup_started` | User submits the sign-up form (client-side, before API call) | — | `utm_source` (string) | B-001 |
| `auth_signup_succeeded` | `profiles` row created in Supabase after email confirmation; server-side | `user_id` (uuid) | — | B-001 |
| `auth_signup_failed` | Sign-up API returns an error | `error_code` (enum: `email_taken` \| `weak_password` \| `rate_limited` \| `unknown`) | — | B-001 |
| `auth_confirmation_email_sent` | Supabase triggers confirmation email on new user creation | — | — | B-001 |
| `auth_signin_succeeded` | Valid session created; user redirected to `/trips` | `user_id` (uuid) | — | B-002 |
| `auth_signin_failed` | Invalid credentials or rate-limit rejection | `error_code` (enum: `bad_credentials` \| `rate_limited` \| `unconfirmed_email` \| `unknown`) | — | B-002 |
| `auth_signout` | User clicks sign-out; session cookie cleared | `user_id` (uuid) | — | B-003 |
| `auth_password_reset_requested` | Forgot-password form submitted; Supabase reset email triggered | — | — | B-003 |
| `auth_password_reset_completed` | User follows reset link and saves a new password successfully | `user_id` (uuid) | — | B-003 |
| `auth_guard_redirected` | Unauthenticated request hits a protected page route; middleware fires redirect | `target_path` (string) | — | B-018 |
| `auth_guard_api_blocked` | Unauthenticated request hits a protected API route; server returns 401 | `target_path` (string) | — | B-018 |

**Notes on B-001 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Form validates email / password ≥ 12 chars / passwords match | `auth_signup_failed` with `error_code: weak_password` |
| Duplicate email returns "Email already registered" | `auth_signup_failed` with `error_code: email_taken` |
| Supabase Auth user + `profiles` row created on confirmation | `auth_signup_succeeded` (fires post-confirmation) |
| Confirmation email sent | `auth_confirmation_email_sent` |
| Unconfirmed users cannot access protected routes | `auth_signin_failed` with `error_code: unconfirmed_email` |
| Rate limit: 5 attempts / 15 min | `auth_signup_failed` with `error_code: rate_limited` |

**Notes on B-002 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Invalid credentials → generic error | `auth_signin_failed` with `error_code: bad_credentials` |
| Successful sign-in creates session; redirects to `/trips` | `auth_signin_succeeded` |
| Rate limit + 15-minute lockout | `auth_signin_failed` with `error_code: rate_limited` |

**Notes on B-003 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Sign-out clears session; redirects to `/` | `auth_signout` |
| Forgot-password triggers reset email | `auth_password_reset_requested` |
| Reset link expires / old tokens invalidated | `auth_password_reset_completed` |

**Notes on B-018 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Protected pages redirect unauth users to `/sign-in?next=…` | `auth_guard_redirected` (target_path captures the attempted destination) |
| Protected API routes return 401 | `auth_guard_api_blocked` |
| After sign-in, redirect to original `next` URL | Computable from `auth_guard_redirected.target_path` + `auth_signin_succeeded.user_id` join on session |

---

### 2.2 Trips domain

Covers B-004 (Trips CRUD).

| Event | Trigger | Required properties | Optional properties | Item |
|-------|---------|---------------------|---------------------|------|
| `trip_create_started` | User submits the "Create trip" form (client-side, before API call) | — | — | B-004 |
| `trip_created` | `trips` row + `trip_members` owner row + `trip_days` rows all committed to DB; server-side | `user_id` (uuid), `trip_id` (uuid), `day_count` (integer), `has_budget` (boolean), `currency` (string ISO-4217) | `date_range_days` (integer: end_date − start_date + 1) | B-004 |
| `trip_create_failed` | POST `/api/trips` returns a validation or DB error | `error_code` (enum: `validation_error` \| `date_range_invalid` \| `unknown`) | — | B-004 |
| `trip_list_viewed` | Authenticated user loads `/trips` | `user_id` (uuid), `trip_count` (integer) | — | B-004 |
| `trip_detail_viewed` | User loads a trip overview page `/trips/[id]` | `user_id` (uuid), `trip_id` (uuid) | `member_count` (integer) | B-004 |
| `trip_edit_started` | User opens the edit form for a trip | `user_id` (uuid), `trip_id` (uuid) | — | B-004 |
| `trip_edited` | PATCH `/api/trips/[id]` succeeds | `user_id` (uuid), `trip_id` (uuid), `fields_changed` (string[]: array of field names updated) | `date_range_extended` (boolean), `budget_changed` (boolean) | B-004 |
| `trip_edit_failed` | PATCH `/api/trips/[id]` returns error | `trip_id` (uuid), `error_code` (enum: `items_on_removed_days` \| `validation_error` \| `unauthorized` \| `unknown`) | — | B-004 |
| `trip_delete_started` | User opens the delete confirmation dialog | `user_id` (uuid), `trip_id` (uuid) | — | B-004 |
| `trip_deleted` | DELETE `/api/trips/[id]` succeeds; cascade complete | `user_id` (uuid), `trip_id` (uuid) | — | B-004 |

**Notes on B-004 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Create form validates: name, start ≤ end date, base currency required | `trip_create_failed` with `error_code: validation_error` |
| `trips` row saved with `owner_id = auth.uid()` | `trip_created` (server-side, after successful write) |
| `trip_days` rows auto-generated | `trip_created.day_count` captures the count |
| Trip list shows only user's trips; paginated | `trip_list_viewed.trip_count` |
| Edit: extending dates generates new `trip_days` | `trip_edited.date_range_extended` |
| Edit: shrinking dates blocked if items exist on removed days | `trip_edit_failed` with `error_code: items_on_removed_days` |
| Delete: requires typing trip name; cascade deletes all child rows | `trip_deleted` (server-side, fires only on success) |

---

### 2.3 Itinerary domain

Covers B-005 (day view) and B-006 (itinerary items CRUD).

| Event | Trigger | Required properties | Optional properties | Item |
|-------|---------|---------------------|---------------------|------|
| `trip_itinerary_viewed` | User loads `/trips/[id]/itinerary` | `user_id` (uuid), `trip_id` (uuid), `day_count` (integer), `days_with_items` (integer) | — | B-005 |
| `trip_day_viewed` | User scrolls to or directly navigates to a specific day section | `user_id` (uuid), `trip_id` (uuid), `day_id` (uuid), `day_number` (integer) | `item_count` (integer) | B-005 |
| `trip_day_title_edited` | Inline day title saved (on blur or Enter) | `user_id` (uuid), `trip_id` (uuid), `day_id` (uuid) | — | B-005 |
| `itinerary_item_create_started` | User opens the type-selection step ("Add item" button clicked) | `user_id` (uuid), `trip_id` (uuid), `day_id` (uuid) | — | B-006 |
| `itinerary_item_created` | POST `/api/trips/[id]/days/[dayId]/items` succeeds; server-side | `user_id` (uuid), `trip_id` (uuid), `day_id` (uuid), `item_id` (uuid), `item_type` (enum: `transport` \| `lodging` \| `activity` \| `meal` \| `note`) | `has_cost` (boolean), `has_time` (boolean) | B-006 |
| `itinerary_item_create_failed` | POST returns validation or auth error | `trip_id` (uuid), `day_id` (uuid), `error_code` (enum: `validation_error` \| `unauthorized` \| `unknown`) | `item_type` (string) | B-006 |
| `itinerary_item_edit_started` | User opens the edit form for an existing item | `user_id` (uuid), `trip_id` (uuid), `item_id` (uuid) | — | B-006 |
| `itinerary_item_edited` | PATCH `/api/trips/[id]/days/[dayId]/items/[itemId]` succeeds | `user_id` (uuid), `trip_id` (uuid), `item_id` (uuid), `item_type` (string) | `fields_changed` (string[]) | B-006 |
| `itinerary_item_delete_started` | User opens the delete confirmation modal | `user_id` (uuid), `trip_id` (uuid), `item_id` (uuid) | — | B-006 |
| `itinerary_item_deleted` | DELETE `/api/trips/[id]/days/[dayId]/items/[itemId]` succeeds | `user_id` (uuid), `trip_id` (uuid), `item_id` (uuid), `item_type` (string) | — | B-006 |
| `itinerary_item_delete_failed` | DELETE returns auth or DB error | `trip_id` (uuid), `item_id` (uuid), `error_code` (enum: `unauthorized` \| `unknown`) | — | B-006 |

**Notes on B-005 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Days listed in date order | Verified structurally; `trip_itinerary_viewed.day_count` confirms days loaded |
| Items within a day sorted by `start_time` | Verified by [test-engineer]; `trip_day_viewed.item_count` confirms items rendered |
| Day title editable inline by editor/owner | `trip_day_title_edited` |
| Viewer cannot edit day titles | `trip_day_title_edited` only fires for editor/owner (server-side guard prevents viewer write) |
| Empty days show CTA | `trip_day_viewed` with `item_count: 0` identifies empty-day exposure |

**Notes on B-006 AC coverage:**

| Acceptance Criterion | Covered by |
|----------------------|-----------|
| Type selection is the first step | `itinerary_item_create_started` + `itinerary_item_created.item_type` (type chosen before form fills) |
| Common fields: title required, start/end time, notes, cost, currency | `itinerary_item_create_failed` with `error_code: validation_error` |
| Items sorted by start time within day | `trip_day_viewed` + `itinerary_item_created.has_time` |
| Delete requires confirmation modal | `itinerary_item_delete_started` fires before delete; `itinerary_item_deleted` fires on confirm |
| Only editor/owner can add/edit/delete | `*_failed` events with `error_code: unauthorized`; server-side guard prevents viewer writes |
| `trip_id` and `day_id` set server-side | `itinerary_item_created` is a server-side event — fires only after successful server write |

---

## 3. Identification Strategy

### Anonymous users
Before authentication, a `distinct_id` cookie (UUID v4, `SameSite=Lax; Secure; HttpOnly`) is set on first page load. This enables measurement of the sign-up funnel (`auth_signup_started` → `auth_signup_succeeded`) for users who don't yet have a `user_id`.

### Authenticated users
On `auth_signin_succeeded` and `auth_signup_succeeded`, the analytics client calls `analytics.identify(user_id)`, merging the anonymous `distinct_id` profile into the identified `user_id` profile. All subsequent events are attributed to the Supabase UUID.

### Super-properties
The following properties are attached to every event automatically by the analytics client:

| Property | Value | Notes |
|----------|-------|-------|
| `app_version` | From `process.env.NEXT_PUBLIC_APP_VERSION` | Set at build time |
| `platform` | `"web"` | Fixed in v1 |
| `locale` | `"en-US"` | Fixed in v1 (no i18n) |
| `session_id` | UUID v4, generated per browser tab session | For funnel analysis within a session |

### Server-side events
Events marked "server-side" in §2 are emitted from Next.js API route handlers, not from the browser. They use the service-role Supabase client and are written to `audit_log` (entity/action/metadata) **and** forwarded to the analytics provider via the stub (or, when a provider is configured, via a server-to-server SDK call). Server-side events are authoritative: they only fire when the DB mutation succeeded.

---

## 4. Success Metrics (Sprint 1 scope)

All five metrics below are computable exclusively from the events defined in §2. No additional instrumentation is required.

| Metric | Definition | Target | Source events |
|--------|------------|--------|---------------|
| **Activation rate** | Distinct `user_id`s where `trip_created` occurred within 7 days of `auth_signup_succeeded` / distinct `user_id`s in `auth_signup_succeeded` | ≥ 40% | `auth_signup_succeeded` + `trip_created` |
| **Sign-up completion** | Distinct fires of `auth_signup_succeeded` / distinct fires of `auth_signup_started` (same `distinct_id`, any session, 24-hour window) | ≥ 70% | `auth_signup_started`, `auth_signup_succeeded` |
| **Time-to-first-trip** | Median seconds between `auth_signup_succeeded.timestamp` and the first `trip_created.timestamp` per `user_id` | < 300 s | `auth_signup_succeeded`, `trip_created` |
| **Itinerary engagement** | Distinct `user_id`s who fire `itinerary_item_created` ≥ 3 times on the same `trip_id` within 30 days of `trip_created` / distinct `user_id`s in `trip_created` | ≥ 60% | `trip_created`, `itinerary_item_created` |
| **Failed-auth rate** | `auth_signin_failed` / (`auth_signin_succeeded` + `auth_signin_failed`) in a rolling 24-hour window | < 10% | `auth_signin_succeeded`, `auth_signin_failed` |

### Alignment with PRD §4 KPIs

The Sprint 1 events provide the foundation for the following PRD §4 KPIs (full realization depends on later sprints):

| PRD KPI | Sprint 1 coverage |
|---------|------------------|
| Trips created | `trip_created` count |
| Trip days with ≥ 1 item | Derivable from `itinerary_item_created.day_id` aggregated per trip |
| Itinerary items logged | `itinerary_item_created` count |
| Budget set on trip | `trip_created.has_budget` |
| API P95 latency | Measured from server-side event timestamps (emitted after DB write) vs. request start (from middleware) |
| Mobile sessions | `super_property: platform` + user-agent detection added to the analytics session stub |

---

## 5. Implementation Notes

### Where events are called

| Layer | Mechanism | Examples |
|-------|-----------|---------|
| **Client (React)** | `analytics.track()` called from React hooks and event handlers | `auth_signup_started`, `auth_guard_redirected`, `trip_itinerary_viewed`, `trip_day_viewed`, `trip_day_title_edited`, all `*_started` events |
| **Server (API routes)** | `analytics.track()` called after successful DB write; always paired with `logAudit()` | `auth_signup_succeeded`, `auth_signup_failed`, `auth_signin_succeeded`, `auth_signin_failed`, `trip_created`, `trip_edited`, `trip_deleted`, `itinerary_item_created`, `itinerary_item_edited`, `itinerary_item_deleted` |

### File locations

```
app/src/lib/analytics/
  track.ts          — analytics.track(), analytics.identify(), analytics.page() API
  stub.ts           — Sprint 1 provider: console.log + audit_log write
  types.ts          — TypeScript union types for all event names + payloads
  super-properties.ts — app_version, platform, locale, session_id attachment

app/src/__tests__/analytics/
  auth.test.ts      — assert auth_signup_started, auth_signup_succeeded, auth_signup_failed fire + shape
  trips.test.ts     — assert trip_created, trip_edited, trip_deleted fire + shape
  itinerary.test.ts — assert itinerary_item_created (all 5 types), edited, deleted fire + shape
  guards.test.ts    — assert auth_guard_redirected, auth_guard_api_blocked fire + shape
```

### Provider stub (Sprint 1)

```typescript
// app/src/lib/analytics/stub.ts
// Writes to console in development; writes to audit_log in all environments.
// Swap: set NEXT_PUBLIC_ANALYTICS_PROVIDER=posthog|mixpanel in .env.local
// to activate a real provider without changing call sites.
export const analytics = {
  track: (event: AnalyticsEvent, properties: EventProperties) => { /* ... */ },
  identify: (userId: string) => { /* ... */ },
  page: (path: string) => { /* ... */ },
};
```

`.env.example` must include:
```
# Analytics — set to 'posthog' or 'mixpanel' to activate a real provider.
# Leave unset or set to 'stub' for local/development mode (console + audit_log).
NEXT_PUBLIC_ANALYTICS_PROVIDER=stub
NEXT_PUBLIC_APP_VERSION=0.1.0
```

### Privacy rules

1. **No PII in payloads** — email addresses, display names, phone numbers, passwords, and invitation tokens must never appear in any event property. Violation is a CRITICAL finding in R5 [security-reviewer].
2. **User IDs are pseudonymous** — `user_id` is a Supabase UUID. It is not linked to an email without a separate lookup that requires auth. Safe to include in analytics payloads.
3. **`target_path` scrubbing** — for `auth_guard_redirected` and `auth_guard_api_blocked`, strip any query params that may contain tokens before recording `target_path` (e.g., `/invite/[token]` → `/invite/[redacted]`).
4. **Sampling** — 100% in Sprint 1 (low volume). Revisit when DAU > 1,000.
5. **Audit log** — the `audit_log` table is the server-of-record for all mutation events. The analytics provider receives a forwarded copy. If the provider is unavailable, the `audit_log` write must still succeed (do not fail the mutation).

### Testing requirement

Every event listed in §2 must have a corresponding test assertion in `app/src/__tests__/analytics/` that verifies:
- The event fires (call count ≥ 1)
- Required properties are present and correctly typed
- No PII fields appear in the payload

---

## 6. Open Questions

1. **`auth_signup_succeeded` timing** — Supabase confirmation emails introduce an async gap between `auth_signup_started` and `auth_signup_succeeded`. If a user starts sign-up, leaves, and confirms days later, the 24-hour window in the sign-up completion metric will miss them. **For [scrum-master]:** Should we extend the funnel window to 72 hours, or is the 24-hour window intentionally strict to measure immediate intent?

2. **Server-side event delivery to provider** — The stub writes server-side events to `audit_log`. When a real provider is configured, server-to-server delivery requires a backend API key (not the public `NEXT_PUBLIC_*` key). **For [solution-architect]:** Confirm that the Sprint 2 provider integration should use a `ANALYTICS_SERVER_KEY` env var in `.env.example` alongside the existing public one.

3. **`trip_day_viewed` granularity** — The day view page renders all days for a trip on a single scrollable page. Scroll-based viewport tracking requires an `IntersectionObserver` hook. **For [frontend-engineer]:** Confirm whether scroll-tracking is in scope for Sprint 1 or whether `trip_day_viewed` should fire once per page load (covering all days) rather than per individual day scroll into view.
