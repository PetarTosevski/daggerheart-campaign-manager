# TASK-PH-B3: campaign shell

Tracer B3-shell. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

The signed-in campaign has a route tree, a campaign provider, a tab bar, a More
sheet, and a GM-only group. Email, Google, and Apple sign-in are unchanged.
Each existing route file now also exports an `ErrorBoundary`.

`CampaignProvider` (`apps/mobile/src/shell/campaign-provider.tsx`) subscribes to
`campaigns.get` once. While that query is unanswered the screen shows
`Loading`. A null result, or a missing campaign id, shows `Empty` titled
"Not found". The role rendered in the shell is that query's `role`.

Tabs are Dashboard, Party, Combat Map, and Sessions, plus More. More lists
World, Characters & Locations, Notes, Lorekeeper, Players, Tome, Settings, and
Switch campaign. Adversaries is in that list only for the GM. Placements live
in `apps/mobile/src/shell/sections.ts` and are keyed off `CAMPAIGN_SECTIONS`
and `visibleToPlayers` from `src/lib/campaign-sections.ts`. A section slug
with no phone placement fails typecheck, and a tab slug left out of the tab
order fails typecheck.

The installed tabs navigator (`useVisibleTabsWithRedirect` in expo-router
58.0.27) sends a focused hidden tab back to the first visible tab, so More
destinations are stack screens and the bar is the shell's own. Adversaries
lives in `app/campaign/[campaignId]/(gm)/`. The campaign stack wraps that
group in `Stack.Protected` and redirects a failed guard to the dashboard.
The adversaries route also checks `campaigns.get`'s role before it renders
`AdversariesScreen`. That screen is the one that subscribes to
`encounters:list`. A player render shows the Dashboard stub and does not
subscribe.

`LiveOffline` reads `useConvexConnectionState`. A dropped socket, or a connect
attempt that has already retried, shows `StaleBanner` and sets writes off.
`WriteButton` is the existing `Button` with that flag. The first attempt,
before any retry, does not show the banner.

Screens that are not built yet render `NotBuiltYet`, which is `Empty` with
"Not built yet." Route errors use `ErrorState` and `errorMessage` from
`src/lib/convex-errors.ts`. `ErrorState` is loaded when a route throws, so
importing a route does not load Reanimated before a test installs its mock.

The root layout still sends a signed-out visitor to sign-in and a signed-in
visitor on the sign-in or signed-out screen to `/campaign`. A signed-in
visitor already inside `/campaign/:id` stays there. `useBrandFonts` now runs
from that layout.

Stub routes, still `NotBuiltYet` plus an `ErrorBoundary`: `party/new`,
`party/[characterId]`, `codex/[entryId]`, `notes/[pageId]`,
`sessions/[sessionId]`, `(gm)/packs`, and `(gm)/adversaries/[encounterId]`.
Packs and the encounter sit in the protected group and check
`campaigns.get`'s role before the stub. A player render shows the dashboard
and subscribes only to `campaigns.get`. Those two stubs do not subscribe to a
GM function.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 28 suites, 78 tests. Watchman printed a recrawl warning. Re-run after the stub routes. |
| `pnpm lint` | Exit 0. |
| `pnpm typecheck` | Exit 0. |
| `pnpm test` | Exit 1. Vitest 4.1.10: 1 file failed, 324 passed (325). 1 test failed, 8388 passed, 1 expected fail (8390). Duration 45.76s. |

The failure is in `tests/convex/codex.test.ts`, "map pins: only existing tokens, region from the pin, hidden tokens never reach players": `gmView.entries[0]` had `tokenId: null`, `region: ""`, and `regionAuto: false` where the test expects `tokenId: 1`, `region: "Haven"`, and `regionAuto: true`. This tracer did not edit that file. Root Vitest only includes `tests/unit` and `tests/convex`. The phone shell tests are not in that run.

## Not done

No commit, no push, no merge. Feature screens other than sign-in and the Fear proof are stubs. The adversaries stub subscribes to `encounters:list` only after the GM gate, so the next adversaries screen should keep that query behind the same gate or the player harness will throw.
