# Witherwild Campaign Manager

A private, single-user web application used by one Game Master to run a
Daggerheart campaign with the Witherwild campaign frame.

Tasks 001–011C (including 008, 009A, and 011A–011C) are complete. The
application currently provides authentication and the persistent authenticated
shell; the Phase 1 database schema; Fear, countdown, and operations tracking;
the campaign week / day-night cycle with one-day advancement; in-app campaign
creation and initialization; the character workspace with guided character
creation, overview, and notes; and PDF-backed character sheet templates —
private PDF storage and rendering (011A), a GM field-overlay template editor
with a draft/published version lifecycle (011B), and the interactive character
sheet runtime that renders a character's pinned published template with
autosaving HTML field overlays (011C).

Not yet implemented: food stores, character inventory, Wither tokens, the
character asset/media library, and the dice engine / roll history (Tasks
012–016). See `AGENTS.md` and `docs/` for product, architecture, and task
documentation, and `docs/tasks/` for per-task status.

## Technology stack

- Next.js (App Router) with TypeScript (strict mode)
- Tailwind CSS and shadcn/ui
- Supabase (PostgreSQL, Auth, RLS) — local configuration only at this stage
- Zod for validation
- Vitest for unit tests, Playwright for end-to-end tests
- pnpm for package management

## Prerequisites

- Node.js
- pnpm
- Supabase CLI (invoked via `pnpm dlx supabase` — no global install required)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in local values; never commit secrets
```

## Common commands

```bash
pnpm dev          # start the development server
pnpm build        # production build
pnpm start        # run the production build
pnpm lint         # ESLint
pnpm typecheck    # TypeScript type checking (tsc --noEmit)
pnpm test         # run unit tests (Vitest)
pnpm test:watch   # unit tests in watch mode
pnpm test:e2e     # Playwright end-to-end tests
```

## Environment variables

Copy `.env.example` to `.env.local` and provide values. The example file lists
variable names only and contains no secrets.

## Local database and reset workflow

Local Supabase runs via `pnpm dlx supabase start`. On this machine the default
`543xx` ports are reserved by the OS, so they are remapped to `545xx` in
`supabase/config.toml`; the local API is `http://127.0.0.1:54521` and the DB is
`postgresql://postgres:postgres@127.0.0.1:54522/postgres`.

Prefer `pnpm dlx supabase migration up` to apply new migrations. **`supabase db
reset` wipes ALL local data** (it rebuilds from migrations + `seed.sql` only), so
use it only when a clean slate is required.

`supabase/seed.sql` is optional, deterministic, and idempotent. On a fresh reset
it creates a **local-only** Game Master login and a demo campaign, so the app is
immediately usable. It derives the owner from the seeded user (no hard-coded
UUID) and never runs in production.

The application does **not** require a seeded campaign. An authenticated GM with
no campaign sees a **Create campaign** action on the Campaign page and can create
the initial campaign in-app; creation is server-validated, RLS-scoped to the
owner, and seeds the canonical starting state (Week 1, Day cycle, day 1, Fear 0).
After a reset you can therefore either sign in with the seeded login or create a
campaign through the UI.

## Project layout

The intended application structure is documented in `docs/architecture.md`.
Rules interpretations, house rules, and task specifications live under `docs/`.
