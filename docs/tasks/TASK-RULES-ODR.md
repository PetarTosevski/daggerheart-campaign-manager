# TASK-RULES-ODR: the optional rule Defined Ranges (CB p.103), on by default

Plan `.omc/plans/rule-switches.yaml`, tracer ODR (epic dcm-jh6d part A; user 2026-10-30 on dcm-bxp.134: "Defined Ranges
CB p.103 becomes a switch, default ON (off = no square counting / range hints / range checks; GM judges by eye)").
Built on RS0 (`ruleModesOf(campaign).definedRanges`, registry id `definedRanges`, kind `optional`, default `true`).

## The book

CB p.103, "Range": "these ranges aren't intended to be precisely measured during play. The suggested estimates are a
quick guide for the GM to determine ranges during a scene, and they might adjust the map as needed. The map should always
adjust to capture the fiction, rather than the fiction changing to match the map." … "Out of Range: Anything beyond a
character's Very Far range is Out of Range and usually can't be targeted."

CB p.103, "Optional Rule: Defined Ranges": "If your table would rather operate with more precise range rules, you can use
a 1-inch grid battle map during combat. If you do, use the following guidelines for play: Melee: 1 square • Very Close:
3 squares • Close: 6 squares • Far: 12 squares • Very Far: 13+ squares • Out of Range: Off the battlemap".

## Behaviour

| | On (default, unchanged) | Off |
|---|---|---|
| PC weapon attack (`checkTargets`) | A target beyond the weapon's range waits for the GM (`pending`) or is refused by the table's `outOfRange: "refuse"` | Every target is in range: no `pending`, no COMBAT_TARGET_OUT_OF_RANGE, for players and the GM |
| Rider-added targets (Hold Them Off, Surrounded: `addedOutOfRange`, `addedTargets`) | Out of the rider's range: the attack waits for the GM (Refuse drops it) | Never out of range |
| Card and feature uses, feature prompts (`buildRun`'s `outOfRange`) | Targets, picks, allies, follow-ups and chain links out of range wait for the GM; a picked point out of range is COMBAT_TARGET_INVALID | `outOfRange` is always empty; a point is never out of range; an `aroundPoint` target is not re-measured from the points; a repeating chain always asks (`chainGoesOn`) |
| The `outOfRange` table setting | Ask / Refuse | Ignored (nothing is ever out of range); the Table section's row is disabled and says "Defined Ranges is off" (the stored choice is kept) |
| Target hints (`combatActionsReads.targets`) | `inRange` by squares | `inRange` true for every target (`band` is still reported) |
| Minion offer after a weapon hit (D6, `offerMinions`) | Minions within the weapon's range | Every standing Minion of the encounter the roll beat (the attacker or GM judges the range) |
| Gold past a recipient's cap (`featureRunner`, dcm-i5e1) | Party members within Close | Every party member on the map (the nearest is still the default) |
| Door / light reach (`reach.ts` `inMelee`, `anyInMelee`) | Melee (1 square) | Always (with the new `definedRanges` argument; see Not done 1) |
| Range circles (`tokens-layer.tsx`) | R and the token's button show Melee / Very Close / Close / Far rings | None shown; R does nothing |
| Measure tool (`MeasureLayer`) | "7 squares · Far" | Renders nothing (`definedRanges` prop; see Not done 2) |
| Area pick (`AreaPickLayer`) | The hovered square and a preview circle of the area's range | The square still places; no preview circle (`definedRanges` prop; see Not done 2) |
| Adversary actions (`convex/lib/adversaryActions.ts`) | No range refusal exists on the server (a GM never waits for a sanction) | Unchanged: still nothing to refuse |

Interpretations (each reversible, kept to the plan's acceptance):

- Off removes every range **refusal**, every **out-of-range request** to the GM, and every range **filter on a list a
  person picks from** (Minion offer, gold candidates). Automatic effects that pick creatures by range with nobody
  choosing still count squares (see Questions).
- `rangeCheck(from, to, range, definedRanges = true)` keeps reporting `distance` and `band` when off; only `inRange` is
  always true. Code that reads the band for its own rule (Sandstorm's "from beyond Melee range" disadvantage, adversary
  reaction windows) is unchanged.
- A scene built without `attackScene` (`combatAreas` `triggerScene`, `combatActionsReads`) has no `definedRanges`; it
  reads as on (`rangesOn`). The checks that matter read the campaign directly (`checkTargets`, `addedTargets`,
  `targetHints`, `buildRun`).

## Code

- `src/lib/domain/combat-actions/distance.ts`: `rangeCheck(..., definedRanges = true)`.
- `src/lib/domain/combat-map/reach.ts`: `inMelee(..., definedRanges = true)`, `anyInMelee(..., definedRanges = true)`.
- `convex/lib/combatActions.ts`: `AttackScene.definedRanges?` (set by `attackScene`), `rangesOn(scene)`;
  `targetHints`, `checkTargets`, `addedOutOfRange`, `addedTargets`, `offerMinions` read the rule.
- `convex/lib/cardRunner.ts`: `BuiltRun.definedRanges`; `buildRun`'s `flag`, the points check and `chainGoesOn`.
- `convex/lib/featureRunner.ts`: the gold candidates.
- `src/components/combat-map/map-view/measure.tsx`: `useDefinedRanges(campaignId)` (on until `ruleSettings.get` loads),
  `MeasureLayer`'s `definedRanges` prop.
- `src/components/combat-map/map-view/area-pick.tsx`: `AreaPickLayer`'s `definedRanges` prop.
- `src/components/combat-map/tokens/tokens-layer.tsx`: rings and R read `useDefinedRanges`.
- `src/components/config/sections/table/index.tsx`: the Out-of-range row (`TABLE_TEXT.rangesOff`).

## Not done (outside ODR's files)

1. **Door / light reach**: `convex/combatVision.ts` (`anyInMelee([viewer.token], object)`, around line 495) and
   `src/components/combat-map/vision/vision-layer.tsx` (line ~454) should pass `ruleModesOf(campaign).definedRanges` /
   `useDefinedRanges(campaignId)` as the third argument.
2. **Map board wiring**: `src/components/combat-map/map-view/map-board.tsx` should call `useDefinedRanges(campaignId)`
   and pass `definedRanges` to `<MeasureLayer>` and `<AreaPickLayer>`; `src/components/combat-map/hud/dock/index.tsx`
   should hide both Measure buttons when off (and reset the tool to Select); the HUD's own area pick
   (`src/components/combat-map/hud/pick-area/layer.tsx`) and the area overlay (`map-view/area-overlay.tsx`) draw their
   own preview circles.
3. **Range-circle buttons**: `src/components/combat-map/tokens/token-panel.tsx` ("Range circles (R)", "Hide all
   circles") and `src/components/combat-map/vision/panels.tsx` still show their buttons (the layer draws nothing).
4. **Client range hints**: the HUD pickers mark targets in / out of range on their own
   (`hud/pick/model.ts`, `actions/hand/model.ts` `outOfRange`, `actions/adversary/model.ts` `inAttackRange`,
   `hud/pick-attack/model.ts`, `hud/pick-area/*`) and show band labels; off they should mark everything reachable and
   hide the band. The server hint (`targets`) already says `inRange: true`.
5. **Other server range refusals**: `convex/combatCards.ts` card Minion offers (line ~656, could read
   `built.definedRanges`); `convex/lib/allyPicks.ts` (`alliesFor`, the ally list within range); `convex/featurePrompts.ts`
   (`inRange` of ally candidates ~133, the band checks ~161 / ~268, Charge's Melee landing ~185);
   `convex/featurePromptsReads.ts` (~72); `convex/combatTokens.ts` (Blink Beast's duplicate within Close, ~389, GM only);
   `convex/lib/combatAreas.ts` (area placement within range ~210, carried creatures within Melee ~895, `moveLimit`
   "can only move within Very Close range" via `src/lib/domain/feature-effects/areas.ts` ~231).
6. **Movement**: `convex/lib/combatMovement.ts` (owned) has no range check; the movement range checks are the ones in 5
   (`combatAreas`).

## Questions (automatic effects with the rule off)

CB p.103 says without Defined Ranges "it's up to the GM to decide roughly how far away everything is". Effects that pick
creatures by range with nobody choosing still count squares off. Which should they do?

- **a (today, kept)**: keep counting squares for automatic effects (auras such as Elemental Incarnation's "all other
  adversaries within Very Close range", "all targets within Close range" with no target named, triggers such as Ill Omen
  "a PC within Close range", Hold the Line's "moves within Very Close range", Cloaked's ally-in-Melee bonus).
- **b**: treat every creature as in range (as with no map, Q18), so the GM undoes what doesn't fit.
- **c**: don't apply them; post a GM-only note ("Elemental Incarnation: who is within Very Close range?").

## Tests

`tests/convex/rules-defined-ranges.test.ts`: on by default (pending); off: a player's and the GM's Very Far attack
resolves, no request; with Refuse, attack, card and feature resolve (on: the card is refused); Ask: card and feature
resolve; Hold Them Off's Very Far extra target; the target hints; the pure `rangeCheck` and door / light reach.
