# TravelPlanner — Marketing Plan

**Version:** 1.0
**Date:** 2026-04-24
**Owner:** [marketing-manager]
**Status:** Active — Sprint 0 baseline

---

## 1. Marketing Objectives

Three SMART goals for Year 1 (May 2026 – April 2027), scaled to reflect Phase 1 as a personal tool and Phase 2 as an invite-only beta.

### Objective 1 — Validate the core flow on a real trip (Phase 1)
**By November 13 2026** (Japan trip start date), TravelPlanner must be the sole planning tool for the Japan 2026 trip: all 26 days planned, all hotels and transportation logged, budget set in CHF, and at least 1 travel partner actively collaborating. This is a product validation goal, not a user acquisition goal — it is the prerequisite for everything that follows.

**Measurement:** Japan 2026 trip exists in the app with 26 trip days, transport entries, accommodation entries, bookmarks, and at least 1 non-owner trip member with editor or viewer role.

### Objective 2 — Reach 200 activated beta users within 8 weeks of beta launch (Phase 2)
**By end of Q1 2027**: 200 registered users who have each completed the activation sequence (created a trip + added at least one itinerary item + viewed the budget page). Target launch window: late Q4 2026.

**Measurement:** Activation rate (activated users / registered users) > 40%. WAU > 60 users (30% of 200) by week 8 post-launch.

### Objective 3 — Establish two owned content assets that drive organic discovery (Phase 2)
**By end of Q1 2027**: Publish at least 2 public trip templates (Japan itinerary and one European multi-city trip) indexed by Google, generating at least 200 organic sessions/month combined within 60 days of publication.

**Measurement:** Google Search Console impressions and clicks for template pages; session counts from analytics.

---

## 2. Target Audience Segments

### Primary: The Organised Group Traveller

**Demographics:** Age 28–45, professional, primarily English-speaking. Based in Europe, North America, or Australia/NZ. Travels internationally 1–3 times per year in groups of 2–5 people.

**Behaviour:** Books own flights and accommodation, not package tours. Plans 4–8 weeks ahead. Currently uses Trello, Notion, or Google Docs for planning. Tracks costs in a spreadsheet or not at all.

**Psychographics:** Values having a complete plan but hates the overhead of maintaining it across multiple tools. Feels responsible for the group's logistics. Mildly anxious about going over budget. Proud of planning a trip well.

**Pain point:** "I'm the one who always ends up managing everything across Trello, the spreadsheet, and the WhatsApp group. There's no single place where everything lives."

**Where to reach them:** r/travel, r/solotravel, r/JapanTravel, r/EuroTrips, r/digitalnomad, HackerNews (Show HN), travel-adjacent Slack communities, word of mouth from early users.

**Willingness to pay:** Moderate — would pay $5–10/month for a tool that saves significant planning time and prevents group coordination headaches. Need to experience value first.

### Secondary: The Solo Organised Planner

**Demographics:** Age 25–40, solo traveller or the single person in a couple who handles all trip planning. Travels 1–2 times per year on self-planned itineraries.

**Behaviour:** Researches destinations thoroughly; builds detailed day-by-day plans. Budget-conscious. Less likely to use collaboration features but highly likely to use templates and bookmark features.

**Psychographics:** Derives satisfaction from a well-organised trip. Frustrated by tools that can't handle multi-city complexity. Would share a public template if proud of the itinerary.

**Pain point:** "I spend more time managing my Notion travel template than actually planning. I just want something that understands how a trip works."

**Where to reach them:** r/solotravel, r/travel, travel-specific subreddits (r/JapanTravel, r/Schengen, r/backpacking), Pinterest (trip itinerary searches), Google (destination planning queries).

**Willingness to pay:** Lower than group segment — collaboration features are less compelling. Would pay for a Pro tier if budget analytics and unlimited trips are included.

---

## 3. Brand Positioning & Messaging

### Value Proposition

TravelPlanner is the trip planning app for people who plan seriously. It brings your itinerary, places, budget, and travel partners into one structured, collaborative tool — so the plan is always complete, always current, and always shared.

### Three Key Messages

**Message 1: "The complete trip plan, not just a list"**
Day-by-day structure. Real place data from Google. Hotels, flights, and transfers in the same view. This is what a complete trip plan looks like — not a Trello board, not a Google Doc.

*Use in:* onboarding empty states, landing page hero, Reddit posts describing the product.

**Message 2: "Your budget, built into the plan"**
Set a trip budget. Log expenses as you go. See what's left — per day, per category, per person. No spreadsheet reconciliation at the end of the trip.

*Use in:* budget feature onboarding, content comparing TravelPlanner to spreadsheets, any messaging to cost-conscious travellers.

**Message 3: "Plan together, not in parallel"**
One plan, shared with your whole group. Owners control; editors contribute; viewers follow along. No more "which version is current?" No shared Google Doc chaos.

*Use in:* collaboration feature onboarding, invite email copy, any messaging where group travel is the context.

### Tone of Voice

**Practical.** Get to the point. Tell users what the product does, not how it will make them feel. No "wanderlust," no "your adventure awaits," no travel-magazine language.

**Friendly, not performative.** Warm enough that users feel supported, not cold. But no forced enthusiasm or hollow encouragement copy.

**Honest about scope.** Phase 1 is a beta. Don't over-promise. Users who discover early-stage products expect rough edges — acknowledge it if relevant, fix it fast.

**Voice examples:**
- Landing page headline: "Plan your trip. All of it. In one place." (not "Unlock Your Next Adventure")
- Onboarding prompt: "Add your first day to get started." (not "Let the journey begin!")
- Budget empty state: "Set a trip budget to start tracking expenses against your plan." (not "Money doesn't have to be a drag!")
- Collaboration invite email subject: "George invited you to the Japan 2026 trip" (not "Adventure awaits — join George's trip!")

---

## 4. Campaign Calendar

### Q1 2026 (May – June 2026) — Foundation
*Primary goal: working app, not marketing.*

| Milestone | What | Who |
|-----------|------|-----|
| Sprint 1 complete | Auth + create trip + itinerary skeleton | Engineering |
| Japan trip import | Trello JSON → TravelPlanner (all 26 days, bookmarks, transport) | Engineering |
| Internal use begins | Builder uses app as sole Japan planning tool | Product owner |
| No external marketing | — | — |

**Marketing output this quarter:** Zero intentional. Product must earn the right to be promoted.

### Q2 2026 (July – September 2026) — Pre-trip Polish
*Primary goal: production-ready for Japan trip. Secondary: prep beta assets.*

| Milestone | What | Who |
|-----------|------|-----|
| Japan 2026 trip fully planned in app | All days, hotels, transport, bookmarks, budget set | Product owner + travel partner |
| Public landing page live | Waitlist / "coming soon" page with value prop | [frontend-engineer] + [marketing-manager] |
| First travel partner invited | Real collaboration use begins; feedback loop | Product owner |
| Draft Japan public template | Sanitised version of Japan itinerary for future public share | [content-creator] (brief from [marketing-manager]) |
| No public launch yet | — | — |

**Marketing output this quarter:** Landing page with email capture (waitlist). No active promotion.

### Q3 2026 (October – December 2026) — Japan Trip + Post-Trip Retrospective
*Primary goal: use TravelPlanner during the Japan trip. Capture real-world friction. Post-trip: assess readiness for beta.*

| Milestone | What | Who |
|-----------|------|-----|
| Japan trip (Nov 13 – Dec 8) | Live use of the app for a real 26-day trip | Product owner + partner |
| Expense tracking during trip | Log expenses as they happen; validate budget flow | Product owner |
| Post-trip retrospective (Dec) | List all friction points; prioritise fixes | Product owner |
| Beta launch decision | Go / no-go for Phase 2 based on trip experience | Product owner |

**Marketing output this quarter:** None publicly. Internal retrospective notes feed the Q4 planning.

### Q4 2026 (January – February 2027) — Beta Launch
*Primary goal: 200 activated users. Assumes beta launch decision is "go."*

| Milestone | What | Target date |
|-----------|------|------------|
| Post-trip polish complete | Critical bugs fixed; onboarding improved | Jan 2027 |
| Public trip template published | Japan 2026 itinerary as public browsable template | Jan 2027 |
| r/travel + r/JapanTravel posts | "I built a trip planning app to plan my Japan trip — here's what I made" | Jan 2027 |
| HackerNews Show HN | Show HN post with tech angle (Next.js, Supabase, Leaflet) | Jan–Feb 2027 |
| ProductHunt launch | If metrics and polish warrant it; coordinate with HN post | Feb 2027 |
| Invite-only sign-up live | Waitlist converted to invite codes | Jan 2027 |
| 200 activated users goal | — | End of Feb 2027 |

---

## 5. Channel Strategy

### Owned Channels (Phase 1 + Phase 2)

**Product itself**
The primary owned channel is the product. Every invitation email, every shared trip link, every public template page is a distribution mechanism. The collaboration invite flow is TravelPlanner's most powerful organic channel — every trip partner who receives an invite sees the product.

Priority: Highest.

**Landing page / marketing site**
- Phase 1: "Coming soon" / waitlist capture page. Minimal — one page, clear value prop, email field.
- Phase 2: Full landing page with feature highlights, public trip templates accessible without sign-up, pricing page (Phase 3).
- SEO: optimise landing page and template pages for long-tail planning queries ("Japan 26-day itinerary," "multi-city Europe trip planner," "travel budget tracker app").

Priority: Medium (Phase 1), High (Phase 2).

**Blog / content hub**
- Phase 2 only. 1–2 posts per month. Not a travel content site — a planning-focused content site.
- Content types: sample trip templates, "how we planned X" narratives, budget breakdowns, comparison posts ("TravelPlanner vs Notion for trip planning").
- SEO value: long-tail destination + planning queries. Not competing with Lonely Planet; competing with "best Japan trip planner template" search results.

Priority: Medium (Phase 2), growing in Phase 3.

### Earned Channels (Phase 2)

**Reddit**
The highest-ROI Phase 2 channel. Target subreddits:
- r/travel (16M members) — general trip planning discussions
- r/JapanTravel (1.2M members) — directly relevant to Japan template content
- r/solotravel (4M members) — secondary audience
- r/digitalnomad (1M members) — budget-tracking angle
- r/sysadmin / r/webdev (HN cross-promotion if tech angle resonates)

**Approach:** Authentic participation, not spam. Lead with the Japan 2026 trip story ("I tracked everything for a 26-day Japan trip in a tool I built"). Share the public template. Answer planning questions with genuine advice. Never post promotional-only content.

Priority: High (Phase 2 launch).

**HackerNews (Show HN)**
TravelPlanner has a credible tech story: Next.js 16 + Supabase + Leaflet + Google Places, built as a personal tool that became a product. Show HN posts from genuine builders with interesting stacks perform well. Target: 100–300 points and 30+ comments. This drives sign-ups from technical early adopters who are often opinion leaders.

Priority: High (single post, Phase 2 launch window).

**ProductHunt**
Launch only if: (a) the product is polished, (b) WAU is already growing organically, (c) a small network of supporters can be coordinated. A weak ProductHunt launch is worse than no ProductHunt launch. Defer if not ready.

Priority: Medium (Phase 2, conditional on readiness).

**Word of mouth**
Every trip partner invited by an existing user is a potential new user. The collaboration invite flow is the most natural referral mechanism. Ensure the invite email and the first-time collaborator experience are exceptional.

Priority: Always on (by design).

### Paid Channels (Phase 3 only, deferred)

Paid acquisition is not justified until:
- Product-market fit is confirmed (Phase 2 WAU + activation metrics)
- A paid conversion path exists (Phase 3 paid tier)
- LTV:CAC ratio can be modelled

When Phase 3 begins, evaluate: Google Ads (destination + planning intent keywords), Reddit ads (travel subreddits), and content amplification. No paid social (Meta, TikTok) in Phase 3 — insufficient LTV data to justify CPM-based channels.

---

## 6. Content Strategy

### Content Pillars

**Pillar 1: Public Trip Templates**
Format: Browsable, shareable trip plans derived from real trips (Japan 2026, and others added over time). Each template shows the day structure, place bookmarks, and estimated budget range. Accessible without sign-up — but sign up to copy the template into your own trip.

Cadence: 1 template per major trip planned by the builder or contributed by early users. Target: 4–6 templates by end of Phase 2.

SEO purpose: Rank for "[destination] trip itinerary template," "[N] days in [city] itinerary."

Example templates to create:
- Japan 26-day itinerary (Nov–Dec, 8 cities, CHF budget)
- Swiss Alps + Italian Lakes 10-day (common from Zurich)
- Balkans road trip 14-day
- Japan 10-day (shorter, more accessible version for newcomers)

**Pillar 2: Budget Breakdowns**
Format: Blog post or template page showing real cost data for a specific trip — flights, accommodation, food, transport, attractions — broken down by category and by day.

Cadence: 1 per quarter in Phase 2.

SEO purpose: Rank for "[destination] trip budget breakdown," "how much does [trip] cost."

Example posts:
- "26 days in Japan: the complete budget breakdown (CHF 4,800)"
- "10 days in Kyoto and Tokyo: what we actually spent"

**Pillar 3: Planning How-Tos**
Format: Short, practical blog posts or landing page content explaining how to plan a specific type of trip using structured tools. Not travel advice — planning process advice.

Cadence: 1 per month in Phase 2.

SEO purpose: Rank for "how to plan a multi-city Japan trip," "trip planning spreadsheet alternative," "collaborative trip planning."

Example posts:
- "How to plan a multi-city Japan trip without losing your mind"
- "Why I stopped using Trello for trip planning (and what I use instead)"
- "How to track travel expenses with your group"

**Pillar 4: Product Updates / Changelog**
Format: Brief, honest changelog posts when significant features ship. Not "here's our roadmap" — "here's what we shipped and why." Distributed via in-app changelog and optionally a newsletter.

Cadence: Per sprint that ships a user-facing feature.

Audience: Existing users; keeps them engaged and signals active development.

### Formats

| Format | Phase | Channel |
|--------|-------|---------|
| Public trip templates | Phase 2 | Website, shared links, Reddit |
| Budget breakdown posts | Phase 2 | Blog, Reddit, HN |
| Planning how-to posts | Phase 2 | Blog, SEO |
| Reddit discussion posts | Phase 2 | Reddit |
| Show HN post | Phase 2 | HackerNews |
| In-app changelog | Phase 2+ | Product |
| Email newsletter | Phase 3 | Email (if list grows) |

### Cadence

- Phase 1: Zero public content. All effort is product.
- Phase 2 launch (Jan 2027): 1 Reddit post, 1 HN post, 2 public templates, 1 budget breakdown — released in a coordinated 2-week window around beta launch.
- Phase 2 ongoing: 1–2 blog posts per month; 1 new template per 6–8 weeks; Reddit participation as genuine community member.

---

## 7. Budget Allocation

### Phase 1 — Personal use (May 2026 – Dec 2026)

**Total marketing budget: $0.**

All investment is time (the builder's own). No paid tools, no paid distribution, no advertising. The only costs are infrastructure (Supabase, hosting, Google Places API) which are product costs, not marketing costs.

If a landing page email capture tool is needed: use a free tier (Resend free, Netlify free, or a simple Supabase-stored waitlist table).

### Phase 2 — Invite-only beta (Jan 2027 – Mar 2027)

**Total marketing budget: $0–$200.**

| Item | Budget | Notes |
|------|--------|-------|
| Domain (if not already owned) | $15/year | travelplanner.app or similar |
| Email sending (Resend or similar) | $0–$20/month | Free tier covers up to 3,000 emails/month |
| Analytics (Plausible or PostHog) | $0–$9/month | Plausible self-hosted free; PostHog free tier |
| Content creation time | $0 | Builder writes all Phase 2 content |
| Paid promotion | $0 | Not in Phase 2 |

### Phase 3 — Paid tier + growth (Q2 2027 onwards)

Budget is conditional on Phase 2 activation and retention data. Preliminary allocations:

| Channel | Monthly budget (indicative) | Condition |
|---------|---------------------------|-----------|
| SEO content (freelance writer or AI-assisted) | $200–$500 | If organic traffic is showing traction |
| Google Ads (planning intent keywords) | $300–$800 | Only after LTV can be estimated from Phase 2 cohorts |
| Reddit ads (travel subreddits) | $100–$300 | Test small before scaling |
| Email platform upgrade | $20–$50 | If list exceeds free tier |
| **Total Phase 3 (early)** | **$620–$1,650/month** | Subject to Phase 2 validation |

No influencer partnerships, no sponsored content, no Meta/TikTok in Phase 3 unless specific evidence of audience fit emerges.

---

## 8. KPIs & Measurement

### Primary KPIs

| KPI | Definition | Phase 1 target | Phase 2 target (8 weeks post-launch) |
|-----|-----------|----------------|--------------------------------------|
| **Registered users** | Total accounts created | 1–5 (builder + partners) | 200+ |
| **Activation rate** | Users who create a trip + add 1 itinerary item + view budget page | 100% (closed group) | >40% |
| **WAU** | Unique users active in a given week | 1–3 | >60 (30% of 200 registered) |
| **Trips created per user** | Avg trips per activated account | 1 (Japan only) | 1.5–2.5 |
| **Collaborators per trip** | Avg non-owner members per trip | 1–2 | >1.5 |
| **Expense entries per trip** | Proxy for budget feature engagement | 10+ (Japan trip) | >5 per trip with budget set |

### Secondary KPIs

| KPI | Definition | Phase 2 target |
|-----|-----------|----------------|
| **Template page views** | Organic visits to public trip templates | 200 sessions/month per template within 60 days of publication |
| **Waitlist conversion** | Waitlist sign-ups → registered users | >60% within 2 weeks of invites sent |
| **Invite acceptance rate** | Trip invitation emails → accepted collaborators | >70% |
| **D7 retention** | Users who return within 7 days of activation | >35% |
| **D30 retention** | Users who return within 30 days of activation | >20% |

### Measurement Stack

**Phase 1:**
- Manual review of database records (trips created, days added, expenses logged)
- No external analytics tool required — too few users

**Phase 2:**
- **Product analytics:** PostHog (free tier, self-hosted or cloud) — event tracking on key flows: trip created, day added, itinerary item added, expense logged, collaborator invited, budget set
- **Web analytics:** Plausible (privacy-friendly; no cookie banner required in EU) — sessions, referrers, template page performance
- **Search Console:** Track organic impressions and clicks for template and blog content
- **Funnel tracking:** Registered → created trip → activated → WAU — reported weekly in a simple dashboard

**Key events to instrument (aligned with data-analyst tracking plan):**
- `trip_created` (trip_id, day_count, has_budget)
- `itinerary_item_added` (trip_id, item_type)
- `bookmark_added` (trip_id, category, has_place_id)
- `expense_logged` (trip_id, category, amount_chf_equivalent)
- `collaborator_invited` (trip_id, role)
- `collaborator_accepted` (trip_id, role)
- `template_viewed` (template_id, source: organic/reddit/direct)
- `template_copied` (template_id) — conversion event for templates

### Reporting Cadence

| Report | Frequency | Audience |
|--------|-----------|---------|
| Weekly active users snapshot | Weekly (Phase 2+) | Product owner |
| Activation funnel | Weekly (Phase 2+) | Product owner |
| Content performance (templates + blog) | Monthly (Phase 2+) | Product owner |
| Full KPI review | End of each sprint | [marketing-manager] + [product-manager] |
| Phase gate review (go/no-go for Phase 3) | End of Phase 2 (Mar 2027) | Product owner |
