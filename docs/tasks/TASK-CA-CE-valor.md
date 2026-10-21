# TASK CE-valor: Card effects, Valor (21 cards)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-valor (depends on CA1). Book pages are printed pages; CB = Core Book.
The Valor cards are on CB p.341 (Bare Bones to Goad Them On) and p.342 (Support Tank to Unyielding Armor).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/valor.ts` | `VALOR_EFFECTS`: 21 entries (14 combat + 7 passive; no Valor card is out of combat), each quoting its card |
| `tests/unit/card-effects/valor.test.ts` | 45 tests: the table matches the classification exactly (a missing or extra id fails); each card runs through `run()` with `queueRng` and the dice queue must be used up exactly; I Am Your Shield, Shrug It Off and Unyielding Armor also run through AA1's reaction window (`openWindow` → `runReactionCard` → `respond` → `resolveWindow`) |

User answers implemented: **U3** every Valor card has an entry. **Q3** limits are stored as `card:<id>` (or
`card:<id>:<useId>`) in `featureUses`: Bold Presence's condition use, Critical Inspiration, Rousing Strike (rest); Lean on
Me, Full Surge (long rest). **Q4** no Valor limit is "on a success". **Q9** movement is a `move` prompt (Forceful Push,
Ground Pound, Hold the Line), conditions go on the tracker (Vulnerable, Restrained, the tags Goaded and Lead by Example),
choices are dialog inputs (Forceful Push's Hope, Rousing Strike's own option, who clears / gains what), and what is left is a
`manual` step with the card's words. **Q13** (Part B): I Am Your Shield is an ally reaction on `whenAllyWouldTakeDamage`
(Very Close), Shrug It Off a target reaction on `whenYouWouldTakeDamage`, Unyielding Armor a target reaction on
`whenArmorSlotMarked`, so AA1's window offers all three before the damage resolves. No vocabulary type changed.

Rules used (quoted briefly): CB p.104 (R9) "roll damage once and apply the total to each target" (Ground Pound's full and
half damage come from one roll). CB p.92 (R5) a full Stress track marks a Hit Point instead (Goad Them On's Stress). CB p.90
(R8) the roll's Hope lands before a later Hope payment (Forceful Push's Vulnerable). CB p.114 one Armor Slot per hit unless a
card says otherwise (I Am Your Shield's "any number"). CB p.102 "temporarily" (Forceful Push's Vulnerable).

## Cards and readings

| Lv | Card | Activation | Reading |
|---:|------|-----------|---------|
| 1 | Bare Bones | passive | requires no armor worn; `set armorScore = 3 + Strength`, `set majorThreshold / severeThreshold` by tier (9/19, 11/24, 13/31, 15/38) |
| 1 | Forceful Push | action | primary weapon attack vs one adversary in Melee; on a hit primary weapon damage, `+1d6` when the hit is with Hope, `move` prompt knock back to Close; optional 1 Hope (offered on a hit) → Vulnerable `temporary` |
| 1 | I Am Your Shield | reaction `whenAllyWouldTakeDamage` Very Close | cost 1 Stress; `redirectDamage` to self, `extraArmorSlots any` (the CA0 example). AA1 window: redirect fold makes the user the target, who then answers with any number of slots |
| 2 | Body Basher | auto `whenYouAttack` success, weapon, Melee | `modifyDamage + Strength` |
| 2 | Bold Presence | rider `beforeYouRoll presence` (use `main`) + reaction `wouldGainCondition`, once per rest (use `condition`) | main: 1 Hope, `modifyRoll + Strength`. condition: `negate condition` |
| 3 | Critical Inspiration | rider `whenYouAttack` critical, once per rest | allies within Very Close: those who clear a Stress are `picked`, those who gain a Hope are `allies` (gap 1) |
| 3 | Lean on Me | reaction `afterAllyRolls` failure, once per long rest | requires the situation "you console or inspire the ally"; clear 2 Stress on you and on the ally |
| 4 | Goad Them On | action | Presence Roll vs one adversary within Close; on a hit it marks 1 Stress (overflow to HP, R5), gets the tag "Goaded" (duration `manual`) and a `manual` step for the forced attack with disadvantage (gap 2) |
| 4 | Support Tank | reaction `afterAllyRolls` Close, failure | cost 2 Hope; `modifyRoll reroll hopeOrFear` on the ally |
| 5 | Armorer | passive (use `main`) + reaction `timing afterRest` (use `repair`) | main: requires armor worn; `armorScore +1`. repair: requires "you chose to repair your armor as a downtime move during this rest"; every ally clears 1 Armor Slot |
| 5 | Rousing Strike | rider `whenYouAttack` critical, once per rest | `choose` for you: clear 1 HP or 1d4 Stress; allies who clear a HP are `picked`, allies who clear 1d4 Stress are `allies`, each rolling their own d4 (gap 1) |
| 6 | Inevitable | auto `afterYouRoll action` failure | self effect `advantage on action`, duration `nextRoll` |
| 6 | Rise Up | passive (use `main`) + auto `whenYouMarkHp` fromAttack (use `stress`) | main: `severeThreshold + Proficiency`. stress: clear 1 Stress |
| 7 | Shrug It Off | reaction `whenYouWouldTakeDamage` | cost 1 Stress; `reduceSeverity 1`; `check` 1d6 total ≤ 3 → `toVault` |
| 7 | Valor-Touched | passive (use `main`) + auto `whenYouMarkHp` withoutArmor (use `armor`) | both require 4+ Valor cards in the loadout. main: `armorScore +1`. armor: clear 1 Armor Slot |
| 8 | Full Surge | action, once per long rest | cost 3 Stress; self effect `trait all +2`, duration `rest` |
| 8 | Ground Pound | action | cost 2 Hope; Strength Roll vs every adversary within Very Close; hit targets: `move` prompt thrown back to Far, then a reaction roll (17): fail 4d10+8 physical, success half of the same roll |
| 9 | Hold the Line | action (use `main`) + action (use `pull`) | main: 1 Hope; self effect "Hold the Line" (no mods, duration `manual`, ends when you move or fail a roll with Fear); a `manual` reminder. pull: requires the stance active and the situation "the adversary moved within Very Close range"; `move` prompt pull into Melee; Restrained, duration `manual` (gap 3) |
| 9 | Lead by Example | reaction `whenYouDealDamage` to an enemy | cost 1 Stress; acts on the damaged adversary (trigger subject): tag "Lead by Example" (duration `manual`) and a `manual` step for the next attacking PC's Stress or Hope (gap 4) |
| 10 | Unbreakable | reaction `whenYouMarkHp` last | `negate deathMove`; clear 1d6 HP; `toVault` |
| 10 | Unyielding Armor | reaction `whenArmorSlotMarked` self | `check` Proficiency d6, any 6 → `reduceSeverity 1` and a `manual` step "don't mark the Armor Slot" (gap 5) |

## Manual steps and prompts

| Card | Step | Why | Page |
|------|------|-----|------|
| Goad Them On | `manual` + tag "Goaded": next spotlight, the adversary must attack you, with disadvantage | no modifier for the bearer's own next attack or a forced target (gap 2, dcm-e75) | CB p.341 |
| Hold the Line | `manual` reminder after the stance | the pull needs the player to start the `pull` use when an adversary moves in (gap 3, dcm-bpr) | CB p.342 |
| Lead by Example | `manual` + tag: the next PC to attack this adversary clears a Stress or gains a Hope | no trigger on another PC's attack against a tagged adversary (gap 4, dcm-7zb) | CB p.342 |
| Unyielding Armor | `manual`: answer without marking an Armor Slot | no outcome that skips or refunds the slot (gap 5, dcm-98d) | CB p.342 |
| Forceful Push, Ground Pound, Hold the Line | `move` prompts | movement is a prompt (Q9) | CB p.341-342 |

## Vocabulary gaps (beads filed; no type changed)

1. **No per-recipient choice** (dcm-bz8; Critical Inspiration, Rousing Strike). Each ally picks their own option. The first
   option goes to `picked`, the second to `allies`; the dialog must keep the two lists disjoint (the step notes name them).
2. **No "must attack you, with disadvantage" modifier** (dcm-e75; Goad Them On): tag plus manual step.
3. **No "an enemy moves within range of you" trigger** (dcm-bpr; Hold the Line): a second `action` use the player starts,
   gated by the stance's sheet effect and a situation. Related to dcm-cma (fixed areas that trigger on entry).
4. **No trigger for another PC's next attack on a marked adversary** (dcm-7zb; Lead by Example): tag plus manual step.
   Related to dcm-9gw (Breaking Blow).
5. **No "instead of marking the Armor Slot" outcome** (dcm-98d; Unyielding Armor): reaction + `reduceSeverity` + manual.

## For the next tracers

- **AA2 (server).** AA1's `triggerFits` matches only `whenAllyWouldTakeDamage`, `whenYouWouldTakeDamage`, `whenAttacked`
  and `whenArmorSlotMarked`. Unbreakable (`whenYouMarkHp last`), Rise Up's and Valor-Touched's autos (`whenYouMarkHp`) and
  Bold Presence's condition use (`wouldGainCondition`) must be offered or run by the server after the window resolves (the
  hit marked HP / the last HP / a condition). Unbreakable's `negate deathMove` fold should stop the `deathMove` the window
  reports. Shrug It Off's and Unbreakable's `toVault` are plan steps (not folds): the server moves the card.
- **CA4 / the Hand.** Critical Inspiration and Rousing Strike need two ally pickers (see gap 1).

## QUESTIONS

1. **Forceful Push's Vulnerable** ("On a success, you deal damage and knock them back to Close range. … Additionally, you can
   spend a Hope to make them temporarily Vulnerable.", CB p.341). Read as offered only on a success (a miss leaves nothing to
   make Vulnerable). Or can you spend the Hope on a failure too?
2. **Ground Pound's damage type** ("Targets who fail take 4d10+8 damage. Targets who succeed take half damage.", CB p.342).
   The card names no type; read as physical (a Strength strike). Confirm.
3. **Bold Presence's timing** ("When you make a Presence Roll, you can spend a Hope to add your Strength to the roll.",
   CB p.341). Read as decided before the roll (a toggle in the roll dialog, like Codex-Touched). Or may the player add it
   after seeing the dice?
4. **Critical Inspiration / Rousing Strike: who chooses** ("all allies within Very Close range can clear a Stress or gain a
   Hope", CB p.341; "you and all allies who can see or hear you can clear a Hit Point or 1d4 Stress", CB p.342). Read as each
   ally choosing their own option (the card's user enters them in the dialog), and each ally rolling their own 1d4 for
   Rousing Strike. Confirm, or should one 1d4 be rolled for everyone?
5. **Unyielding Armor as a reaction** ("When you would mark an Armor Slot, roll a number of d6s equal to your Proficiency.
   If any roll a 6, reduce the severity by one threshold without marking an Armor Slot.", CB p.342). The classification calls
   it automatic; it is a reaction here so the hit PC plays it in the reaction window before answering armor (the window
   does not run automatic uses). The prompt costs nothing, so it is never worse to accept. Confirm.
6. **Goad Them On's forced attack** ("the next time the GM spotlights them, they must target you with an attack, which they
   make with disadvantage", CB p.341): left to the GM through the "Goaded" tag and a manual step. Should AA2 enforce it
   (only you as the target, disadvantage on that attack)?
7. **Hold the Line's pull** ("If an adversary moves within Very Close range, they're pulled into Melee range and Restrained.
   This condition lasts until you move or fail a roll with Fear, or the GM spends 2 Fear on their turn to clear it.",
   CB p.342). Read as every adversary that enters Very Close while the stance lasts (not just the first), and the stance and
   each Restrained ending together when you move or fail a roll with Fear. Confirm.
8. **Lead by Example's beneficiary** ("The next PC to make an attack against that adversary can clear a Stress or gain a
   Hope", CB p.342): read as any PC including you. Confirm.
9. **Support Tank's "fails a roll"** ("When an ally within Close range fails a roll", CB p.342): read as a failed action
   roll (`afterAllyRolls` failure). Should reaction rolls count too?
10. **Armorer's ally clear** ("During a rest, when you choose to repair your armor as a downtime move, your allies also clear
    an Armor Slot.", CB p.342): read as every ally in the party (no range on the card). Confirm.
