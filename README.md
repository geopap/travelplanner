# TravelPlanner

A personal travel planning app for organising multi-leg trips end-to-end: flights, transfers, hotels, daily itinerary, bookmarked restaurants and places (with Google Places enrichment), per-trip budgets and cost tracking, and collaboration with invited trip partners.

## Tech stack

- Next.js 16, React 19, TypeScript (strict)
- Tailwind CSS v4
- Supabase (Postgres + Auth + Row Level Security)
- Leaflet + react-leaflet
- Google Places API

## Repository layout

- `app/` — Next.js application (source, tests, Supabase migrations under `app/supabase/migrations/`)
- `docs/`, `agents/`, `onboarding/` — project documentation and agent workflow assets
- `BACKLOG.md`, `SPRINT.md`, `PRD.md`, `SOLUTION_DESIGN.md` — living planning documents

## Getting started

```bash
cd app
npm install
cp .env.example .env.local   # fill in Supabase + Google Places keys
npm run dev
```

Then open http://localhost:3000.

### Useful scripts (run from `app/`)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Vitest unit/integration tests |

### Database migrations

Migrations live in `app/supabase/migrations/`. Apply via the Supabase CLI (`supabase db push`) or paste into the Studio SQL Editor in numeric order. Each migration ships with a `*_rollback.sql` companion.

## License

[MIT](./LICENSE)
