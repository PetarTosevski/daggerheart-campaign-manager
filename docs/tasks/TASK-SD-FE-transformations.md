# TASK SD FE-transformations: Feature effects of the transformations

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-transformations (wave 3, depends on SD1). Bead `dcm-bxp.99.19`.
Status: Review.

The transformations table (`src/lib/srd/feature-effects/transformations.ts`) holds an effect entry for each of the 7
transformation features classified combat or passive. Each entry quotes the feature with its printed Hope & Fear page and
uses only SD0's vocabulary. Drawbacks are entries too. No vocabulary, runner, schema or UI change.

## User answers implemented

- **Q11 (a)** transformations are in scope and automated: Gifted's +1, Weight of Divinity, Ephemeral's resistance and
  double magic damage, Fangs, Feed, Wolf Form and Howling Rampage.
- **Q6 (a)** Ephemeral's physical resistance halves damage and rounds up (the engine's halving; see SD1's open point 1).
- **Q9 (a)** passing through a solid object (Ephemeral) is a prompt for the table.
- **Q13 (a)** situations the engine can't see are confirmed by the player (Feed's "Fangs attack against a creature that
  can bleed", Feed's "no tokens"). "In Wolf Form" is engine-read (`featureEffect` state check), with the check box as
  fallback.

## Entries

| Feature id | Uses | Reading |
|------------|------|---------|
| `transformation:demigod:gifted` | `main` passive: `actionRoll` +1, `damage` +1. `reaction` auto `beforeYouRoll reaction`: modifyRoll +1 | The vocabulary has no reaction-roll stat, so reaction rolls get an automatic +1 before each roll (no prompt). |
| `transformation:demigod:weight-of-divinity` | `main` auto `afterYouRoll any, failure`: choose `weight`: `stress` (mark a Stress) / `fear` (GM gains a Fear) | Any failed roll, action or reaction. The player picks (SD0 classification). See question 1. |
| `transformation:ghost:ephemeral` | `main` passive: physical resistance, flag `doubleMagicDamage`. `pass-through` action: 2 Stress, manual step | The pass-through gets a Use button with its cost, so the 2 Stress is charged. |
| `transformation:vampire:fangs` | `main` action: trait roll (any of the six traits, the player's pick) vs the target's Difficulty, one enemy in Melee; on a hit Proficiency d6 physical | `RollSpec.attack` needs a weapon, so it is a trait roll (bead dcm-bn1). |
| `transformation:vampire:feed` | `main` rider `whenTargetMarksHp`: confirmed situation, 1 Stress, tokens + HP marked (max 6). `fear-die` rider `beforeYouRoll action`: 1 token, Fear Die d20. `long-rest` auto `afterLongRest`: remove a token. `hunger` passive: flags `actionDisadvantage`, `reactionDisadvantage`, confirmed situation "no tokens" | Tokens live under `feat:transformation:vampire:feed`. No requirement reads a feature's own tokens (bead dcm-2g9), and no trigger narrows to the Fangs use (bead dcm-bn1). |
| `transformation:werewolf:wolf-form` | `main` reaction `whenYouMarkHp`: 1 Stress, effect "Wolf Form" until a rest. `attack` auto `beforeYouRoll attack`: +1d10. `damage` auto `whenYouAttack success`: +1d10 damage. `hope` auto `whenYouGainHope`: mark a Stress. The last three require Wolf Form | The d10s are rolled on each roll, not once on entering (a resolved `stat` mod would freeze one value). |
| `transformation:werewolf:howling-rampage` | `main` auto `whenYouMarkStress last`, requires Wolf Form: every creature within Very Close except you (side `any`) takes tier d20s physical; manual step "Drop out of Wolf Form" | `byTier [1,2,3,4]` gives the dice count. No step ends another feature's effect (bead dcm-5fc). |

Not run from the map (no entry; see `classification.ts`): Unfinished Business (narrative), Corpse and Won't Stay Dead (rest
and death-move flows), Change Shape and Only Skin Deep (downtime and build; `owned()` reads the sheet).

## Book passages checked (printed pages; "===== PAGE N =====" holds printed page N-1)

- HF p.34: "Transformations provide both a mechanical benefit and a drawback." "Like ancestry and community cards, a
  transformation card doesn't count against your domain card limit." "A PC can have only one transformation."
- HF p.35, Gifted: "You gain a +1 bonus to action, reaction, and damage rolls." Weight of Divinity: "When you fail a roll,
  you must mark a Stress or the GM gains a Fear."
- HF p.36, Ephemeral: "Your body wavers in and out of being corporeal. You are resistant to physical damage, take double
  magic damage, and can mark 2 Stress to momentarily pass through a solid object."
- HF p.39, Fangs: "Make an attack using a trait of your choice to bite a target within Melee range. On a success, deal d6
  physical damage using your Proficiency." Feed: "On a successful “Fangs” attack against a creature that can bleed, you
  can mark a Stress to feed. Place a number of tokens on this card equal to the number of Hit Points the target marks.
  You can hold up to 6 tokens at a time. Before you make an action roll, you can spend a token to make your Fear Die a
  d20. When you take a long rest, remove a token. While there are no tokens on this card, you make action and reaction
  rolls with disadvantage."
- HF p.40, Wolf Form: "When you mark 1 or more Hit Points, you can mark a Stress to enter your Wolf Form. While in this
  form, you gain a 1d10 bonus to attack and damage rolls. When you gain a Hope while in Wolf Form, you must also mark a
  Stress. Your Wolf Form lasts until you go into your “Howling Rampage” or take a rest." Howling Rampage: "When you mark
  your last Stress while in Wolf Form, you go into a rampage. Roll a number of d20s equal to your tier and deal that much
  physical damage to all creatures within Very Close range, then drop out of Wolf Form."
- CB p.92: a full Stress track marks a Hit Point instead (Weight of Divinity's Stress, tested).

## Tests

`tests/unit/feature-effects/transformations.test.ts` (28), every use through `runFeature` with fixed dice:

- The table equals the combat and passive transformation features of the classification, in data order. Every entry is in
  `FEATURE_EFFECTS`. A vampire sheet's `owned()` features have entries.
- Gifted: the passive mods, and the +1 fold on reaction rolls. Weight of Divinity: Stress, Fear, the choose prompt, and a
  full track's HP. Ephemeral: the mods, 2 Stress for the pass-through, and the cost refusal at 5/6 Stress.
- Fangs: Strength 12 vs 12 hits, 2d6 = 9; Knowledge -1 misses with no damage.
- Feed: 1 + 2 tokens = 3, capped at 6, refused without the confirmed situation, the Fear Die d20 fold and its cost
  refusal, the long-rest removal, and the no-tokens disadvantage.
- Wolf Form: the effect and its Stress, the d10 attack and damage folds only in form, and the Stress on Hope.
- Howling Rampage: tier 2 → 24 to an adversary and `pcDamage` to an ally PC, tier 1 and 4 dice counts, and only in form.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 300 of 301 files pass, 1 test fails, 1 is an expected fail. The
  only failure is SD0's old assertion in `tests/unit/feature-classification.test.ts` ("empty until their FE tracers fill
  them"). It fails once any FE table is filled. On `rebuild` that test now checks that entries are classified instead
  (orchestrator note), so it passes after the merge.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-transformations`: OK.

## Beads filed (labels feature-effects, vocabulary-gap)

- `dcm-2g9`: no requirement or state check on a feature's own tokens (Feed: no tokens).
- `dcm-5fc`: no step that ends another feature's sheet effect (Howling Rampage drops out of Wolf Form).
- `dcm-bn1`: a trait-roll attack (Fangs) is not an "attack" for `rollMatches` / `whenYouAttack`, and a rider can't be
  narrowed to one feature's attack (Feed).

## Open points and questions (nothing decided beyond the book)

1. **Weight of Divinity: who chooses, and on which rolls?** HF p.35: "When you fail a roll, you must mark a Stress or the
   GM gains a Fear."
   - **(a) Implemented:** the player picks, on any failed action or reaction roll.
   - (b) The player picks, on failed action rolls only.
   - (c) The GM picks.
2. Wolf Form's reaction is offered on every Hit Point marked, even while already in Wolf Form. The vocabulary has no "not
   in Wolf Form" check. SD4 can hide the prompt while the effect is active.
3. Wolf Form's +1d10 to attack rolls rides on rolls `rollMatches("attack")` accepts (weapon and spellcast). A Fangs bite is
   a trait roll and is not matched until dcm-bn1 is resolved.
