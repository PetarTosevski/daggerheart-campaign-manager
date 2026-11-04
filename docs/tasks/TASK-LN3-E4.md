# TASK-LN3-E4: cardRunner wiring and area runtime, round 3 (lanes-2 wave 9, tracer E4.3)

Branch `lane3-e4`. Owns: `convex/lib/cardRunner.ts`, `convex/combatAreas.ts`, `convex/combatTokens.ts`,
`src/lib/domain/feature-effects/areas.ts`, `tests/{unit,convex}/lane3-e4-*.test.ts`, this doc (also owned, unchanged:
`combatMovement.ts`, `combatMaps.ts`, `combatVision.ts`, `validators/combatMaps.ts`).

## What landed

### cardRunner (`buildRun`, `runCard`, `writeSheetChanges`)
- **RunContext fields** (dcm-q40t): `numbers` (`self`, `byId` slot maximums / stats / gold, map `creatures` for
  `creatureCount`), `payers` (`self`, `triggerSubject`, `triggerSource`, `picked`; PCs only), `modsOn` (each creature's
  lasting mods from its sheet effects / instance modifiers, read from their entries: `sheetModsOn`, `instanceModsOn`),
  `pointsOf` (`pointsOfCreatures`), `hopeOf`, `goldOf`, `effectsOn`, `trigger.damageType` (dcm-m5fy, Encore).
- **Per-chooser picks and chain links** (dcm-x4ft): `chooserOptions`, `chooserOptionals`, `heldDicePicks`, `chain` (each
  link range-checked from the link before it), `saveRaisers`.
- **State facts** (dcm-gl9, dcm-576v): actor facts (Armor Slots, card tokens, weapon ranges incl. the attacking one,
  nearest ally, `usedOnBefore`) and `target` / `subject` creature facts (tracks, conditions, Hope, items, distance from
  the actor, nearest ally, live areas it stands in). The use's own facts win on a clash.
- **Words of Discord memory** (dcm-c75 user answer): `withUsedOn` records hit creatures in `featureUses` for an entry
  reading `usedOnBefore`; `buildRun` reads it back.
- **CHAIN_CARDS dropped** (dcm-io4m): the chain is the entry's `origin: "chain"`. The Share the Burden clamp stays: the
  choice's `max` alone refuses a number above it (INVALID) where the table (and tests/convex/combat-cards.test.ts) expects
  the cap.
- **Points** (dcm-va0f, dcm-dgu (2)): `CardRequest.points` (≤ `MAX_CARD_POINTS` = 10, on the map, in range); an
  `aroundPoint` / `origin: "point"` target is measured from the nearest point.
- **`choiceAsks`** (dcm-sc54): a `choose` with a chooser asks per chooser (`chooserId`); a repeating follow-up asks for the
  next link (`followUp`, answered `chain:<link>`) only while some untargeted creature of its side stands within its range of
  the last link (CB p.328: "until there are no more adversaries within range") and nothing waits for the GM (out of range).
- **Vitality slots** (dcm-o3j): a permanent effect's hpMax / stressMax mods raise the maxima once (`gainSlots`, key
  `<card>:<option>`, capped at 12), not as a lasting effect.
- **Condition mods** (dcm-q40t): a condition step's `mods` ride on its sheet effect. Its endings (`endsOnCaster`,
  `endsOnRoll`, `escape`, `endFear`, `sharedGrant`) were already read from the entry (`stepEnds`, cardRows) by E6.
- **`planHandoff(built, plan)`** (dcm-q40t): feed words for `setStance` / `exhaust` / `forcedAttack` / `changeForm` /
  `heldReroll`, and the forced attacks and form changes by token id for E7. `exhaust` needs no write (already in
  `plan.actor.featureUses`). The caller (combatCards, E1.3a) logs and applies them: follow-up dcm-tn8u.

### Areas and moves (`combatAreas.ts`, `combatTokens.ts`, `areas.ts`)
- **`runTriggeredUse`** (dcm-cma, dcm-wuu, dcm-bpr, dcm-g90o engine half): an area's `onEnter` / `onCross` steps run on
  the creature that set them off (`triggerSubject`, the caster as actor); a card's `auto` `whenEnemyEntersRange` use runs
  on the creature that came in (`triggerSource`). It writes only what the server can write alone (actor sheet, enemy
  instances, server `intoMelee` moves); a use needing a choice, a roll answer, Fear, another PC's sheet, or that the
  runner refuses, stays the table's feed row. A reaction use stays the player's.
- **Forced moves** (dcm-1yo): `forcedMoveReduceOf` (stat block passives + instance / sheet lasting mods), `forcedMove`
  (shortened by `forcedRange` / `alongTo`; GM row when shortened), `pullIntoMelee` (`pullSquare`).
- **Lasting move limits** (dcm-3oe, dcm-wuu): `moveRules` reads `moveLimit` mods carried by the instance or the PC sheet
  (`maxRange` only; a `direction` pick isn't stored).
- **Duplicates** (dcm-v27): `placeDuplicate` (within Close by default, one at a time unless `keepOld`, a duplicate of a
  duplicate names the original), `duplicatesOf`, `removeDuplicates`; `combatTokens.remove` takes the duplicates too.

## Beads
- dcm-q40t: cardRunner half **closable**; applying stance / gifts / handoffs in combatCards is dcm-tn8u, E7's half dcm-9l9g.
- dcm-m5fy: **closable** (cardRunner fills `trigger.damageType`).
- dcm-x4ft: **closable**.
- dcm-gl9: **closable**.
- dcm-io4m: CHAIN_CARDS **done**; the Share the Burden clamp kept (see above). Closable if the clamp is accepted as
  the cap's server side, else run.ts should clamp a `max` number instead of refusing.
- dcm-o3j: Vitality **done**; At Ease is still `FEATURE_SLOTS` at gain time (guardian-warrior.ts has no stressMax mod; not
  this lane's files). Left: switch At Ease's data and derive FEATURE_SLOTS from it.
- dcm-576v (cardRunner half): **closable**.
- dcm-sc54 (runCard half): **closable**; the drawer showing the asks is dcm-tn8u.
- dcm-cma, dcm-wuu: **closable** for server-writable steps; an area on its owner's own token is not run (owner-self).
- dcm-3oe, dcm-1yo: **closable** (engine); no SRD entry carries `forcedMoveReduce` yet.
- dcm-v27: helper **done**; E7's `summon.duplicate` must call `placeDuplicate`.
- dcm-ii4: partly: the subject's areas are now a fact (`subject.areas`); no area end on its tokens reaching 0 or the
  caster leaving.
- dcm-dgu: (1) chain and (2) point **done**; (3) line / front / path / between shapes left.
- dcm-bpr / dcm-g90o engine half: **closable**; the data switch is dcm-trib.
- dcm-qoq9 (Chain Lightning fresh roll per link): `RunContext.freshLinkDamage` is not on this branch (E3.3 is elsewhere);
  at merge set `freshLinkDamage: true` in `buildRun`'s context.

## Follow-ups filed
- dcm-tn8u (lane:w1-e1-triggers-rolls): combatCards applies `planHandoff`, stances, gifts, passes `points`, shows the new asks.
- dcm-9l9g (lane:w1-e7-adversary-engine): run forcedAttack / changeForm handoffs.
- dcm-trib (lane:w3-srd-data): Hold the Line's pull as an `auto` `whenEnemyEntersRange` use.

## Data switches ready for wave 10
- `card-effects/valor.ts`: Hold the Line pull → `auto` `whenEnemyEntersRange` (dcm-trib).
- `card-effects/*`: any `TargetSpec.points` / `aroundPoint` card once combatCards passes `points` (dcm-tn8u).
- `adversary-effects/*`: Immovable Object (CB p.230) as a passive `forcedMoveReduce` mod (steps 2).
- `feature-effects/guardian-warrior.ts`: At Ease as a stressMax mod (with FEATURE_SLOTS derived, dcm-o3j).

## QUESTIONS
0. Share the Burden (CB p.333, "transfer up to that much Stress"): above the target's marked Stress, cap (kept) or
   refuse (run.ts's `max`)? Kept the cap.
1. An area's entry steps on its owner's own token (the caster walks into their own area) are not run. CB has no case
   where an owner triggers their own area; simplest reading kept. Core rule or frame-exclusive if one appears?
2. Forced-move shortening moves along the straight line to the destination (Immovable Object, CB p.230: "moves them two
   fewer ranges"); the book names no path. Kept simplest.
