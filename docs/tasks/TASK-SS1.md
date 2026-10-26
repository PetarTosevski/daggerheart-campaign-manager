# TASK-SS1: Feature slots raise the maximum (subclass and ancestry)

Status: Review. Plan: `.omc/plans/slots-spellcast.yaml`, tracer SS1 (wave 1). User decision 8 (2026-10-18): "yes, raise max".

## What changed

- **Table** (`src/lib/domain/characters/slots.ts`): `FEATURE_SLOTS` maps a feature key to `{ hp: 1 }` or `{ stress: 1 }`:
  `subclass:vengeance` (At Ease, CB 36), `subclass:school-of-war` (Battlemage, CB 51), `ancestry:giant:0` (Endurance),
  `ancestry:human:0` (High Stamina). `slotBonusKeys(sheet)` lists the keys a sheet's features grant: its subclass and
  multiclass foundations, both features of a single ancestry, and for a mixed ancestry the first feature of `first` and
  the second of `second` (as the heritage card shows). `gainSlotBonus`, `loseSlotBonus` and `applySlotBonuses` change
  the maximum and record or drop the key in `sheet.slotBonuses`.
- **Sheet** (`src/lib/validation/characters.ts`): `slotBonuses: string[]`, optional (widened, `SHEET_VERSION` stays 2).
  `toView` in `convex/characters.ts` strips it, because `sheetValidator` (not owned) doesn't list it.
- **Creation**: `sheetFromDraft` ends with `applySlotBonuses`.
- **Level-up** (`src/lib/domain/level-up/index.ts`): the multiclass pick gains the new foundation's slot; its slot counts
  toward the 12-slot cap in `validateLevelUp`; `revertLevelUp` takes it back and keeps marked HP/Stress within the maximum.
- **Migration** (`convex/migrations/slotBonuses.ts`, `applySlotBonuses`): batched over `characters`; adds the missing
  bonuses and records them, so a rerun (`reset: true`) changes nothing. A character whose oldest action log row
  (`by_character_at`) is an `import` only records the keys: its maximums were copied from the paper sheet. Run with
  `npx convex run migrations/run:run '{fn: "migrations/slotBonuses:applySlotBonuses"}'` (dry run: add `dryRun: true`).

## Deliberate choices

- A Shapeshifter's chosen form feature grants no slot (the form changes; the book ties these slots to creation). See QUESTIONS.
- Photo imports created after this change store no `slotBonuses` (`src/lib/import/sheet.ts` is not owned), but their
  first action log row is the `import`, so the migration still only records their keys.

## QUESTIONS

1. Shapeshifter whose chosen form feature is Endurance or High Stamina: should the slot apply (and follow form changes)?
2. Characters whose GM already raised `hpMax`/`stressMax` by hand for these features will get the slot again from the
   migration; the GM can lower it on the sheet. Is a dry-run review per deployment enough?

## Verification

See the tracer report (lint, typecheck, unit and convex tests, e2e).
