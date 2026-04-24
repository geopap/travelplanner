# E2E Tests

Sprint 1 deferred — Playwright install and end-to-end harness will be added once a
staging Supabase project is provisioned (see Gate 8). Unit and integration coverage
in `app/src/__tests__/` covers route-handler contracts, validation, rate limiting,
the trip-access role hierarchy, and the session proxy.

Planned flows for Sprint 2:

- sign-up -> sign-in -> /trips -> create trip -> add day item -> sign out
- data isolation: user A cannot access user B's trip via URL or API
- password-reset end-to-end through Supabase inbox
