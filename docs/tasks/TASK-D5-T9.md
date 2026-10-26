# TASK-D5-T9: Motherboard Ikonis and augments, Light in the Dark, rest-checked card swaps

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T9. Beads: dcm-bxp.13 (Motherboard Ikonis), dcm-bxp.14 (Light in the Dark).

## What works

- **Ikonis at creation (Motherboard only).** `characters.create` takes an optional `ikonis` argument (`ikonisValidator`). In a Motherboard campaign it is required and must have a trait, range, damage type and name. The draft must have no primary or secondary weapon. The sheet stores `primaryWeaponId: ""`, and the character's `characterExtras` motherboard row is created with the Ikonis (`startingMotherboard`). Other frames still require a primary weapon and refuse an `ikonis` (INVALID).
- **Ikonis Training.** A Warrior starts with Force built and installed. Other classes start with no augments.
- **Sheet edits in Motherboard.** `updateSheet` refuses a new primary or secondary weapon. With an empty primary, `assertEquipment` checks only armor. A Motherboard character created before T9 keeps its weapon, which is still checked as a weapon.
- **Augment defense.** `derivedDefense(sheet, installedAugments)` adds Guard (+1 Armor Score), Deny (+2) and Block (+3 Armor Score, −1 Evasion). `adjustResource` (armor), `applyDamage` and `updateSheet` load the installed augments with `installedAugments(ctx, campaign, characterId)` (convex/characterExtras.ts). That function returns `[]` outside Motherboard.
- **Light in the Dark.** `characterExtras.saveCompanion` sets the sheet's `hopeSlotBonus` to 1 while the training is taken and to 0 when it is not. Hope is cut to the remaining slots. Hope max becomes 7. `adjustResource` scars now stop at 6 + `hopeSlotBonus`.
- **Sheet schema (widened, no version bump).** `scars` max is now 7, and `primaryWeaponId` may be empty. Stored sheets still parse. `characterDraftSchema.primaryWeaponId` may be empty; the server requires it outside Motherboard.
- **Card swaps.** `characters.moveCard` with `duringRest` is free only while the campaign has an open rest. Otherwise the swap costs the Recall Cost in Stress.
- **Wizard.** In a Motherboard campaign, step 5 shows Ikonis fields (name, trait, range and damage, damage type, description) instead of the weapon pickers. `missingByStep(state, opts)` asks for the Ikonis. The Ikonis is saved in the local draft and sent as `ikonis`. The Motherboard panel's Ikonis card lists the installed augments and their defense bonus.

## Book references (re-checked)

- CB 295, Warriors: "The warrior's 'Combat Training' feature is replaced with the following new feature: Ikonis Training: You start with one Force augment already crafted and installed in your Ikonis."
- CB 301, Ikonis: "Characters don't have access to Daggerheart's normal selection of primary and secondary weapons during this campaign." … "Ikonis are always considered to be two-handed weapons". "An Ikonis starts with no augments installed." "While installed, augments are treated as additional features for that weapon."
- Motherboard module sheet (CB p.354 of the PDF; transcribed in `AUGMENTS`): Guard "+1 Armor Score", Deny "+2 Armor Score", Block "+3 Armor Score; −1 Evasion".
- CB 40: Light in the Dark, "Use this as an additional Hope slot your character can mark."
- CB 101: "When you start a rest, you can swap cards between your loadout and your vault." When you're not resting, an immediate swap means you "mark a number of Stress equal to the vaulted card's Recall Cost". CB 105 (short and long rest): "Each player can swap any domain cards in their loadout for cards in their vault".

## Tests

- `tests/convex/motherboard-ikonis.test.ts` (8): Warrior Ikonis and Force, other classes, missing or incomplete Ikonis, weapons refused in Motherboard and required elsewhere, sheet edits, Guard raising the Armor Score, Light in the Dark (Hope 7, 7 scars, untaking it), and Recall Cost with and without an open rest.
- `tests/unit/extras-motherboard.test.ts`: `startingMotherboard`, `ikonisMissing`, `augmentDefense`, `derivedDefense` with augments.
- `tests/unit/extras-companion.test.ts`: Hope max 7, and the 7th scar ending the journey (`avoidDeath`).
- `tests/unit/motherboard.test.ts`: wizard gating and draft persistence in Motherboard.
- `tests/e2e/motherboard-ikonis.spec.ts`: creating a Motherboard Warrior shows the Ikonis fields, no weapon pickers, and the Force augment on the sheet.

## Follow-ups (outside T9's files)

- `src/lib/domain/wither/index.ts` `SCARS_MAX = 6` and `applyResourceDelta`'s scar clamp (6) should allow 6 + `hopeSlotBonus`. Without that, a Wither scar never reaches a seventh slot, and `avoidDeath` stores 6 scars even though it sets `journeyEnds`.
- The client sheet and roster call `derivedDefense(sheet)` without augments, so they show the Armor Score and Evasion without Guard, Deny or Block.
- `page-one.tsx` still shows a primary weapon picker for Motherboard characters (the server refuses the change). It should show the Ikonis there.
- `page-two.tsx`'s "during rest" checkbox labels swaps "free". The server now charges unless a rest is open.
- `convex/rolls.ts` and the dice box have no Ikonis attack or damage source.
- When Combat Training is automated, Motherboard Warriors should not get it (CB 295).
- CB 301 Network tether in the starting inventory, and CB 302 "gold is not used as a currency": not done.
