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
env vars: `ALLOWED_EMAILS` (the three test accounts), `E2E_AUTH_ENABLED`,
`E2E_AUTH_SECRET`, `SITE_URL`, and a freshly generated `JWT_PRIVATE_KEY` /
`JWKS` pair. No real secret is needed anywhere.

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
