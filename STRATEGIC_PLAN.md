# TravelPlanner — Strategic Plan

**Version:** 1.0
**Date:** 2026-04-24
**Owner:** [marketing-manager]
**Status:** Active — Sprint 0 baseline

---

## 1. Executive Summary

Trip planning is a $40B+ global market — yet the experience of actually planning a trip remains fractured across a patchwork of tools that were never designed for it. Travellers use Trello for task tracking, Google Docs for itineraries, Google Maps for place discovery, a spreadsheet for budgets, and WhatsApp to coordinate with travel partners. None of these talk to each other. None understand the structure of a multi-city trip.

TravelPlanner is a purpose-built trip planning app that brings the full plan into one place: flights, transfers, hotels, a day-structured itinerary, bookmarked restaurants and sights (with live Google Places data), per-trip budget tracking, and real-time collaboration with invited trip partners. It is designed for people who plan seriously — who care about what day the ryokan is booked, how much the trip is costing, and whether their travel partner has seen the latest itinerary.

The immediate opportunity is product-market fit with a narrow, high-intent audience: multi-city international travellers who plan in groups of 2–5 people, have real budget constraints, and are frustrated by the tool chaos they currently endure. If the product solves this problem well — proven first on the builder's own Japan 2026 trip — it has a credible path to a broader audience of organised travellers who plan 1–3 international trips per year.

**Commercial potential is real but Phase 2.** The strategic priority in Phase 1 is building a tool that works so well for a small group of users that they cannot imagine planning a trip without it. Commercial go-to-market follows product validation, not the reverse.

---

## 2. Market Analysis

### Market Size

- Global online travel market: ~$700B (2025), growing at 8% CAGR
- Trip planning tools and itinerary apps: estimated $40B+ sub-segment (fragmented; no single dominant player in the organised-planning niche)
- Target accessible market (organised multi-city travellers, English-speaking, tech-comfortable): estimated 50–80M people globally

### Competitive Landscape

| Product | Wins at | Loses at |
|---------|---------|---------|
| **TripIt** | Automated flight/hotel import from confirmation emails; business travellers; zero-effort capture | No day-structure for itineraries; no budget tracking; no collaborative planning; passive/calendar-like, not planning-forward |
| **Wanderlog** | Clean UI; collaborative trip documents; good for road trips; popular with younger travellers | Budget tracking is shallow; no per-day cost breakdown; place bookmarks lack Google Places depth; feels more like a doc than a planning tool |
| **Roadtrippers** | Road trip routing; turn-by-turn logic; US-centric road travel | Not designed for multi-modal international trips; no budget layer; weak collaboration |
| **Polarsteps** | Post-trip journaling; beautiful automatic travel log; community sharing | Not a planning tool at all — it records trips in progress, does not help plan them |
| **Notion templates** | Infinitely flexible; power-user community; zero cost | Requires heavy manual setup; no native place data; no budget automation; not shareable without Notion accounts; no mobile-first UX |
| **Google Maps (saved places)** | Ubiquitous; rich place data; offline maps; zero friction | No trip structure; no day planning; no budget; no collaboration beyond sharing a list; no itinerary ordering |
| **Google Trips (discontinued)** | Was the closest analogue — auto-imported reservations, offline access | Discontinued 2019; proves Google does not prioritise this niche |
| **Airbnb Trips / booking.com** | Booking-centric organisation of confirmed stays | Siloed to their own bookings; no broader itinerary; no budget vs. total spend |

### Market Gaps

Three underserved needs run across all competitors:

1. **Budget integration at the trip level** — none of the trip-planning tools (TripIt, Wanderlog, Roadtrippers) combine itinerary planning with a real budget tracker that shows remaining spend against a target.
2. **Day-structured planning with real place data** — Notion templates require manual everything; Google Maps has place data but no day structure. No tool combines both.
3. **Lightweight collaboration without requiring a shared subscription** — Wanderlog does collaboration but requires both parties to use Wanderlog. TravelPlanner's invitation model (email invite, role-based access) is simpler.

### Trends Favourable to TravelPlanner

- Post-pandemic travel recovery driving more ambitious multi-destination trips
- Group travel growing among millennials and Gen Z (2–4 people, shared costs)
- "Digital nomad" adjacent culture normalising serious trip planning as a skill
- Growing fatigue with general-purpose tools (Notion, Trello) for travel — category-specific apps winning

---

## 3. Target Market Definition

### Primary Segment: The Organised Group Traveller

**Profile:**
- Age 28–45, professional or creative, tech-comfortable
- Plans 1–3 international trips per year, typically 1–3 weeks duration
- Travels in groups of 2–5 (couple, friend group, small family)
- Visits multiple cities/regions in one trip (e.g., Japan 3 cities; Balkans 4 countries)
- Has a real budget — not backpacker-cheap, not unlimited — and wants to track it
- Currently uses Trello, Google Docs, or Notion to manage trips; spreadsheet for costs
- Books their own flights and accommodation (not a package tour buyer)
- Pain: the plan is scattered across 4–6 different tools; budget is never clear until the credit card bill arrives; travel partner doesn't have the latest version of the plan

**Size:** This segment is large (tens of millions globally) but TravelPlanner can win on depth before breadth. The Japan 2026 trip is a perfect archetype: 26 days, 8 cities, one organiser with real budget discipline and a travel partner who needs visibility.

### Secondary Segment: The Solo Organised Planner

**Profile:**
- Age 25–40, solo traveller or couple where one person does all the planning
- Values structure and completeness — wants a day-by-day itinerary, not just a list of things to do
- Tracks spending carefully; may travel on a defined per-day budget
- Less need for collaboration features; primary draw is day-structured itinerary + budget + place bookmarks in one place
- Currently uses a notes app or spreadsheet; has tried and abandoned Notion templates

**Size:** Larger than the group segment but lower willingness to pay (less collaboration value). Will be important for content marketing (solo trip templates) but secondary in product priority.

### Tertiary Segment (Phase 3 only): Travel Agents / Trip Curators

Small travel agencies and independent trip curators who plan trips for clients. Would use TravelPlanner as a client-facing planning and presentation tool. Not in scope for Phase 1 or 2 — flagged here for roadmap awareness only.

---

## 4. Competitive Positioning

### Positioning Narrative

The trip planning market has two axes that matter to organised travellers:

**Axis 1: Planning depth** — from passive/capture-only (TripIt) to active/structured (day-by-day itinerary with times, places, logistics)

**Axis 2: Budget integration** — from none (Wanderlog, Roadtrippers, Google Maps) to basic (Polarsteps expense log) to full (trip budget + per-day + per-category tracking)

No current competitor occupies the high-depth + full-budget quadrant for international multi-city trips. TravelPlanner's position:

```
                          PLANNING DEPTH
                    shallow ◄────────────► structured

         none   │  Google Maps    │                    │
                │  (saved places) │                    │
  BUDGET        │─────────────────│────────────────────│
  INTEGRATION   │  TripIt         │  Wanderlog         │
                │  (import only)  │  (collab/doc)      │
         full   │                 │  ★ TravelPlanner   │
                │                 │  (target position) │
```

TravelPlanner owns: **structured day planning + full budget integration + collaborative access + real place data**. This is the gap no competitor currently fills.

### Differentiation Statement

TravelPlanner is the only trip planning app that combines a day-by-day structured itinerary, live Google Places data for restaurants and sights, per-trip budget tracking with expense logging, and role-based collaboration — so the whole group plans, tracks, and travels from a single source of truth.

---

## 5. USP & Messaging Framework

### Three Unique Selling Propositions

**USP 1: The day-structured itinerary with real place data**
Every trip is organised by day, every day has its own plan, and every place in the plan is backed by live Google Places data (ratings, hours, photos, address). Not a list of things to do — a real, navigable day-by-day plan.

**USP 2: Budget integrated into the trip, not bolted on**
Set a trip budget, log expenses as they happen, and always know where you stand — per day, per category, per person. No more end-of-trip spreadsheet reconciliation. The budget is part of the plan.

**USP 3: Collaboration that respects roles**
Invite trip partners with a single email link. Owners control; editors contribute; viewers follow along. No separate subscription needed. Everyone sees the same plan, in real time.

### Three Messaging Pillars

**Pillar 1: "One place for the whole plan"**
Your itinerary, hotels, flights, restaurants, budget, and travel partners — all in one tool. Stop copy-pasting between Trello, Google Docs, and a spreadsheet.

**Pillar 2: "Plan like you mean it"**
Day-by-day structure. Real place data. A budget that tracks itself. TravelPlanner is built for people who take their trips seriously — not for casual list-making.

**Pillar 3: "Built for groups, not just one planner"**
Trip planning shouldn't mean one person doing all the work. Invite your travel partners, assign roles, and plan together — even from different cities.

---

## 6. Brand Identity

### Name

**Keep: TravelPlanner** — functional, clear, and searchable. Does exactly what it says. Easy to remember and recommend. No confusion about what the product does.

**Alternative 1: Wayfarer** — warmer and slightly aspirational without being pretentious. Implies both movement and intentionality. Risk: less immediately clear as a planning tool; more competitive naming space.

**Alternative 2: Tripora** — coined word (trip + itinerary + -ora suffix). Distinctive and brandable; no confusion with generic travel content. Risk: requires explanation; harder to spell from verbal description.

**Recommendation:** Launch as TravelPlanner through Phase 1 and Phase 2. Revisit naming only if commercial launch requires differentiation in a crowded app store. "Wayfarer" is the strongest alternative if a rebrand is ever needed.

### Visual Direction

**Color palette:**
- Primary: Deep teal (#1A6B72) — trustworthy, focused, not generic travel-app blue
- Secondary: Warm sand (#E8D5B0) — warmth without being garish
- Accent: Coral (#E8603C) — used sparingly for CTAs and budget alerts
- Neutrals: Off-white (#FAFAF8), Dark slate (#1C2635)

**Typography:**
- Headings: A geometric sans (e.g., Inter or Plus Jakarta Sans) — modern, clean, highly legible on mobile
- Body: System font stack (system-ui) — performance and familiarity
- No decorative typefaces; this is a functional tool, not a travel magazine

**Visual style:**
- Clean and information-dense; optimised for mobile use during trip planning (not while travelling)
- Maps (Leaflet) as first-class UI elements — the map is not a decoration
- Use whitespace generously in empty states; skeleton loaders over spinners

**Tone of voice:**
- Practical and direct — tells you what to do, not how to feel about travel
- Friendly but not chatty — no filler copy, no "wanderlust" language
- Honest about what the product does and does not do
- Examples:
  - Good: "Add your first day" / "Set a trip budget to start tracking expenses"
  - Avoid: "Your next adventure awaits!" / "Unleash your wanderlust"
  - Good: "3 days left, 12 expenses logged" (informative)
  - Avoid: "You're crushing it, traveller!" (hollow)

---

## 7. Go-to-Market Phases

### Phase 1 — Personal Use / Closed Beta (Q2–Q3 2026)

**Goal:** Prove that TravelPlanner works better than the current Trello + spreadsheet workflow for a real trip. No user acquisition pressure. No revenue.

**Trigger:** App is functional enough to plan the Japan 2026 trip (Nov 13 – Dec 8, 2026).

**Activities:**
- Import Japan 2026 trip from Trello JSON (one-shot import script)
- Use the app actively as the primary planning tool for Japan 2026
- Invite 1–2 travel partners as editors/viewers
- Capture bugs and UX friction weekly in BACKLOG.md

**Success criteria:**
- Japan 2026 trip is fully planned in TravelPlanner (all days, hotels, transportation, bookmarks, budget)
- At least 1 travel partner actively uses the collaboration features
- Budget is tracked against a CHF-denominated total; expenses logged during the trip
- No critical data loss events

**What to avoid:** launching publicly, writing blog posts, posting to Reddit — until the product earns it.

### Phase 2 — Invite-Only Public Beta (Q4 2026 – Q1 2027)

**Goal:** Validate product-market fit with 50–200 real users outside the builder's network. Confirm the primary segment's willingness to use and return.

**Trigger:** Japan 2026 trip complete; post-trip retrospective confirms core flows work; at least 3 sprints of polish post-trip.

**Activities:**
- Open invite-only sign-up (waitlist or invitation code)
- Soft launch to relevant communities: r/travel, r/solotravel, r/JapanTravel, r/digitalnomad
- Show HN post on HackerNews if product is technically interesting enough
- ProductHunt launch if WAU and activation metrics warrant it
- Public trip templates (sample Japan itinerary, sample Europe rail trip) as SEO and acquisition content

**Success criteria:**
- 200+ signed-up users within 8 weeks of beta launch
- Activation rate (creates first trip + adds first itinerary item) > 40%
- WAU / MAU ratio > 30% (weekly active use)
- At least 30% of trips have 2+ collaborators

**Monetisation:** Not in Phase 2. Free beta. Understand usage patterns before pricing.

### Phase 3 — Paid Tier + Growth (Q2 2027 onwards)

**Goal:** Establish sustainable revenue if commercial viability is confirmed. Alternatively, stay as a high-quality personal tool — Phase 3 is conditional on Phase 2 validation.

**Trigger:** Phase 2 success criteria met; clear signal that users would pay.

**Potential paid features (to be validated in Phase 2):**
- Free tier: up to 3 trips, basic budget tracking, 1 collaborator
- Pro tier ($5–8/month): unlimited trips, full budget analytics, unlimited collaborators, priority Google Places caching, export to PDF

**Growth channels (Phase 3 only):**
- SEO via destination guides and sample trip templates
- Referral: invite a collaborator → they see the product → potential conversion
- Integrations: Google Calendar export, currency conversion APIs, booking confirmation import
- Potential App Store / Play Store listing

**What Phase 3 is not:** paid advertising, influencer partnerships, or aggressive growth tactics before product-market fit is confirmed. Those belong in Phase 3 only if the retention data justifies the spend.
