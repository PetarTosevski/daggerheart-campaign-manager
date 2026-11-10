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

## Re-measure on an idle host (2026-11-10)

Bead dcm-bxp.36.3. Branch `master` at f6340e92; the scripts print 67acfc0c, a commit that only adds a plan file, so
the app code is the same. Taken on 16 cores in WSL2 with no agents running, default e2e ports (3000 / 3212).

Load average (1 min / 5 min / 15 min) when each command started:

- `measure.mjs --profile wan --runs 3`: 1.30 / 1.61 / 1.75 at start, 0.71 / 1.27 / 1.60 at end.
- `bundle.mjs`: 0.34 / 1.07 / 1.51.

Every number below was taken under the 5 load-average limit, so these milliseconds count against the targets.

### Navigation (`measure.mjs --profile wan`, median of 3 runs, ms)

The app has changed since the baseline. Sessions and Notes are now one Journal tab, World is called World Map, and the
Lorekeeper tab is a real page, no longer a placeholder.

| Step | url / firstAdd / lastData (quiet) | baseline wan (a60a1c0) | q | srv | JS on click |
|---|---|---|---:|---:|---|
| title menu cold load (DCL / menu data) | 255 / 1,059 | 259 / 1,069 | 4 | 3 | 17 files, 214 KB |
| title → Load Campaign | 31 / 334 / 497 | 240 / 264 / 353 | 2 | 0 | 1 / 14 KB |
| Load → **Dashboard** | **46 / 678 / 772** (2,577) | 318 / 324 / 618 (1,520) | 13 | 13 | 48 / 898 KB (see below) |
| first: Party | 54 / 64 / 259 | 242 / 256 / 350 | 7 | 0 | 0 |
| first: Codex (Characters & Locations) | 36 / 44 / 234 | 236 / 246 / 435 | 3 | 0 | 0 |
| first: World Map | 39 / 41 / 235 | 227 / 232 / 330 | 4 | 0 | 0 |
| first: Combat Map | 53 / 67 / 250 | 333 / 346 / 530 | 7 | 1 | 0 |
| first: Adversaries | 46 / 78 / 166 | 277 / 314 / 403 | 3 | 0 | 0 |
| first: Journal (Sessions + Notes) | 43 / 51 / 162 | 289 / 292 / 381 (Sessions) | 5 | 0 | 0 |
| first: Lorekeeper | 39 / 47 / 238 | 207 / - / - (placeholder) | 9 | 0 | 0 |
| first: Dashboard | 34 / 40 / 145 | 115 / 126 / 222 | 12 | 0 | 0 |
| revisit: tabs (range of medians) | **40-52** / 43-59 / 132-246 | 114-133 / 118-148 / 208-317 | same | 0 | 0 |
| hard load: Dashboard | - / 925 / **1,147** (2,998) | - / 944 / 1,180 (2,180) | 16 | 17 | 63 / 1,098 KB |

Hard load timeline (median): HTML 93, DOMContentLoaded 230, WebSocket open 838, first queries 925, last first result
1,147 ms. Every run sent 1 `Authenticate` frame and 0 `POST /api/auth` (baseline 2 and 1).

### Client JS per route (`bundle.mjs`, KB)

Raw / gzip initial JS. "PF11" is the last recorded number for a route (`docs/tasks/TASK-PF-PF11.md`, a8a01e2 plus
PF11).

| Route | Baseline (a60a1c0) | PF11 | 2026-11-10 | async | CSS | Watched modules on initial JS |
|---|---:|---:|---:|---:|---:|---|
| `/` (title menu) | 864 / 320 | | 771 / 298 | 98 | 108 | |
| `/campaigns` (Load Campaign) | 780 / 296 | | 791 / 306 | 0 | 108 | |
| `/campaigns/[id]` (dashboard) | 1,627 / 571 | 1,153 / 430 | **1,375 / 518** | 1,302 | 173 | domain-cards |
| `/campaigns/[id]/party` | 1,437 / 502 | 1,336 / 468 | **1,797 / 621** | 154 | 170 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/[characterId]` | 1,596 / 560 | 1,479 / 522 | **1,982 / 690** | 725 | 276 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/new` | | 1,271 / 436 | 1,626 / 571 | 137 | 162 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/world` | 1,089 / 405 | | 1,339 / 501 | 137 | 153 | domain-cards, zod |
| `/campaigns/[id]/codex` | 1,359 / 468 | 1,138 / 418 | 1,286 / 482 | 137 | 140 | domain-cards, zod |
| `/campaigns/[id]/journal` (was sessions, notes) | 1,307 / 444, 986 / 375 | | 1,287 / 494 | 137 | 188 | domain-cards |
| `/campaigns/[id]/combat-map` | 1,427 / 507 | | **2,586 / 903** | 1,115 | 356 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/adversaries` | 1,482 / 500 | | **2,203 / 745** | 682 | 228 | domain-cards, srd/adversaries, srd/environments, zod |
| `/campaigns/[id]/lorekeeper` | 935 / 354 | | 1,156 / 439 | 137 | 140 | domain-cards |
| `/campaigns/[id]/[section]` (new) | | | 1,146 / 436 | 137 | 138 | domain-cards |
| `/campaigns/[id]/combat-map/packs` (new) | | | 1,194 / 455 | 137 | 147 | domain-cards |
| `/new` (new campaign) | | | 1,432 / 488 | 0 | 108 | domain-cards, equipment-tiers, zod |
| `/frames/[frameId]` | | | 1,538 / 529 | 0 | 108 | tomes, domain-cards, equipment-tiers, zod |
| `/admin`, `/signin`, `/join/[code]`, `/_not-found` | | | 816 / 316, 756 / 292, 754 / 291, 696 / 260 | 0 | 108-123 | |

- **Shared base.** pkg:next is 601 / 230 KB on campaign routes and 571 / 215 KB on `/` (baseline 559 / 208), convex
  88 / 31 KB.
- **Dashboard regrowth since PF11** (+222 KB raw). These modules are back on the dashboard's initial JS:
  - `srd/domain-cards.ts` 94 KB: `page.tsx` → `party-section.tsx` → `party/party-card.tsx` → `party/party-display.ts` →
    `srd/art.ts` → `srd/domain-cards.ts`. PF11 left this chain in place and proposed a fix outside its owns.
  - `srd/subclasses.ts` 32 KB: through the same `party-display.ts`.
  - `srd/feature-effects/classification.ts` 33 KB: `page.tsx` → `party/dice/index.tsx` → `dice/roll-feed.tsx` →
    `dice/free-roll.tsx` → `lib/domain/dice/index.ts` → `domain/feature-effects/owned.ts`.
  - `design-assets.generated.json` 30 KB: `party/dice/index.tsx` → `party/sheet-ui/index.tsx` → `lib/design-assets.ts`.
  - `components/config` 62 KB.
- **Party routes** (+460 KB raw since PF11): the new rules engine. `srd/card-effects/*` (sage, codex, splendor, arcana,
  dread, midnight, valor, bone, grace and more, 10-21 KB each), `srd/feature-effects/*`, `rules/registry.ts` and
  `srd/beastforms.ts` are all static imports.
- **Combat Map**: `components/combat-map` 548 KB and `lib/sprite-packs` 219 KB on the initial JS. three and cannon-es
  stay off it.
- **Adversaries**: `srd/adversaries.ts` 321 KB and `srd/environments.ts` 119 KB are back on the initial JS, plus
  `lib/sprite-packs` 206 KB and `components/combat-map` 119 KB.

### Targets (`.omc/plans/performance.yaml`), met or not

| Target | Result | |
|---|---|---|
| PF1: tab revisit URL change ≤ 40 ms, 0 RSC requests | 40-52 ms; 0 requests | **Missed** (by 0-12 ms) |
| PF1: first visit URL change ≤ 60 ms, 0 JS on click | 34-54 ms; 0 JS | Met |
| PF3: hard load 1 `Authenticate`, 0 `POST /api/auth` | 1 and 0 in every run | Met |
| PF3: wan hard-load dashboard data ≤ 2.0 s | 1,147 ms | Met |
| PF4: wan Load → Dashboard `lastData` ≤ 600 ms | 772 ms (PF4 measured 498-502) | **Missed** |
| PF4: hard load, page queries in the same flight as the first | 5 of 16 leave at 925 ms, 11 at about 1,050 ms | **Missed** (as at PF4) |
| PF5/PF11: dashboard ≤ 1,250 / 450 KB | 1,375 / 518 KB (PF11 measured 1,153 / 430) | **Missed** (regressed) |
| PF5: tomes off every campaign route; equipment-tiers and zod off the dashboard | yes; yes | Met |
| PF5: domain-cards off the dashboard | still on it | **Missed** |
| PF6: zod off `/`; `/` ≤ 730 KB raw | zod off; 771 KB | **Missed** (size) |
| PF6: srd/adversaries off the Sessions page (now Journal) | off Journal | Met |
| PF9: dashboard party payload ≤ 1.5 KB, no `characters.listByCampaign` | `charactersReads.partySummary` 1,259 B; not subscribed | Met |

Not measured here: PF2 (`auth:isAuthenticated` calls in the backend log), PF7 (Fear click) and the cpu4 targets.

### Why the misses happen

- **Load → Dashboard, 772 ms.** The URL changes at 46 ms and the loading skeleton shows at once. The first query
  only leaves at about 670 ms, because the click must first fetch the dashboard's own chunks: 13 files and about
  225 KB, in 4-5 sequential waves that finish at about 500 ms (a request-timing probe of one run). The Load Campaign
  page does not prefetch them. Render and hydration then take about 150 ms more. The data arrives one round trip
  after the queries leave (about 100 ms). The dashboard's 222 KB of regrowth since PF11 lengthens that download. The
  48 files / 898 KB in the step are mostly the PF1 background prefetch of the other tabs: 35 files / 675 KB load
  after the queries leave, as the user accepted on 2026-10-22.
- **Hard-load level gap.** It looks like PF4: `settings.get`, `appStatus.get`, `campaignTime.get`,
  `sessionWrap.dashboard` and `campaigns.get` leave at 925 ms. The other 11 wait about 125 ms for the page's own JS.
  The WebSocket opens at 838 ms (PF4: 750) because the hard load now fetches 63 files / 1,098 KB of JS (PF1: 49 /
  794).
- **Tab revisit, 40-52 ms.** It has no request and no JS. What is left is the client render of the page from the
  router cache, slowest on Party (51 ms), World Map (48 ms) and Combat Map (52 ms).
- **Dashboard and `/` sizes.** See the module chains above. `/` grew only through pkg:next (559 → 571 KB).
- **title → Load Campaign data, 497 ms** (baseline 353 ms; no target). The page now subscribes to
  `campaigns.listDeleted` too. `campaigns.list` returns 61 KB for the e2e GM, because test runs have built up many
  campaigns.

### The slow first click (dcm-bxp.36)

- **Fixed inside a campaign.** Every first visit of a tab after the dashboard changes the URL in 34-54 ms, fetches no
  JS and shows data in 145-259 ms. The baseline was 207-333 ms for the URL alone, with up to 110 KB of JS on the
  click.
- **Explained on the way in.** The one slow click left is Load Campaign → Dashboard. The skeleton shows at 46 ms,
  but the data takes 772 ms, because that click downloads the dashboard's chunks (see above).

## NB3: client JS back down (2026-11-10)

Plan `.omc/plans/next-batch-1110.yaml`, tracer NB3, bead dcm-xgbe. `bundle.mjs` before (master 079970bf) and after,
back to back in the same worktree; load average 4.4 / 9.1 / 5.2 before, 1.1 / 1.5 / 2.7 after (byte counts do not
depend on load). Raw / gzip KB of initial JS.

| Route | PF11 | Before | After | Change (raw) |
|---|---:|---:|---:|---:|
| `/campaigns/[id]` (dashboard) | 1,153 / 430 | 1,375 / 518 | **1,281 / 491** | −94 |
| `/campaigns/[id]/party` | 1,336 / 468 | 1,798 / 622 | **1,095 / 427** | −703 |
| `/campaigns/[id]/party/[characterId]` | 1,479 / 522 | 1,983 / 691 | 1,982 / 690 | −1 |
| `/campaigns/[id]/party/new` | 1,271 / 436 | 1,626 / 571 | 1,621 / 569 | −5 |
| `/campaigns/[id]/combat-map` | | 2,588 / 903 | **2,547 / 887** | −41 |
| `/campaigns/[id]/adversaries` | | 2,223 / 753 | **1,397 / 490** | −826 |
| `/campaigns/[id]/codex` | 1,138 / 418 | 1,286 / 482 | 1,133 / 436 | −153 |
| `/campaigns/[id]/world` | | 1,339 / 501 | 1,186 / 455 | −153 |
| `/campaigns/[id]/journal` | | 1,287 / 494 | 1,134 / 448 | −153 |
| `/campaigns/[id]/lorekeeper` | | 1,156 / 439 | 1,003 / 393 | −153 |
| `/campaigns/[id]/[section]` | | 1,146 / 436 | 993 / 390 | −153 |
| `/campaigns/[id]/combat-map/packs` | | 1,194 / 455 | 1,041 / 409 | −153 |
| `/`, `/campaigns` | | 771 / 298, 791 / 306 | 770 / 297, 790 / 305 | 0 |

`srd/domain-cards.ts` is now off every campaign route except the sheet, the wizard and the Combat Map, which use the
cards.

### What moved

- **Campaign shell (every campaign route, −153 KB).** The avatar (`components/config/shell/avatar.tsx`) took
  `portraitSource` from `party-display.ts`, which reached `srd/art.ts` (its `DOMAIN_CARD_ART` pulls all of
  `domain-cards.ts`, 94 KB) and the subclass, ancestry and community lists. `PORTRAITS` now lives in
  `src/lib/party/portraits.ts` (art.ts re-exports it, so Convex and the barrel are unchanged), and the portrait helpers
  in `components/party/portrait-source.ts` (party-display re-exports them). In this build Turbopack kept every export of
  an imported module, so a light importer needs a light module.
- **Party roster (−703 KB).** The roster took `getClass` / `getDomain` / `getSubclass` from the `@/lib/srd` barrel
  (CL9), `PartyLevelUpButton` from the level-up index (tier history, pickers, sheet schema), `FRAME_OF` from
  `frames/extras/common` (zod) and `derivedDefense` (the whole rules engine) for one Evasion number. Now: leaf
  lookups, `level-up/party-button.tsx` and `level-up/badge`, a typed `"motherboard"` constant, and
  `party/roster-evasion.tsx` behind `next/dynamic`; its import starts when the roster module runs, beside the
  roster's queries, and the cell shows "…" while it loads.
- **Adversaries (−826 KB).** The Encounters tab's tracker (its mini map: sprite packs, map view, tokens, zod) and the
  Environment tab (`srd/environments.ts`, the opened adversary) load with `next/dynamic` when their tab opens, inside
  their existing `SlotBoundary`. Done in `page.tsx` only; `src/components/adversaries/**` is untouched.
- **Combat Map (−41 KB).** The GM's Edit mode (editor layer, edit tools, Scene card) loads with `next/dynamic`;
  the page takes the provider from `editor/editor-state` directly.
- **Load Campaign → Dashboard.** "Resume Campaign" is a full-prefetch `<Link prefetch>`: the most recent campaign starts
  expanded, so its dashboard payload and chunks download while the GM reads the list. Not measured here (no e2e run in
  this tracer); `measure.mjs --profile wan` should show the click without the 13-file chunk download.

### What is left, and why

- **Dashboard 1,281 / 491 (PF11 1,153 / 430).** `lib/domain/dice/index.ts` imports `feature-effects/owned.ts` for one
  helper (Purposeful Design), so the roll feed's `free-roll.tsx` and `tick-countdowns.tsx` bring
  `feature-effects/classification.ts`, `feature-effects/beastforms.ts` and `srd/beastforms.ts` (73 KB raw). A leaf
  module for the free-roll helpers and `OUTCOME_LABEL` would drop them; `src/lib/domain` is outside NB3's owns. The
  config panel (`components/config/sections/*`, 62 KB, the rules registry 15 KB) mounts with the shell on every route;
  it could load when the gear opens (outside owns). The party cards' text lines keep `subclasses`, `heritage` and
  `classes` (75 KB) until `partySummary` sends the display names.
- **Character sheet 1,982 / 690.** The sheet is the rules engine's page (derived stats, card and feature effects).
  Its page two and three could load with their tab, but four unit tests outside the owns (`sheet-render`,
  `experiences-level-up`, `purposeful-design`, `domain-deck-level-up`) render the sheet and click the tabs
  synchronously; they need `findBy` first.
- **Combat Map 2,547 / 887.** Most of it is needed in Play: the HUD (314 KB) uses the rules engine through the hand,
  the reaction prompts, the pickers and the action ring (card effects 135 KB, feature effects 151 KB, domain cards,
  Tier 2-4 equipment via `derived.ts` → `@/lib/srd`), and the map painter needs the built-in sprite packs (200 KB).
  Cutting single HUD parts saves 1-27 KB each, since they share the same hooks. The real fix is in `src/lib`: per-class
  lazy card and feature effect registries, and `derived.ts` off the `@/lib/srd` barrel.
- **Adversaries 1,397 / 490.** `srd/adversaries.ts` (321 KB) is the default Catalogue tab's data; a lighter list (names,
  tiers, roles) with stat blocks on open needs `components/adversaries/catalogue` (outside owns).
