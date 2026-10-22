# Testing

## Commands

```bash
pnpm install          # also installs the git hooks (prepare script)
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit, includes convex/
pnpm test             # vitest: unit (jsdom) and convex (convex-test) projects
pnpm e2e:setup        # once per checkout: configure the local e2e Convex backend
pnpm test:e2e         # Playwright; starts the local backend and an e2e build itself
pnpm test:e2e tests/e2e/auth.spec.ts   # a single spec
```

Playwright needs Chromium and its system libraries:
`pnpm exec playwright install chromium`, then
`sudo pnpm exec playwright install-deps chromium`.

## E2E setup

The e2e tests never touch a cloud deployment. They run against the project's
local, account-free Convex backend (`CONVEX_AGENT_MODE=anonymous`, deployment
`anonymous-agent`, state in `.convex/local/default/`).

`pnpm e2e:setup` (idempotent) writes `.env.e2e.local` (git-ignored) with a
random `E2E_AUTH_SECRET`, pushes the functions once, and sets the backend's
env vars: `ALLOWED_EMAILS` (the five test accounts), `E2E_AUTH_ENABLED`,
`E2E_AUTH_SECRET`, `SITE_URL`, and a freshly generated `JWT_PRIVATE_KEY` /
`JWKS` pair. No real secret is needed anywhere.

**One email per sign-in method.** A user created through the test sign-in has
no password account, so a later password sign-up with that email fails (and
so does the password sign-in), whatever spec ran first. Every allowlisted
account (`E2E_ALLOWED` in `scripts/e2e-setup.mjs`) uses exactly one method:

| Email | Sign-in method | Used by |
|---|---|---|
| `e2e-gm@example.test` | test sign-in | the GM in most specs |
| `e2e-player@example.test` | test sign-in | the first player |
| `e2e-player2@example.test` | test sign-in | the second player / outsider (lorekeeper-shell, notes-*, visual/D11-N6) |
| `e2e-password-only@example.test` | email + password | `tests/e2e/players.spec.ts` only |
| `e2e-session-ended@example.test` | email + password | `tests/e2e/auth-session-ended.spec.ts` only |

A new spec that needs another account, or signs up with a password, gets its
own email in `E2E_ALLOWED`, then `pnpm e2e:setup`.

`pnpm test:e2e` then starts two servers (see `playwright.config.ts`):

1. `node scripts/convex-e2e.mjs dev`: the local backend with live function
   pushes. The wrapper always passes `--env-file .env.e2e.local` and restores
   `.env.local` (your cloud deployment) whenever the Convex CLI rewrites it.
2. `node scripts/e2e-next.mjs`: `next build` + `next start` with the test
   sign-in form enabled (`NEXT_PUBLIC_E2E_AUTH=true`).

`tests/e2e/global-setup.ts` refuses to run against anything but a local
backend URL.

## Ports and parallel runs

| Variable            | Default | Used for                                             |
| ------------------- | ------- | ---------------------------------------------------- |
| `E2E_PORT`          | 3000    | Next.js e2e server                                   |
| `E2E_CONVEX_PORT`   | 3212    | local Convex backend; its site proxy uses port + 1   |
| `E2E_REUSE_SERVERS` | unset   | `1` reuses servers already listening on those ports  |

```bash
E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm test:e2e  # worktrees: ports from pnpm worktree:setup
```

- Each Next port builds into its own directory: `.next-e2e` for 3000,
  `.next-e2e-<port>` otherwise, so parallel builds never collide.
  `next build` adds the directory's type globs to `tsconfig.json`;
  `scripts/e2e-next.mjs` removes that addition after the build.
- Before starting, the run checks that all three ports are free. If one is
  taken (typically a stale server from an interrupted run) it stops with the
  owning PID and command, for example:

  ```text
  E2E ports are taken, most likely by a stale server from an earlier run:
    port 3212, local Convex backend (E2E_CONVEX_PORT), is already in use:
      PID 263044: /home/.../convex-local-backend --port 3212 ...
  Then either:
    - stop it: kill 263044
    - run on other ports: E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm test:e2e  # worktrees: ports from pnpm worktree:setup
    - reuse running servers on purpose: E2E_REUSE_SERVERS=1 pnpm test:e2e
  ```

  Reusing is opt-in because a leftover backend no longer receives function
  pushes and a leftover Next server may be an old build.
  `node scripts/e2e-ports.mjs check next convex convexSite` runs the same
  check by hand.
- `scripts/convex-e2e.mjs` forwards SIGINT/SIGTERM to the Convex CLI as SIGINT
  (the only signal on which it stops its backend), so stopping the wrapper no
  longer leaves a backend behind.
- **One checkout = one backend database.** The backend's state lives in
  `.convex/local/default/` and the Convex CLI has no option to move it, so two
  runs from the same checkout share one database even on different ports.
  For truly parallel runs (e.g. several agents) use separate git worktrees,
  each with its own `pnpm install`, `pnpm e2e:setup`, `E2E_PORT` and
  `E2E_CONVEX_PORT`.
- The backend port is stored in `.convex/local/default/config.json` by the
  last run. `SITE_URL` (only used by OAuth redirects, not by the test
  sign-in) follows `E2E_PORT` at `pnpm e2e:setup` time.

### Running e2e on a loaded machine

`pnpm test:e2e` builds Next.js before the first test, which can take minutes
when the host is busy. Start the two servers by hand instead (commands in
`docs/performance.md`, "Start the e2e stack"), keep their PIDs, and run
Playwright against them with `E2E_REUSE_SERVERS=1`:

```bash
E2E_PORT=<next> E2E_CONVEX_PORT=<convex> E2E_REUSE_SERVERS=1 pnpm exec playwright test tests/e2e/<spec>.spec.ts
```

If the build fails with "next/font/google queries have exactly one entry", the
Google-font cache in `.next-e2e-<port>` is broken: delete that directory and
build again (outside the sandbox).

## Authorization matrix

Rule 14 and TE2: every public Convex function is called as every role of its
access class, and errors are asserted on `ConvexError.data.code`. The full API
(fields, outcomes, synthesized arguments, pitfalls) is in
`docs/tasks/TASK-D12-H0.md`.

| File | Role |
| --- | --- |
| `tests/convex/authz-matrix.test.ts` | The inventory guard (below). |
| `tests/convex/authz/<area>.entries.ts` | One per area (core, countdowns, characters, play, world, adversaries, combat, sessions, notes, trackers, settings-backup, lorekeeper-*): `{ area, world?, setup?, nameHints?, entries, exempt? }`. |
| `tests/convex/authz/<area>.test.ts` | Three lines, `runMatrix(area)`; one vitest file per area, so areas run in parallel. |
| `tests/convex/authz/harness.ts` | `Entry`, `Area`, `Access`, `Outcome`, the class defaults, `runMatrix`. |
| `tests/convex/authz/world.ts` | `buildWorld()`: GM, playerA (owns characterA), playerB (owns characterB), outsider, a grantee with an `edit` grant, one campaign. |
| `tests/convex/authz/synth.ts` | `synthArgs()`: valid arguments from the function's own validator, plus `NAME_HINTS` for string ids. |
| `tests/convex/authz/inventory.ts` | `publicFunctions()` (found at runtime) and `wrapperOf()` (source scan). |

**Access classes** (each must agree with the function's wrapper): `gm`
(gm* wrappers), `view` and `edit` (campaign* wrappers with `need: "view"` or
`"edit"`), `own`, `scoped` and `user` (user* wrappers on a character, on
another resource, or on the caller's own rows), `maybe` (`maybeUserQuery`).
Each class has default outcomes per role (`anon`, `outsider`, `player`,
`otherPlayer`, `grantee`, `gm`); `scoped` has none, so a `scoped` entry states
anon, outsider, player and gm itself. Outcomes: `UNAUTHENTICATED`,
`NOT_FOUND`, `FORBIDDEN`, `ok`, `null`, `empty`.

**Entry fields**: `fn`, `access`, and optionally `args` (merged over the
synthesized arguments; give values that pass validation, or validation masks
the access rows), `expect` (per-role overrides), `okCodes`, `setup`, `world`,
`knownBug`, `note`.

- `okCodes`: domain codes that still mean "access granted", for example
  `PHOTO_IMPORT_UNAVAILABLE` without `ANTHROPIC_API_KEY`. Never an access code;
  the guard refuses `UNAUTHENTICATED`, `NOT_FOUND` or `FORBIDDEN` there.
- `knownBug: "<bead id>"`: the expectations are correct but the code is not
  yet. File a bead first; the entry runs as one `it.fails` over all its rows
  and turns red once the code is fixed, which tells the fixer to remove it.

**The guard** fails when a public function has no entry (naming it), a listed
name no longer exists, a name is listed twice, an access class disagrees with
the wrapper, a `scoped` entry leaves a role out, an `okCodes` list holds an
access code, an exemption has no reason, or an entries file has no test file.

**Adding a function**: add an entry to its area's `*.entries.ts` (most are one
line, `{ fn: api.fear.adjust, access: "gm" }`), then run
`pnpm vitest run tests/convex/authz/<area>.test.ts tests/convex/authz-matrix.test.ts`.

**Adding an area**: create `tests/convex/authz/<area>.entries.ts` exporting
an `Area` as default (create the area's state in `setup`; `idOf(table)` throws
naming any table the world lacks) and `tests/convex/authz/<area>.test.ts`
with `runMatrix(area)`. The guard loads every `./authz/*.entries.ts` by glob;
there is no shared index to edit.

## Unauthenticated sweep

- `tests/convex/unauthenticated-sweep.test.ts` calls every
  `publicFunctions()` name with synthesized arguments, with no hand-written
  list: signed out it must get `UNAUTHENTICATED` (the `maybe` reads return
  `null`), and as a signed-in stranger it must get `NOT_FOUND`, `FORBIDDEN`,
  `null` or empty, except the user-level functions. A new function is swept
  the day it lands.
- `tests/e2e/unauthenticated.spec.ts`: signed out, every page route redirects
  to `/signin?next=<path>` and the HTML leaks no campaign or character names;
  a signed-in non-member sees "Campaign not found".

## Accessibility and tablet specs

`tests/e2e/a11y-*.spec.ts` (entry, party, play, smoke) use
`tests/e2e/a11y.ts`:

- `expectNoSeriousA11yViolations(page, { include?, exclude?, reason? })`: axe
  with WCAG 2.0, 2.1 and 2.2 A/AA tags; fails on any serious or critical
  finding. An `exclude` needs a non-empty `reason`. It returns the moderate and
  minor findings; `summarizeViolations` formats them for the task doc.
- `TABLET_VIEWPORTS`: 768x1024 and 1024x768. At each, `expectFitsViewport`
  (no sideways scroll) and `expectTouchTargets(locator)` (at least 44 px).

## Live-update specs

`tests/e2e/live-*.spec.ts` (dashboard, party, world, combat, sessions, notes)
use `gmAndPlayer()` from `tests/e2e/live.ts`: a fresh campaign, the GM and the
player (`e2e-player@example.test`, owner of characterA) signed in in two
browser contexts, both on the dashboard. Both pages are on the screen under
test before the change, and the change must show on the other one with no
`reload()` and no `waitForTimeout`. Each file raises the test timeout (60 s
or more: two sign-ins plus a join). Call `close()` at the end of each test.

## Error boundaries

`tests/unit/route-error.test.tsx` fails when a directory under `src/app` with
a `page.tsx` lacks an `error.tsx`. `tests/e2e/error-boundary.spec.ts` injects
a failing query and checks that the error screen, not a blank page, shows.

## Unit test timeout policy

`vitest.config.ts` sets one `testTimeout` of 15 s for both projects, and tests
carry no per-test timeouts. A test that comes close is made cheaper first:
render only what is tested, and look elements up by label
(`getByLabelText(name, { selector })`) rather than `getByRole(..., { name })`
over a large tree, which is slow in jsdom (`docs/tasks/TASK-D12-H3.md`). The
limit is the headroom, not the fix.

## Pre-commit hook

`core.hooksPath` points at the tracked `.beads/hooks/` (set by the `prepare`
script on `pnpm install` when unset). `.beads/hooks/pre-commit` runs the beads
integration, then `scripts/pre-commit.sh`:

1. ESLint on the staged `*.{ts,tsx,js,jsx,mjs,cjs}` files (working-tree
   copies), and
2. `tsc --noEmit` for the whole project.

It is non-interactive (safe for agent commits), takes a few seconds, and
never runs e2e. Skip it once with `git commit --no-verify` or
`SKIP_PRE_COMMIT=1 git commit ...`. If `node_modules` is missing it prints a
note and lets the commit through.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- **checks**: `pnpm install --frozen-lockfile`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`.
- **e2e**: installs Chromium with its system dependencies, runs
  `pnpm e2e:setup` (a fresh local backend with generated test secrets; no
  repository secrets) and `pnpm test:e2e`. On failure it uploads
  `playwright-report/` and `test-results/` as the `playwright-report`
  artifact. Playwright retries failed tests twice on CI.

The e2e job downloads the Convex local backend binary on its
first run; Playwright browsers and that binary are cached afterwards.
