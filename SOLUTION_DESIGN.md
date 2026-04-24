# TravelPlanner — Solution Design

**Version:** 1.0
**Date:** 2026-04-24
**Owner:** [solution-architect]
**Status:** Draft — populated in Sprint 0

---

## 1. Project Structure

```
/Users/george/travelplanner/
├── CLAUDE.md                      # Agent rules + pipeline
├── SPRINT.md · BACKLOG.md · ...   # Product/process docs
├── agents/*.md                    # 17 agent definitions
├── docs/user-manual/              # End-user documentation
└── app/                           # Next.js application
    ├── src/
    │   ├── app/                   # App Router pages + API routes
    │   │   ├── (auth)/            # Sign in, sign up, invite accept
    │   │   ├── trips/             # Trip list + detail
    │   │   └── api/               # Server routes
    │   ├── components/            # UI components
    │   ├── lib/
    │   │   ├── supabase/          # Client, server, types
    │   │   ├── types/             # Domain types
    │   │   ├── validations/       # Zod schemas
    │   │   ├── hooks/             # Custom React hooks
    │   │   ├── utils/             # Formatters (dates, currency)
    │   │   └── ai/                # Reserved, empty in v1
    │   └── __tests__/             # Unit + integration tests
    ├── e2e/                       # Playwright tests
    ├── supabase/
    │   └── migrations/            # SQL migrations
    ├── scripts/
    │   └── import-trello.ts       # Japan 2026 import
    └── public/
```

## 2. Database Schema

*[Populated in Sprint 0 by [solution-architect]. See plan file for proposed tables: profiles, trips, trip_members, trip_days, itinerary_items, places, bookmarks, transportation, accommodations, expenses, trip_invitations.]*

## 3. Security Architecture

### 3.1 Authentication
Supabase Auth — email/password v1; OAuth providers in a later sprint.

### 3.2 Authorization
- RLS on every table
- Trip-scoped tables checked via membership: `EXISTS (SELECT 1 FROM trip_members WHERE trip_id = X AND user_id = auth.uid() AND status = 'accepted')`
- Role-based write restrictions: `viewer` read-only; `editor` write trip content; `owner` also manages members
- Application-level guards in every API route as defense-in-depth

### 3.3 Compliance
- GDPR: export + delete endpoints
- Audit logging on all mutations
- Google Places data cached with TTL; attribution displayed where required

## 4. API Contracts

*[Populated in Sprint 0. Endpoints: `/api/trips` CRUD, `/api/trips/[id]/members`, `/api/trips/[id]/days`, `/api/trips/[id]/items`, `/api/trips/[id]/expenses`, `/api/invitations/[token]/accept`, `/api/places/search`, `/api/places/[id]`.]*

## 5. Frontend Architecture

Pages: `/trips`, `/trips/new`, `/trips/[id]`, `/trips/[id]/itinerary`, `/trips/[id]/places`, `/trips/[id]/budget`, `/trips/[id]/members`, `/invitations/[token]`.

Leaflet map for day stops. Place detail pages populated from cached Google Places data.

## 6. AI/ML Architecture

Reserved for a later sprint (e.g., itinerary suggestions, smart budget forecasting). Empty in v1.

## 7. Performance Standards

| Metric | Target |
|--------|--------|
| API P95 | < 500ms |
| Page LCP | < 2.5s |
| DB query | < 200ms |
| Places cache hit | < 50ms |

## 8. Deployment Architecture

*[Populated in Sprint 0 — likely Vercel + Supabase cloud.]*

---

## Runbooks

*(added as async jobs/background processes are created)*

## Rollback Plans

*(added per sprint as DB migrations and breaking changes are introduced)*

## Incident Log

*(post-mortems for SEV1/SEV2 incidents)*

## Build Deviations

*(deviations from R2 architecture plans, documented at R7 close)*
