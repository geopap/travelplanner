# Sprint 1 — Build Spec

**Owner:** [solution-architect]
**Date:** 2026-04-24
**Scope:** B-001, B-002, B-003, B-004, B-005, B-006, B-018
**Source of truth:** `SOLUTION_DESIGN.md` §2–§4 (baseline). This document is the buildable delta for Sprint 1 only.

---

## 3.1 Environment & session

### Environment variables (from `app/.env.example`)

| Variable | Scope | Used by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | browser + server Supabase clients | safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | browser + server Supabase clients | safe to expose; RLS is the isolation boundary |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `lib/supabase/service.ts`; never imported in client bundles | bypasses RLS — use only for audit log writes, password-reset completion, GDPR delete |
| `NEXT_PUBLIC_SITE_URL` | client + server | password-reset email redirect URL, invitation links | set to the deployed origin in production |

Sprint 1 uses all four. `GOOGLE_PLACES_API_KEY` is reserved for Sprint 2.

### Supabase client factories

All three live under `app/src/lib/supabase/`:

| File | Purpose | Cookie handling | RLS? |
|---|---|---|---|
| `browser.ts` | Client components via `createBrowserClient` from `@supabase/ssr` | reads/writes document cookies | yes (anon key) |
| `server.ts` | Server components, route handlers, middleware via `createServerClient` from `@supabase/ssr` | reads/writes Next.js `cookies()` store | yes (anon key) |
| `service.ts` | Privileged server-only ops via `createClient` from `@supabase/supabase-js` using `SUPABASE_SERVICE_ROLE_KEY` | no cookies | **no RLS** — bypasses — every call must verify the acting user's membership manually before writing trip-scoped rows |

Additional helpers in `server.ts`:
- `requireAuth()` — returns `{ user, supabase }` or throws `Response(401)`. Used by every server component and route handler covered by the middleware.
- `getSessionUser()` — non-throwing variant used on public pages that render different UI for logged-in users.

### Session cookie

Supabase SSR default: `sb-<project-ref>-auth-token` — `httpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`. The cookie is written by the Supabase client during sign-in and cleared during sign-out. The middleware refreshes the access token on each request via `supabase.auth.getUser()`.

---

## 3.2 API contracts (Sprint 1)

All routes live under `app/src/app/api/`. All responses are JSON. Error envelope from SOLUTION_DESIGN §4 applies. Every list endpoint accepts `page` (default 1) and `limit` (default 20, max 100) — **R2 Q-3**.

### Auth

| Method · Path | Auth | Body / schema | Response | Errors | Rate limit | Audit |
|---|---|---|---|---|---|---|
| POST `/api/auth/signup` | none | `SignupInput` `{ email, password }` | `201 { user_id }` (email verification required before sign-in) | 400, 409 (generic — do not leak existence), 429 | 5/IP/15min | `audit_log: action='signup', entity='auth.users', entity_id=user_id` |
| POST `/api/auth/signin` | none | `SigninInput` `{ email, password }` | `200 { user_id }` + session cookie | 400, 401 (generic "Email or password incorrect"), 429 | 5 failed/IP/15min → 15-min lockout | `audit_log: action='signin', entity='auth.users', entity_id=user_id` |
| POST `/api/auth/signout` | session | — | `204`; clears cookie | 401 | none | `audit_log: action='signout'` |
| POST `/api/auth/password-reset` | none | `PasswordResetInput` `{ email }` | **always** `200 { ok: true }` (idempotent, no enumeration) | 400, 429 | 3/email/hour | `audit_log: action='password_reset_request', entity='auth.users'` (only on hit; misses not logged to avoid enumeration even via audit) |

**Note on Sprint 1 compromise:** signup/signin pages MAY call Supabase directly from the browser using `@supabase/ssr` browser client. The `/api/auth/*` wrappers exist specifically to add server-side rate limiting and audit logging. [backend-engineer] to decide: wrappers-only or wrappers-plus-direct. Recommendation: wrappers-only for Sprint 1 so rate limits + audit actually apply.

### Trips

| Method · Path | Auth / role | Body | Response | Errors | Audit |
|---|---|---|---|---|---|
| GET `/api/trips?page=&limit=` | member | — | `{ items: Trip[], page, limit, total }` | 401 | — |
| POST `/api/trips` | authenticated | `CreateTripInput` | `201 { trip: Trip, days: TripDay[] }` | 400, 401 | `action='create', entity='trips', entity_id=trip.id, trip_id=trip.id, metadata={ name, start_date, end_date }` |
| GET `/api/trips/[id]` | viewer+ | — | `{ trip, member: { role } }` | 401, 404 | — |
| PATCH `/api/trips/[id]` | owner | `UpdateTripInput` (partial) | `{ trip }` | 400, 403, 404, 409 | `action='update', entity='trips', metadata={ changed_fields }` |
| DELETE `/api/trips/[id]` | owner | header `X-Confirm-Name: <trip name>` | `204` | 400 (name mismatch), 403, 404 | `action='delete', entity='trips'` |

**POST `/api/trips` transactional logic:**
1. Insert `trips` row (anon-key client, RLS allows owner-only insert).
2. Trigger `trips_seed_owner_member` seeds `trip_members` owner row.
3. Server generates `trip_days` rows in the same request: one per calendar day inclusive, `day_number` starting at 1, using anon-key client (RLS allows editor+ which the seeded owner now satisfies).
4. Return the trip plus the days array.

**PATCH `/api/trips/[id]` date-shrink conflict:**
- If new `end_date < existing max trip_days.date` AND any `itinerary_items.day_id` references a day that would be removed → respond `409 { error: { code: 'date_shrink_blocked', message, details: { blocking_days: [{ day_id, date, item_count }] } } }`.
- If extending, server inserts additional `trip_days` for new dates within the same request.

**DELETE** — requires header `X-Confirm-Name` whose value must equal the trip's current `name` (case-sensitive). Cascade handled by FK `on delete cascade`.

### Trip days

| Method · Path | Auth / role | Body | Response | Errors | Audit |
|---|---|---|---|---|---|
| GET `/api/trips/[id]/days` | viewer+ | — | `{ items: TripDay[] }` (ordered by `day_number`; bounded — at most 1× trip length, no pagination needed under the 365-day natural limit) | 401, 404 | — |
| PATCH `/api/trips/[id]/days/[dayId]` | editor+ | `UpdateTripDayInput` `{ title?, notes? }` | `{ day }` | 400, 403, 404 | `action='update', entity='trip_days'` |

**R2 Q-1 note:** `/days` is intentionally un-paginated because `trip_days` is naturally bounded by trip length. Server enforces a hard cap: trips with `end_date - start_date > 365 days` are rejected at create/update (validated in `CreateTripInput` / `UpdateTripInput`).

### Itinerary items

| Method · Path | Auth / role | Body | Response | Errors | Audit |
|---|---|---|---|---|---|
| GET `/api/trips/[id]/items?dayId=&page=&limit=` | viewer+ | — | `{ items, page, limit, total }` (default limit 50, max 100; order by `start_time nulls last, created_at`) | 401, 404 | — |
| POST `/api/trips/[id]/items` | editor+ | `CreateItineraryItemInput` | `201 { item }` | 400, 403, 404 | `action='create', entity='itinerary_items'` |
| PATCH `/api/trips/[id]/items/[itemId]` | editor+ | `UpdateItineraryItemInput` (partial) | `{ item }` | 400, 403, 404 | `action='update', entity='itinerary_items', metadata={ changed_fields }` |
| DELETE `/api/trips/[id]/items/[itemId]` | editor+ | — | `204` | 403, 404 | `action='delete', entity='itinerary_items'` |

**Server-enforced invariants on write:**
- `trip_id` is taken **only** from the URL path — never from the body (per B-006 AC 7).
- `day_id` (if present) is validated to belong to the same `trip_id` via a server-side `select 1 from trip_days where id = $1 and trip_id = $2` check before insert/update.
- `itinerary_items.created_by` is set to `auth.uid()` server-side.

---

## 3.3 Zod validation schemas

All schemas live in `app/src/lib/validations/`. Reuse `UuidSchema`, `IsoDateSchema`, `Iso4217Schema`, `PageSchema` from SOLUTION_DESIGN §4.1.

### Files

| File | Exports |
|---|---|
| `common.ts` | `UuidSchema`, `IsoDateSchema`, `Iso4217Schema`, `IsoDateTimeSchema`, `PageSchema` |
| `auth.ts` | `SignupInput`, `SigninInput`, `PasswordResetInput` |
| `trips.ts` | `CreateTripInput`, `UpdateTripInput` |
| `trip-days.ts` | `UpdateTripDayInput` |
| `itinerary-items.ts` | `CreateItineraryItemInput`, `UpdateItineraryItemInput` |

### Field rules

- **SignupInput** — `email: z.string().email().max(254)`, `password: z.string().min(12).max(128).refine(has upper+lower+digit)`, `confirm_password: z.string()` + refine equality.
- **SigninInput** — `email: z.string().email()`, `password: z.string().min(1).max(128)`.
- **PasswordResetInput** — `email: z.string().email()`.
- **CreateTripInput** — per SOLUTION_DESIGN §4.2, plus added refinement: `(end_date - start_date) ≤ 365 days` (enforces the `/days` un-paginated invariant). `base_currency` default `'EUR'`.
- **UpdateTripInput** — `CreateTripInput.partial()`; if `start_date` or `end_date` present, enforce the 365-day cap against whichever value is present + the existing DB counterpart (validated in the route handler after DB read).
- **UpdateTripDayInput** — `{ title: z.string().max(120).nullable().optional(), notes: z.string().max(5000).nullable().optional() }`; refine: at least one key present.
- **CreateItineraryItemInput** — per SOLUTION_DESIGN §4.5, plus: `start_time` and `end_time` are ISO-8601 datetimes with offset (`z.string().datetime({ offset: true })`); server rejects values outside the trip's `[start_date 00:00 UTC, end_date 23:59 UTC]` window with 400.
- **UpdateItineraryItemInput** — `CreateItineraryItemInput.partial()`; refine at least one key present.

**ISO date/time bounds** (reused refinement):
- `IsoDateSchema` — `/^\d{4}-\d{2}-\d{2}$/` plus `.refine(d => !Number.isNaN(Date.parse(d)))`.
- `IsoDateTimeSchema` — `z.string().datetime({ offset: true })`; applied to `start_time` / `end_time`.

---

## 3.4 Rate limiting (Sprint 1)

**Approach:** per-instance in-memory fixed-window counter, keyed by `(ip, route)` for auth routes and `(userId, route)` for authenticated routes. Implemented as a single helper `app/src/lib/rate-limit.ts` exporting `checkRateLimit(key, windowMs, max)` returning `{ ok, retryAfterMs }`.

**Storage:** `Map<string, { count, windowStart }>` with a 5-minute background sweep to evict stale keys. No external dependency.

**Limits:**

| Endpoint | Window | Max | Key |
|---|---|---|---|
| POST `/api/auth/signup` | 15 min | 5 | IP |
| POST `/api/auth/signin` | 15 min | 5 failed; on 5th failure → 15-min lockout (separate cooldown counter) | IP + email hash |
| POST `/api/auth/password-reset` | 60 min | 3 | email (hashed) |
| All other writes | 60 sec | 60 | userId |
| All list GETs | 60 sec | 120 | userId |

**Sprint 1 compromise — FLAG for R7:**
In-memory counters do **not** hold across Vercel serverless function instances. A determined attacker hitting multiple cold-start instances can exceed the limit. Acceptable for Sprint 1 (single-user dev + demo), **not** acceptable for production. Phase B must swap to Upstash Redis (`@upstash/ratelimit`). A TODO-in-README (not in code) and a note in `SOLUTION_DESIGN.md` Build Deviations is sufficient for Sprint 1 close.

---

## 3.5 Route guards (B-018)

### `app/src/middleware.ts`

Matcher:
```ts
export const config = { matcher: [
  '/trips/:path*',
  '/account/:path*',
  '/api/trips/:path*',
  '/api/account/:path*',
] };
```

Behavior:
1. Build a Supabase server client from request cookies.
2. Call `supabase.auth.getUser()`.
3. If `user` is null:
   - For API paths (starts with `/api/`) → return `new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized' } }), { status: 401 })`.
   - For page paths → `NextResponse.redirect(new URL('/sign-in?redirect=' + encodeURIComponent(pathname + search), req.url))`.
4. Otherwise continue; middleware response writes refreshed Supabase cookies.

### `requireAuth()` in `server.ts`

Defense-in-depth helper used in every server-component page and every route handler covered by the matcher. Returns `{ user, supabase }` or throws. Route handlers catch the thrown 401 and return it verbatim.

### Post-signin redirect

Sign-in page reads `?redirect=` from URL, validates it starts with `/` (no open redirect), and routes the user there after successful sign-in. Falls back to `/trips`.

---

## 3.6 Pages and components (frontend contract for R4)

### Pages

| Route | Server/Client | Purpose | Notes |
|---|---|---|---|
| `/sign-in` | client | Sign-in form | `AuthForm` with `mode='signin'`; honors `?redirect=` |
| `/sign-up` | client | Sign-up form | `AuthForm` with `mode='signup'`; shows "check your email" confirmation state after submit |
| `/forgot-password` | client | Password-reset request | always shows "If the email exists, we sent a link." after submit |
| `/reset-password/[token]` | client | Complete password reset | Supabase default flow; validates token, sets new password, invalidates existing sessions |
| `/trips` | server | List user's trips | server-fetches paginated list; `TripList` with `TripCard`s |
| `/trips/new` | client | Create trip form | `TripForm` with `mode='create'` |
| `/trips/[id]` | server | Trip overview | fetches trip + member role + day summary |
| `/trips/[id]/itinerary` | server | Day view + items | fetches days + items in one round-trip (joined select) |
| `/trips/[id]/edit` | client | Edit trip form | `TripForm` with `mode='edit'` |

### Components (`app/src/components/`)

| Component | Props (sketch) | Shared? |
|---|---|---|
| `AuthForm` | `{ mode: 'signin' \| 'signup' \| 'forgot', onSubmit }` | yes — shared across 3 auth pages |
| `TripCard` | `{ trip: Trip, role: MemberRole }` | |
| `TripList` | `{ items: Trip[], page, limit, total }` | |
| `TripForm` | `{ mode: 'create' \| 'edit', initial?: Trip, onSubmit }` | |
| `DayCard` | `{ day: TripDay, itemCount, canEdit }` | |
| `DayList` | `{ days: TripDay[], itemsByDay: Record<string, ItineraryItem[]> }` | |
| `ItineraryItemForm` | `{ mode, initial?, dayId, tripId, onSubmit }` | |
| `ItineraryItemCard` | `{ item: ItineraryItem, canEdit, onEdit, onDelete }` | |
| `ItemTypePicker` | `{ value, onChange }` | 5-radio buttons for transport/lodging/activity/meal/note |
| `ConfirmDeleteDialog` | `{ open, title, requireTypedName?, expectedName?, onConfirm, onCancel }` | used for trip delete (typed-name) + item delete (no typed-name) |
| `EmptyState` | `{ icon, title, message, ctaLabel?, ctaHref? }` | used on empty trips list, empty day, empty items |
| `SkeletonCard`, `SkeletonList`, `SkeletonDay` | — | shared loading primitives |

### Client state shape (per-page summary)

- `/trips` — server-rendered; client state only for pagination control (`useRouter` push).
- `/trips/new`, `/trips/[id]/edit` — React 19 `useActionState` on the `TripForm`; validation from `CreateTripInput` / `UpdateTripInput`.
- `/trips/[id]/itinerary` — server-render initial items; client state per-day expanded/collapsed + open item form drawer `{ dayId, mode, initialItem }`.
- Auth pages — `useActionState` + server action that calls the matching `/api/auth/*` route.

---

## 3.7 Risks & deviations for R7

### Deviations from `SOLUTION_DESIGN.md` baseline

| # | Baseline | Sprint 1 actual | Reason | Action at R7 |
|---|---|---|---|---|
| D-1 | `itinerary_items.place_id` FK to `places(id)` (§2.7) | column **omitted** in `0001_init.sql` | `places` table is Sprint 2 scope (B-009/B-010). Keeping the FK would require shipping `places` DDL in Sprint 1. | Sprint 2 migration `0002_places_and_place_fk.sql` adds `places` table + `alter table itinerary_items add column place_id uuid references places(id) on delete set null` + `create index itinerary_items_place_idx`. Document at R7 close. |
| D-2 | `GET /api/trips/[id]/days` paginated per §4.4 | **un-paginated** in Sprint 1 | `trip_days` is naturally bounded (≤ 366 rows by the 365-day cap in `CreateTripInput`); pagination would be noise. | Note in SOLUTION_DESIGN Build Deviations; document the 365-day cap as the bounding mechanism. |
| D-3 | `tg_seed_owner_member` position — baseline shows it under the `trips` table DDL (§2.2) | moved to the **shared functions block** (top of migration) with `create trigger` inline with `trips` | Keeps all `create or replace function` idempotent and grouped; trigger creation stays with the table it binds. | None (equivalent behavior). |
| D-4 | Baseline §3.2 mentions `rpc('accept_trip_invitation')` | **not built** in Sprint 1 | Invitation accept flow is B-012 (Sprint 3). | None. |

### Risks flagged for [scrum-master]

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | In-memory rate limit does not hold across Vercel function instances | Attacker can brute-force auth beyond documented limit in prod | Upstash Redis swap in Phase B; explicitly flagged at Sprint 1 R7 close. Acceptable for the current single-user scope. |
| R-2 | Supabase keys not yet in `app/.env.local` | R3 backend cannot run migrations / integration tests | Blocker already tracked in `SPRINT.md`; owner: user; must resolve before R3 starts. |
| R-3 | `DELETE /api/trips/[id]` header-confirmation is unusual for a browser form | Frontend must explicitly set `X-Confirm-Name` in fetch; easy to miss | Document the header in `ConfirmDeleteDialog` contract; [frontend-engineer] to add an integration test. |
| R-4 | Date-shrink 409 response returns a list of blocking days | Frontend must render a structured list, not just a toast | `TripForm` edit mode handles the 409 body and displays blocking days in a list under the dates field. |
| R-5 | Password-reset completion page uses the Supabase default token flow (`/reset-password/[token]`) | Requires `NEXT_PUBLIC_SITE_URL` correctly set in every environment | Verified present in `.env.example`; Vercel env-var presence check in Sprint close checklist. |
| R-6 | `itinerary_items` Sprint 2 migration will ALTER a Sprint 1 table in production | Any deployed trips will need to be backfilled with NULL `place_id` (safe) but the migration must be forward-compatible | `0002_*` will ship with `add column ... null` (no default) + index — non-blocking; documented at Sprint 2 R2. |

---

## Handoff checklist for R3/R4

- [ ] [backend-engineer] applies `0001_init.sql` via `npx supabase db push` in a branch project
- [ ] [backend-engineer] implements `app/src/lib/supabase/{server,browser,service}.ts`, `rate-limit.ts`, `validations/*`, and all routes in §3.2
- [ ] [backend-engineer] writes every audit-log entry listed in §3.2
- [ ] [backend-engineer] creates `app/src/middleware.ts` per §3.5
- [ ] [frontend-engineer] builds pages + components per §3.6 consuming the R3 API surface
- [ ] Both engineers honor R-2..R-6 mitigations above
