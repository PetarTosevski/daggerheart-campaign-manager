# TASK DA19: Beastform trait bonus reaches every roll; Evolved forms filter their uses

Plan `.omc/plans/drawer-answers.yaml`, tracer DA19, run as lane tracer A2 (`.omc/plans/lanes.yaml`, label
`w0-a-drawer-engine`). Bead `dcm-bxp.99.19.19` (B1 regression). DA9 follow-ups 1 and 3 (`docs/tasks/TASK-DA-DA9.md`).
Status: Review. Book pages are printed pages (CB = Core Book).

## The regression (dcm-bxp.99.19.19)

B1 (user 2026-10-29): the drawer's table owns a Beastform's trait and Evasion bonus. DA9 removed D5's `mods` from the
Beastform effect, but every roll path still read `withEffects(sheet).traits`. As a result, the form's trait bonus (CB p.30
"use the trait specified in their statistics"; CB p.32 Agile Scout "Agility +1"; CB p.34-35 Evolved "+1 [+2] bonus to
the trait used by this form") reached no roll. The fix uses DA9's option (a): each trait read is now
`withPassiveTraits(withEffects(sheet), scope)` (`src/lib/domain/characters/derived.ts`). An older sheet whose effect still
carries the mods is counted once, through `legacyBeastformMods`.

| Path | File | Change |
|---|---|---|
| Dice box, sheet rolls, map attack (`prepareDuality`) | `convex/lib/rolls.ts` | Uses the roll's campaign scope. |
| Tag Team Roll | `convex/rolls.ts` | Uses `featureScope(lead.campaign)`. |
| Every card and feature run, including the drawer's form attack (`cardActor`: traits and Spellcast) | `convex/lib/cardRunner.ts` | Changed. |
| Refocus (Instinct dice) | `convex/combatFeatures.ts` | Changed. |

`convex/lib/featureDrawer.ts` and `sheet-context.tsx` read no traits. They read only `derivedDefense`, which already adds
the form's Evasion, so their traits need no change. `convex/lib/rolls.ts` damage (`live.damageBonus`) reads no trait.

## Evolved uses (DA9 follow-up 3)

`OwnedFeature.uses` restricts an Evolved form to the uses keyed by its base form. It also restricts the base form's stat
line to `form` and `advantage`.
- `drawerOf` (`convex/lib/featureDrawer.ts`) lists only those uses.
- `pickFeature` (`convex/lib/featureRunner.ts`) picks only among them. A use outside them is refused with `INVALID`, the
  code the runner already uses for a use the entry lacks. Without a `useId`, the default pick is the first held use.

## Tests

`tests/convex/beastform-rolls.test.ts` has 3 tests:
- Agile Scout: Agility +1 in `rolls.actionRoll` (the dice box / sheet), in `prepareDuality` (the map attack) and in
  `cardActor` (the drawer's form attack); dropping out removes it.
- An older sheet with the effect's mods is counted once.
- Legendary Beast on Agile Scout gives Agility +2. Its attack and Evolved list only `agile-scout`, and the base line lists
  `form` and `advantage`. `pickFeature` accepts `agile-scout` and refuses `armored-sentry` (INVALID).

Note: lanes.yaml A2's `owns` omits `tests/convex/beastform-rolls.test.ts`, which drawer-answers.yaml DA19 owns. The file
is new.

## Follow-ups (outside owns)

- Some trait displays read the raw `sheet.traits`, without effects or passives. They show the trait before the form's
  bonus, but the roll itself is right:
  - `src/components/party/dice/dice-box.tsx` (the trait list and the roll label);
  - `src/components/combat-map/actions/attack/index.tsx` (the trait select);
  - `convex/lib/combatVision.ts:229` (Instinct for vision).
- Filed as `dcm-bxp.99.19.64` (label `lane:w1-e4-targeting-areas`).

## QUESTIONS

None.
