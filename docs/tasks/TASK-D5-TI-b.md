# TASK-D5-TI-b: Integration of rests, the sheet display, Motherboard and frame follow-ups

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer TI-b (wave 4). Work list: items 6, 9-15 and 17-20 of `.omc/autopilot/d5-integration.md`.

## Items

| # | Item | Done | Where | Test |
|---|---|---|---|---|
| 6 | Tribute as a real rest move | yes | `restMovesFor` offers `tribute` to a Warlock (class or multiclass) while the campaign offers Warlock features (`classFeaturesAvailable`); `applyMoves` adds Favor = max(0, Spellcast) (`warlockSpellcast`) | unit `rest.test.ts`, convex `rest-frame-hooks.test.ts` |
| 9 | Rest moves `keepWatch` and `haltLycanthropy` | yes | `restMoveValidator` (widened union), `RestMove`, `MOVE_LABELS`, `frameRestMoves` | both files above |
| 10 | Picker shows the extra moves | yes | `rests.current.open.moves` lists each resting PC's pickable moves; `picker.tsx` uses it | e2e `rest-frame-hooks.spec.ts` (Beast Feast) |
| 11 | Projects filtered to kind "project" | yes | `rests.projects` and `rests.choose` accept only `kind: "project"` countdowns of the character | convex `rest-frame-hooks.test.ts` |
| 11 (optional) | Horizon long-rest check in `rests.start` | no | The sanctuary check lives inline in `horizonRestHook` (convex/trackers/horizon.ts, not in TI-b's files). Copying it into `rests.ts` would give two copies of the rule. Needed: an exported `assertLongRestAllowed(ctx, campaign)` in horizon.ts, which `start` can then call | none |
| 12 | Beast Feast move restriction | yes | `FEAST_FORBIDDEN`, `validateChoice(…, forbidden)`, `allowedMoves` | unit, convex, e2e |
| 13 | Colossus manual rest buttons relabelled as corrections | yes | `trackers/colossus.tsx`: "Correction: short rest +1" and a note that party rests mark the track automatically | e2e `rest-frame-hooks.spec.ts` |
| 14 | Horizon Endurance ticks on entering a wilderness hex | yes | `enduranceOnEntry` in `convex/maps.ts`, called from `moveToHex` | convex `maps.test.ts` |
| 15 | One source for the equipment rules | yes | `src/lib/equipment-rules.ts` (`assertEquipment`, `assertArmor`, `assertSource`, `IKONIS_ONLY`), used by `convex/characters.ts` and `src/lib/import/sheet.ts` (code `PHOTO_IMPORT_RULE`) | unit `equipment-rules.test.ts` |
| 17 | Scar cap 6 + `hopeSlotBonus` | yes | `scarsMax()` in `src/lib/domain/characters/index.ts`, used by `applyResourceDelta` and the Wither `addScar` (`SCARS_MAX` removed) | unit `wither.test.ts` |
| 18 | Client defense includes installed augments | yes | `page-one.tsx` (Defence box: Evasion, Armor Score and slots) and `roster.tsx` read `characterExtras.get` in Motherboard campaigns | e2e `character-sheet.spec.ts` |
| 19 | Ikonis in place of the weapon pickers | yes | `IkonisBlock` in `page-one.tsx` (Motherboard frame with an empty primary) | e2e `character-sheet.spec.ts` |
| 20 | "During rest" label | yes | `page-two.tsx`: "Swapping during a rest (free only while the GM has a rest open)", plus a warning when it is checked and no rest is open | e2e `character-sheet.spec.ts` |

## Rules and book passages (checked in the books' text)

### Beast Feast, CB 278 (and CB 279)

> CB 278: "During downtime, players can't choose downtime moves to clear Stress, clear Hit Points, or gain Hope. Instead, they have a new downtime move: Make a Feast."

Forbidden on both rests: Tend to Wounds, Tend to All Wounds (clear Hit Points, on yourself or an ally), Clear Stress, Clear All Stress, Prepare and Prepare together (gain Hope). Repair Armor, Repair All Armor, Work on a Project, Make a Feast and Tribute stay.

> CB 279, Berry's Restaurant: "When the PCs are near an open Berry's Restaurant during their downtime, they can each spend a handful of gold to order food and choose a downtime move to clear Stress, clear Hit Points, or gain Hope. Only 2 handfuls of gold can be spent per PC during downtime."

Not modelled (question 1).

### The Age of Umbra, CB 289

> "Parties have access to an additional downtime move: Keep Watch: Describe how you stay vigilant against what lurks beyond your camp. When the GM makes a Lurking Darkness roll at the end of downtime, you roll your Hope Die and choose whether to replace their roll with yours. If multiple players choose this move, you can take the highest die roll."

`keepWatch` can be picked on short and long rests in Age of Umbra campaigns. The T3b hook (`ageOfUmbraRestHook`) already rolls one Hope Die per watcher and keeps the best result.

### Dark Heart of Andaluria, HF 153

> "activate a long-term Lycanthropy Countdown (6). It ticks down each time the PC takes a rest without using a downtime move to halt their lycanthropy's progression. When it triggers, the PC gains the Werewolf transformation."

`haltLycanthropy` can be picked on short and long rests while `transformations` is on. The T3b hook skips the tick for a PC who picked it. It is offered to every PC, not only to bitten ones (question 2).

### Journey to Horizon, HF 176

> "OPTIONAL RULE: ENDURANCE COUNTDOWNS … At the end of a rest, each PC gains an Endurance Countdown (6). When the party enters a wilderness hex, each player rolls their Hope Die. If the result is equal to or lower than the value of their PC's Endurance Countdown, they mark a Stress. Otherwise, they tick down their Endurance Countdown. When a PC's Endurance Countdown triggers, they become Vulnerable until their next rest. At the start of a rest, all PCs' Endurance Countdowns end."

With `enduranceCountdowns` on, `moveToHex` rolls a server Hope Die (d12) for every active PC that has an active Endurance Countdown (`ownerKey` `endurance:<id>`, started by a rest).
- At or below the countdown: the PC marks a Stress through `applyResourceDelta`, so a full Stress track marks a Hit Point instead (CB 92).
- Above it: the countdown ticks, with its own history. When it triggers, the PC becomes Vulnerable (removed at the next rest by the T3b hook).
- The sheet change is logged with `before` and can be undone. The tick keeps its own countdown history.
- A hex with a sanctuary marker does not count as wilderness (question 3).

### Warlock Favor, HF 14

> "You start with 3 Favor. You can use a downtime move to show tribute to your patron. Describe how and gain Favor equal to your Spellcast trait."

Tribute is a downtime move on either rest. A negative Spellcast trait gives 0. Picking it twice gives Favor twice, because CB 105 lets a player choose the same move twice. An interrupted long rest keeps it: CB 105 says "the characters instead gain the benefits of a short rest", and Tribute is also a short-rest move. The frame moves are still dropped from the applied moves (their hooks read the picks).

### Scars and Light in the Dark, CB 40 and CB 106

> CB 40: "Use this as an additional Hope slot your character can mark."

Scars now stop at 6 + `hopeSlotBonus`. With Light in the Dark, the seventh scar is stored and ends the journey.

## Questions (reversible minimums)

1. **Beast Feast, Berry's Restaurant (CB 279):** see the CB 279 quote above. Should the app model "near an open Berry's Restaurant" (for example a GM toggle on the rest that lifts the restriction and charges a handful of gold per PC)? Now: the restriction always applies, and the GM can still adjust sheets by hand.
2. **Halt lycanthropy (HF 153):** "without using a downtime move to halt their lycanthropy's progression". The book doesn't say who may pick it or what the move looks like. Now: every PC can pick it in Andaluria while transformations are on, even without a Lycanthropy Countdown. A PC without a countdown wastes the pick. Nothing in the app creates `lycanthropy:<id>` countdowns yet, so limiting the move to bitten PCs would make it unpickable.
3. **Wilderness hex (HF 176):** "When the party enters a wilderness hex". The chapter contrasts the wilderness with sanctuaries ("You'll find no safety in the wilderness and must rely on sanctuaries", HF 159) but doesn't define a wilderness hex. Now: every hex without a sanctuary marker is wilderness.
4. **Endurance rolls (HF 176):** "each player rolls their Hope Die". Now: the server rolls (D5 decision 1), and the result goes to the character's feed. Physical-dice entry is not offered here.

## Changes needed outside TI-b's files (for the orchestrator)

- `convex/trackers/horizon.ts`: export the long-rest sanctuary check so `rests.start` can refuse a Horizon long rest up front (item 11, optional part).
- `src/lib/domain/death/index.ts` line 75: the comment "The stored scars stop at 6" is out of date. `applyResourceDelta` now stores the seventh scar with Light in the Dark.
- `src/lib/domain/class-features/classes/warlock.ts`: the class action `tribute` duplicates the new rest move. It could be removed, or kept for downtime taken outside the app.
- `tests/unit/sheet-render.test.ts`: the vault button still reads "(free)" whenever the checkbox is checked, even with no rest open, because that test expects it. Once the test mocks `rests.current`, the button could show the Stress cost when no rest is open.

## Verification

`pnpm lint` and `pnpm typecheck` are clean. `pnpm test`: 99 files, 990 tests. Local push with `--typecheck=enable`. e2e: `rest.spec.ts`, `rest-frame-hooks.spec.ts`, `character-sheet.spec.ts`, `colossus.spec.ts` and `motherboard-ikonis.spec.ts` all pass (9 tests).
