# TASK LN-SRD-F2: SRD feature effects, Assassin, Brawler, Bard, Wizard, Druid, Sorcerer, Guardian, Warrior

Plan `.omc/plans/lanes.yaml`, tracer SRD-F2 (lane `w2-srd-data`), wave 5. Wave 4 (V, E1-E8) widened the vocabulary
and taught the engines to run it, using fixture entries. This tracer switches the real SRD entries of its four files to
the new vocabulary and checks every remaining `manual` step against it. Book pages are printed pages (CB = Core Book,
HF = Hope & Fear). Feature texts were checked against the books.

Files: `src/lib/srd/feature-effects/{assassin-brawler,bard-wizard,druid-sorcerer,guardian-warrior}.ts`, their tests in
`tests/unit/feature-effects/`, and this file. No engine, runner or `types.ts` file was changed.

## Entries automated

| Entry (use) | Book | Before | Now | Test |
|---|---|---|---|---|
| Toxic Concoctions `poison` + Twin Fang | HF p.9: "spend an additional token to also inflict the effect of a second poison you know" | `second-poison` could repeat the first poison | `choose.distinctFrom: "poison"`: the runner refuses the same poison (`choice`), the dialog hides it (dcm-40m) | assassin-brawler: "the second poison must differ" |
| Stance Fighter `shift` (+ Flow State option) | HF p.12: "spend a Focus to shift into a martial stance" | `manual` step x2 | `setStance` step (`SHIFT_STANCE`, dcm-awh). run.ts still turns it into a manual prompt with the same text until dcm-4xl; the stance itself is still set by SD3's `shiftStance` intent | assassin-brawler: Stance Fighter (prompt carries the `setStance` step) |
| Eloquent option `downtime` | CB p.29: "Give them an additional downtime move during their next rest." | `manual` step | `downtime` `op: "extraMove", at: "nextRest"` to the ally: featureRunner records the grant, the ally's next rest offers one more move (E8; dcm-bxp.99.19.2) | bard-wizard: Eloquent (plan step + `extraMoveGrantsOf` = 1 for the ally) |
| Perfect Recall | CB p.50: "Once per rest, when you recall a domain card in your vault, you can reduce its Recall Cost by 1." | action use with a `manual` step | rider on `whenYouRecall`, `loadout reduceRecallCost` 1, limit per rest (dcm-bxp.99.19.1) | bard-wizard: the plan and the real entry through `recallReductions` (2 → 1, then refused) |
| Unstoppable `main` | CB p.36: "You can't be Restrained or Vulnerable." | `cannotBeRestrained` flag + `manual` step for Vulnerable | flags `cannotBeRestrained` and `cannotBeVulnerable` (cardRows refuses Vulnerable; dcm-v17's flag part) | guardian-warrior: Unstoppable |
| Attack of Opportunity option `hold` | CB p.48: "They can't move from where they are." | `manual` step | `effect` on the adversary, flag `cannotMove`, duration `manual` (the book names no end; on an instance it is stored as `temporary`, ended by the GM) | guardian-warrior: hold |
| Attack of Opportunity `critical` | CB p.48: "Choose one effect on a success, or two if you critically succeed" | the second pick could repeat the first | `choose.distinctFrom: "effect"` (dcm-fjh's distinct part) | guardian-warrior: critical distinct |
| Courage | CB p.48: "When you fail a roll with Fear, you gain a Hope." | `result: "failure"` + situation "The roll was with Fear" | `result: "failure", duality: "fear"`, no situation (dcm-5z3); runs on attacks (auto riders) and plain rolls (`plainRollAutos`) | guardian-warrior: Courage (entry, and the real entry through `plainRollAutos`: failFear +1 Hope; failHope, successFear nothing) |

## Manual steps per file

| File | Before | After |
|---|---|---|
| assassin-brawler.ts | 2 | 0 (the two `setStance` steps still show as manual prompts until dcm-4xl) |
| bard-wizard.ts | 3 | 1 |
| druid-sorcerer.ts | 2 | 2 |
| guardian-warrior.ts | 3 | 1 |

## Manual steps left, and why

1. **Eloquent, option `object`** (CB p.29: "they find a mundane object or tool they need"): narrative; nothing to
   automate, so no bead.
2. **Elemental Incarnation, Water** (CB p.30: "When you deal damage to an adversary within Melee range, all other
   adversaries within Very Close range must mark a Stress."): V can express it (`whenYouDealDamage.within`,
   `TargetSpec.excludeSubject`), but the attack's rider phase passes no `picked` creatures to any rider
   (`runRiderPart`: `choices.picked = []`) and does not match `within` (dcm-76l5). As data it would mark no Stress, so it
   stays manual. Beads dcm-ssf (open) and new **dcm-umti**.
3. **Manipulate Magic, option `reach`** (CB p.47: "Extend the spell or attack's reach by one range"): `RollChange
   reach` exists, but nothing widens the host's range yet (dcm-76l5 item 2). Bead dcm-x7p (open).
4. **Weapon Specialist, `slayer-ones`** (CB p.48: "once per long rest when you roll your Slayer Dice, reroll any
   1s"): `RollChange rerollHeld` exists, but run.ts does not apply it (dcm-inou, dcm-sa2). The dice box and map
   attacks already reroll the 1s (convex/lib/rolls.ts).

## Beads

| Bead | State |
|---|---|
| dcm-40m Twin Fang, distinct choose steps | done (data). Ready to close. |
| dcm-5z3 Courage, failure with Fear | done (data). Ready to close. |
| dcm-bxp.99.19.2 Eloquent, extra downtime move | done (data). Ready to close. |
| dcm-bxp.99.19.1 Perfect Recall | data done. The server takes the rider only when `recallRiders` names it, and neither `characters.moveCard` nor the Hand passes it yet (dcm-cfpv). Until then the player has no button for Perfect Recall (before, it was an action button with a manual note). |
| dcm-v17 Unstoppable | the `cannotBeVulnerable` flag is in. Its other parts (classDie, the effect ending with D5's die) are E5's and E6's (dcm-4xl, dcm-kmr). |
| dcm-fjh Attack of Opportunity | the hold and distinct parts are in; one use per trait and At Ease's Stress slot are unchanged. |
| dcm-awh Stance Fighter | data done (`setStance`); the engine part is dcm-4xl. |

## Follow-ups

- **dcm-umti** (new; `lane:w1-e1-triggers-rolls`, `vocabulary-gap`): auto riders need their `picked` creatures filled
  ("all enemies in range, minus the trigger subject") so Elemental Incarnation Water can drop its manual step.
- Existing beads that still block the manual steps above: dcm-76l5, dcm-x7p, dcm-ssf, dcm-inou, dcm-4xl, dcm-cfpv.

## QUESTIONS

None. The one open reading (Water: Very Close of whom) was answered before (dcm-bxp.99.19.34: of the druid).
Attack of Opportunity's "can't move" has no end in the book, so this tracer used duration `manual` (the table ends it)
and did not pick a length.
