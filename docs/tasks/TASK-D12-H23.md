# TASK-D12-H23: README, AGENTS, CLAUDE and testing docs match the app

Plan `.omc/plans/d12-hardening.yaml`, tracer H23. Design: analysis section 11
(`.omc/autopilot/d12-analysis.md`). User answers (2026-10-21): Q14, a short
README (what the app is, the stack, setup with Convex and the sign-in env
vars, commands, deploying, links to AGENTS.md and docs; nothing about
Supabase); Q15, remove the AGENTS.md "keep UI minimal" line and point to the
roadmap's porting rules.

Status: Complete.

## What changed

- **README.md** (rewritten): a multi-user live-play console for Daggerheart
  (10 frames plus Custom); the stack (Next.js 16, Convex 1.46, Convex Auth
  with Google and password, Tailwind/shadcn, Vitest/convex-test,
  Playwright/axe); setup (`pnpm install`, `npx convex dev`); a table of env var
  names and where each is set (Convex env, Vercel, `.env.local`), never
  values; `ANTHROPIC_API_KEY` only in the Convex env; the Lorekeeper caps as
  Convex vars; the dev-only variables (`SEED_ACCOUNTS`, `ALLOW_SEED_ACCOUNTS`,
  `E2E_AUTH_*`, `LOREKEEPER_FAKE_MODEL`) never on production;
  `pnpm lorekeeper:ingest` and "book text never goes into git"; the commands,
  copied from AGENTS.md "Build & Test"; deploying (Vercel runs
  `npx convex deploy --cmd 'pnpm build'`, production only, `CONVEX_DEPLOY_KEY`
  in Vercel); links to AGENTS.md and docs/. No Supabase, PostgreSQL, RLS or
  "single-user" text remains.
- **AGENTS.md** (outside the binding block): the overview says multi-user;
  the active-plan paragraph names the D12 and D13 plans; "Convex layout" adds
  `convex/tables/*`, `convex/migrations/*`, `convex/crons.ts` +
  `convex/cleanup.ts`, `convex/convex.config.ts` and the Lorekeeper modules;
  "Deployments and environments" lists the current Convex and Vercel vars,
  drops `SEED_ACCOUNTS` from production, adds the `ANTHROPIC_API_KEY`,
  dev-only and ingest rules; "Architectural boundaries" replaces
  "`requireUser` plus the campaign role check" with the wrappers and
  `permissionFor`; "Testing requirements" adds the authz matrix and its guard,
  the unauthenticated sweep, the a11y/tablet specs, the live-update specs and
  the error-boundary tests; "Build & Test" adds the `E2E_REUSE_SERVERS=1`
  note; "Change boundaries" replaces "Visual design is pending the user's
  references; keep UI minimal" with the boards as the spec and the roadmap's
  porting rules (Q15).
- **CLAUDE.md** (outside the binding block): "Build & Test" gets `pnpm dev`
  and `pnpm build` (now the same commands as AGENTS.md) and one paragraph on
  what the suite enforces.
- **docs/testing.md**: new sections "Running e2e on a loaded machine"
  (servers by hand, `E2E_REUSE_SERVERS=1`, delete `.next-e2e-<port>` on the
  next/font error), "Authorization matrix" (files, access classes, outcomes,
  entry fields, `okCodes`, `knownBug`, the guard, adding a function, adding an
  area file), "Unauthenticated sweep", "Accessibility and tablet specs",
  "Live-update specs", "Error boundaries" and "Unit test timeout policy".
- **docs/best-practices.md**: Enforced-by lines only. TE2 → the guard in
  `authz-matrix.test.ts` over `authz/*.entries.ts` + the sweep; TE13 →
  `tests/e2e/a11y-*.spec.ts`; CL1 → `tests/unit/route-error.test.tsx` +
  `tests/e2e/error-boundary.spec.ts`. Rule texts and the Top 15 are untouched.

## Binding blocks

The "Binding rules" section was not edited in either file. Check:

```bash
sed -n '/^## Binding rules/,/^## Project overview/p' AGENTS.md | sed '$d' > a.txt
sed -n '/^## Binding rules/,/^<!-- BEGIN BEADS INTEGRATION/p' CLAUDE.md | sed '$d' > c.txt
cmp a.txt c.txt && echo BYTE-IDENTICAL     # BYTE-IDENTICAL (69 lines each)
```

## Checks

- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H23`: passes.
- `pnpm lint`, `pnpm typecheck`: clean (docs-only change).
