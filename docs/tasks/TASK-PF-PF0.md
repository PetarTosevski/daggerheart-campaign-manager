# TASK-PF-PF0: Perf harness and recorded baseline

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF0. No app code changed.

## What changed

- **`scripts/perf/measure.mjs`** (`--profile local|wan|cpu4 --runs N`): the navigation harness.
  - **Flow:** title menu → Load Campaign → dashboard → every tab, first visit and revisit → hard load of the dashboard,
    against the e2e stack.
  - **Per step:** URL-change time, first query sent, last first-result, queries subscribed, Authenticate frames,
    POST /api/auth, Next-server (proxy) requests, JS fetched, and CDP main-thread task and script time.
  - **Output:** medians over the runs, plus the queries per page.
- **`scripts/perf/bundle.mjs`**: initial / async client JS and CSS per route from `next experimental-analyze` (`export`
  JSON Lines).
  - It lists the largest modules and the watched modules on each route (tomes, domain-cards, equipment-tiers, SRD
    adversaries and environments, zod, three, cannon-es).
  - `--why` prints an import chain.
- **`scripts/perf/lib.mjs`**: ports from `scripts/e2e-ports.mjs`, test sign-in, an idempotent bench seed (Perf 0-3
  Witherwild campaigns, 4 bards on Perf 3) and the median helper.
- **`docs/performance.md`**: the exact commands, column meanings and the baseline tables.

Both scripts are ports of the analysis's scratch scripts (`measure.mjs`, `cold.mjs`, `bundle.js`, `why.js`). The
changes: ports come from env, the seed runs through the API, runs repeat and report medians, the hard load is folded
in, and `srv`, `authPOST`, `auth2` and `lastUpd` are new.

## Acceptance

| Check | Result |
|---|---|
| lint, typecheck; no app code (tracer-guard) | pass (see Verification) |
| wan: dashboard entry lastData about 730 ms (±30%) | 618 ms (median of 3; runs 1,047 / 618 / 618) |
| wan: tab revisit URL change 116-178 ms | 114-133 ms (medians per tab) |
| wan: hard-load dashboard data about 2.6 s with 2 Authenticate frames | 2 Authenticate + 1 POST /api/auth reproduce in every run. Data arrives at **1,180 ms, not 2.6 s**: see below |
| bundle: `/campaigns/[campaignId]` 1,561 KB raw / 541 KB gzip (±5%), with tomes, domain-cards and equipment-tiers | On the analysis's graph (e0304f1): exactly 1,561 / 541, all three listed. At a60a1c0: 1,627 / 571 (+4.2% / +5.5%), all three listed |
| docs/performance.md has the tables and commands | yes |

Hard-load gap:
- The analysis's 2.6 s came from a run where the token refresh (second Authenticate) went out before the dashboard
  queries, so it held back their results.
- In this session the host load was lower (5-15 against 17-25). Hydration and the WebSocket open came about 700 ms
  sooner, and the queries answered before the refresh landed.
- The double run itself (counts and the POST) is unchanged. PF3 should judge by `auth` = 1 and `authPOST` = 0 with
  `lastData`, not by the absolute 2.6 s.

Bundle gzip +5.5%: real growth from merges since e0304f1, about 60 KB raw on every route. The script reproduces the old
graph to the KB.

## Verification

- Stack: Convex backend on E2E_CONVEX_PORT 3418, production e2e Next server (`scripts/e2e-next.mjs`) on E2E_PORT 3153,
  both started by hand and stopped by PID afterwards. `tsconfig.json` was unchanged afterwards (e2e-next.mjs reverts
  it, and so does bundle.mjs).
- `measure.mjs --runs 3` for local, wan and cpu4, back to back. Load average 18 → 15 (local), 15 → 5 (wan), 5 → 5
  (cpu4).
- `bundle.mjs`, a full analyze (51 s), and `--skip-analyze` on the analysis's saved graph.
- `pnpm lint`, `pnpm typecheck`, `pnpm tracer:guard .omc/plans/performance.yaml PF0`.

## Notes for PF1-PF10

- `srv` counts every request that passes `src/proxy.ts`. Most of the 9-27 on dashboard entry are auto-prefetches
  (270-320 byte RSC shells), so it shows PF1 (prefetch) and PF2 (proxy) changes directly. `jsN` / `jsKB` and
`bundle.mjs` show PF5 and PF6, and `auth` / `authPOST` show PF3.
- The Lorekeeper tab is in the nav now. It is a placeholder with no queries, and the harness walks whatever links the
  nav shows.
- `test-results/perf/` is the default output and Playwright clears it. Pass `--out` to keep runs.
