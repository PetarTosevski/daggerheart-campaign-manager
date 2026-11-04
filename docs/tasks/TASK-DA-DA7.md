# TASK DA7: D5-delegated features and the drawer read model

Plan `.omc/plans/drawer-answers.yaml`, tracer DA7 (no dependencies). Bead `dcm-bxp.99.19`; closes `dcm-bxp.99.19.41`,
`dcm-bxp.99.19.26`, `dcm-bxp.99.19.28`, `dcm-bxp.99.19.46` (1) and pins `dcm-bxp.99.19.40`. Status: Review.

## User answers implemented

- **Rogue's Dodge** (CB p.42: "Spend 3 Hope to gain a +2 bonus to your Evasion until the next time an attack succeeds
  against you. Otherwise, this bonus lasts until your next rest."). User 2026-10-30: neither refresh nor stack. D5's
  `roguesDodge` refuses while its effect holds (`CLASS_FEATURE_RULE`, nothing paid: the mutation rolls back; the
  drawer's delegated use is refused whole). The drawer read model gives the feature the new state `active` with
  `resetLabel` "Until an attack succeeds against you, or your next rest" and every non-passive use `ready: false`; the
  list shows an "Active" banner and the disabled Use. The Party sheet's Hope box shows "Active: until …" and disables
  its Use. A hit (`gotHit`, `expire(sheet, "hit")`) or a rest (`onRest`) ends the effect and the feature is ready again.
- **Hex** (HF p.16: "The maximum number of creatures you can Hex at one time is equal to your Spellcast trait."). User
  2026-10-29: at the maximum a new Hex ends the oldest by default; before casting the player can pick which to drop.
  D5's `hex` takes the pick as `params.amount` (the Hex's 1-based place in `classState.hexes`; absent or 0 = the
  oldest; out of range = `CLASS_FEATURE_RULE`), so `classFeatures.use`'s params are unchanged (no widening needed). If
  the list is longer than the maximum (the trait went down), the oldest others end too (`hexesToEnd`). The summary names
  the ended Hex. The map entry (`seraph-witch.ts`) gets a number choice `dropHex` (min 0) passed to D5 as `amount`; the
  drawer read model's `choices[]` widen with optional `options` (value + label), filled for `dropHex` from the current
  Hexes at the maximum (`hexDropOptions`: "The oldest (X)" = 0, then each Hex). The Party sheet's Hex row shows an "At the
  maximum, end" select with the same options.
- **Prayer Dice** (CB p.44: "add to a roll's result after the roll is made"). User 2026-10-29: action and reaction
  rolls, not damage. D5's `prayerRoll` refuses a damage roll (and still a free roll or none); a reaction roll's outcome
  is recomputed from its dice and total like an action roll's. The table's roll use stays the `afterAllyRolls`
  reaction (an action roll's trigger; the attack's after-roll offers are built from the attack roll only), pinned by a
  test that no Prayer Dice use is triggered by a damage roll.
- **Drop out of Beastform ends Evolution** (CB p.30 Evolution: "choose one trait to raise by +1 until you drop out of
  that Beastform"). User 2026-10-30: `classFeatures.endEffect` on `beastform` (the drawer's Drop out and the Party
  sheet's End) also ends `evolution`, in the same write and one undoable actionLog row ("ended Beastform, Evolution").
  Ending Evolution alone leaves the form.
- **Armor maximum** (SD6 QUESTION 4): `drawerOf` takes the installed augments (new optional 4th argument) and counts
  them in `trackers.armor.max` as `characters.adjustResource` does. See QUESTIONS 1: the query must pass them.
- **Pin** (dcm-bxp.99.19.40, user 2026-10-30): Contacts Everywhere's +3 (CB p.43: "On your next action roll, their help
  provides a +3 bonus to the result of your Hope or Fear Die") stays a rider on your finished action roll
  (`afterYouRoll`), a `dieBonus` on `hopeOrFear`: picked after the roll, seeing both dice. Test only.

## What changed

| File | What |
|------|------|
| `src/lib/domain/class-features/classes/rogue.ts` | `ROGUES_DODGE_EFFECT_ID`, `ROGUES_DODGE_BACK`, `roguesDodgeActive`; the use refuses while active. |
| `src/lib/domain/class-features/classes/witch.ts` | `hexesToEnd`, `hexDropOptions`; Hex ends the oldest / picked Hex at the maximum. |
| `src/lib/domain/class-features/classes/seraph.ts` | `prayerRoll` refuses damage rolls; texts. |
| `src/lib/srd/feature-effects/seraph-witch.ts` | `HEX_DROP_CHOICE`; Hex's `choices` and the delegate's `amount`; Prayer Dice comment. |
| `convex/classFeatures.ts` | `endEffect` ends `ENDS_WITH` effects too (Beastform → Evolution), one row. |
| `convex/lib/featureDrawer.ts` | state `active` (`ACTIVE_WHILE`), `choices[].options` (widen), `drawerOf(..., augments)`. |
| `src/components/combat-map/drawer/list/index.tsx` | `ActiveBanner`; no state badge for `active`. |
| `src/components/party/features/panel.tsx` | Rogue's Dodge "Active" status and disabled Use; Hex's "At the maximum, end" select. |
| `tests/unit/d5-answers.test.ts` | D5 and read-model tests for all five answers and the pin (14). |
| `tests/unit/drawer-list-states.test.tsx` | The list's Active banner and disabled Use (3). |
| `tests/convex/drawer-answers-d5.test.ts` | Through Convex: Dodge refused / Active / back after a hit, Hex picks, Prayer damage refusal, Drop out + undo (4). |

`src/lib/domain/feature-effects/delegate.ts` needed no change: a D5 refusal already refuses the whole drawer use.
`classFeatures.use`, `endEffect` and `combatFeatures.drawer` keep their authz rows (args unchanged; `drawer`'s returns
validator only widens).

## Checks

- `pnpm lint`, `pnpm typecheck`: pass. `node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA7`: pass.
- `pnpm test`: 8582 pass, 6 fail. Four are the old [built] pins outside `owns` (QUESTIONS 2). Two are load flakes
  (load average about 80) that fail alone too and that DA7 does not touch: `tests/convex/schema-guard.test.ts` (15 s
  timeout, as SD6 recorded) and `tests/convex/auth-signup.test.ts` "global sign-up bucket" (its bucket refills on
  wall-clock time: 66 > 63).
- New tests: `tests/unit/d5-answers.test.ts` (14), `tests/unit/drawer-list-states.test.tsx` (3),
  `tests/convex/drawer-answers-d5.test.ts` (4): pass.
- e2e `tests/e2e/sheet-drawer.spec.ts` (2) and `tests/e2e/hope-features.spec.ts` (1, Party sheet Rogue's Dodge): pass.

## QUESTIONS

1. **Armor maximum wiring (not a mechanic).** `convex/combatFeatures.ts` (not in DA7's `owns`) calls
   `drawerOf(characterId, readSheet(character.sheet), campaign)`. Until it passes
   `await installedAugments(ctx, campaign, characterId)` (from `convex/characterExtras.ts`) as the 4th argument, the live
   drawer still ignores augments. One-line edit for the orchestrator at merge (or DA10 / DA12, which own the file).
2. **Old tests that pinned the [built] options** (outside `owns`, they now fail and need these edits):
   - `tests/unit/hope-features.test.ts:126` `use("rogue", { sheet })` "does not stack" → now refused (RuleError).
   - `tests/unit/class-features-hf.test.ts:259` expects `/at most 2/` → the third Hex now ends the oldest
     (`["Target 1", <new>]`).
   - `tests/unit/feature-effects/seraph-witch.test.ts:276-279` "D5 refuses a Hex past your Spellcast trait" → now
     `ok: true`, the oldest ends.
   - `tests/convex/class-features-hf.test.ts:157` expects `CLASS_FEATURE_RULE` for a second Hex at Knowledge +1 → now
     `ok`, the first Hex ends.
3. **Hex on the map (follow-up, no rule question).** The map's Hex delegates without a name, so D5's list holds
   "Target N"; ending the oldest drops that name from the list but the dropped token keeps its "Hexed" condition and
   effect (the server does not read `holdLimit` yet). Ending the dropped token's Hexed state needs the runner
   (`convex/lib/featureRunner.ts`, DA10 / DA12) to name the Hex after its token and end its condition.
4. **Drawer Use flow.** `FeatureUse` (`drawer/use`, SD7) is still SD0's stub, so the drawer's `dropHex` pick reaches the
   player only once SD7 renders `choices[].options` as a select (value 0 = the oldest, the default).
5. **Contacts Everywhere on the map's attack after-roll.** `afterRollChangeOf` (`convex/lib/combatActions.ts`) returns
   null for a `dieBonus` change, so the +3 is not offered in the attack's after-roll window yet (the data is right; the
   pin covers it). A follow-up for the after-roll owner.
