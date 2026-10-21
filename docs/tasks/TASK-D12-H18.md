# TASK-D12-H18: Live-update e2e - dashboard, party and world (two browsers)

Plan `.omc/plans/d12-hardening.yaml`, tracer H18 (depends on H1). User answer Q12 (2026-10-21): the listed live-update
checks, "all with GM and player open side by side, never reloading".

## What landed

Three specs on H1's `gmAndPlayer` fixture (`tests/e2e/live.ts`). Each test gets a fresh campaign: the GM and the
player (`e2e-player@example.test`, owner of characterA, the Bard "Liriel") are signed in in two browser contexts. Both
pages are on the screen under test **before** the change, and the change must show up on the other one. Moving to a
page with `goto` before the change is fine; nothing reloads after it. None of the three specs calls `reload()` or
`waitForTimeout`. Each file sets a 60 s test timeout (analysis section 4: "each test stays under 60 s"), because the
two sign-ins plus the join take 10-20 s on a loaded machine.

| Analysis section 4 row | Spec · test | Direction | What proves it |
|---|---|---|---|
| Fear tokens change | `live-dashboard` · Fear set by the GM | GM → player dashboard | the player's `fear-value` goes — → V → IV and the "Fear 4 of 12" token is pressed |
| Countdown revealed, ticked, hidden | `live-dashboard` · a countdown revealed, ticked and hidden | GM → player | a Private countdown is absent for the player; made Public from the "Who can see" badge it appears at 4/4; Tick −1 moves it to 3/4; made Private again it disappears |
| Witherwild time arc advances | `live-dashboard` · the Witherwild time arc | GM → player | the player's `time-stage` follows Day 4 (High Noon) and Day 7 (Nautical Twilight); Bring the Night moves `time-label` to Week 2 and the stage to Nightfall |
| Player joins, GM removes player | `live-dashboard` · the GM removes the player … and sees them join again | GM → player; player → GM | Remove in the open Players dialog turns the player's open dashboard into "Campaign not found" and the dialog into "No players yet."; a rotated code shows in the open dialog; the player joins by the /join link and the open dialog lists them again |
| Player marks HP / Hope on their sheet | `live-party` · the player marks HP and Hope | player → GM roster card and sheet | the player taps Hit Point 2 and Hope 4; the GM's dashboard card (`Liriel HP 2 of 5`, `Liriel Hope 4 of 6`) and the GM's open sheet (a second GM tab) follow |
| GM edits the player's sheet (condition, gold) | `live-party` · the GM edits the player's sheet | GM → player sheet | the GM marks all 6 Stress: the player's sheet shows 6 of 6 and "All Stress marked: Vulnerable."; the GM's + on Handfuls of gold raises the player's count by one |
| Roll feed: player rolls | `live-party` · a roll from the player's sheet | player → GM feed | two Presence rolls from the player's Dice box add one, then two lines to the GM's open Rolls feed |
| Codex entry shown / hidden | `live-world` · a Codex entry the GM shows and hides | GM → player list | a new secret entry is absent from the player's open Entries list; "Secret from players" → Known makes it appear; back to Secret removes it |
| World map token placed / party moved | `live-world` · a world map token … and the party | GM → player world view | a Village named Oakhollow placed by the GM appears on the player's open map; Shift+ArrowRight on the party banner moves the player's "Party token" by 2% (its `left` style) |

Notes:

- The game has no free "set a condition" control on a character sheet (conditions come from features, death moves and
  the tracker). The condition row uses Vulnerable from full Stress, which is what the sheet shows.
- The roll test emulates reduced motion on the player's page, which turns the 3D dice off by default (`dice-3d.spec`),
  so the result shows at once; the account's 3D setting is not touched.
- The countdown and Fear tests use Beast Feast (a frame without the time arc, as in `dashboard.spec`); the rest use the
  fixture's default, Witherwild.

## Live-update bugs found

None. Every live update in the table reached the other screen without a reload, so there is no `test.fixme` and no
new bead.

## Flakiness on a loaded machine (not an app bug)

While the specs ran, the machine's load average was 30-55 on 16 cores (many tracers in parallel). The local backend
then hits its 1 s function limit ("Function execution timed out (maximum duration: 1s)" in `convex logs`, for example
`characters.listByCampaign`, `countdowns.listByCampaign`, `rests.current`, `characters.assignOwner`). A timed-out
query trips the page's error boundary ("The campaign dashboard failed to load"), and a timed-out mutation fails the
fixture. Every failure in the runs below matched such a timeout in the backend log; none was a missing live update.

## Verification

Ports 3120 / 3352, `E2E_REUSE_SERVERS=1`, local backend and `scripts/e2e-next.mjs` started by hand, `--workers=1`:

- Final two runs, back to back: **9 passed (1.6 min)**, then **9 passed (1.4 min)** (load average about 30).
- Earlier runs at load 45-55 failed 2-7 tests each, and each of those failures lined up with a backend 1 s timeout
  (see above). Every test passed in several runs before the final pair.

- `pnpm lint` (ESLint on the three specs) and `pnpm typecheck` pass.
- `grep -n "reload()\|waitForTimeout" tests/e2e/live-*.spec.ts` finds nothing.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H18` passes.
