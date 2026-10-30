# TASK SD2: Passive feature modifiers in derived stats and the adversary attack engine

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD2 (wave 4, depends on SD1 and the FE-* tables). Bead `dcm-bxp.99.19`.
Status: Review.

Always-on and state-gated passive features now change Evasion, thresholds, Armor Score, roll and damage modifiers. The
values come from the feature tables (`src/lib/srd/feature-effects`), not from a hand-kept list. The adversary attack roll
reads the target PC's passives that key on the attacker (NV9). Pure code only: no Convex function, schema or UI change.

## User answers implemented

- **Q6 (a)**: resistance halving rounds up (`damageTaken`, `Math.ceil`). CB p.107, Rounding Up: "if you need to round to a
  whole number, round up unless otherwise specified." CB p.99: 26 physical damage against physical resistance is 13.
  This closes SD1 open point 1.

## What changed

| File | What |
|------|------|
| `src/lib/domain/encounters/damage.ts` | `damageTaken` halves resistant damage and rounds up (Q6). |
| `tests/unit/encounter-damage.test.ts` | Expected values updated for rounding up: 15 → 8, 1 → 1, `hpForDamage(15/1, resistant)`. |
| `tests/convex/combat-attack.test.ts`, `tests/convex/encounter-tracking.test.ts`, `tests/unit/adversary-actions/attack-severity.test.ts`, `tests/unit/combat-actions/damage.test.ts` | The four tests that pinned round-down halving now expect rounding up (same intent): the Skeleton's halved damage is `Math.ceil`; resistant 15 against 8 / 15 is 8, Major, 2 HP; resistant 21 is 11; 27 resistant is 14. |
| `src/lib/domain/feature-effects/passives.ts` (new) | `passiveMods(sheet, state, scope, only?)` sums the `passive` uses of every feature the sheet holds (`owned()`, so the class, subclass up to its rank, the multiclass foundation, ancestry, community, transformation, Beastform and stances). Upgrades are applied and `requires` checked against the sheet (Hope, HP, Stress, Armor) and its facts (conditions, tags, Flying, feature effects such as Channeling, Beastform, stance). It returns stat totals (`evasion`, `armorScore`, `majorThreshold`, `severeThreshold`, `proficiency`, `attack`, `damage`, `actionRoll`), always-on advantage and disadvantage-against filters, flags, `versus` mods, the contributing feature ids, and `rollOptions`. `rollOptions` lists the before-roll toggles of passive features whose condition holds (Rise to the Challenge). `versusMods(sheet, side, creature)` sums what holds against one creature: Evasion and disadvantage when it attacks the bearer, advantage when the bearer attacks it. Also `activePassives`, `passiveAmount`, `sheetFacts`, `effectHash`. |
| `src/lib/domain/characters/derived.ts` | `SUBCLASS_BONUSES` and `HELD` removed. `subclassBonuses` reads the subclass entries from the tables (Unwavering / Unrelenting / Undaunted, Fleeting Shadow, Ascendant, Rugged, plus any state-gated subclass passive). `derivedDefense` adds every passive's Evasion and Armor Score. `derivedThresholds` adds every passive's thresholds (Shell, Stoneskin, Beastform Thick Hide, the Anchored stance and so on). Both take an optional `PassiveState`. The return shapes are unchanged. |
| `src/lib/domain/adversary-actions/attack.ts` | `EvasionTarget` gains optional `advantage` / `disadvantage`. `pcTarget(id, sheet, evasion, attacker, state?)` builds a target with the passives keyed to this attacker (Elusive Predator, Scorpion's Poise, Battle-Bonded) and Sturdy's disadvantage. `adversaryAttack` adds one disadvantage (or advantage) source when any target carries it. |
| `tests/unit/feature-passives.test.ts` (new) | Covered in the Tests section. |

## Book passages (printed pages)

- CB p.36, Unwavering / Unrelenting / Undaunted: "Gain a permanent +1 / +2 / +3 bonus to your damage thresholds."
- CB p.61, Shell: "Gain a bonus to your damage thresholds equal to your Proficiency."
- CB p.70, Nimble: "Gain a permanent +1 bonus to your Evasion at character creation."
- HF p.21, Stoneskin: "Gain a permanent +1 bonus to your Armor Score and damage thresholds at character creation."
- CB p.51, Conjure Shield: "While you have at least 2 Hope, you add your Proficiency to your Evasion."
- CB p.48, Rise to the Challenge: "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die."
- CB p.30, Elemental Dominion: "While Channeling … Fire: You gain a +1 bonus to your Proficiency for attacks and spells
  that deal damage. … Air: You gain a +1 bonus to your Evasion and can fly."
- CB p.48, Combat Training: "When you deal physical damage, you gain a bonus to your damage roll equal to your level."
- CB p.68, Sturdy: "When you have 1 Hit Point remaining, attacks against you have disadvantage."
- CB p.39, Elusive Predator: "When your Focus makes an attack against you, you gain a +2 bonus to your Evasion against
  the attack."
- CB p.38, Battle-Bonded: "When an adversary attacks you while they're within your companion's Melee range, you gain a +2
  bonus to your Evasion against the attack."
- HF p.8, Scorpion's Poise: "You gain a +2 bonus to your Evasion against attacks made by a creature you've Marked for
  Death."
- HF p.16, Vexing Malison: "You have advantage on attacks against Hexed creatures."
- CB p.161: "If an NPC has advantage, roll an extra d20 and take the highest result." "When an adversary's action lets
  you make an attack against multiple targets, you make one attack roll and ask if it hits any of the targets."

## Tests

- `tests/unit/feature-passives.test.ts` (18 tests) covers:
  - Shell (with Proficiency 2 and 3).
  - Nimble.
  - Stoneskin, with and without the Hope & Fear option.
  - The Stalwart ranks from the tables.
  - Shell and Unwavering together.
  - Conjure Shield at 1, 2 and 3 Hope, with a state override and at foundation rank.
  - Rise to the Challenge at 2, 1 and 3 unmarked HP.
  - Elemental Dominion with Fire, Air and no element.
  - Combat Training: no passive damage, and D5's `combatTraining` option still gives + level.
  - The effect hash matches `effectKeyOf`.
  - Sturdy through `adversaryAttack`: 15 and 4 at +2 keep the 4, a miss; it cancels the adversary's advantage.
  - Elusive Predator, Battle-Bonded (and not at foundation), Scorpion's Poise.
  - Vexing Malison on the attacking side only.
  - A multi-target roll.
- `tests/unit/derived.test.ts`, `tests/unit/derived-moon.test.ts` and `tests/unit/expiry-effects.test.ts` pass unchanged.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` and
`node scripts/tracer-guard.mjs .omc/plans/sheet-drawer.yaml SD2`. No e2e spec is named for SD2.

## QUESTIONS (built on the most literal reading; please confirm)

1. **Sturdy with several targets.** CB p.68: "When you have 1 Hit Point remaining, attacks against you have disadvantage."
   CB p.161: "you make one attack roll and ask if it hits any of the targets." Built: one roll for all targets. If any
   target has Sturdy active, that roll has one disadvantage die, so the other targets benefit too. Should the
   disadvantage apply only when comparing against the Sturdy target? That would mean one d20 pair, with the lowest kept
   for the Orc and the first die used for the others.
2. **Rise to the Challenge is offered, not automatic.** CB p.48: "you *can* roll a d20 as your Hope Die." `passiveMods`
   lists it in `rollOptions` while 2 or fewer HP are unmarked. The roll path (SD5 / D5 roll options) has to offer it.
   It is not applied by itself.
3. **Elemental Dominion Fire.** CB p.30: "+1 bonus to your Proficiency for attacks and spells that deal damage." Built: a
   `proficiency` +1 total in `passiveMods`. Derived Evasion does not use it, and Conjure Shield keeps the sheet's own
   Proficiency, because the Fire bonus is only "for attacks and spells that deal damage".

## Follow-ups (outside SD2's owns)

1. **The server has to pass the attacker.** `pcTarget` needs the attacker as `CreatureInfo` (its condition tags, Hexed,
   inside the companion's Melee range). `convex/lib/adversaryActions.ts` / `adversaryHits.ts` (SD4's owns) must build the
   targets through `pcTarget`. The PC attack path (SD5's owns) must add `versusMods(sheet, "attacksAgainstThem", target)`
   for Vexing Malison. Until then the always-on values reach the server through `derivedDefense` / `derivedThresholds`,
   but the attacker-keyed ones do not.
2. **Beastform stat lines.** A Beastform's own stat line (its "Evasion +N" and trait bonus, the `beastform:<form>:attack`
   table entries) is not an owned feature, so `passiveMods` does not add it. CB p.30 Beastform says: "add their Evasion
   bonus to your Evasion". The form's features (Thick Hide, Hollow Bones, Evolved, and so on) are added. `owned()` (SD1)
   should list the stat line, or the derived stats should read it.
3. **Roll and damage totals.** `passiveMods` already sums `attack`, `damage` and `actionRoll`: Reliable +1 attack,
   Adrenaline + level damage while Vulnerable, Demigod's Gifted. The duality roll path does not read them yet; that is
   SD5's owns.
4. `sheetFacts` repeats `factsOf` (convex/lib/featureRunner.ts) in pure code. A test pins the shared hash. SD3 could
   import `sheetFacts` there.
