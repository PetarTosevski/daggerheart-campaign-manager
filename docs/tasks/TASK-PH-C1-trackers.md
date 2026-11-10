# TASK-PH-C1: frame trackers

Tracer C1-trackers. Branch `phone/C1-trackers` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c1-trackers`,
from `phone/A1-on-master` at `9b522dc`. Not committed.

## What changed

The six dashboard frame trackers and the Witherwild Wither panel now live in
`apps/mobile/src/features/trackers/`. They call the same Convex functions and
domain helpers as the website. `CampaignFramePanels` renders the frame tracker,
then the Wither panel. Nothing under `apps/mobile/app` mounts them yet, so the
campaign dashboard route is still the stub.

Players can read every panel. GM edits mount only when the campaign role is
`gm` (and, where the query itself is role-split, when that query's role is
`gm`). A player render does not subscribe to a GM query or call a GM mutation.
The harness throws if it does.

- Age of Umbra: Sacred Pyres, Blessed Branches, and the at-pyre checkbox.
  Lurking Darkness, including its log, is the GM's.
- Andaluria: players see the hunt, its beat, revealed clues, and a revealed
  monster. The GM names hunts, edits beats, clues, and the monster, and
  archives or deletes a hunt.
- Colossus: the hunt phase and slain count are public. Defeat, corrections,
  and Kudamat are the GM's.
- Five Banners: players see the week and revealed relationships, sheets, and
  objectives. The GM edits those and advances the week. `operateObjective` is
  not a scanned GM function, but the server requires the owner and the website
  shows it only to the GM, so the phone does too.
- Horizon: players see Soul Echoes and disasters that have occurred. The GM
  sets echoes and marks the Doom Track, and also reads `sessionRecords.list`
  for the session number on a mark.
- Weredragon: anyone can roll the night sky and submit a secret. A player with
  an unplaced roll sees the dice and cannot roll again. Placing the reading,
  editing revelations, and marking a secret used are the GM's.
- Wither panel: only a Witherwild campaign. The count is the sum of sheet
  Wither, ignoring a corrupt sheet, against the pool of 20. The GM ends the
  session with `sessions.end`. `witherPersists` keeps the tokens and says so.

Keyed mutations send a fresh `idempotencyKey` from `crypto.randomUUID()`,
called as a method so `this` stays the Crypto object. Writes go through the
offline-aware button, and destructive confirms use `Sheet`.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the worktree. `pnpm install` was required
first; the new worktree had no `node_modules`.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 29 suites, 97 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1, then exit 0 on a second run of the same command. This tracer did not edit that file. |

The first codex run (Vitest 4.1.10) failed 1 of 24 tests: "images: players get only revealed ones; revealing marks the entry known". `gmView.entries[0].images` was `[]`; the test expects two image URLs. The same test alone, and then the whole file, passed on the next two runs (24 passed). The map-pins failure recorded on TASK-PH-B3 did not fail in either run here.

## Not done

No commit, no push, no merge. The dashboard route is still `NotBuiltYet`. The
next shell tracer should render `CampaignFramePanels` on the campaign
dashboard. Campaign time stays a header control on the website and is not part
of this panel.
