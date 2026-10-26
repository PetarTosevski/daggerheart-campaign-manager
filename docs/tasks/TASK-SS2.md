# TASK-SS2: Multiclass Spellcast trait choice

Status: Review. Plan: `.omc/plans/slots-spellcast.yaml`, tracer SS2 (wave 2). User decision 9 (2026-10-18): "when
multiclassing, the player should choose which spellcast modifier is used for the new class". CB 111: "If that
foundation card has a Spellcast trait on it, you can choose to use that trait when making a Spellcast Roll or use the
Spellcast trait from your original subclass. If you did not previously have a Spellcast trait and now require one for
your multiclass, you must use the Spellcast trait noted on your new subclass."

## What changed

- **Helper** (`src/lib/domain/characters/spellcast.ts`): `multiclassSpellcastOption(own, new)` is `choose` (both
  subclasses have different traits), `forced` (no original trait) or `none` (the new card has none, or the same one).
  `multiclassSpellcastProblem` and `resolvedMulticlassSpellcast` check and resolve the pick. `spellcastTraitOf(sheet)`
  is the effective trait: the stored choice (if it is one of the two), else the original subclass's, else the
  multiclass's; null without one. Older multiclass data without a choice keeps the original trait.
- **Data**: `multiclass.spellcastTrait` (optional `TraitId`) in the zod sheet schema, the `levelUp.apply`
  `choiceValidator` and the view `sheetValidator` (all widened; `SHEET_VERSION` stays 2). The view validator also gains
  `slotBonuses` (SS1's field) and `toView` no longer strips it (coordinator request).
- **Engine** (`src/lib/domain/level-up/index.ts`): `multiclassProblem` ends with the Spellcast check (required for a
  choice, a forced pick must be the new trait, any other trait refused). `applyLevelUp` stores the pick, or the forced
  trait; nothing when nothing changes. `revertLevelUp` deletes the multiclass with it (unchanged code).
- **Readers**: magic weapon eligibility (`assertEquipment`, whose `EquipmentSheet` gains the optional `multiclass`, and
  the creation check in `convex/characters.ts`), `warlockSpellcast`, `witchSpellcast` (only that function changed in
  witch.ts), `prayerDiceCount` (Seraph or Seraph multiclass), the Heritage tab's Spellcast lines (with two different
  traits the one in use reads "(used for Spellcast Rolls)") and the equipment weapon list.
- **UI** (`tier-pickers.tsx`): after the foundation card, "Spellcast trait for Spellcast Rolls" with two buttons
  ("Presence (Troubadour)", "Knowledge (School of Knowledge)") only for a choice; a note when forced. Changing the
  foundation card drops the pick. The field travels inside the draft's existing `multiclass` object.

## Deliberate choices

- Warlock and Witch features now read the effective trait whichever class is the original (a Warlock who switched to
  a Hedge Witch's Knowledge gains Favor by Knowledge). Before, they read the class's own subclass trait.
- Seraph Prayer Dice keep reading base traits (no effects), as before.

## Not owned (follow-up)

- `level-up-draft.tsx`: its sessionStorage `storedSchema` lists `multiclass` without `spellcastTrait`, so a restored
  draft (page reload mid level-up) loses the pick and the player picks again (the problem list says so).
  `advancementsChosen` doesn't require the pick either; the problem list blocks Finish until it is made.

## Verification

See the tracer report (lint, typecheck, unit and convex tests, e2e).
