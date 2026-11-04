# TASK LN2-E4: areas, walls, holds, movement rules and carried tokens (round 2)

Plan `.omc/plans/lanes-2.yaml`, tracer E4 (label `lane:w1-e4-targeting-areas`), wave 8. Book pages are printed pages
(CB = Core Book, HF = Hope & Fear). No `types.ts` or `src/lib/srd/**` file was edited; tests use fixture entries and the
real Red Ooze / Bladed Guard data (`tests/convex/lane-e4-areas-round2.test.ts`). Round 1: docs/tasks/TASK-LN-E4.md.

## What landed

- `convex/lib/validators/combatMaps.ts` (widen only, absent = old rows): `combatAreaFields.shape` adds `"wall"`, new
  optional `wall: { a, b }` and `damage: { major, severe, hpMax, hp }`; `combatTokenFields.duplicateOf` (Blink Beast's
  second position, nothing writes it until E7's `summon.duplicate`). No migration needed.
- `src/lib/domain/feature-effects/areas.ts` (pure): `reduceRange` (forcedMoveReduce), `WIND_DIRECTIONS` keyed by
  Tempest's `wind` option ids, `moveBreaks` (moveLimit: maxRange, direction), `carriedTo` (withCaster), `rangesCrossed`
  (pcMoves into / outOf), `areaHpMarked` (CB p.91 rule with the area's thresholds), `seesThrough`, `wallBetween`.
- `convex/combatAreas.ts`:
  - `placeArea` / `placeAreasFromPlan`: walls (two picked squares, both on the map and within `placeWithin`), `anchored`
    token centres stored as the token's square, `count` areas (one per picked square, at most 10; siblings kept, a new
    use ends the old ones), damageable areas start at 0 HP. `PlanAreasInput.points` carries the extra squares.
  - `areaSightBlocks` / `viewerSeesThrough`: walls block sight as a row of discs; `seeThrough` per viewer.
  - `endAreasOnCasterEvent(campaignId, characterId, event)`: ends the caster's areas whose `endsOnCaster` holds it.
  - `memberConditionsFor` (memberCondition), `observerConditions` (perObserver / ownerPerObserver), `leaveGate`
    (`leave`), `areaCentreSquare` (Phantom Retreat's spot, for `move.relativeTo: "area"`), `damageArea`.
  - `moveRules`: before a move is written: area holds (`leave`), `moveLimit` from areas a token stands in and from an
    adversary's own passive (Creeping Fire), and the `pcMoves` features of enemies whose ranges a PC's move enters or
    leaves (stage `would` / `did`, one GM feed row). A player's move breaking a hold / limit is MOVE_BLOCKED with the
    reason; a GM drag goes through and returns `warnings`.
  - `carryAlong`: tokens carried by the mover (withCaster), each within Melee of the carrier first; players carry PC
    tokens only; at most 4.
  - Public: `list` (campaignQuery view; players only the live map; returns validator), `remove` (GM, or the caster's
    player on the live map), `damage` (gmMutation; Wild Fortress HP, public feed row).
- `convex/combatTokens.ts` `move`: new optional arg `carry`; returns `warnings`, `triggers`, `carried`; calls
  `moveRules`, `carryAlong`, and `endAreasOnCasterEvent(..., "moves")` for a PC mover.
- `convex/lib/combatVision.ts`: `Scene.areaBlocks`, `Scene.preparedWithout`, `preparedFor(scene, characterId)`; `viewOf`
  uses it, so see-through darkness is clear for its owner (and allies with `ownerAndAllies`).
- `convex/lib/cardRunner.ts`: target line of sight uses `preparedFor` for a PC actor.

## Beads

| Bead | State | What / left |
|---|---|---|
| dcm-3p7s stored-shape widens | done | walls, damage, duplicateOf. Structured `moveLimit` / `forcedMoveReduce` on instance effects are `validators/encounters.ts` (E7) |
| dcm-cj8 Wild Fortress | done (server) | damage fields, `damageArea`, `combatAreas.damage`; the attack path routing an attack on the dome to it is UI / E1 (follow-up) |
| dcm-cma persistent areas | partly | walls stored and crossed (onCross named in the feed). Running the entry steps automatically still needs a runner pass |
| dcm-wuu area hazards | partly | `leave` hold, area / passive `moveLimit`, `memberConditionsFor`. Reading member conditions in the attack paths is E1 / E7; `dispel` roll is the table's |
| dcm-3oe Hurricane | partly | `moveBreaks` direction and `WIND_DIRECTIONS` by the SRD option ids. Hurricane's limit sits on a condition on adversary instances: needs E7's structured instance mods (follow-up) |
| dcm-1yo Immovable Object | partly | `reduceRange` pure; applying it needs forced moves made by the server (no forced-move server path yet) and E7's structured instance mod |
| dcm-v27 Blink Beast | partly | `duplicateOf` field; E7's `summon.duplicate` writes the second token |
| dcm-ii4 Circle of Power | partly (unchanged from round 1 besides endsOnCaster) | subject areas are E8 (dcm-me3), tokensGone E6 |
| dcm-bhp Cloaked | partly | `observerConditions` gives `perObserver` per observer; reading it in the attack paths is E1 / E7 |
| dcm-bpr Hold the Line | partly | `endAreasOnCasterEvent("moves")` on a PC move; the card itself is a condition (E6's endsOn) |
| dcm-lqnt overlay | server half done | `list` / `remove` public; overlay and point picking UI wait for the sprites (wave 9) |
| dcm-xobk would-move hook | done (E4 half) | `moveRules` emits the pcMoves triggers (returned + GM feed row); E7 runs the use and its `negate` |
| dcm-z5a6 / dcm-lvgm withCaster | partly | `move.carry` drags tokens; the runner offering the carry from a stored `casterMoves` rider is E7 / E8 |
| dcm-5yew Phantom Retreat / Forest Sprites | partly | `anchored`, `count`, `areaCentreSquare`; the runner's `relativeTo: "area"` move prompt reading it is a follow-up |
| dcm-o44e Eclipse / Veil of Night | done (server) | seeThrough per viewer, walls block sight, ownerPerObserver; `castsSpell` firing is E6 |
| dcm-rx1k Hush | done (E4 half) | `endAreasOnCasterEvent`; E2 / E6 call it on majorDamage / castsSpell |
| dcm-ssf, dcm-ofy, dcm-x7p, dcm-dgu, dcm-gl9, dcm-x4ft, dcm-m5fy, dcm-o3j, dcm-io4m, dcm-jkhp, dcm-bxp.99.19.39, dcm-bxp.99.19.64 | not touched this round | cardRunner fills (x4ft, gl9, m5fy), E1 sites, UI; see follow-ups |

## Follow-ups (not in E4's owns)

1. Wire `placeAreasFromPlan` into `useCard` / `useFeature` with `point` / `points` args (nothing calls it yet; dcm-u2wx).
2. E2 / E6: call `endAreasOnCasterEvent` on majorDamage, castsSpell, etc.
3. E7: structured `moveLimit` / `forcedMoveReduce` on instance effects (validators/encounters.ts) so Hurricane and
   Immovable Object reach `moveRules`; run the `pcMoves` triggers `move` returns.
4. E1 / E7: read `memberConditionsFor` and `observerConditions` in the attack paths.

## Authz entries the orchestrator must add (tests/convex/authz/*, not owned)

- `combatAreas.list` (campaignQuery, need view): args `{ mapId }`; anonymous UNAUTHENTICATED, outsider FORBIDDEN,
  player ok (empty for a non-live map), GM ok.
- `combatAreas.remove` (campaignMutation, need view): args `{ areaId }`; anonymous UNAUTHENTICATED, outsider FORBIDDEN,
  player NOT_FOUND on an unknown id / FORBIDDEN on another character's area, GM ok.
- `combatAreas.damage` (gmMutation): args `{ areaId, amount }`; anonymous UNAUTHENTICATED, outsider and player
  FORBIDDEN, GM ok (NOT_FOUND on an unknown id).
- `combatTokens.move`: new optional arg `carry: string[]` (existing entry; no access change).

## QUESTIONS

1. Wings of Light / Pin carrying: built as an explicit `carry` list on `move`, each within Melee before the move
   (CB p.45: "carry another willing creature"). Players may carry any PC token (the willing creature). Confirm.
2. A GM drag that breaks an area's hold or a movement limit goes through with a warning; a player's is refused. Confirm.
