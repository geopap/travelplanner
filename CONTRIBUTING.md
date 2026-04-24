# Contributing to TravelPlanner

## Development Setup

1. Clone: `git clone https://github.com/geopap/travelplanner.git`
2. `cd travelplanner/app`
3. `npm install`
4. Copy `.env.example` → `.env.local` and fill in Supabase + Google Places keys
5. `npx supabase link --project-ref <project-ref>` (one-time)
6. `npx supabase db push` to apply migrations
7. `npm run dev`

## Git Workflow

- Main branch: `main` (production)
- Development branch: `develop` (integration)
- Feature branches: `feature/B-XXX-description`
- Commit format: `type(scope): description` (e.g., `feat(api): add trip CRUD endpoints`)
- Use `/usr/bin/git` when pushing if Homebrew git has libcurl issues

## Code Standards

- TypeScript strict mode
- No `any` types, no unsafe casts
- No TODOs in committed code
- All mutations must have audit logging
- RLS policies required on every new Supabase table

## Testing

- Run full test suite before marking any item done: `npm test && npm run test:e2e`
- Regression tests for every bug fix (test-first)
- Deterministic — no flakiness

## Pull Requests

- PRs require at least one review
- All CI checks must pass
- Squash merge to keep history clean
