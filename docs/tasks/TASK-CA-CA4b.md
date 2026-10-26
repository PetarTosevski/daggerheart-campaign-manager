# TASK CA4b: Card server follow-ups - undoable adversary effects, stored dice for post-roll choices, wording-based ranges, one-target attacks, Onslaught, rest timing, GM recall, file split

Plan `.omc/plans/combat-actions.yaml`, tracer CA4b (depends on CA4). Closes the QUESTIONS and "Notes for CA4" left open in
`docs/tasks/TASK-CA-CA4.md`. Book pages are printed pages; CB = Core Book.
Status: Review.

## What landed

| File | What |
|------|------|
| `convex/lib/cardRunner.ts` | 725 lines (was 1,087, CH9). Card pick, combatants (`cardActor`, `pcCombatant` unchanged), `Creatures`, `buildRun` with range origins (`rangeOrigin`, `extraSpecs`, `CHAIN_CARDS`), `runCard` (now returns the dice it rolled), `replaying`, `tokenIdsOf`, sheet changes (`writeSheetChanges`, `actorSheetAfter` unchanged). |
| `convex/lib/cardChoices.ts` (new) | Roll / choice validators, `parseChoices`, `DEFAULT_OPTIONALS`, kept dice (`keptDice`, `keepDice`, `dropDice`). |
| `convex/lib/cardRows.ts` (new) | Return validators, instance writes (now with `effects`), `adversaryBefore`, row words (public / GM), prompts. |
| `convex/lib/cardHand.ts` (new) | The Hand (`handCard`, `handOf`), `moveCardFor` (loadout / vault, GM recall, logging), `runRestTiming`. |
| `convex/combatCards.ts` | Imports the split; `runKept` (kept dice) in `useCard` and `sanction`; instance effects; drops kept dice on resolve. |
| `convex/lib/validators/actionLog.ts` | `adversaryBeforeValidator` widened with optional `effects` (widen only). |
| `convex/lib/actionLog.ts` | Undo writes `effects` back (an empty list clears the field). |
| `convex/lib/combatActions.ts` | `WEAPON_ATTACK_TARGETS = 1` in `checkTargets`; Onslaught's floor in `resolveAttack`. |
| `convex/rests.ts` | Card timing uses around the rest's expiry; their lines on each PC's rest row. |
| `convex/characters.ts` | `moveCard` delegates to `moveCardFor` (768 lines, was 796). |
| tests | `combat-cards.test.ts` +5, `combat-cards-authz.test.ts` +1, `combat-attack.test.ts` +2, `combat-attack-authz.test.ts` +1, `rests.test.ts` +3, `characters.test.ts` +1; matrix notes in `authz/combat.entries.ts`, `authz/characters.entries.ts`. |
| `docs/data-model.md` | `adversaryBefore.effects`; the `card_dice` operations rows. |

## User answers implemented (quoted from the plan)

- "Plain weapon attacks take one target" (bead dcm-bxp.99.18): `combatActions.attack` refuses more than one target with
  COMBAT_TARGET_INVALID; MAX_TARGETS for card effects is unchanged.
- Card range for extra creatures: "Depends how aoe is worded, some cards may need to check range from the target
  initially hit (chain lightning) but yes, range matters for extra creatures too": every picked / ally / follow-up
  creature is range-checked from the origin the card text names (the caster by default; the first target for chains like
  Chain Lightning; the area's point for areas). Out of range follows Q1 (GM sanction). Where the vocabulary can't name
  the origin, file a gap bead and fall back to the caster.
- "The GM may play a PC's cards after turning on a switch (CA6 builds the UI): characters.moveCard (recall/vault)
  accepts the GM for any character in the campaign, logged as the GM acting for that character."

Orchestrator decisions (technical): widen `adversaryBeforeValidator` with an optional `effects` field; a choice made
after the roll must not reroll (store the dice, resolve the second call with them); split cardRunner under 800 lines,
keeping `cardActor`, `pcCombatant`, `writeSheetChanges` exported from cardRunner.ts for AA2; Onslaught's floor in CA3's
attack path; card timing uses at rests (Wild Surge before expire, Inspirational Words' long-rest tokens).

## Rules (quoted, printed pages)

- **R11** (CB p.103): ranges "measured from" the actor; the vocabulary's own rule (types.ts): "Ranges are measured from
  the actor unless `area` says otherwise."
- **Chain Lightning** (CB p.328): "Additional adversaries not already targeted by Chain Lightning and within Close range
  of previous targets who took damage must also make the reaction roll. … This chain continues until there are no more
  adversaries within range."
- **Onslaught** (CB p.330): "When you successfully make an attack with your weapon, you never deal damage beneath a
  target's Major damage threshold (the target always marks a minimum of 2 Hit Points)."
- **Wild Surge** (CB p.339): "When the die's value would exceed 6 or you take a rest, this form drops and you must mark an
  additional Stress."
- **Inspirational Words** (CB p.334): "After a long rest, place a number of tokens on this card equal to your Presence.
  … When you take a long rest, clear all unspent tokens."
- **R7** (CB p.101, p.105): a vault card costs its Recall Cost in Stress, free "when you start a rest".

## How it works

### One-target weapon attacks

`checkTargets` (used by `combatActions.attack` and CA3's `combatRequests.sanction`) refuses 0 or more than
`WEAPON_ATTACK_TARGETS` (1) targets with COMBAT_TARGET_INVALID before any roll, range check or sanction. Card uses keep
`MAX_CARD_TARGETS` (20).

### Range origins (`rangeOrigin` in cardRunner.ts)

| Creature | Spec | Measured from |
|---|---|---|
| target | no area / `front` / `line` / `path` / `between` | the actor, with the use's range |
| target | `aroundSelf` | the actor, with `areaRange` (else the range) |
| target | `aroundPoint` / `aroundTarget` | the first target (anchor) from the actor with the range; the others from the anchor with `areaRange` |
| picked / allies / follow-up | its step's `pick` (or the follow-up's `targets`) with `aroundTarget` | any of the use's targets, with `areaRange` (Vicious Entangle, Fireball, Hush, Damnation, Strategic Approach) |
| follow-up of a chain card (`CHAIN_CARDS`: Chain Lightning) | `aroundTarget` | any target or any earlier follow-up in the list (each jump from the one before) |
| picked / allies / follow-up | `aroundSelf` | the actor with `areaRange` (Healing Field, Rejuvenation Barrier, Whirlwind, Critical Inspiration) |
| picked / allies / follow-up | anything else | the actor with the spec's range (`unlimited` never waits) |

A creature out of range joins `outOfRange` (deduplicated, its band from its origin): the use becomes a GM sanction as in
Q1, and the approval waives every range. Which `pick` applies: the first step (nested ones included) sending to `picked`,
to `allies` / `selfAndAllies`, and the first `followUp` step.

Vocabulary gaps (bead **dcm-dgu**): no chain origin (the server's `CHAIN_CARDS`, and "who took damage" is not checked),
no point for `aroundPoint` (the first target stands in), no geometry for `line` / `front` / `path` / `between` (the
actor).

### Adversary effects (undoable)

A card `effect` step on an enemy becomes an instance `effects` entry (CA0's `instanceEffectValidator`): id
`card:<cardId>:<n>`, source the card, label the step's label, `difficulty` / `attack` / `damage` / `hpMarked` from the stat
mods, `halfDamage` from Blighting Strike's flag, `until` from the duration (temporary / rest / long rest / session /
manual → temporary, scene → scene, hit / nextRoll → hit, permanent → permanent). An exclusive card's older entries on
that instance go first; at most 20. An enemy that only gained an effect (Glyph of Nightfall) is still written. The GM row
says "<label> (on the instance)" and its `adversaryBefore` carries `effects` (the list before) for each instance whose
effects changed; undo writes it back. CA3's and CA4's `difficultyOf` already read `effects`.

### Kept dice for a choice after the roll

`useCard` and `sanction` run the use through `runKept`: dice kept for (campaign, character, card, use) are replayed in
order; a use that still needs a choice keeps the dice it rolled (an `operations` row, kind `card_dice`, scope
`campaign:<id>:cardDice`, key `<characterId>:<cardId>:<useId>`, `result: {values}`), for 15 minutes from the first roll.
Asking again replays the same dice (no fishing); answering resolves with them; the resolving use drops the row. A use
that goes to the GM (Q1) keeps its dry run's dice, so the approval resolves with them. The scope never equals a client
idempotency scope (`campaign:<id>`), so no client key collides; the 7-day operations sweep removes leftovers. Nothing of
the dice reaches the client before the use resolves.

### Onslaught

`resolveAttack`: while `onslaught` is in the attacker's loadout, a hit's damage on a non-Minion instance is applied with
`minimumSeverity: "major"` (2 HP when it would be Minor; none stays none). The GM row says "Major (Onslaught)".

### Rest timing

`applyRest`: for each resting PC, `runRestTiming(sheet, "afterRest")` before `restedSheet` (expiry), then on a finished
long rest `runRestTiming(…, "afterLongRest")` after it. It runs every loadout card's `auto` use with that `timing`
trigger through CA1's runner (unmet requirements skip it): Wild Surge's rest use (clear the die, one more Stress; the
card's sheet effect is removed, `ENDS_ON_REST`), Inspirational Words / Restoration / Fane of the Wilds / Strategic
Approach tokens, Dark Army / Twilight Toll / Thorn Skin token clears. The use's name joins the PC's rest row, and the
rest's group undo takes it back. An interrupted long rest runs only `afterRest`.

### `characters.moveCard`

Body moved to `moveCardFor` (cardHand.ts), behaviour unchanged, plus: a move by the GM for a character they don't own,
or a recall that cost Stress, writes an undoable public `feature` row (`actorId` the mover, `characterId` the character,
`before` the sheet): "GM for Ash recalls Bolt Beacon (1 Stress)", "Ash recalls Bolt Beacon (1 Stress)", "GM for Ash vaults
Bolt Beacon". A player vaulting their own card writes no row.

## Public functions and roles

No wrapper, `need` or argument changed. Asserted on `ConvexError.data.code`:

| Function | anon | outsider | other player | player (own) | GM | Test |
|---|---|---|---|---|---|---|
| `combatActions.attack` (one target) | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok | combat-attack-authz, matrix |
| `combatActions.attack` (two targets) | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | COMBAT_TARGET_INVALID | COMBAT_TARGET_INVALID | combat-attack-authz |
| `combatCards.useCard` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok (plays for the character; answers its kept dice) | combat-cards-authz, matrix |
| `combatCards.sanction` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | ok | combat-cards-authz, matrix |
| `characters.moveCard` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok (any character, logged as GM for it) | characters.test, matrix |
| `rests.finish` / `interrupt` | unchanged (GM only) | | | | | rests.test |

## What a player receives (U1)

Unchanged: the kept dice stay server-side; `needsChoice` holds only the asks; instance effects (Difficulty deltas) are on
the instance and the GM row only; the public row of an Onslaught hit says Hit / Defeated. Tests assert no stat keys in the
results and no stat words in the public rows.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: see the handoff report for counts.
- `pnpm tracer:guard .omc/plans/combat-actions.yaml CA4b`: OK.
- `convex/_generated` not committed (the new lib modules need the orchestrator's regeneration for `api.d.ts`'s module list
  only; no public function was added).

## QUESTIONS

1. **Chain Lightning's "who took damage"**: each follow-up is measured from any target or earlier follow-up, not only
   those that took damage (the server doesn't know the damage before running the use). Check it after the run and drop
   (or sanction) links whose previous creature took none?
2. **Kept dice lifetime**: 15 minutes from the first roll, per character, card and use, whoever sends the next use. A
   declined sanction leaves them for the next use of that card within the window. Shorter / longer, or clear on decline?
3. **moveCard logging**: rows only for GM-for-character moves and paid recalls (a player's free vaulting stays silent, so
   the builder's loadout edits don't flood the feed). Log every move instead?
4. **Onslaught on card attacks**: the floor applies to CA3's weapon attacks only; card uses that deal weapon damage
   (Blade cards with `roll: weapon`) don't run auto riders yet. Apply it there too?
