# TASK-PF-PF7: Fear out of the campaign summary; stable campaign context

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF7 (pulled forward to wave 1; owns widened 2026-10-21
to the 14 Fear readers).

## What changed

- **`campaigns.fear`** (new public query, `campaignQuery`, `need: "view"`, `args: { campaignId }`,
  `returns: v.number()`): the campaign's GM Fear, read from `campaignState`. GM and players read it; outsiders get
  `NOT_FOUND`, the signed-out get `UNAUTHENTICATED`. Authz-matrix entry: D12 H5.
- **`campaigns.get`** no longer reads `campaignState`. It returns the summary without `fear`
  (`campaignSummaryValidator.omit("fear")`; `CampaignSummary` has no `fear`), so a Fear click does not change its result.
- **`campaigns.list`** keeps `fear` (type `CampaignListItem`), because Load Campaign shows it on every card. Only the
  title menu subscribes to `list`, never a campaign page, so it is not re-sent by a Fear click on a campaign page.
  The other choice was one `campaigns.fear` subscription per card, up to 100 of them.
- **Campaign shell**: the context is split. `CampaignContext` holds the summary (it changes only when the campaign is
  edited), `OpenTomeContext` holds a setter that never changes, and the live Fear has its own hooks:
  `useCampaignFear()` and `<WithFear>{(fear) => …}</WithFear>`, which re-render only their own subtree. `CampaignNav`,
  `DashboardHero`, `CampaignTome` and `PlayersDialog` are memoized, and their callbacks are stable.
- **FearPanel** reads `campaigns.fear` itself, with its own error boundary, and is memoized. A token click updates the
  value optimistically (`fear.set` with an update on `campaigns.fear`), so the change shows at once. Tokens are
  disabled until the first value loads. The dashboard no longer passes it `fear`.
- **Other Fear readers**: the Adversaries page (encounter tracker, environment catalogue) and the combat map's Fear
  pill use `<WithFear>`. The dice box reads `campaigns.fear`. The tracker's Spend Fear and the environment
  feature-spend optimistic updates now lower `campaigns.fear` instead of patching `campaigns.get`.
- `sessions.ts`: no change was needed. `sessions.current` reads `campaignState`, so a Fear write re-runs it on the
  server, but its result is unchanged and Convex does not re-send it.

## Measurements

`tests/e2e/fear-render.spec.ts`: 8 Fear clicks on a fresh Beast Feast dashboard, CPU throttled 4x (PF0's cpu4).

- **Queries re-sent**: counted from Convex WebSocket `Transition` frames (CDP).
- **Main-thread time**: CDP `Performance.getMetrics` `TaskDuration` and `ScriptDuration` over a 2 s window after a
  DOM `click()`, minus the 2 s idle window just before it.
- **Noise control**: CSS animations are paused, and nothing polls the page inside a window, so Playwright's injected
  script is not counted. Before that change, Playwright's actionability and `toHaveText` polling made up most of the
  measured time.

Same machine, same local backend, baseline and PF7 builds run back to back. Load average was 20–30 on a shared host,
so medians vary between runs.

| Fear click on the dashboard | Baseline (rebuild 4f39112) | PF7 |
|---|---|---|
| Query results re-sent per click | 1: `campaigns:get` (whole summary incl. tome text) | 1: `campaigns:fear` (a number) |
| Main-thread script time, median per click (3 runs) | 76 / 57 / 58 ms | 24 / 35 / 47 ms |
| Main-thread task time, median per click (3 runs) | 200 / 194 / 173 ms | 173 / 218 / 234 ms |

Findings:

- The plan's baseline of 3 re-sent queries does not happen on the wire. `sessions.current` re-runs, but an unchanged
  result is not re-sent, and `campaigns.list` is not subscribed on a campaign page. Baseline and PF7 both re-send 1
  query. PF7's is the small Fear read instead of the campaign summary, and no `useCampaign()` reader re-renders.
- Script time (React work) per click is down about 50% (median of medians 58 → 35 ms).
- Total task time is **not** down. A CDP trace of a PF7 click shows the time is mostly the rendering pipeline after the
  Fear panel changes, not React. At 4x throttle, one ~240 ms frame breaks down as:
  - forced style and layout: 76 ms
  - compositor layerization (`PaintArtifactCompositor::Update`): 33 ms
  - `IntersectionObserver` recomputation (the `next/link` prefetch observers): 30 ms
  - layer updates: 15 ms
  - the React event and FearPanel render: about 60 ms

  CSS containment on the panel (`contain: layout paint`) made no measurable difference and was not kept. The acceptance
  line "task time down >= 50%" is therefore not met by narrowing re-renders. The rest of the cost is the page's paint
  and compositing (see QUESTIONS).

## Tests

- `tests/convex/campaigns.test.ts`:
  - a new campaign has Fear 0 through `campaigns.fear`
  - `get` has no `fear`, `list` and `campaigns.fear` follow `set`/`adjust`
  - role test for `campaigns.fear`: GM and player read it, outsider `NOT_FOUND`, signed-out `UNAUTHENTICATED`
- Fear helpers in `fear`, `fear-spend`, `encounter-tracking`, `environment-actions`, `horizon` and `age-of-umbra`
  tests, and in `tests/e2e/environments.spec.ts`, read `campaigns.fear`.
- `tests/e2e/fear-render.spec.ts` asserts exactly `["campaigns:fear"]` per click and logs the timings.

## QUESTIONS

1. The remaining Fear-click cost is rendering, not React: layerization, link-prefetch `IntersectionObserver`s,
   style/layout. Should a later tracer go after it (fewer composited layers in the Fear panel's filters, fewer observed
   links), or is the React-side halving enough?
