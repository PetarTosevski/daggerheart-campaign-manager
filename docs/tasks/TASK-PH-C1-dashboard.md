# TASK-PH-C1: campaign dashboard

Tracer C1-dashboard. Branch `phone/C1-dashboard` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c1-dashboard`,
from `phone/A1-on-master` at `9b522dc`. Not committed.

## What changed

The campaign dashboard follows the website: header, Fear, party cards, roll
feed, countdowns, rests, end scene, frame rules, last session, the tome, and
key figures. Frame trackers and the Witherwild tracker panel are not on this
screen.

`DashboardScreen` still renders `NotBuiltYet` ("Dashboard" / "Not built yet.")
when `campaigns.get` has no frame. The shell's player routes use that shape, so
they keep a single `campaigns:get` subscription. A campaign from `campaigns.get`
always has a frame; the live tree loads only then, so those routes do not
import Reanimated.

GM controls render only for the GM: Fear plus and minus, Start Session, the
long-cycle day and week controls, rest start / finish / interrupt / undo, the
long-rest countdown tick, secret rolls, clear / reveal / delete, countdown
create and advance, end scene, and frame rules. A player still sees their own
character steppers when `canEdit` is set, and Undo on a feed row the server
marks `canUndo`. Revive stays GM-only.

The roll feed calls `usePaginatedQuery` on `feed.list` with
`initialNumItems: 15`, and "Show older rolls" asks for another 15. Dice come
from the server row.

Fear plus and minus call `fear.adjust` with one new idempotency key per tap.
Two increases from 3 show 5 before the server answers. The value stays inside
0–12. `campaigns.markOpened` is not called from an effect.

A player render of the live dashboard subscribes to `campaigns:get`,
`sessionWrap:dashboard`, `campaigns:fear`, `characters:partySummary`,
`rests:current`, `feed:list`, `countdowns:listByCampaign`, and `maps:locations`.
It does not subscribe to `countdownRolls:countedRows`, `countdownRolls:preview`,
or `countdownTracks:afterRest`. Those queries mount only for the GM, and
`preview` only after Tick countdowns is opened. The harness throws
`Player subscribed to GM function <name>` if a player render reaches one.

## Commands

Node v24.22.1, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 34 suites, 105 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1. Vitest 4.1.10: 1 file failed. 1 test failed, 23 passed (24). Duration 1.51s. |

The failure is `tests/convex/codex.test.ts`, "images: players get only revealed ones; revealing marks the entry known": `gmView.entries[0].images.map((g) => g.url)` was `[]` where the test expects two URL strings. The map-pins test in the same file passed. This tracer did not edit that file.

## Not done

No commit, no push, no merge. The phone app routes are unchanged.
