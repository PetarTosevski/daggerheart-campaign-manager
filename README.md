# Daggerheart Campaign Manager

A private, multi-user live-play console for running Daggerheart campaigns. A
Game Master picks one of the 10 published campaign frames (or a GM-written
Custom frame), creates a campaign and runs the table from it: Fear,
countdowns, the party's character sheets and dice, world maps, the codex,
adversaries and encounters, the combat map, sessions, notes, and the
Lorekeeper rules assistant. Players sign in with their own accounts and join a
campaign by email invite or join code; roles are per campaign, and anything
hidden from players is enforced on the server. Changes show up live on every
open screen.

It is not a virtual tabletop, a rules compendium or a replacement for the
Daggerheart rulebook.

## Stack

- Next.js 16 (App Router), TypeScript in strict mode
- Convex 1.46 (database, server functions, live queries, file storage, crons)
- Convex Auth: Google and email + password. Sign-up is open.
- Tailwind CSS and shadcn/ui primitives, Zod for validation
- Vitest (unit tests in jsdom, Convex function tests with convex-test),
  Playwright with axe for end-to-end tests
- pnpm; hosted on Vercel

## Setup

Prerequisites: Node.js, pnpm and a Convex account.

```bash
pnpm install          # also installs the git hooks
npx convex dev        # once: log in, create your dev deployment, write .env.local
```

`npx convex dev` writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to
`.env.local` (git-ignored; `.env.example` lists the names). Keep it running
next to `pnpm dev`; it pushes the functions in `convex/` on every change.

### Environment variables

This lists names only; never commit values. Server variables are Convex
environment variables (`npx convex env set <NAME> <value>`, or the Convex
dashboard), set separately on the dev and the production deployment. The
typed list is in `convex/convex.config.ts`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Convex | Google sign-in |
| `ALLOWED_EMAILS` (legacy `GM_EMAILS`) | Convex | Declared and ignored. Sign-up is open. |
| `SITE_URL` | Convex | The app's URL, for sign-in redirects |
| `JWT_PRIVATE_KEY`, `JWKS` | Convex | Convex Auth session signing keys |
| `ANTHROPIC_API_KEY` | Convex only | Photo import, combat map generation and the Lorekeeper; without it those features are unavailable |
| `ANTHROPIC_MODEL`, `LOREKEEPER_MODEL` | Convex | Optional model overrides |
| `LOREKEEPER_DAILY_QUESTIONS`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_MONTHLY_USD` | Convex | Lorekeeper usage caps (change without a deploy) |
| `CONVEX_DEPLOY_KEY` | Vercel (production) | Lets the Vercel build run `npx convex deploy` |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Written by `npx convex dev`; on Vercel `npx convex deploy` sets the URL for the build |

`ANTHROPIC_API_KEY` is a server secret: it lives only in the Convex
environment, never in Vercel, `.env.local` or anything behind `NEXT_PUBLIC_`.

Dev and test only, and never set on production: `SEED_ACCOUNTS` and
`ALLOW_SEED_ACCOUNTS` (test logins on a cloud dev deployment, created with
`npx convex run accounts:seed`), and `E2E_AUTH_ENABLED`, `E2E_AUTH_SECRET`
and `LOREKEEPER_FAKE_MODEL` (local e2e backend only; `pnpm e2e:setup` sets
them).

### Lorekeeper library

The Lorekeeper answers from rulebook text you load into your own deployment:

```bash
pnpm lorekeeper:ingest <bookKey> <textFile>   # --prod, --deployment <name> or --e2e to pick the target
```

Book text never goes into git: the script refuses files inside the
repository (except `tests/fixtures`) and prints none of the text.

## Commands

```bash
pnpm install        # also points git at the tracked hooks (.beads/hooks)
pnpm dev            # Next.js; run `npx convex dev` alongside it
pnpm lint
pnpm typecheck      # also typechecks convex/
pnpm test           # vitest projects: unit (jsdom) and convex (convex-test)
pnpm e2e:setup      # once: configure the local e2e Convex backend
pnpm test:e2e       # starts the local backend and an e2e build itself
pnpm build
```

The end-to-end tests run against a throwaway local Convex backend, never a
cloud deployment. See `docs/testing.md` for ports, worktrees and the test
layers (authorization matrix, signed-out sweep, accessibility and tablet
checks, live two-browser specs).

## Deploying

Vercel builds production with `npx convex deploy --cmd 'pnpm build'`
(`vercel.json`): it pushes the Convex functions to the production deployment,
then builds Next.js against it. Only production builds run; previews are
skipped. Set the Convex variables above on the production deployment and
`CONVEX_DEPLOY_KEY` in Vercel. Never deploy a locally built output.

## More

- `AGENTS.md`: architecture, conventions, binding rules and the definition of
  done (for agents and humans alike).
- `docs/best-practices.md`: the Convex, Next.js, React and testing rulebook.
- `docs/design-port-roadmap.md`: the phased port of the design boards.
- `docs/testing.md`, `docs/workflow.md`, `docs/data-model.md`,
  `docs/game-interpretation.md` and the task documents in `docs/tasks/`.
