# Performance: harness and baseline

The measuring stick for `.omc/plans/performance.yaml` (PF0). Every perf tracer (PF1-PF10) measures before and after
with the commands below: same worktree, same profile, median of 3 runs. It records both tables in its own
`docs/tasks/TASK-PF-<id>.md`.

The host is shared and often heavily loaded, so absolute timings move by ±30% between runs. Compare a before and an
after taken back to back, record the load average the scripts print, and trust counts (queries, Authenticate frames,
requests, bytes) over milliseconds.

## Commands

### 1. Start the e2e stack on your worktree's ports

`pnpm worktree:setup` prints the ports. Run `pnpm e2e:setup` once per worktree first, or every test sign-in fails.
Start both servers yourself and keep their PIDs, so you stop only your own processes. Never use port 3000.

```bash
E2E_PORT=<next> E2E_CONVEX_PORT=<convex> pnpm e2e:setup        # once per worktree
E2E_CONVEX_PORT=<convex> setsid nohup node scripts/convex-e2e.mjs dev --typecheck=disable --tail-logs disable > <log> 2>&1 &
E2E_PORT=<next> NEXT_DIST_DIR=.next-e2e-<next> NEXT_PUBLIC_E2E_AUTH=true NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:<convex> \
  setsid nohup node scripts/e2e-next.mjs > <log> 2>&1 &       # production build + next start; about 3 min
```

`scripts/e2e-next.mjs` undoes the `tsconfig.json` include that `next build` adds. When you are done, stop the servers:

- Next: `kill -TERM -<pgid>`, using the process group from `setsid`.
- Convex: `kill -INT <convex-e2e.mjs pid>`.

Then check the ports with `ss -ltnp`. A leftover `next-server` or `convex-local-backend` child may need its own
`kill <pid>`.

### 2. Navigation timing, queries and auth round trips

```bash
E2E_PORT=<next> E2E_CONVEX_PORT=<convex> node scripts/perf/measure.mjs --profile local|wan|cpu4 [--runs 3] [--out test-results/perf] [--verbose]
```

- **Seed.** The script seeds the bench data if it is missing, and the step is idempotent: 4 Witherwild campaigns
  `Perf 0`-`Perf 3`, with 4 level-1 bards (Ash, Brin, Cael, Dov) on `Perf 3`. It warms every route on the server once.
- **Each run.** A fresh browser context (empty HTTP cache, signed in as the e2e GM) goes through:
  1. title menu cold load
  2. Load Campaign
  3. Resume Campaign (dashboard)
  4. every tab in the campaign nav (first visit)
  5. every tab again (revisit), each pass ending on Dashboard
  6. a hard load of the dashboard in a new context
- **Profiles:**
  - `local`: no throttling.
  - `wan`: 80 ms RTT on HTTP via CDP (10/5 Mbit), plus 40 ms each way on the Convex WebSocket via `routeWebSocket`.
  - `cpu4`: 4x CPU throttling.
- **Output.** It prints the per-step medians, the Convex queries each step subscribes to (run 1) and the load average
  at start and end. It writes every run to `<out>/measure-<profile>.json` (git-ignored `test-results/`, which
  Playwright clears).

Columns (ms are from the click, or from `goto` for loads):

| Column | Meaning |
|---|---|
| `url` | URL changed (client navigation: the RSC round trip is done). For the title menu: DOMContentLoaded |
| `firstAdd` | first Convex query sent (`ModifyQuerySet` Add) |
| `lastData` | the last of the step's new queries got its first result |
| `lastUpd` | last `Transition` update for those queries (catches re-sent results) |
| `quiet` | last change of any query or request before 600 ms of silence (1 s for the hard load) |
| `q` | queries subscribed by the step |
| `auth` | `Authenticate` frames sent on the Convex WebSocket |
| `authPOST` | `POST /api/auth` requests (token refresh through the middleware) |
| `srv` | requests to the Next server outside `/_next/static` (documents, RSC, prefetches, `/api/auth`). Each one passes `src/proxy.ts`, which today calls Convex `auth:isAuthenticated` |
| `jsN` / `jsKB` | JS files / KB fetched during the step |
| `taskMs` / `scriptMs` | CDP `TaskDuration` / `ScriptDuration` delta over the step (main-thread work) |

The hard-load line also prints `html`, `dcl`, `wsOpen` and `auth2`, the time of the second `Authenticate` frame (the
auth double run).

### 3. Client JS per route

```bash
node scripts/perf/bundle.mjs                       # analyze (about 1 min) + table of every route
node scripts/perf/bundle.mjs --skip-analyze --route "/campaigns/[campaignId]"   # the 30 largest modules of a route
node scripts/perf/bundle.mjs --skip-analyze --why src/lib/srd/equipment-tiers.ts --entry "campaigns/[campaignId]/page.tsx"
```

- **Build.** It runs `next experimental-analyze -o` into `.next-e2e-analyze/` (git-ignored) and restores
  `tsconfig.json` if Next touched it. It streams `next experimental-analyze export` to `.next-e2e-analyze/graph.jsonl`.
- **Sums per route.** Initial client JS: the chunks loaded with the route, raw and gzip, without fonts and media. Also
  async (lazy) JS and CSS.
- **Watched modules.** It lists which of these sit on the route's initial JS: tomes.ts, domain-cards.ts,
  equipment-tiers.ts, srd/adversaries.ts, srd/environments.ts, zod, three and cannon-es.
- **`--why`.** Prints the shortest static import chain from an entry module to a target.
- **Output.** It writes `<out>/bundle.json`.

## Baseline

Branch `rebuild` at a60a1c0 (PF7 merged, so the Fear numbers are post-PF7). Taken 2026-10-21 on 16 cores in WSL2.

### Client JS per route (`bundle.mjs`)

Re-running `bundle.mjs --skip-analyze` on the analysis's saved graph (e0304f1) gives the analysis table exactly:
dashboard 1,561 KB raw / 541 KB gzip. At a60a1c0, with N9, P10, M1, D12 and PF7 merged since, every route is about
60-70 KB raw larger:

| Route | JS raw KB | JS gzip KB | async KB | CSS KB | Watched modules on initial JS |
|---|---:|---:|---:|---:|---|
| `/` (title menu) | 864 | 320 | 0 | 92 | zod |
| `/campaigns` (Load Campaign) | 780 | 296 | 0 | 92 | |
| `/campaigns/[id]` (dashboard) | **1,627** | **571** | 545 | 138 | tomes, domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party` | 1,437 | 502 | 17 | 117 | tomes, domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/[characterId]` | 1,596 | 560 | 545 | 216 | tomes, domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/world` | 1,089 | 405 | 0 | 99 | tomes, zod |
| `/campaigns/[id]/codex` | 1,359 | 468 | 0 | 94 | tomes, domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/sessions` | 1,307 | 444 | 0 | 116 | tomes, srd/adversaries |
| `/campaigns/[id]/combat-map` | 1,427 | 507 | 0 | 115 | tomes, zod |
| `/campaigns/[id]/adversaries` | 1,482 | 500 | 545 | 141 | tomes, srd/adversaries, srd/environments |
| `/campaigns/[id]/notes` | 986 | 375 | 0 | 118 | tomes |
| `/campaigns/[id]/lorekeeper` | 935 | 354 | 0 | 102 | tomes |

- **Shared base.** next 559 / 208 KB, convex 85 / 30, zod 81 / 24, tailwind-merge 52 / 16. tailwind-merge was 26 KB
  at e0304f1, and `src/lib/errors` grew from 5 to 19-25 KB.
- **Dashboard modules:** domain-cards.ts 93 / 26 KB, equipment-tiers.ts 90 / 11 KB, tomes.ts 88 / 34 KB.
- **Import chain** for equipment-tiers.ts: dashboard `page.tsx` → `party/dice/index.tsx` → `dice-box.tsx` →
  `class-features/classes/brawler.ts` → `@/lib/srd` barrel → `equipment-tiers.ts`.

### Navigation (`measure.mjs`, median of 3 runs, ms)

Load average (1 min): local 18.1 → 14.8, wan 14.8 → 4.7, cpu4 4.7 → 4.9. The load fell during the session, so compare
profiles with care. Within a profile, the runs are back to back.

| Step | local url / firstAdd / lastData | **wan** url / firstAdd / lastData (quiet) | cpu4 url / lastData, taskMs | q | srv (wan) | JS on click |
|---|---|---|---|---:|---:|---|
| title menu cold load (DCL / menu data) | 76 / 472 | 259 / 1,069 | 123 / 779, 700 | 3 | 4 | 14 files, 217 KB |
| title → Load Campaign | 163 / 202 / 203 | 240 / 264 / 353 | 197 / 279, 264 | 1 | 0 | 2 / 17 KB |
| Load → **Dashboard** | 169 / 199 / 548 | **318 / 324 / 618 (1,520)** | 250 / 573, 1,097 | 10 | 17 | **9 / 229 KB** |
| first: Party | 214 / 287 / 310 | 242 / 256 / 350 | 196 / 299, 289 | 3 | 1 | 3 / 17 KB |
| first: World | 186 / 200 / 205 | 227 / 232 / 330 | 115 / 158, 403 | 1 | 0 | 3 / 25 KB |
| first: Characters & Locations | 146 / 177 / 229 | 236 / 246 / 435 | 139 / 242, 223 | 2 | 0 | 2 / 18 KB |
| first: Sessions | 226 / 271 / 377 | 289 / 292 / 381 | 139 / 194, 181 | 1 | 0 | 4 / **89 KB** |
| first: Combat Map | 408 / 472 / 561 | 333 / 346 / 530 | 200 / 324, 310 | 5 | 1 | 4 / **110 KB** |
| first: Adversaries | 218 / 352 / 425 | 277 / 314 / 403 | 152 / 372, 365 | 1 | 0 | 3 / 66 KB |
| first: Notes | 305 / 361 / 495 | 233 / 244 / 426 | 129 / 275, 346 | 7 | 0 | 3 / 18 KB |
| first: Lorekeeper (placeholder) | 123 / - / - | 207 / - / - | 96 / -, 123 | 0 | 0 | 2 / 2 KB |
| first: Dashboard (shell kept) | 97 / 132 / 162 | 115 / 126 / 222 | 90 / 184, 461 | 9 | 0 | 0 |
| revisit: tabs (range of medians) | 66-120 / 73-155 / 75-176 | **114-133** / 118-148 / 208-317 | 66-145 / 97-235, 95-510 | same | 0 | 0 |
| hard load: Dashboard (see below) | 396 / 651 | 944 / 1,180 (2,180) | 673 / 1,145, 1,839 | 11 | 19 | 23 / 432 KB |

Hard load of the dashboard (new context, cold HTTP cache):

| Event | local | wan | cpu4 |
|---|---:|---:|---:|
| HTML done | 68 | 99 | 92 |
| DOMContentLoaded | 89 | 249 | 115 |
| WebSocket opens (after hydration) | 385 | 823 | 649 |
| first queries sent (`settings.get`, `campaigns.get`) | 396 | 944 | 673 |
| `POST /api/auth` (token refresh), per run | 407 / 252 / 461 | 1,122 / 1,078 / 1,081 | 1,015 / 829 / 1,077 |
| 2nd `Authenticate`, per run | 750 / 384 / 611 | 1,237 / 1,174 / 1,178 | 1,304 / 1,106 / 1,335 |
| last first-result of the 11 queries | 651 | 1,180 | 1,145 |
| Authenticate frames / POST /api/auth | 2 / 1 | 2 / 1 | 2 / 1 |

Every hard load sends 2 `Authenticate` frames and 1 `POST /api/auth` (PF3's target: 1 and 0). In these runs the second
`Authenticate` lands as the page's queries answer, or just after. Per the analysis, the server then re-runs every
subscribed query. No result changes, so nothing is re-sent and `lastUpd` = `lastData`. In the analysis run, the token refresh came first and
held back the dashboard data (2,658 ms at wan).

**Convex queries per page** (unchanged across profiles):

- title menu (3): `settings.get`, `users.viewer`, `campaigns.list`
- Load Campaign (1): `campaigns.list`
- dashboard entry (10): `campaigns.get` (shell), then `campaignTime.get`, `sessionWrap.dashboard`,
  `characters.listByCampaign`, `feed.list`, `countdowns.listByCampaign`, `campaigns.fear` (PF7), `sessions.current`,
  `rests.current`, `maps.locations`
- Party (3): `photoImport.available`, `characters.listByCampaign`, `members.roster`
- World (1): `maps.get`
- Characters & Locations (2, waterfall): `codex.list` → `codex.entryText`
- Sessions (1): `sessionRecords.list`
- Combat Map (5): `campaignTime.get`, `sessionWrap.dashboard`, `campaigns.fear`, `combatMaps.list`, then
  `combatMapStyle.settings`
- Adversaries (1): `customAdversaries.list`
- Notes (7): `notes.journal`, `notesThreads.threads`, `notesSharing.shared`, `notesJournals.playerJournals`,
  `notesJournals.pastJournals`, `notesBin.bin`, `notesEntries.entries`
- hard load of the dashboard (11): `settings.get` (AccentSync) and `campaigns.get` first, then the dashboard's 9 one
  round trip later

**Server requests (`srv`).**

- Dashboard entry: 9-27 requests to the Next server, almost all `<Link>` auto-prefetches of the nav and party links
  (270-320 byte RSC shells; every route is dynamic).
- Each request goes through `src/proxy.ts`, which today calls Convex `auth:isAuthenticated`. That is PF2's target.

### Against the analysis (e0304f1, load 17-25)

- **Matches (within ±30%, wan):**
  - dashboard entry `lastData`: 618 vs 729 ms
  - tab revisit `url`: 114-133 vs 116-178 ms
  - first-visit `url`: 224-339 vs 210-330 ms
  - dashboard entry JS: 9 files / 229 KB vs 8 / 228 KB
  - query counts, plus `campaigns.fear` (PF7)
  - the auth double run: 2 Authenticate frames and 1 POST per hard load
- **Does not match: hard-load dashboard data,** 1,180 ms at wan vs 2,658. Hydration finished much sooner here
  (WebSocket open at 823 vs 1,496 ms; load average 5-15 vs 17-25). The page's queries then went out and answered
  before the refreshed token arrived, instead of after it. The counts reproduce, and the timing depends on that race.
  PF3 should compare `auth`, `authPOST` and `lastData` together.
- **Not comparable: CPU.** At cpu4 the main-thread task time for Load → Dashboard is 1,097 ms (analysis 1,461 ms) and
  revisit Dashboard is 510 ms (analysis 1,461 ms). The host load differed a lot between the two sessions, so use CPU
  numbers only in back-to-back before/after pairs.
