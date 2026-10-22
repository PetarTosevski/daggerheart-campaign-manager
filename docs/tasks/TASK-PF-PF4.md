# TASK-PF-PF4: Preload the campaign in the layout; header art via next/image

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF4 (depends on PF1 and PF7). Branched from `rebuild` at
58b2288. On 2026-10-22 the orchestrator added `tests/e2e/auth-single-run.spec.ts` to PF4's owns.

## What changed

- **`[campaignId]/layout.tsx`** reads `campaigns.get` on the server:
  `preloadQuery(api.campaigns.get, { campaignId }, { token: await convexAuthNextjsToken() })` (CL5).
  - The read sits in its own async component inside a `<Suspense>` whose fallback is the shell skeleton
    (`CampaignShellLoading`). While the server reads the campaign, a hard load streams that skeleton instead of
    Load Campaign's (`campaigns/loading.tsx`, the next boundary up).
  - If the read fails (Convex unreachable, a token the server rejects), the layout logs it and passes `null`. The
    shell then reads the campaign on the client as before, and the existing error boundaries and B5's sign-in redirect
    handle the failure. Signed-out requests never reach the layout, because `src/proxy.ts` redirects them.
- **`campaign-shell.tsx`**:
  - `CampaignShell` takes `preloaded`. With it, `usePreloadedQuery` renders the campaign at once, on the server and
    at hydration, and the same subscription keeps it live. With `null`, it falls back to `useQuery` and the old
    skeleton.
  - **The page renders from hydration on, not into the server HTML** (`useHydrated`, a `useSyncExternalStore` that
    is `false` on the server and during hydration). The server HTML holds the shell (header art, nav, hero) and the
    page skeleton, and the page mounts right after hydration in the same task. Client navigations are unchanged.
    - Why: rendered on the server, the page sat in its own streamed Suspense boundary (`loading.tsx`). React 19.2
      reveals such boundaries in batches, up to 300 ms after the shell. A context change above the boundary in that
      window (Convex auth confirming, for one) made React throw away the server HTML and render the page again.
    - For about 100 ms both copies were in the DOM: the hidden streamed one and the client one. Strict locators failed
      on that: `auth-session-ended.spec.ts` failed 8 of 8 runs, and `auth-single-run.spec.ts` failed 1 of 3.
    - A probe saw a second copy in 2-3 of 12 hard loads of the dashboard. With the page kept off the server it saw
      none in 12, and both specs pass.
    - Two other fixes did not work. `useDeferredValue` on the summary broke the live "Campaign not found" switch: the
      page's own failing queries reached `campaigns/error.tsx` first. Dropping the layout's Suspense made the double
      render more frequent.
  - `useSameContent` keeps the previous summary when a new result changes nothing a campaign page reads, so the
    `useCampaign()` readers do not all re-render. That covers the first live result (equal to the preloaded one) and
    the shell's own `markOpened` write, which changes only `lastOpenedAt` (read by Load Campaign, not by any campaign
    page). Real changes pass in the same render.
  - **Header art is `next/image`**: `fill`, `sizes="100vw"`, `preload` (Next 16's name for the deprecated
    `priority`), `alt=""` and `objectPosition` from the frame. There is no CSS `backgroundImage` left in the file
    (CL10).
- **`src/lib/campaign-art.ts`** adds `src` (the image path, undefined when the asset is missing). It keeps `image`
  (the CSS value) for `campaign-tome-book.tsx`, which is outside this tracer.
- **`tests/e2e/campaign-preload.spec.ts`** (new):
  1. **Hard loads of the dashboard and `/party`.**
     - The HTML carries the campaign name.
     - The spec holds back every Convex server message until the page has subscribed to all its queries. With no
       reply delivered, `campaigns.get` plus the page's own queries (dashboard: `sessionWrap.dashboard`,
       `characters.listByCampaign`, `campaigns.fear`, `feed.list`; party: `characters.listByCampaign`,
       `members.roster`) must all be sent. This checks cause, not timing, so host load cannot flake it.
     - No hydration or page errors, and never more `section`/`main` landmarks than after the page settles (no second
       copy).
  2. **Header art.** It is a `/_next/image` `<img>` with `sizes="100vw"` and `alt=""`, preloaded by a
     `<link rel="preload" as="image">` in the HTML. It decodes, and no CSS background art is left in the header.
  3. **Unknown campaign id**, on the dashboard and on `/party`: "Campaign not found" is in the server HTML and on screen.
  - On the baseline build all three fail. The hold check alone fails as well: only `settings.get` and `campaigns.get`
    go out before a reply.
- **`tests/e2e/auth-single-run.spec.ts`**:
  - "retried once" waits for the refresh with `expect.poll(() => sameTokenServed)`. The campaign heading is now
    server-rendered, so it no longer marks the moment after the refresh.
  - Its Fear locators are scoped to the GM Fear region.

## Measurements

PF0 harness, same worktree and local e2e stack. Baseline = `rebuild` 58b2288 built into its own output directory.
The two builds were served alternately on the same port, back to back.

### Navigation (`measure.mjs`, median of 3 runs, ms)

Load average (1 min) at start: 0.1-0.5 for both (pairs 5 and 6). An earlier pair at load 35-46 was too noisy to use.

| Step | metric | local before | local PF4 | wan before (pair 5 / 6) | wan PF4 (pair 5 / 6) | wan, PF4 without `preload` |
|---|---|---:|---:|---:|---:|---:|
| hard load: Dashboard | WebSocket open | 98 | 108 | 627 / 623 | 749 / 750 | 705 |
| | first query sent | 99 | 108 | 715 / 718 | 839 / 840 | 795 |
| | **lastData** | 134 | 168 | **1,215 / 954** | **1,037 / 1,037** | 995 |
| Load → Dashboard | **lastData** | 136 | 151 | **550 / 543** | **498 / 502** | |
| first: Party | lastData | 81 | 86 | 167 | 173 | |

Counts are unchanged: 12 queries on the hard load, 1 `Authenticate`, 0 `POST /api/auth`.

**Level gap** (per run, from the harness JSON):

- **Baseline:** on every hard load and every Load → Dashboard, local and wan, all 10 page queries left after
  `campaigns.get`'s result.
- **PF4, local hard load:** all page queries left in the same millisecond as `campaigns.get` (0 ms gap in 3 of 3 runs).
- **PF4, wan hard load:**
  - 2 of the 10 page queries leave with `campaigns.get`.
  - The other 8 follow 90-130 ms later. They do not wait for its result; the hold test above proves that. They wait
    for the page's own JS: the page renders after hydration and needs its chunks, which arrive later on the 10 Mbit
    profile.
  - The baseline is bimodal: its page queries left either about 20 ms after `campaigns.get`'s result (954 ms) or
    300 ms after it (1,215 ms). PF4 is steady at about 1,040 ms.
- **Hard reload of `/party`:** the harness does not measure it. The spec shows the page's queries go out before any
  reply.

**What moved the wan hard load:**

- The WebSocket opens about 125 ms later. On the 10 Mbit profile, the header art (94 KB, now in the HTML and
  preloaded) competes with the scripts before hydration. Without `preload` it costs about 80 ms instead of 125.
- On the same profile the header art finishes at about 545 ms instead of 1,950 ms. A request probe shows a 94 KB webp
  through `/_next/image` where the CSS background loaded a 334 KB jpg, discovered only after the client rendered the
  shell. That is the LCP element.
- A version that rendered the page into the server HTML (before the double-render fix) was worse on wan: 1,296-1,370
  ms against 957-1,068 ms. The dashboard's CSS panel textures in `dashboard.css` (outside owns; a 361 KB png among
  them) were discovered from the HTML and competed with the scripts.

### Acceptance

| Criterion | Result |
|---|---|
| lint, typecheck, `pnpm test` | pass (see Tests) |
| dashboard, campaigns, campaign-preload specs and the not-found path | pass |
| page queries in the same flight as the first one (0 ms level gap) | local: 0 ms. `/party`: proven by the spec. wan: 2 of 10 with `campaigns.get`, the rest 90-130 ms later on page JS, not on its result |
| wan Load → Dashboard ≤ 600 ms (baseline 729) | 498 / 502 ms |
| wan hard-load data ≥ 1 RTT below the PF3 result | 1,037 ms vs PF3's 1,531 (taken at load 25-30). Against this session's back-to-back baseline: −178 ms (pair 5), +83 ms (pair 6). The baseline is bimodal, PF4 steady |
| no CSS backgroundImage in campaign-shell.tsx; the LCP image has priority | none left; `preload` (Next 16 replacement for `priority`) |

### Client JS per route (`bundle.mjs`, KB raw / gzip)

| Route | Before | After |
|---|---:|---:|
| `/campaigns/[id]` (dashboard) | 1,173 / 441 | 1,188 / 448 |
| every other `/campaigns/[id]/*` route | | +15 / +7 to +8 |
| routes outside the campaign | | unchanged |

The 15 KB is `next/image`'s client component, loaded with the shared campaign layout.

## Tests

- `pnpm lint` and `pnpm typecheck` are clean.
- `pnpm test --maxWorkers=4 --testTimeout=60000`: 261 files, 6,354 passed, 1 expected fail.
- e2e on the final build (ports 3124/3360, `E2E_REUSE_SERVERS=1`): 87 passed across campaign-preload, dashboard, campaigns, auth-single-run, auth-session-ended, auth, error-boundary, unauthenticated (not-found on every campaign route), navigation-perf, fear-render, live-dashboard, live-party, lorekeeper-shell, notes-shell, combat-map-shell, a11y-entry, a11y-party, party-roster and players. `auth-single-run.spec.ts` with `--repeat-each 3`: 12 passed.

## Follow-ups (outside owns)

- **`dashboard.css` panel textures.** They are CSS backgrounds, one a 361 KB png. Moving them to `next/image`, or
  adding webp siblings, would cut the dashboard's image bytes, and they would no longer compete with scripts. Any
  page rendered into the server HTML needs this first.
- **`campaign-tome-book.tsx`** still uses `campaignArt().image` as a CSS background (CL10).
- **Strict test locators.** Specs that use `getByTestId` or `getByText` right after a hard load are exposed to any
  future double render. Role-scoped locators are not.
