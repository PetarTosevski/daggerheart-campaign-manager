# TASK-PF-PF1: Instant tab feedback, full prefetch and router cache

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF1 (depends on PF0). User answer Q3 (2026-10-21): prefetch
all 8 campaign tabs.

## What changed

- **`src/app/(gm)/campaigns/[campaignId]/loading.tsx`** (new): the Suspense fallback of the campaign segment. It renders
  inside the campaign shell, so the header and nav stay, and shows `CampaignSectionLoading` until a tab's server
  payload arrives. Because the segment now has a loading boundary, the default (auto) prefetch of any link to a campaign
  page fetches the shell down to it, so even an unprefetched click shows the skeleton at once.
- **`CampaignSectionLoading`** (exported from `campaign-shell.tsx`): the shared skeleton. It uses the dashboard boards'
  dark panels (`#141e22` on `#253338`, 14 px radius) in the page grid, with `role="status"`, `aria-busy="true"`,
  `aria-live="polite"` and a screen-reader label ("Loading page…"). The pulse runs only under `motion-safe`. The shell
  shows the same skeleton while `campaigns.get` loads, in place of the old "Loading campaign…" line.
- **`src/app/(gm)/campaigns/loading.tsx`** (new): Load Campaign's fallback. It has the Chronicle board's `PageHeader`
  and three dim campaign bands, announced the same way ("Loading campaigns…").
- **Campaign nav**: every nav link is fully prefetched (`prefetch={true}`) once the browser first goes idle after the
  shell mounts (`requestIdleCallback`, 2 s timeout; `setTimeout` 1 s where it is missing). Until then the links keep the
  default prefetch (shell plus loading boundary). The tabs' payloads and code then do not compete with the open page's
  first data and hydration. The PF7 context split (`CampaignContext`, `OpenTomeContext`, `useCampaignFear`,
  `WithFear`, the memoized nav and hero) is unchanged.
- **`next.config.ts`**: `experimental.staleTimes.dynamic = 30`, so a page segment fetched on navigation is reused for
  30 s. Fully prefetched links use `staleTimes.static`, which stays at its default of 5 minutes (Next 16 docs:
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`). Data stays live,
  because every campaign page reads it from Convex subscriptions and not from the RSC payload.
- No `error.tsx` was touched (rule 11; D12 H4 owns them). The loading boundary sits inside each segment's error boundary.

## Spec: tests/e2e/navigation-perf.spec.ts

- **Campaign tabs.** On a fresh Witherwild campaign, the test waits for the nav's prefetches to land. It then adds
  80 ms of latency (PF0's wan profile) and clicks every tab twice (first visit, then revisit), each click from a
  settled page.
  - **Timing.** A capture-phase click listener in the page runs a `requestAnimationFrame` loop. The loop stops on the
    first frame that shows either the skeleton or the target URL (the URL commits with the new page's render). So
    Playwright's own round trips are not counted.
  - **Asserts.** Each click must show something within **100 ms**. A revisit must send **0 RSC requests**: no request
    with `_rsc=` or an `RSC: 1` header between the click and the next settle. The per-click report is attached to the
    test as an annotation.
- **Load Campaign.** From the title menu, with the same latency, the Load Campaign header (the skeleton's or the
  page's) must show within 100 ms of the click. The list must replace the skeleton afterwards.
- **Baseline.** Against the baseline build, the spec fails at the first tab ("first Party: page after 262 ms").

In-page timings from the spec with this change, 3 runs at load average about 23:

- first visits: 21-95 ms
- revisits: 16-89 ms
- revisit RSC requests: 0 on every tab
- Adversaries is the slowest; its page render takes most of the time.

## Measurements (`node scripts/perf/measure.mjs --profile wan --runs 3`, medians, ms)

The host was shared with several other tracers, and the load average stayed far above PF0's baseline session (4.7-18).
So the before and after builds were run back to back:

- **Pair A (load 14 → 23):** the baseline build, then the change with `prefetch={true}` from mount.
- **Pair B (load 29-38):** the baseline build rebuilt, then the change with `prefetch={true}` from mount.
- **Final:** the shipped idle-gated build (load 26-30).

| Step | Before A (load 14) | After A (load 23) | Before B (load 32) | After B (load 29-38) | **Final, idle-gated (load 28)** |
|---|---:|---:|---:|---:|---:|
| title → Load Campaign `url` | 269 | 87 | 423 | 124 | 158 |
| Load → Dashboard `url` / `lastData` | 345 / 1,160 | 105 / 902 | 411 / 1,234 | 88 / 1,291 | 146 / 1,133 |
| Load → Dashboard JS (files / KB) | 9 / 229 | 30 / 509 | 9 / 229 | 30 / 509 | 30 / 509 |
| first visit `url` (range of tab medians) | 223-368 | 47-130 | 326-699 | 89-208 | **56-187** |
| first visit JS on click | up to 4 files / 111 KB | **0** | up to 4 / 111 KB | **0** | **0** |
| revisit `url` (range of tab medians) | 119-145 | 42-126 | 153-241 | 61-185 | **40-170** |
| revisit `srv` (requests to Next) | 0-1 | 0 | 0 | 0 | **0** |
| hard load `lastData` / `quiet` | 1,278 / 2,275 | 1,301 / 2,934 | 1,901 / 3,292 | 2,177 / 4,487 | 1,328 / 2,876 |
| hard load JS (files / KB) | 23 / 433 | 49 / 794 | 23 / 433 | 49 / 794 | 49 / 794 |

Final run per tab (`url`, first / revisit):

| Tab | first | revisit |
|---|---:|---:|
| Party | 144 | 132 |
| World | 81 | 64 |
| Characters & Locations | 187 | 82 |
| Sessions | 70 | 87 |
| Combat Map | 56 | 104 |
| Adversaries | 106 | 146 |
| Notes | 102 | 170 |
| Lorekeeper (placeholder) | 106 | 40 |
| Dashboard | 139 | 53 |

### Against the acceptance targets

| Target | Result |
|---|---|
| First visit: 0 JS chunks fetched on the click (baseline up to 89 KB) | **Met.** 0 files on every tab in every run (baseline at this commit: up to 111 KB, Combat Map) |
| Revisit: 0 RSC requests inside 30 s | **Met.** `srv` is 0 on every revisit, and the spec's `request` listener sees 0 RSC requests |
| navigation-perf.spec.ts: skeleton or page within 100 ms | **Met.** Passed 3 of 3 repeats, plus the acceptance run at load 28-50 |
| Revisit `url` ≤ 40 ms median (baseline 116-178) | **Not met at this load.** 40-170 ms at load 28, against 153-241 ms for the baseline at load 32 |
| First visit `url` ≤ 60 ms (baseline 210-330) | **Not met at this load.** 56-187 ms at load 28, against 326-699 ms for the baseline at load 32 |

Why the millisecond targets are missed:

- **No server wait is left.** With the payload and code cached, the step's `url` is now Playwright's click (its
  actionability checks are CDP round trips) plus the React render of the new page on the main thread.
- **The harness has a floor.** The revisit of the empty Lorekeeper placeholder is 40-61 ms in every run, so the
  harness cannot measure much below that at this load.
- **The rest is render time of the heavier pages:** Party, Characters & Locations, Adversaries and Notes. That is the
  render and bundle work PF5 and the later tracers target.
- **In-page timing is lower.** Taken frame-accurately inside the page, the same clicks take 16-95 ms. A rerun at PF0's
  load (5-15) should be compared with the harness first.

### Costs

- **Dashboard entry fetches more JS.** Load → Dashboard and the hard load now fetch the 8 tabs' code too: about 280 KB
  and 360 KB more, and 8 full RSC prefetches (about 20 requests to the Next server on dashboard entry).
- **Dashboard data is not slower.** `lastData` stayed within noise in every pair: 1,160 → 902, 1,234 → 1,291, and
  hard load 1,278 → 1,301.
- **The idle gate keeps it that way.** The idle-gated build moves the prefetch behind the page's first idle period.
  Its dashboard main-thread time (1,578 ms) was below both the ungated build (1,789 ms) and the baseline (1,703 ms) at
  similar load. The tab JS is still counted, because the step's window is 2.4 s long.
- **PF5 shrinks this.** PF5 makes the per-tab chunks smaller, and that also cuts this prefetch cost.

## Verification

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm test --maxWorkers=4 --testTimeout=60000`: 223 files.
  - 5,435 passed, 1 expected fail, 1 failed: `combat-vision-sprites.test.ts` "keeps spriteSources and playerView
    within the C1 budget". This is a 500 ms timing budget that measured 654 ms at load average 50.
  - The file passes on its own (7 of 7). It is not in PF1's area.
- e2e, ports 3137 / 3386, servers started by hand, `E2E_REUSE_SERVERS=1`:
  - `dashboard.spec.ts`, `campaigns.spec.ts` and `navigation-perf.spec.ts` together: 13 of 15 passed at load 35-50.
    The 2 `campaigns.spec.ts` failures were a 30 s click timeout and a missing element.
  - `campaigns.spec.ts` alone right after: 7 of 7. Then `campaigns.spec.ts` and `dashboard.spec.ts`
    `--repeat-each 2`: 26 of 26.
  - `navigation-perf.spec.ts --repeat-each 3`: 6 of 6.
- `tsconfig.json` is unchanged (`scripts/e2e-next.mjs` restores it). The servers are stopped.
