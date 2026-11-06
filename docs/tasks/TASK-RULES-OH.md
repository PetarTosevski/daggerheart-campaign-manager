# TASK-RULES-OH: Horizon encounter Hope / Fear bonuses (optional rule, HF p.171)

Plan `.omc/plans/rule-switches.yaml`, tracer OH. Registry id `horizonEncounterBonuses` (kind `optional`, Journey to
Horizon only, off by default; RS0). User answer Q15 (a, 2026-11-05, binding over the plan's (b) acceptance): "the app
also rolls the Encounter table and shows the entry; it applies only the optional bonuses automatically (4: GM +1 Fear
per PC, 12: each PC +1 Hope); the GM runs the rest."

## Book passage

HF p.171, "Encounter (d8 + d6)":

> 4 The party suffers a temporary setback, such as a dead end, bad omen, spoiled rations, or damaged tools.
> Optional: The GM gains a Fear for each PC.
>
> 12 The party gains a bit of good fortune, such as a shortcut, good omen, helpful resource, or lucky break.
> Optional: Each PC gains a Hope.

HF p.176, "Encounter Rolls": "When the party enters a hex, roll a number of d6s equal to the hex's terrain rating. If
any of the dice show a result of 1, activate an encounter you designed during region creation. Otherwise, you can spend
a Fear to activate an encounter. … The party can trigger more than one encounter in a single region. If this happens,
either roll on the Encounter table to generate a new encounter in the moment or shift an encounter from a region …"

## Interpretation

- The app already rolls the Encounter table (d8 + d6, not a d14) when a region is generated and on "Roll another
  encounter" (`convex/trackers/horizon.ts`), and shows each entry in the GM's region list and in the travel result. OH
  adds nothing to the rolling.
- The bonus applies when the encounter **happens**, i.e. when the GM runs (activates) it: ticking the encounter's
  "used" box in the region list. With the switch on, ticking an unused 4 or 12 calls `horizonEncounters.activate`,
  which marks it used and applies the bonus in one mutation; every other entry, and unticking, still goes through
  `trackers.horizon.setRegionEncounterUsed`. While on, an unused 4 / 12 shows "Running it: GM +1 Fear per PC" / "each PC
  +1 Hope".
- "Each PC" = the campaign's active characters (`status: "active"`), at most `MAX_PCS`.
- 4: `gainFear(pcs)` (cap 12, history row), one public feed row (`kind: "roll"`, `fearDelta` = Fear actually gained;
  players with "see the GM's Fear" off get the numbers hidden by `feed.list`).
- 12: each PC +1 Hope through `applyResourceDelta` (cap = `hopeMax`), one public row per PC whose Hope rose (with
  `before`, so undo restores it) and one campaign row naming PCs already at max.
- All rows share one `groupId`: Undo in the feed takes the Fear / Hope back. Undo does not untick the encounter; the GM
  unticks it by hand if they want to run it again.
- Off (the default) or outside Journey to Horizon: no new UI, and `activate` refuses with `MECHANIC_DISABLED`.

## What landed

| Piece | File |
|---|---|
| Pure `encounterBonus(total, pcCount, on = false)`, `SETBACK_ENTRY`, `GOOD_FORTUNE_ENTRY` | `src/lib/domain/frames/horizon.ts` |
| `horizonEncounters.activate` = `keyedGmMutation { regionId, index }` → `{ entry, fearGained, hopeGained }` | `convex/horizonEncounters.ts` |
| GM region list: the checkbox of a 4 / 12 runs the bonus when on; the hint line | `src/app/(gm)/campaigns/[campaignId]/world/crawl-regions.tsx` |
| Tests (pure, off / other frame, Fear cap for every start 0–12, Hope cap for every start, undo, idempotency, refusals) | `tests/convex/rules-horizon-bonuses.test.ts` |
| Authz entry (GM, co-GM ok; grantee, players FORBIDDEN) | `tests/convex/authz/rules-horizon.entries.ts` (+ `.test.ts`) |

Errors: `MECHANIC_DISABLED` (switch off or another frame), `TRACKER_RULE` (region / encounter gone, encounter already
ran), `INVALID` (an entry other than 4 or 12), `FORBIDDEN` for players.

## Open points

- When the bonus applies (on ticking the encounter as run) is this tracer's reading of "automatically"; the travel
  roll (`maps.moveToHex`) is untouched (not in OH's owns) and does not pick an entry.
