# TravelPlanner — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-04-24
**Author:** [product-manager]
**Status:** Active

---

## 1. Product Vision and Strategy

### 1.1 Vision Statement

One app for everything your trip needs — from the first flight search to the last restaurant receipt.

### 1.2 Strategic Context

Leisure travel is one of the most intention-driven activities in a person's life, yet the tools most travelers use to plan trips have not evolved: Trello boards for task lists, Google Docs for itineraries, spreadsheets for budgets, email threads for sharing with partners, and a separate app for discovering places. The global travel planning market sits within the broader travel technology sector valued at over $900 billion annually, with independent and semi-independent travelers (those who research and book on their own rather than using a travel agent) representing the fastest-growing segment.

Mobile-first behavior has transformed how people plan. Travelers research on desktop but execute — checking in, reading maps, updating plans — on mobile while on the road. This creates demand for an app that is equally usable at home during planning as it is in a Tokyo train station. No current tool occupies the full planning-to-execution space for cost-conscious independent travelers.

The timing is right because: (1) Supabase and Next.js App Router have matured to the point where a single developer can build a production-quality multi-user collaborative app in weeks rather than months; (2) Google Places API v2 makes rich place data accessible at reasonable cost with proper caching; (3) the Japan 2026 trip — a 26-day, 8-city, 319-item itinerary — exists as a real-world test bed that immediately validates every core feature on launch.

### 1.3 Problem Statement

Today, planning a complex multi-city trip looks like this:

- **Itinerary fragmentation**: The day-by-day plan lives in a Trello board (or a Google Doc), flights and hotel confirmations are in email, activities are in a separate notes app or another Trello list. There is no single view of "what is happening on Thursday, November 20."
- **No budget tracking in context**: A spreadsheet tracks costs, but it has no relationship to the actual itinerary. You cannot see that Day 7 is 40% over budget without manually cross-referencing two documents.
- **Collaboration friction**: Sharing a Trello board gives a trip partner view access, but there is no structured role — anyone can delete anything, there is no invite flow, and there is no way to know who changed what.
- **Place data is flat**: Restaurants and sights are stored as names or URLs in cards. There are no opening hours, ratings, photos, or maps. Planning a dinner requires opening Google Maps in a separate tab, finding the place again, and reading it there.
- **No mobile-ready trip view**: Trello on mobile is functional but not optimized for "I am standing in Osaka and need to know where my hotel is and when I need to leave."
- **No cross-trip expense history**: Each trip's budget spreadsheet is isolated. There is no way to compare what you spent in Japan vs. a previous European trip.

### 1.4 Solution Overview

TravelPlanner replaces the patchwork with a single purpose-built app. A trip owner creates a trip with dates, destination, base currency, and a budget. The app generates a day-by-day structure automatically. Within each day, the owner adds itinerary items typed as transport, lodging, activity, meal, or note — each with time, cost, and optional place link. Transportation (flights, trains, transfers) has structured fields for carrier, confirmation number, and times. Accommodations span multiple days with check-in/check-out dates. Places are looked up via Google Places search, cached in the app's database, and bookmarked per trip with category tags (restaurant, sight, museum, shopping). Each trip has a budget and an expense log where amounts, categories, currencies, and who paid are all tracked. Trip partners are invited by email with a role: owner, editor, or viewer. The entire plan is accessible on mobile with a map view of each day's stops. For the first real trip, a one-shot import script reads the Japan 2026 Trello export and populates the full trip structure automatically.

### 1.5 Competitive Positioning

| Tool | Strengths | Gaps vs. TravelPlanner |
|------|-----------|------------------------|
| **TripIt** | Parses booking confirmation emails automatically; strong flight tracking | No day-by-day itinerary builder; no budget tracking; no bookmark/discovery layer; expensive Pro tier |
| **Wanderlog** | Good map-based itinerary builder; Google Places integration; free tier | Budget tracking is superficial; collaboration is limited (no role-based access); no expense split tracking; no structured transportation fields |
| **Roadtrippers** | Strong for road trips; route optimization | Focused only on road trips; no hotel blocks; no flight tracking; no expense management |
| **Notion travel templates** | Fully flexible; good for power users | No Google Places integration; requires manual data entry for every field; no invitation flow; no map view; significant setup per trip |
| **TravelPlanner** | Structured day-by-day plan + Google Places bookmarks + budget + expense split + role-based collaboration in one mobile-first app | First-mover on the specific combination of all five pillars for independent travelers |

---

## 2. Target Personas

### 2.1 Persona A — Trip Organizer

**Role**: Primary planner. Creates and owns the trip.

**Context**: Mid-30s to mid-40s professional, traveling 2-4 times per year on trips that last 1-4 weeks. Often planning trips to non-English-speaking destinations with complex logistics (multiple cities, multiple modes of transport, mix of booked and spontaneous activities). Based in a high-cost country (e.g., Switzerland, Germany, Netherlands) and budget-conscious — not cheap, but tracking spend matters. Uses a laptop for deep planning sessions and a phone while traveling.

**Core needs**:
- Single source of truth for the entire trip
- Day-structured view so nothing is missed
- Budget visibility without switching to a spreadsheet
- Ability to share the plan with a partner and assign them tasks without losing control

**Decision driver**: "I need to stop copying things between five different apps. I want to open one thing and see the full picture."

### 2.2 Persona B — Trip Partner

**Role**: Invited collaborator. Contributes to and follows the plan.

**Context**: Partner, friend, or family member invited to the trip. May or may not have been involved in the initial planning. During planning, they want to add ideas (restaurant suggestions, things to see). During the trip, they need to read the day's plan without being overwhelmed by editing controls.

**Core needs**:
- Simple, read-optimized view of the itinerary
- Ability to add bookmarks and notes without breaking anything
- Real-time access to the latest version of the plan (no "can you resend the updated doc?")
- Expense visibility so they know what has been paid and what they owe

**Decision driver**: "I don't want to manage another app. I just want to open a link, see what we're doing today, and know where to be."

---

## 3. Core Features and Requirements

### 3.1 Trips

**Feature group**: Create and manage top-level trip records.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-TRP-01 | Create trip | User fills a form: trip name, start date, end date, primary destination (free text), base currency (ISO 4217 picker), total budget (optional). On save, `trip_days` rows are auto-generated for each calendar day. | (1) Form validates: name required (max 120 chars), start ≤ end date, base currency required. (2) `trips` row created with `owner_id = auth.user`. (3) One `trip_days` row created per calendar day between start and end inclusive, numbered sequentially. (4) Trip appears in user's trip list immediately. (5) Owner role recorded in `trip_members`. | backlog |
| F-TRP-02 | Trip list | Authenticated user sees a paginated list of trips they are a member of (any role). Each card shows: trip name, destination, dates, cover image (or placeholder), days until trip / days since trip. | (1) Only trips where the user has a non-revoked `trip_members` row appear. (2) Trips sorted by start date descending. (3) "Upcoming" / "Past" / "Active" badge displayed correctly relative to today. (4) List is paginated (≥20 per page). (5) Empty state shows "Plan your first trip" CTA. | backlog |
| F-TRP-03 | Trip detail / overview | Trip overview page shows: name, destination, dates, cover image, member count, budget summary (spent vs. budget), and tab navigation to Itinerary, Places, Budget, Members. | (1) Page accessible to any trip member. (2) Budget summary shows total budget, total logged expenses, and remaining (can be negative). (3) Member count shows avatars for up to 5 members, "+N more" if more. (4) Page LCP < 2.5s on mobile. | backlog |
| F-TRP-04 | Edit trip | Owner or editor can update trip name, destination, dates, cover image, base currency, total budget. Changing dates outside the existing range generates new `trip_days` rows; shrinking dates does not delete days that contain itinerary items (warns instead). | (1) Only `owner` or `editor` role can reach the edit form. (2) Extending date range: new `trip_days` rows created for new days. (3) Shrinking date range: if itinerary items exist on removed days, user sees a blocking warning listing the affected days. (4) Base currency change does not convert existing expense amounts (user is warned). | backlog |
| F-TRP-05 | Delete trip | Owner can delete a trip. Requires a confirmation dialog with the trip name typed. Cascade deletes all trip-scoped rows. | (1) Only `owner` role can trigger delete. (2) Confirmation dialog requires user to type the exact trip name before the confirm button enables. (3) On confirm, deletes: `trips`, `trip_days`, `itinerary_items`, `transportation`, `accommodations`, `expenses`, `bookmarks`, `trip_members`, `trip_invitations` rows for that trip. (4) User redirected to trip list. (5) Deleted trip no longer appears in any member's list. | backlog |

### 3.2 Itinerary (Days + Items)

**Feature group**: Day-structured itinerary builder.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-ITN-01 | Day view | Each trip day shows: date, day number, optional day title, a list of itinerary items in chronological order, and a "+" button to add an item. | (1) Days listed in date order. (2) Items within a day sorted by `start_time` ascending (null times last). (3) Day title is editable inline by editor/owner. (4) Each item shows: type icon, title, time range, cost (in trip currency). (5) Viewer role sees items but no edit controls. | backlog |
| F-ITN-02 | Add itinerary item | Editor/owner adds an item to a day by selecting a type (transport, lodging, activity, meal, note) and filling the appropriate fields. | (1) Type selection is the first step. (2) Common fields: title (required), start time, end time, notes, cost, currency, optional place link. (3) Type-specific fields: transport → see F-TRP-03; lodging → see F-ACM-01; activity/meal/note → no extra required fields. (4) Item appears in the day view immediately on save. (5) `trip_id` and `day_id` written server-side, never trusted from client. | backlog |
| F-ITN-03 | Edit / delete itinerary item | Editor/owner can edit any field of an existing item or delete it (with confirmation). | (1) All fields editable. (2) Delete requires confirmation modal. (3) Item removed from day view on delete. (4) Viewer cannot reach edit or delete controls. | backlog |

### 3.3 Transportation (Flights, Trains, Transfers)

**Feature group**: Structured transport records linked to itinerary days.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-TRN-01 | Add transportation segment | When adding an itinerary item of type "transport," extra fields appear: mode (flight / train / bus / car / ferry), carrier / operator, confirmation number, departure location, arrival location, departure datetime, arrival datetime, cost, currency, notes. | (1) Mode field required. (2) Departure datetime stored in UTC, displayed in local format via `Intl.DateTimeFormat`. (3) A `transportation` row created in addition to the `itinerary_items` row (linked by foreign key). (4) Segment appears on the correct day based on departure date. (5) Confirmation number stored as plain text (not masked). | backlog |
| F-TRN-02 | Transportation summary | Trip overview shows a "Transport" section listing all segments chronologically with from/to, carrier, and times. | (1) All transport segments for the trip listed in departure time order. (2) Each row links to the day view for that segment. (3) Flight segments show carrier + confirmation. (4) Section is accessible to all trip members. | backlog |

### 3.4 Accommodations

**Feature group**: Hotel and accommodation blocks spanning multiple days.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-ACM-01 | Add accommodation | Editor/owner adds an accommodation block: hotel name or place link, check-in date, check-out date, confirmation number, cost per night, total cost, notes. Accommodation spans multiple `trip_days`. | (1) Check-in date must be within trip date range. (2) Check-out must be after check-in. (3) `accommodations` row created with `trip_id`, `place_id` (optional), check-in, check-out, confirmation, cost. (4) On the itinerary day view, check-in day shows "Check in: [hotel name]" and check-out day shows "Check out." (5) Cost per night and total cost can be entered independently; if both provided, they are stored as-is (not recalculated). | backlog |
| F-ACM-02 | Accommodation list | Trip overview includes an "Accommodations" section listing all lodging blocks with dates and cost. | (1) All accommodations listed in check-in date order. (2) Shows hotel name, check-in, check-out, total cost. (3) Links to place detail page if a `place_id` is set. | backlog |

### 3.5 Places and Bookmarks

**Feature group**: Google Places-powered discovery, place detail pages, and per-trip bookmark lists.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-PLC-01 | Place search | User types a place name or address. The app calls a server-side proxy that queries Google Places API and returns results (name, address, lat/lng, category). Results displayed in a dropdown. | (1) Search calls `/api/places/search?q=...` — never exposes the Google API key to the client. (2) Results appear within 800ms for cached hits, 3s for live API calls. (3) If the place already exists in the `places` cache table (matched by `google_place_id`), it is returned from cache. (4) Minimum 2 characters before search fires. (5) Rate limiting: max 30 requests/minute per user. | backlog |
| F-PLC-02 | Place detail cache | When a place is selected from search or bookmarked, the app fetches full place details (photos, opening hours, rating, website, phone) from Google Places and stores them in the `places` table with a TTL of 7 days. | (1) Full details fetched from Google Places API via server-side proxy on first request. (2) Subsequent requests within TTL served from `places.cached_details` JSONB column. (3) Google attribution text displayed wherever place data is shown (per Google Places API terms). (4) Cache miss re-fetches from Google and updates TTL. | backlog |
| F-PLC-03 | Place detail page | Each cached place has a detail page showing: name, photos, address, rating, opening hours, website, Google Maps link, and a "Bookmark" button for the current trip. | (1) Page renders from cache data. (2) Photos displayed with Google attribution. (3) Opening hours displayed in local time using `Intl.DateTimeFormat`. (4) "Bookmark for [trip name]" button visible if user is a member of the trip. (5) If user navigates to place detail without a trip context, bookmark button shows "Select a trip." | backlog |
| F-PLC-04 | Bookmark a place | Editor/owner bookmarks a place for a trip with a category: restaurant, sight, museum, shopping. Optional notes field. | (1) Bookmark creates a `bookmarks` row with `trip_id`, `place_id`, `category`, `notes`, `user_id`. (2) Same place can be bookmarked in multiple trips independently. (3) Bookmark appears in the trip's Places tab. (4) Viewer cannot create bookmarks. (5) Duplicate bookmark (same trip + place) prevented — "Already bookmarked" feedback shown. | backlog |
| F-PLC-05 | Trip bookmarks list | Trip Places tab shows all bookmarked places grouped by category, with place name, photo thumbnail, rating, and notes. | (1) Grouped by category: Restaurants, Sights, Museums, Shopping. (2) Each group sorted by name. (3) Photo thumbnail from cached place details. (4) Tapping a place navigates to the place detail page. (5) Viewer can view all bookmarks. | backlog |

### 3.6 Budget and Expenses

**Feature group**: Per-trip budget and expense tracking with category breakdown and split-among support.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-BDG-01 | Trip budget | Owner sets a total budget for the trip at creation or via edit. Budget displayed on overview with spent/remaining. | (1) Budget is optional (trip can exist without one). (2) Budget stored in trip's `base_currency`. (3) Remaining = budget − sum of all expenses converted to base currency. (4) Negative remaining shown in red. (5) Budget is editable by owner at any time. | backlog |
| F-BDG-02 | Log expense | Editor/owner logs an expense: category (accommodation, transport, food, activities, shopping, other), description, amount, currency, date, paid_by (trip member), split_among (array of member IDs), optional receipt image URL. | (1) Amount required; currency defaults to trip base currency but is editable. (2) Paid_by defaults to logged-in user. (3) Split_among defaults to all current trip members. (4) `expenses` row created with all fields. (5) Expense visible in budget summary immediately. (6) Receipt URL stored as text (upload handled separately). | backlog |
| F-BDG-03 | Expense list | Trip Budget tab lists all expenses chronologically with filters by category, paid_by, and date range. Shows per-person totals and a simplified "who owes whom" summary. | (1) All expenses listed in date descending order by default. (2) Category filter narrows the list. (3) Per-member total section: shows how much each member paid and how much they owe (based on split). (4) "Who owes whom" simplifies splits into net balances. (5) Amounts in original currency shown; base currency equivalent shown in parentheses. | backlog |
| F-BDG-04 | Category breakdown | Budget tab shows a breakdown of spend by category as a simple bar or list view. | (1) Each category shows: budgeted amount (if set per category) vs. spent amount. (2) Categories with no expenses still shown with 0 spent. (3) Percentages shown as proportion of total spent (not total budget). | backlog |

### 3.7 Collaboration

**Feature group**: Trip member management with role-based access control.

| ID | Feature | Description | Acceptance Criteria | Status |
|----|---------|-------------|---------------------|--------|
| F-COL-01 | Invite by email | Owner sends an invitation to a trip by entering an email address and selecting a role (editor or viewer). A crypto-random single-use token is generated; an invitation link is sent. | (1) Only `owner` role can invite. (2) Invitation creates a `trip_invitations` row: `trip_id`, `email`, `role`, `token` (crypto-random UUID or 32-byte hex), `expires_at` (48 hours from creation). (3) Email sent to the invitee (or, for v1, link is displayed on screen for manual sharing). (4) Invitation link format: `/invite/[token]`. (5) Inviting an already-accepted member shows "Already a member" without creating a duplicate. | backlog |
| F-COL-02 | Accept invitation | Invitee clicks the link, lands on an invitation acceptance page. If not logged in, they are redirected to sign up / sign in first, then back to the invite URL. On accept, they become a trip member. | (1) Token validated server-side: must exist, not expired, not already used. (2) If invitee is not authenticated, redirect to auth with return URL. (3) On accept: `trip_members` row created with the role from the invitation; `trip_invitations` row marked used. (4) Invitee redirected to the trip overview. (5) Expired or invalid tokens show a clear error message. | backlog |
| F-COL-03 | Member list and roles | Trip Members tab shows all current members with their role badge. Owner can change a member's role or remove them. | (1) All accepted members listed with name (or email if name not set), role badge, and join date. (2) Owner can change role via dropdown: owner / editor / viewer. (3) Owner cannot remove themselves (they must transfer ownership first or delete the trip). (4) Removing a member requires a confirmation modal. (5) Viewer can see the member list but cannot make changes. | backlog |

---

## 4. Success Metrics and KPIs

| Metric | Definition | Target (6 months post-launch) | Category |
|--------|-----------|-------------------------------|----------|
| Trips created | Count of `trips` rows created (excluding test data) | 10 trips | Adoption |
| Trip days with ≥1 item | `trip_days` rows that have at least one `itinerary_items` child | 70% of days on active trips | Engagement |
| Itinerary items logged | Total `itinerary_items` rows created | 500 items | Engagement |
| Expenses logged | Total `expenses` rows created | 200 expenses | Feature usage |
| Budget set on trip | % of trips with a non-null `total_budget` | 80% | Feature usage |
| Collaborators invited | Total `trip_invitations` rows sent | 5 invited | Collaboration |
| Invitation acceptance rate | Accepted invitations / total sent | 60% | Collaboration |
| Places bookmarked | Total `bookmarks` rows | 100 bookmarks | Feature usage |
| Mobile sessions | % of sessions from a mobile user agent | 50% | Platform mix |
| Active trips (last 30 days) | Trips with any itinerary edit in last 30 days | 2 concurrent trips | Health |
| API P95 latency | 95th percentile server response time | < 500ms | Performance |
| Place search cache hit rate | Cache hits / total place search calls | > 70% | Cost control |

---

## 5. Constraints and Compliance

### 5.1 Data Privacy and Compliance

- GDPR applies: users can export all their data and request deletion. Data export returns a JSON document covering trips, itinerary items, expenses, bookmarks.
- No PII (names, emails, locations) in application logs or error messages.
- Google Places data stored with attribution and cache TTL as required by Google's Terms of Service. Attribution text displayed wherever Google data is surfaced.
- Expense receipt images: stored as URLs; actual files stored in Supabase Storage with access restricted to trip members.

### 5.2 Security Requirements

- Authentication via Supabase Auth (email/password in v1; OAuth in a later sprint).
- Row-Level Security enabled on every table. Trip-scoped resources access-controlled via `trip_members` membership check.
- Role enforcement: viewer = read only; editor = read + write trip content; owner = full control including member management and trip deletion.
- Application-level auth guards on every API route (defense-in-depth beyond RLS).
- Client never receives the Google Places API key — all calls go through a server-side proxy.
- Invitation tokens: cryptographically random, single-use, expire after 48 hours.
- Rate limiting on: auth endpoints (5 attempts / 15 minutes per IP), invitation sends (10 / hour per user), Google Places proxy (30 / minute per user).

### 5.3 Performance Constraints

- API P95 response time: < 500ms for CRUD operations.
- Page LCP: < 2.5s on mobile (4G).
- Single DB query: < 200ms under normal load.
- Google Places proxy cache hits: < 50ms response time.
- N+1 queries: treated as CRITICAL findings in code review.
- All list API routes: must accept `page` and `limit` parameters.

### 5.4 Localization

- v1 English only. No i18n framework installed.
- Dates formatted via `Intl.DateTimeFormat` using the user's browser locale.
- Currency amounts displayed with ISO 4217 code; no automatic conversion in v1.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Availability | 99% uptime target (single Supabase instance acceptable for v1) |
| Scalability | Designed for up to 10,000 users and 100,000 trips in v1 schema |
| Accessibility | WCAG 2.1 AA target; semantic HTML; keyboard navigability for all primary flows |
| Mobile-first | All pages usable on 375px viewport; tap targets ≥ 44px; bottom-nav pattern for trip pages |
| Offline | v1: online-only. Graceful degradation if connection drops (show cached page, disable mutation controls). Offline-first deferred to Phase B. |
| Browser support | Chrome, Safari, Firefox — last 2 major versions. Safari iOS 17+ for primary mobile target. |
| TypeScript | Strict mode throughout. No `any`. No non-null assertions without validation. |
| Audit logging | All mutations logged with `user_id`, `timestamp`, `action`, `resource_id` in an `audit_log` table. |
| Rollback | Every DB migration ships with a documented DOWN migration. |
