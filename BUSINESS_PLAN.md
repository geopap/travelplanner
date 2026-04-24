# TravelPlanner — Business Plan

**Version:** 1.0
**Date:** 2026-04-24
**Author:** [product-manager]
**Status:** Active

---

## 1. Executive Summary

TravelPlanner is a personal travel planning application built for independent travelers who plan complex, multi-city trips and are frustrated by the patchwork of Trello boards, spreadsheets, and notes apps they currently use. The app provides a day-structured itinerary builder, Google Places-powered place discovery and bookmarking, per-trip budget and expense tracking with split-among support, and multi-user collaboration with role-based access — all in a single mobile-first web app. It is built by one developer for personal use, with a clear path to a premium SaaS tier if there is broader demand. The first real trip seeded into the app is Japan 2026: a 26-day, 8-city itinerary that immediately stress-tests every core feature at launch.

---

## 2. Problem Statement

Planning a complex international trip today requires a minimum of four separate tools: a task/card tool (Trello, Notion) for the itinerary structure; a spreadsheet for budget and expenses; Google Maps or a separate discovery app for finding and saving restaurants and sights; and email or a shared document for communicating the plan to trip partners. The coordination overhead is significant: plans get out of sync, budget tracking lags behind reality, sharing the plan means handing over an editable document with no role controls, and accessing the plan on a mobile device while traveling is cumbersome. There is no product today that unifies structured day-by-day itinerary planning, place discovery with rich data, expense tracking with split logic, and role-based collaboration in a single mobile-ready application at a consumer price point.

---

## 3. Solution

TravelPlanner consolidates the five pillars of trip planning into one app:

1. **Structured itinerary**: Day-by-day view auto-generated from trip dates, with typed items (transport, lodging, activity, meal, note) on each day.
2. **Place discovery**: Google Places search proxy returns rich place data (photos, hours, ratings) cached in the app's database, bookmarkable per trip.
3. **Budget and expenses**: Trip-level budget with categorized expense log, multi-currency support, paid-by and split-among fields, and a net balance summary per member.
4. **Collaboration**: Email-based invitations with single-use expiring tokens, role-based access (owner / editor / viewer), and a member management interface.
5. **Mobile-first map view**: Leaflet map on each day view showing the geographic spread of the day's stops.

The Japan 2026 Trello import script demonstrates the data migration path for existing trips and validates the full feature set before any user acquisition.

---

## 4. Market Opportunity

The global online travel market exceeds $800 billion annually. Within it, the trip-planning and itinerary-management segment is fragmented between general productivity tools (Notion, Trello) and specialized travel apps (TripIt, Wanderlog) that each solve a subset of the problem. The independent traveler segment — people who research, book, and manage their own trips without a travel agent — is the fastest-growing travel demographic, driven by remote-work flexibility and the rise of long-haul, multi-stop trips. In Europe alone, outbound international travel is growing at 5–7% per year, with Switzerland, Germany, and the Netherlands producing a disproportionate share of high-spend independent travelers.

The serviceable addressable market for a premium trip-planning tool aimed at organized independent travelers (those who take 2+ international trips per year and would pay for a well-designed tool) is estimated at 2–5 million users globally at a $5–10/month price point, representing a $120–600 million annual revenue opportunity. For a solo-built product starting as personal-use, even capturing 0.01% of this market (200–500 paying users) would cover infrastructure and API costs with meaningful personal income.

---

## 5. Business Model and Pricing

**Phase 1 — Personal use (current)**: The app is deployed as a private instance for the developer's own use. No monetization. Infrastructure cost: Supabase free tier (up to 500MB DB, 1GB storage, 50,000 monthly active users) plus Google Places API costs, mitigated by aggressive caching (7-day TTL, cache-first design).

**Phase 2 — Free + Premium (if commercialized)**: A freemium model with a clear upgrade trigger.

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0/month | 3 trips, 2 collaborators per trip, 50 expense entries per trip, no receipt storage |
| Premium | $8/month (or $72/year) | Unlimited trips, 10 collaborators per trip, unlimited expenses, 1GB receipt storage, ICS export, flight status tracking |
| Team (future) | $20/month per organizer | All Premium features, shared team workspace, trip templates library, priority support |

The upgrade trigger is natural: a user creating their 4th trip, or inviting a 3rd collaborator, hits the free-tier limit and is prompted to upgrade. The premium price point is set below TripIt Pro ($49/year) and comparable to Wanderlog Pro ($35/year) with a significantly wider feature set.

**API cost control**: Google Places API calls are rate-limited per user (30/minute) and cached aggressively (7-day TTL). A Places API call costs approximately $0.017 per lookup (Basic Data) to $0.032 per lookup (Advanced). With a 70% cache hit rate target, the marginal cost per active user per month is estimated at under $0.20.

---

## 6. Product Roadmap

**Phase 1 — Foundation (Sprints 1–4, current)**
Build the core data model and all five feature pillars: auth, trips CRUD, trip days, itinerary items, transportation, accommodations, Google Places proxy and bookmarks, budget and expenses, member invitations and roles, Leaflet map view, and the Japan 2026 Trello import script.

**Phase 2 — Enhancements (Sprints 5–8)**
OAuth sign-in (Google), transactional email for invitations, ICS calendar export, flight status tracking via third-party API, trip templates, offline mode (service worker + IndexedDB), and data export for GDPR compliance.

**Phase 3 — Platform (Sprints 9+)**
If commercialization is pursued: Stripe billing integration, free/premium tier enforcement, public landing page and sign-up flow, email marketing automation, ProductHunt launch, and the Team workspace tier. If the app remains personal-use, Phase 3 focuses on AI-assisted itinerary suggestions (using Claude API) and deeper integrations (Google Calendar sync, booking platform import).

---

## 7. Go-to-Market Strategy

**Phase 1 — Personal use**: No public launch. The app is deployed for the developer's Japan 2026 trip. Feedback loop is direct.

**Phase 2 — Soft launch (if commercialized)**: Share a write-up on IndieHackers and HackerNews detailing the build process (Next.js 16 + Supabase + Leaflet + Google Places). The developer's Switzerland / European travel context provides a differentiated narrative vs. US-centric tools. No paid acquisition in Phase 2.

**Phase 3 — ProductHunt launch**: Time the ProductHunt submission to coincide with a completed Japan 2026 trip report (Dec 2026 / Jan 2027) that demonstrates the app's capability with a real 26-day trip. The trip report serves as a live demo and content marketing asset simultaneously.

**Positioning message**: "The trip planner for people who actually plan." Targets organized independent travelers who find TripIt too passive (email parsing only) and Notion too manual (blank canvas).

---

## 8. Competitive Advantages

1. **Five pillars in one app**: No competitor combines day-structured itinerary, Google Places bookmarks, expense tracking with splits, role-based collaboration, and a map view at the same price point.
2. **Data portability from day one**: The Japan 2026 Trello import script demonstrates a migration path and positions TravelPlanner as a tool that works with existing plans, not against them.
3. **Mobile-first execution**: Designed for use on a phone in a foreign city, not just at a desktop during planning. Bottom nav, skeleton loaders, and an LCP target of < 2.5s on 4G.
4. **Self-hostable**: The Supabase + Next.js stack is entirely portable. Privacy-conscious users can deploy their own instance with minimal infrastructure knowledge. This is a meaningful differentiator vs. SaaS-only competitors.
5. **Cost-efficient architecture**: Aggressive Google Places caching, RLS-secured Supabase backend, and a Vercel deployment model keep per-user infrastructure costs low enough for a sustainable freemium tier.

---

## 9. Financial Projections

**Phase 1 (personal use)**: Infrastructure costs approximately $0/month on Supabase free tier. Google Places API usage for personal trips: estimated 200–500 lookups/month totaling < $15/month. No revenue.

**Phase 2 (soft launch, 12 months)**: Target 50 free users and 10 Premium subscribers.
- Monthly recurring revenue: 10 × $8 = $80/month
- Infrastructure (Supabase Pro at $25/month + Vercel Pro at $20/month + Google Places API at ~$30/month): ~$75/month
- Net: approximately breakeven. Goal is product validation, not profit.

**Phase 3 (commercialized, 24 months)**: Target 500 Premium subscribers.
- Monthly recurring revenue: 500 × $8 = $4,000/month
- Infrastructure scales sub-linearly (Supabase $25 → $100/month; Vercel scales with usage); total infrastructure < $500/month
- Net monthly margin: ~$3,500 — sufficient to cover developer time for a side project

If the product does not gain traction beyond personal use, financial projections are not applicable and the roadmap focuses entirely on personal utility. That outcome is acceptable; the tool has value as a personal productivity app regardless of commercial outcome.

---

## 10. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google Places API cost overruns | Medium | High | 7-day cache TTL; cache-first architecture; per-user rate limiting (30 req/min); monitor monthly API spend; set budget alert at $50/month |
| Supabase vendor lock-in | Low | Medium | Postgres schema is standard SQL; auth abstracted behind a service layer; migration path to self-hosted Supabase or Neon is documented |
| RLS misconfiguration exposing trip data | Low | Critical | Defense-in-depth: RLS on every table + application-level auth guard on every API route; [security-reviewer] mandatory on every sprint; penetration test before any public launch |
| Google Places API terms of service violation | Low | High | Cache results per ToS (TTL required); display attribution text wherever Google data is shown; server-side proxy ensures key is never exposed |
| Scope creep delaying Japan trip readiness | Medium | Medium | Sprint 1–2 scope is locked to auth + trips + itinerary items; Japan import script is Sprint 4 with hard deadline of Oct 2026 (6 weeks before the trip) |
| Single-developer bus factor | High | Medium | CLAUDE.md documents all architecture decisions; SOLUTION_DESIGN.md captures schema and API contracts; codebase is TypeScript strict with no TODOs |
