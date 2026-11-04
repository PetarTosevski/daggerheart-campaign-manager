# TASK LN-E4: targeting, range origins, areas and map positions

Plan `.omc/plans/lanes.yaml`, tracer E4 (label `w1-e4-targeting-areas`), after V (docs/tasks/TASK-LN-V.md). Status:
Review. Book pages are printed pages (CB = Core Book, HF = Hope & Fear). No SRD entry was edited: wave 5 switches the
data over; tests use fixture entries (`tests/convex/lane-e4-targeting-areas.test.ts`).

## The area runtime (built here; sheet-drawer SD-A must not build it again)

SD-A (`.omc/plans/sheet-drawer.yaml`) planned the Q14 area runtime. E4 built its server half; SD-A (or the follow-up
beads below) keeps only what is left: the public `list` / `remove`, the overlay, the "pick a square" step, members'
`mods` folded into rolls.

- `src/lib/domain/feature-effects/areas.ts` (pure): `inArea` (a footprint within the radius of the centre's footprint,
  CB p.103 Defined Ranges, Chebyshev like every range check), `moveEvents` (`enter`, `through`, `leave`, a wall `cross`),
  `memberSideFits` / `areaMembers` (`AreaSpec.side`, `excludeOwner`), `placementHolds` (`placeWithin`), `blocksBetween`
  (Dark Cloud's inside / outside), `entersRange` (Hold the Line), `areaExpires`, `sightDisc`.
- `convex/combatAreas.ts` (helpers, no public function yet):
  - `placeAreasFromPlan` / `placeArea`: a plan's `area` steps become `combatAreas` rows in the use's own mutation;
    centre `self` / `target` on the token (it follows it, SD0's `AreaCentre`), `point` on the picked square, checked
    against `placeWithin` (COMBAT_TARGET_INVALID). Using it again ends the caster's old area of the same feature and
    label. A wall is refused (INVALID) until the validator widen below.
  - `activeAreasOnMap`, `areaShape`, `endArea`, `areaSpecOf` (the written spec from the card / feature entry by the row's
    `featureId`, `useId`, `label`).
  - `areaFactsFor`: the areas a token stands in. `buildRun` (convex/lib/cardRunner.ts) puts them in the actor's
    `StateFacts.areas` at each roll, so `inArea` checks are decided by the map.
  - `areasAfterMove` (called by `combatTokens.move`): an `onEnter` area entered or passed through, or an `onCross` wall
    crossed, logs a public feed row ("Bryn enters Rune Circle") and `move` returns `areas`; an area whose `endsOn` holds
    `ownerLeavesArea` ends when its caster leaves it (Circle of Power, HF p.16: "you exit the circle"). The entry steps are
    named, not run: running them as the caster needs a runner pass (follow-up).
  - `rangeTriggersAfterMove` (called by `combatTokens.move` on the live map): an enemy token coming within a loadout
    card's `whenEnemyEntersRange` range of a PC logs "Bear moves within range of Ash: Hold the Line".
  - `sightBlockers`: live `blocksSight` areas are blocking discs in `loadScene` (convex/lib/combatVision.ts), so vision,
    line of sight for attacks and cards, and Cloaked-on-move all see Dark Cloud (CB p.42: "Anyone in this cloud can't see
    outside of it, and anyone outside of it can't see in"). The disc blocks sight between members too (an
    approximation of "can't see outside").

## Beads

| Bead | State | What |
|---|---|---|
| dcm-d7h minimum target count | done | `buildRun`: fewer targets than `TargetCount.upTo.min` / `any.min` is COMBAT_TARGET_INVALID ("Pick at least 2 targets", Shared Clarity CB p.333) |
| dcm-zos Fearsome Presence | done | `buildRun`: a use paying Hope (its costs or a nested step's) against an instance whose stat block has the modifier flag `noHopeFeaturesAgainst` is COMBAT_TARGET_INVALID. Riders on an attack go through `buildRun` too, so the attack is refused while the rider is on |
| dcm-jx6 rider gated on its host roll | done | `riderUse`: a before-roll rider splits on its move gates before binding them, so `when: ["success"]` on a self step lands in `post` and runs on a success (Signature Move, CB p.331). Before, the bound step fell into `pre` and was lost. Wave 5 can fold Signature Move's two uses into one |
| dcm-bxp.99.19.57 Attack bar ally chips | done | `riders.tsx` `extraCandidates`: a rider whose `addTargets` spec side is `any` / `ally` / `selfOrAlly` (Surrounded) offers the other PCs' tokens too, marked "(ally)" |
| dcm-bxp.99.19.64 raw traits | partly | Attack bar trait select and the vision Instinct read `derivedTraits(withEffects(sheet))`; `dice-box.tsx` is outside E4's owns (dcm-hnbk) |
| dcm-dgu range origins | partly | `TargetSpec.origin` `target` / `chain` measured from the first target / the earlier links (main targets, picked, allies, follow-ups); a follow-up spec with `origin: "chain"` chains like CHAIN_CARDS. `point` and the shapes need a point / shape argument on `useCard` / `useFeature` (dcm-76l5, dcm-u2wx); until then the actor |
| dcm-ssf Elemental Incarnation Water | partly | `excludeSubject` on the use's targets and on picked creatures (refused, and left out of "all" picks). `whenYouDealDamage.within` is matched in `combatActions.ts riderPhase` (E1, dcm-76l5) |
| dcm-ofy Dark Army | not | `whenYouDealDamage.within` is E1's site (dcm-76l5) |
| dcm-x7p Manipulate Magic | not | `hostRange` / `RollChange.reach` are read in `combatActions.ts` `addedTargets` and the folds (E1, dcm-76l5) |
| dcm-cma persistent areas | partly | runtime above: entering / passing through an `onEnter` area is named in the feed; walls need the validator widen (dcm-3p7s); running the entry steps automatically is left |
| dcm-wuu area hazards, movement limits | partly | `onEnter` through-moves are detected (Acid Bath); `moveLimit` needs a structured stored mod (dcm-3p7s) |
| dcm-ii4 Circle of Power | partly | the actor's areas reach `inArea`; the caster leaving ends an `ownerLeavesArea` area; `who: "subject"` is E5's (dcm-753y), `tokensGone` is E6's (dcm-u2wx) |
| dcm-bhp Cloaked | partly | Dark Cloud blocks sight in the vision engine (per-observer by geometry). `replaceCondition`, `bearerAttacks`, `endsMoveInSight` are E6 / E1 (C3 already ends Cloaked on a move in sight) |
| dcm-bxp.99.19.39 Dark Cloud at a point | partly | `placeArea` takes a square checked against `placeWithin`; the entry (centre `point`, radius Very Close (to confirm), `placeWithin: "close"`) is wave 5's; the point argument on `useFeature` is dcm-u2wx |
| dcm-bpr Hold the Line | partly | an enemy moving within range of a holder is named in the feed; pulling and Restraining stays the player's use |
| dcm-cj8 Wild Fortress | not | needs `damage` fields on `combatAreas` (dcm-3p7s) |
| dcm-1yo Immovable Object | not | needs a structured `forcedMoveReduce` on the instance's effects (dcm-3p7s) |
| dcm-3oe Hurricane | not | needs a structured `moveLimit` (dcm-3p7s) |
| dcm-v27 Blink Beast | not | needs a second token per instance (`duplicateOf`, dcm-3p7s) and E7's `summon.duplicate` |

## Stored-shape widens needed (outside E4's owns; widen only, nothing stores them yet)

`convex/lib/validators/combatMaps.ts`, `combatAreaFields`:

```ts
shape: v.union(v.literal("circle"), v.literal("wall")),
/** A wall's end squares (`shape: "wall"`). */
wall: v.optional(v.object({ a: pointValidator, b: pointValidator })),
/** AreaSpec.damageable (Wild Fortress, CB p.339). */
damage: v.optional(v.object({ major: v.number(), severe: v.number(), hpMax: v.number(), hp: v.number() })),
```

Then `placeArea` stores walls (`areaShape` returns `wall(a, b)`), and the GM's / players' attacks on a damageable area
mark its `hp`.

## Public functions (none added)

`combatAreas.list` and `combatAreas.remove` need entries in `tests/convex/authz/areas.entries.ts` (outside the owns;
the inventory guard fails `pnpm test` without them), so they are bead dcm-lqnt, with the entries spelled out.

## Questions (none blocking)

1. Dark Cloud's radius: the user placed it at a point within Close (2026-10-29) and left the radius open; Very Close is
   built for the entry to use, to confirm. CB p.42: "create a temporary dark cloud that covers any area within Close
   range."
2. Fearsome Presence counts domain cards as features (a Hope-cost card is refused too). CB p.239: "PCs can't spend Hope
   to use features against the Zombie."

## Tests

`tests/convex/lane-e4-targeting-areas.test.ts`: area geometry; `targetMin`, `paysHope`, chain / target origins, the
Signature Move rider split; on the map: placing (placeWithin, replace), entering an `onEnter` area, the caster leaving an
`ownerLeavesArea` circle, Hold the Line's notice, `inArea` facts in `buildRun`, Dark Cloud blocking line of sight, the
minimum target count, `excludeSubject`, Fearsome Presence and a chain origin through `buildRun`.
