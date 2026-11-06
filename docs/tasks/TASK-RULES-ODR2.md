# TASK-RULES-ODR2: Defined Ranges off, the follow-ups

Plan `.omc/plans/rule-switches.yaml`, tracer ODR2 (bead dcm-bxp.134). Follows ODR (`docs/tasks/TASK-RULES-ODR.md`): its
"Not done" list is this tracer's work list. User 2026-11-06: "Defined Ranges OFF: automatic effects that pick creatures
by range (e.g. 'all adversaries within Very Close', Ill Omen, Cloaked ally-in-Melee) don't apply; the GM gets a note
asking who is in range". On (the default) is unchanged.

## The book

CB p.103, "Range": "these ranges aren't intended to be precisely measured during play. The suggested estimates are a
quick guide for the GM to determine ranges during a scene". "Optional Rule: Defined Ranges" gives the squares (Melee 1,
Very Close 3, Close 6, Far 12, Very Far 13+).

## Behaviour with the rule off

| Where | Off |
|---|---|
| Card / feature "all targets within X" with none named (`buildRun`) | Nobody is picked; the use runs on no target; GM-only note "<card>: who is within Close range?" (the player may still name targets) |
| `creatureCount` with `within` / `chain` (Hive Mind, Shallow Cuts, Shield Wall's line) | Counts no one (`RunContext.definedRanges`, `rangeBlind` drops the map creatures' squares); one GM note per use (`rangeAskNotes`) |
| `within` / `allyNear` / `isolated` situation checks | Unknown: the player's confirmation decides (Q13), as with no map |
| `noEnemyWithin` (Arcane Door) | Holds (the GM judges) |
| Adversary runner (`AdversaryRunContext.definedRanges`) | `creatures` lose their squares, `allyWithin` requirements hold (as Q18), the flag reaches the card runner; `rangeGate(effect, useId)` names a trigger's range for the callers (see Not done) |
| Hold the Line (`rangeTriggersAfterMove`) | No pull and no feed row; for each PC whose stance holds, a GM-only note "Hold the Line (Ash): did Bear move within Very Close range of Ash?" |
| A PC's move and adversaries' `pcMoves` (Shield Wall) | No trigger runs; one GM-only note per move names them ("into Very Close range of Bladed Guard (Shield Wall)") |
| `moveLimit` with `maxRange` (Creeping Fire) | Blocks nothing; the move's GM note names it (a direction limit, Hurricane, still holds) |
| Area placement (`placeWithin`) | Any square on the map |
| Carried creatures (`carryAlong`) | Need not stand within Melee |
| Blink Beast's duplicate (`placeDuplicate`) | Any square on the map |
| Card Minion offer (`combatCards` `offerMinions`) | Every standing Minion of the encounter the roll beat |
| Feature prompts: Warden's Protection allies (`targetCount`), Cannonball's enemies (`featurePromptsReads`) | Every ally / enemy in range, every enemy near every other |
| Charge (`featurePrompts`) | Any enemy can be charged, the landing square need not be next to it, only the picked target is hit; GM note "Charge: who else is within Melee range of the landing square?"; `chargeOptions` sends no band |
| Door and light reach (`combatVision` `inReach`, `vision-layer` `LightSwitches`) | Seen is enough |
| Map board | `MeasureLayer` and `AreaPickLayer` get `useDefinedRanges(campaignId)` |
| Dock | No Measure button (GM dock and `PlayerMapControls` with `campaignId`) |
| HUD area pick (`hud/pick-area`) | No radius circle, no amber square, no placement problem, "Radius: Close" without squares; chain rows show no band |
| Token panel, vision panel | No "Range circles" / "Hide all circles" buttons |
| Client range marks | Hand `outOfRange` false; HUD pick rows never `out` and show no band; adversary `rangeRows` all in attack range; target rings show no band |

Interpretations (reversible):

- One note per use: the "all within" note wins over the count note.
- The card's name heads the note (the use name for Hold the Line, the feature name for an adversary).
- Placed areas still draw their circle (`area-overlay.tsx` unchanged): membership is still worked out by squares (see
  Questions). The GM's area tools' preview circle goes through `AreaPickLayer`, which takes the flag from the board.
- Situation checks off are the player's to confirm, not a GM note (the player confirms in the dialog today when a fact
  is unknown).

## Code

- `src/lib/domain/card-effects/run.ts`: `RunContext.definedRanges`, `rangeBlind`; `availability.ts`:
  `RequirementState.definedRanges`; `rule-notes.ts`: `RANGE_LABEL`, `rangeAsk`, `rangeCounts`, `rangeAskNotes`,
  `UseRuleNote.ruleId` takes `definedRanges`.
- `src/lib/domain/adversary-effects/run.ts`: `AdversaryRunContext.definedRanges`, `rangeGate`.
- `convex/lib/cardRunner.ts` (`buildRun`), `convex/lib/combatAreas.ts`, `convex/featurePrompts.ts`,
  `convex/featurePromptsReads.ts`, `convex/combatCards.ts`, `convex/combatTokens.ts`, `convex/combatVision.ts`.
- UI: `map-view/map-board.tsx`, `hud/dock/index.tsx`, `hud/pick-area/{model,layer,bar,chain}`, `hud/pick/{model,scene}`,
  `tokens/token-panel.tsx`, `vision/{panels,vision-layer}.tsx`, `actions/{hand,adversary}/model.ts`,
  `actions/targets/index.tsx`.

## Not done (outside ODR2's files)

1. **Ill Omen and other adversary range triggers**: `convex/lib/adversaryActions.ts` `pcRollAdversaryUses` (~1980) and
   the other `triggered(...)` callers read the band; with no band (`undefined`) the trigger fires (Q18). Off they should
   skip a use with `rangeGate(t.effect, t.use.id) !== null` and post `rangeAsk(feature, range)` as a `definedRanges` rule
   note in the roll's group, and pass `definedRanges: false` to the adversary runner.
2. **Elemental Incarnation's "all other adversaries within Very Close range"**: `convex/lib/combatActions.ts` ~1170-1185
   picks them by squares; off it should pick none and note.
3. **Cloaked's ally-in-Melee bonus (Sneak Attack)**: `convex/lib/combatActions.ts` ~1553 (`anyAllyInMelee`); off: no
   automatic bonus, a GM note (or the player's tick).
4. **Other `rangeCheck` without the flag in combatActions.ts**: ~784 / ~799 (`within` of triggers), ~1120 ("The target
   is within Melee range" situation), ~1396, ~1508.
5. **Player Measure button**: `src/components/combat-map/hud/shell.tsx` should pass `campaignId={state.campaignId}` to
   `<PlayerMapControls>` (without it the button stays).
6. **Chain rows' band**: `hud/pick-feature/index.tsx` (~257) and `hud/pick-card/chain.tsx` (~65) should pass the flag as
   `chainRows`' fourth argument.
7. **Adversary stat block range rows**: `hud/statblock/model.ts` (~149) should pass the flag to `rangeRows` and hide the
   band.
8. **Charge drawer label**: `drawer/use/model.ts` `targetLabel` shows "(Far)" for a target without a band; off it should
   show the name only.
9. **pick-attack** (OP's): `hud/pick-attack/model.ts` should mark no target out of range and show no band when off.
10. **Ally picks** (CU2's): `convex/lib/allyPicks.ts` `alliesFor`.

## Questions

- Live areas: membership (who stands in Dark Cloud, Zone of Protection) is still worked out by squares when the rule is
  off. Keep it (the drawn circle is the GM's estimate), or ask the GM per roll?
- Notes per move (Hold the Line, `pcMoves`, `moveLimit`) come on every move while the rule is off and a feature could
  apply. Is that too many?

## Tests

`tests/convex/rules-defined-ranges.test.ts` (ODR2 cases: the "all within Close" pick and its note, Hold the Line,
Blink Beast's duplicate, carrying beyond Melee); `tests/unit/card-effects/defined-ranges.test.ts` (runner counts,
checks, notes, `rangeGate`, client marks).
