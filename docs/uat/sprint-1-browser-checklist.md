# TravelPlanner — Sprint 1 Browser UAT Checklist

**Sprint:** 1
**Items covered:** B-001, B-002, B-003, B-004, B-005, B-006, B-018
**Author:** [tester]
**Date:** 2026-04-24
**Environment:** Local dev — `http://localhost:3000`

**How to use this checklist:**
1. Run the dev server: `cd /Users/george/travelplanner/app && npm run dev`
2. Open `http://localhost:3000` in your browser.
3. Work through each case top-to-bottom. Mark `[x]` on PASS or FAIL.
4. Add notes in the Notes field for any deviation from Expected.
5. Return results to [tester] for the UAT report.

---

## Auth — Sign Up (B-001)

### UAT-01 — Sign-up form client-side validation

**Steps:**
1. Navigate to `http://localhost:3000/sign-up`.
2. Submit the form with an empty email and empty password.

**Expected:** Both fields show inline validation errors (email required, password required). No network request made.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-02 — Sign-up with weak password

**Steps:**
1. Navigate to `/sign-up`.
2. Enter a valid email (e.g. `test-uat-01@example.com`) and a password that is fewer than 12 characters (e.g. `Short1`).
3. Submit.

**Expected:** Inline error: password must be at least 12 characters (and meet complexity rules — upper, lower, digit). No account created.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-03 — Sign-up with mismatched confirm password

**Steps:**
1. Navigate to `/sign-up`.
2. Enter a valid email, a strong password (e.g. `MyStrong1234`), and a different confirm password (e.g. `MyStrong9999`).
3. Submit.

**Expected:** Inline error: passwords do not match. No account created.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-04 — Successful sign-up (new email)

**Steps:**
1. Navigate to `/sign-up`.
2. Enter a fresh email address you control (e.g. your real inbox), a strong password (`MyStrong1234`), matching confirm password.
3. Submit.

**Expected:** Form replaced by a "Check your email" confirmation message. No redirect to `/trips`. Check your inbox — a Supabase confirmation email should arrive within ~60 seconds.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-05 — Duplicate email anti-enumeration

**Steps:**
1. Navigate to `/sign-up`.
2. Enter the **same email** used in UAT-04 with a valid strong password.
3. Submit.

**Expected:** Same "Check your email" confirmation screen shown (no "Email already registered" error — anti-enumeration per B-001 AC 2). No visible hint that the address exists.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-06 — Unconfirmed user cannot access protected routes

**Steps:**
1. After UAT-04 (before clicking the confirmation email link), attempt to navigate directly to `http://localhost:3000/trips`.
2. Try to navigate to `http://localhost:3000/settings` (or `/account`).

**Expected:** Both redirects land on `/sign-in?redirect=...` — not on any protected page.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Auth — Sign In (B-002)

### UAT-07 — Email confirmation then sign-in

**Steps:**
1. Open the confirmation email from UAT-04 and click the confirmation link.
2. You should be redirected to the app (possibly `/trips` or `/sign-in`).
3. If redirected to sign-in, enter your credentials and submit.

**Expected:** After sign-in, redirected to `/trips`. Session cookie set (`sb-<ref>-auth-token`).

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-08 — Wrong password shows generic error

**Steps:**
1. Navigate to `/sign-in`.
2. Enter your confirmed email with a wrong password (e.g. `WrongPass999`).
3. Submit.

**Expected:** Generic error message: "Email or password incorrect" (or equivalent). No indication whether the email exists.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-09 — Post-sign-in redirect honors `?redirect=`

**Steps:**
1. Sign out first (if signed in).
2. Navigate directly to `http://localhost:3000/trips`.
3. Confirm you are redirected to `/sign-in?redirect=%2Ftrips`.
4. Sign in with correct credentials.

**Expected:** After sign-in you land on `/trips` (the original destination), not on the default fallback.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Auth — Sign Out & Password Reset (B-003)

### UAT-10 — Sign out clears session

**Steps:**
1. Ensure you are signed in.
2. Trigger sign-out (via header/nav button or `/api/auth/signout`).
3. After sign-out, try navigating to `http://localhost:3000/trips`.

**Expected:** After sign-out, redirected to `/` (or `/sign-in`). Subsequent attempt to reach `/trips` redirects to `/sign-in`. No trip data visible.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-11 — Forgot password — email sent

**Steps:**
1. Navigate to `/sign-in` and click the "Forgot password" link.
2. Enter your confirmed email address.
3. Submit the form.

**Expected:** Page shows "If this email is registered, you will receive a reset link." (or equivalent always-shown message — no enumeration). Check your inbox for the reset email.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-12 — Password reset link works and invalidates old session

**Steps:**
1. Sign in to the app in a separate browser tab (keep the session active).
2. Click the reset link from the email received in UAT-11.
3. On the reset page, enter a new strong password (different from the old one), submit.
4. Switch back to the tab with the old session; try to navigate to `/trips` or refresh.

**Expected:** New password accepted; you are redirected to sign-in (or `/trips` as newly authenticated). The old session tab is invalidated — refreshing it should force a redirect to `/sign-in`.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-13 — Bogus password-reset token rejected

**Steps:**
1. Navigate to `/reset-password/this-is-a-fake-token-1234567890abcdef`.

**Expected:** Page shows a clear error: token is invalid or expired. No password change possible.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Trips CRUD (B-004)

### UAT-14 — Create trip — required fields validation

**Steps:**
1. Sign in.
2. Navigate to `/trips/new`.
3. Submit the form with all fields blank.

**Expected:** Inline validation errors on: trip name (required), start date (required), end date (required), base currency (required or has a sensible default selected).

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-15 — Create trip — successful creation

**Steps:**
1. Navigate to `/trips/new`.
2. Fill in:
   - Trip name: `UAT Test Trip`
   - Start date: 5 days from today
   - End date: 7 days from today (3-day trip)
   - Base currency: `CHF`
   - Destination: `Zurich` (optional — fill it in)
   - Budget: `1000` (optional)
3. Submit.

**Expected:** Redirected to the trip overview or itinerary page. Trip exists in database with `owner` role. `trip_days` auto-seeded: exactly 3 rows (Day 1, Day 2, Day 3) visible on the itinerary page.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-16 — Trip list shows only user's trips, paginated

**Steps:**
1. Navigate to `/trips`.
2. Verify "UAT Test Trip" appears in the list.
3. Confirm the list is sorted by start date (most recent first).

**Expected:** Only trips where you are a member are shown. Pagination controls appear if > 20 trips exist (not testable with a single trip, but note whether pagination UI is present).

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-17 — Edit trip — basic fields update

**Steps:**
1. Open "UAT Test Trip" and navigate to edit (`/trips/[id]/edit`).
2. Change the trip name to `UAT Test Trip Edited`.
3. Save.

**Expected:** Trip name updated to "UAT Test Trip Edited" on the overview and list pages. No other data changed.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-18 — Edit trip — extend dates generates new trip_days

**Steps:**
1. Edit the trip: change end date from `+7 days` to `+9 days` (extend by 2 days, making it a 5-day trip).
2. Save.

**Expected:** Save succeeds. Itinerary page now shows 5 days (Day 1–Day 5). The 2 new days appear with empty "Add first item" CTAs.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-19 — Edit trip — shrink dates with items on removed days is blocked (409)

**Steps:**
1. First, add at least one itinerary item to Day 5 (the last day) — see UAT-24 for how.
2. Then edit the trip: shrink end date back to `+7 days` (removing Day 5 which has an item).
3. Submit.

**Expected:** Save is blocked with a warning. The UI shows a list of the days and item counts that would be removed (not just a generic error). The trip dates remain unchanged.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-20 — Delete trip — name mismatch rejected

**Steps:**
1. Open the trip and trigger the delete action.
2. In the confirmation dialog, type a name that does NOT match the trip name (e.g. `wrong name`).
3. Attempt to confirm.

**Expected:** Delete button remains disabled or submit fails with an error about name mismatch. Trip still exists.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-21 — Delete trip — correct name succeeds with cascade

**Steps:**
1. Create a new disposable trip named `DeleteMe` (2-day trip, any dates).
2. Add one itinerary item to it.
3. Open delete dialog; type `DeleteMe` exactly.
4. Confirm.

**Expected:** Trip deleted. Redirected to `/trips`. "DeleteMe" no longer in the list. All child rows (trip_days, itinerary_items) cascade-deleted.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Trip Days — Day View (B-005)

### UAT-22 — Itinerary page shows correct day structure

**Steps:**
1. Open "UAT Test Trip Edited" and navigate to `/trips/[id]/itinerary`.

**Expected:** Page lists days in date order. Each day shows: date (formatted, e.g. "Monday, 29 April 2026"), "Day N" label, item count. Empty days show "Add first item" CTA (or equivalent empty state with icon + message + CTA).

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-23 — Edit day title inline

**Steps:**
1. On the itinerary page, find Day 1.
2. Click the day title area to enter edit mode.
3. Type `Arrival Day`.
4. Press Enter (or click outside / blur).
5. Refresh the page.

**Expected:** "Arrival Day" persists as Day 1's title after refresh. The change saved on blur/Enter without requiring a separate save button.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Itinerary Items CRUD (B-006)

### UAT-24 — Add item — type selection step appears

**Steps:**
1. On the itinerary page, click "Add item" (or "Add first item") on any day.

**Expected:** A type-selection step appears offering exactly 5 types: transport, lodging, activity, meal, note. Selecting a type proceeds to the item form.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-25 — Add activity item

**Steps:**
1. Click "Add item" on Day 1.
2. Select "activity".
3. Fill in: title `Lake Zurich walk`, start time, notes `Bring a jacket`, cost `0`, currency `CHF`.
4. Save.

**Expected:** Item appears on Day 1, sorted by start time. Item card shows title, time, and type badge. Day 1 item count increments by 1.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-26 — Add transport item

**Steps:**
1. Click "Add item" on Day 1.
2. Select "transport".
3. Fill in: title `Train to Basel`, start time (earlier than the activity), cost `15`, currency `CHF`.
4. Save.

**Expected:** Transport item appears above the activity on Day 1 (sorted by start time, earlier first). Type badge shows "transport".

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-27 — Add lodging item

**Steps:**
1. Click "Add item" on Day 1.
2. Select "lodging".
3. Fill in: title `Hotel zum Storchen`, no start time, notes `Confirmation: ABC123`, cost `200`.
4. Save.

**Expected:** Lodging item appended after time-slotted items (null start time goes last). Type badge shows "lodging".

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-28 — Add meal item

**Steps:**
1. Click "Add item" on Day 2.
2. Select "meal".
3. Fill in: title `Fondue dinner`, start time `19:00`.
4. Save.

**Expected:** Meal item appears on Day 2 at 19:00 with "meal" badge.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-29 — Add note item

**Steps:**
1. Click "Add item" on Day 2.
2. Select "note".
3. Fill in: title `Packing reminder`, notes `Don't forget adapters`.
4. Save.

**Expected:** Note item appears on Day 2. Type badge shows "note".

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-30 — Edit itinerary item

**Steps:**
1. Click edit on the "Lake Zurich walk" activity item.
2. Change title to `Lake Zurich walk (extended)` and cost to `5`.
3. Save.

**Expected:** Item card updates immediately (or after re-render) to show new title and cost. No duplicate created.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-31 — Delete itinerary item — confirmation required

**Steps:**
1. Click delete on the "Lake Zurich walk (extended)" item.
2. A confirmation modal should appear showing the item title.
3. Cancel first — verify item NOT deleted.
4. Re-open delete, confirm.

**Expected:** After cancel, item still present. After confirm, item removed from day. Day item count decrements.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-32 — Items sorted by start time (null last)

**Steps:**
1. Review Day 1 after adding the transport (with start time), activity (with start time), and lodging (no start time).

**Expected:** Order: transport (earliest time) → activity → lodging (no time, appended last). If times are equal, created_at tiebreak.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Route Guards (B-018)

### UAT-33 — Unauthenticated access to `/trips` redirects to sign-in

**Steps:**
1. Sign out.
2. Navigate directly to `http://localhost:3000/trips`.

**Expected:** Redirected to `/sign-in?redirect=%2Ftrips`. No trip data rendered. Status 302.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-34 — Unauthenticated access to nested route redirects with full path preserved

**Steps:**
1. While signed out, navigate directly to `http://localhost:3000/trips/some-fake-id/itinerary`.

**Expected:** Redirected to `/sign-in?redirect=%2Ftrips%2Fsome-fake-id%2Fitinerary`. Full path preserved in the `redirect` (or `next`) query param.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-35 — Unauthenticated API request returns 401 JSON

**Steps:**
1. Open browser DevTools → Network tab (or use curl).
2. While signed out, make a fetch to `http://localhost:3000/api/trips` (or open it in a new tab).

**Expected:** HTTP 401 response with JSON body: `{ "error": { "code": "unauthorized", "message": "Unauthorized" } }` (or equivalent). NOT a redirect — API routes return JSON 401.

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

### UAT-36 — Session validated server-side (not just client cookie readable)

**Steps:**
1. Open DevTools → Application → Cookies.
2. Note the `sb-<ref>-auth-token` cookie is `HttpOnly` (not readable via `document.cookie`).

**Expected:** Cookie is marked HttpOnly. You cannot read it via `document.cookie` in the console (returns undefined/empty for this cookie).

- [ ] PASS  [ ] FAIL

**Notes:** _______________

---

## Summary Table

| ID | Title | Result |
|----|-------|--------|
| UAT-01 | Sign-up client validation | |
| UAT-02 | Weak password rejected | |
| UAT-03 | Mismatched passwords rejected | |
| UAT-04 | Successful sign-up | |
| UAT-05 | Duplicate email anti-enumeration | |
| UAT-06 | Unconfirmed user blocked | |
| UAT-07 | Confirmation + sign-in | |
| UAT-08 | Wrong password generic error | |
| UAT-09 | Post-sign-in redirect honors `?redirect=` | |
| UAT-10 | Sign out clears session | |
| UAT-11 | Forgot password email sent | |
| UAT-12 | Reset link works + old session invalidated | |
| UAT-13 | Bogus token rejected | |
| UAT-14 | Create trip validation | |
| UAT-15 | Create trip success + trip_days seeded | |
| UAT-16 | Trip list scope + sort | |
| UAT-17 | Edit trip fields | |
| UAT-18 | Extend dates generates new trip_days | |
| UAT-19 | Shrink dates with items → 409 blocked | |
| UAT-20 | Delete — name mismatch rejected | |
| UAT-21 | Delete — correct name + cascade | |
| UAT-22 | Itinerary day structure display | |
| UAT-23 | Day title inline edit | |
| UAT-24 | Add item type selection | |
| UAT-25 | Add activity item | |
| UAT-26 | Add transport item | |
| UAT-27 | Add lodging item | |
| UAT-28 | Add meal item | |
| UAT-29 | Add note item | |
| UAT-30 | Edit itinerary item | |
| UAT-31 | Delete item with confirmation | |
| UAT-32 | Items sorted by start time | |
| UAT-33 | Unauth `/trips` → redirect | |
| UAT-34 | Unauth nested route preserves path | |
| UAT-35 | Unauth API → 401 JSON | |
| UAT-36 | Session cookie is HttpOnly | |

**Total: 36 cases**
