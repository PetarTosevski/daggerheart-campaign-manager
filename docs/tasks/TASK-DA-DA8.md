# TASK DA8: Reaction window answers - every ready reaction after armor, Stable, Celestial Wings, Dark Aegis, Draining Bane

Plan `.omc/plans/drawer-answers.yaml`, tracer DA8 (wave 2; depends on DA0, DA1). Bead `dcm-bxp.99.19`; answers
dcm-bxp.99.19.50 (3), dcm-bxp.99.19.9, dcm-bxp.99.19.13, dcm-bxp.99.19.30, dcm-bxp.99.19.15, pins dcm-bxp.99.19.47 (2),
dcm-bxp.99.19.48 (4), dcm-bxp.99.19.50 (2); DA1's follow-ups 1 and 2. Status: Review. Printed pages (CB = Core Book,
HF = Hope & Fear).

## User answers implemented

- **Any order after armor** (dcm-bxp.99.19.50 (3)). CB p.107, "SIMULTANEOUS AND STACKING EFFECTS": "If two or more
  effects can apply to a situation, and the rules don't tell you which order to apply them in, the player controlling the
  effects (including the GM) can apply the effects in any order." After the hit PC marks an Armor Slot (or uses a slot
  substitute) every ready card or feature that still fits the hit as the answers so far left it stays offered, and the
  player answers them in the order they pick, until Done. SD4's severity-only filter (`afterArmor`) is gone. Cards too:
  the hit PC's reaction cards are listed when they fit the hit now (before or after the armor answer).
- **Stable** (dcm-bxp.99.19.9). HF p.12: "You can spend a Focus instead of an Armor Slot to reduce damage." User: the
  Focus lowers the severity by one, the Armor Slot is NOT marked, never more than 1 step in total with the slot, usable
  without armor while the PC has Focus. Entry: `reduceSeverity` with `insteadOfArmorSlot` (DA0).
- **Celestial Wings** (dcm-bxp.99.19.30). HF p.19: "Once per scene while flying, you can spend a Hope instead of marking
  an Armor Slot." User 2026-10-29: any hit while flying, even with no armor or every slot marked, the Hope lowers severity
  by one, once per scene; 2026-10-30: Wings OR a real Armor Slot on a hit, never both. Entry: trigger "when you would take
  damage", 1 Hope, Flying, once per scene, `reduceSeverity` with `insteadOfArmorSlot` (was a `convertMarks` armor → Hope
  on `whenArmorSlotMarked`).
- **Dark Aegis** (dcm-bxp.99.19.13). HF p.14: "Once per long rest when you would take damage, you can spend a Favor
  instead of marking Hit Points." User: the damage becomes zero, no HP marked, zero damage has no severity (no Minor /
  Major / Severe, so "until you take Severe damage" doesn't fire); the attack's on-hit effects (conditions) still apply,
  but any extra "mark HP" from them is ignored. Entry: `negate` damage with `ignoreOnHitHp` (DA0).
- **Draining Bane** (dcm-bxp.99.19.15). HF p.14: "you can clear a Stress." User: an optional tick, ON by default. Entry:
  `defaultOn`; the before-roll prompt shows "Clear a Stress" ticked; unticked it sends `optional:clear-stress = false`,
  which the server reads as `optionalsOff`.
- **Pins.** A halving reaction (Increased Fortitude, Damage Sink) and resistance both apply: reaction first, then
  resistance, each rounding up (Q6; dcm-bxp.99.19.47 (2); CB p.107 "round up unless otherwise specified"): 15 → 8 → 4.
  One answer (card or feature) per ally per hit (dcm-bxp.99.19.48 (4)). Elemental Dominion Fire's +1 Proficiency is a
  passive Proficiency modifier only (damage dice), as SD2 built it (dcm-bxp.99.19.50 (2), CB p.30: "You gain a +1 bonus
  to your Proficiency for attacks and spells that deal damage.").
- **Binding carry-overs** unchanged: players see no adversary roll (U1, Q14); the hit PC sees their own damage and
  severity (after the armor answer: the hit as the answers left it, e.g. "0 damage: No damage."); every write is in the
  action's group, so the GM's undo restores sheets and the instance (U4).

## DA1 follow-ups

1. `attackRollOf` (convex/lib/adversaryHits.ts) finds the action's attack roll by its kind (`action`), not by a d20 in
   it, so a Drained attack's record (d12s) is found. `resolveRerolls` rerolls with the record's die size (a Drained d12;
   critical only on a natural 20 of a d20, CB p.148).
2. An incoming hit stores the target's own `attackTotal` and `attackDisadvantage` (optional payload fields, widen only;
   GM-only, never in a view). A window rebuilt later compares Evasion answers with the target's own total, and a forced
   reroll adds the target's own disadvantage. The disadvantage is read from the totals (see QUESTIONS 6).

## What changed

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/window.ts` | Folds `reduceSeverity.insteadOfArmorSlot`, `negateDamage.ignoreOnHitHp`; `replacesArmorSlot`; `armorAnswered` (a slot substitute is the armor answer); `severitySteps` (substitutes count one step at most); `ruledOut` (a second armor reduction, a substitute on direct damage, an extra slot after the armor answer); `cardAnswers` (the hit PC's cards that fit now); `featureAnswers` without the severity-only filter; `awaiting` keeps the hit PC after a marked slot / substitute while any card or feature fits, until Done (`noArmor` and Done end the turn); `progress` reads a cancelled damage as 0 / none and gives the HP now; zero damage drops "would take damage" answers (CB p.91); `respond` accepts cards after armor, refuses an armor answer after a substitute and a second substitute; `resolveWindow` `hpRidersIgnored`; `targetPrompt` after a cancel; `runReactionFeature` `optionalsOff`. |
| `convex/lib/adversaryHits.ts` | `featureActor` facts carry the active stance and Beastform (a stance answer such as Stable was refused before: its `activeStance` check fell back to a confirmation the prompt never shows); `featureChoices` `optionalsOff`; `attackRollOf` by kind; `attackDieSides`, d12 rerolls, the target's own disadvantage; `rebuildWindow` reads the stored `attackTotal`; `applyRiders(..., ignoreHp)`. |
| `convex/lib/incomingHits.ts` | Stores `attackTotal` / `attackDisadvantage`; Dark Aegis's riders without HP; `hitView` lists the hit PC's fitting cards (`cardIds`), `armorAnswered` from the window, the hit now after the armor answer; `featureView.optionals[].defaultOn`; after-hit features read `optionalsOff`. |
| `src/lib/srd/feature-effects/{stances,warlock,heritage-hf}.ts` | Stable, Dark Aegis, Draining Bane, Celestial Wings as above. |
| `src/components/combat-map/actions/reactions/{model.ts,prompt.tsx}` | `defaultPicks` ticks `defaultOn` optionals; cards shown after the armor answer; "Armor answered. Use another reaction that fits now, in any order, or Done."; the optimistic `pending` keeps the hit PC owed after Mark while answers are listed. |
| `convex/lib/validators/combatRequests.ts` (outside owns, widen only) | `incomingHitPayloadValidator`: optional `attackTotal`, `attackDisadvantage`. |
| `convex/adversaryActions.ts` (outside owns, widen only) | `featureViewValidator.optionals[].defaultOn` optional (the `pending` returns validator). |

No new public function and no authz change: `respond` and `pending` keep their matrix entries.

## Tests

- Unit `tests/unit/feature-window.test.ts` (DA8 blocks): Increased Fortitude after the slot (Iron Will no longer
  offered), the same result in the other order, Don't ends the turn and Done after the slot; halving then resistance
  15 → 8 → 4; one answer per ally (Partners-in-Arms, then I Am Your Shield refused); Stable without armor (Major → Minor,
  no slot), Stable OR the slot (one step, slot clear, armor after it refused, two substitutes still one step); Celestial
  Wings with every slot marked (Severe → Major), not when not flying, not after a real slot; no substitute on direct
  damage; Dark Aegis after a slot (no slot, no severity, no HP, `hpRidersIgnored`), before armor (nothing to reduce),
  Damage Sink not offered after it; Draining Bane's default tick in the prompt model; Elemental Dominion Fire pin.
- Unit entries: `stances.test.ts` (Stable `insteadOfArmorSlot`), `warlock.test.ts` (Dark Aegis negate, Draining Bane
  default on / `optionalsOff`), `heritage-hf.test.ts` (Celestial Wings: Hope, one step, the trigger, no Hope refused).
- Convex `tests/convex/feature-reactions.test.ts` (DA8 block): a dwarf's Increased Fortitude after the slot (17 → 9 →
  Minor, Thick Skin then offered, Done: 1 HP); Stable without armor (Severe → Major, Focus spent, no slot; no roll keys in
  the view); Stable not offered after the slot; Dark Aegis after the slot (0 HP, no slot, Restrained lands, the HP rider
  doesn't, "took no damage", undo restores Favor, conditions); Drained attack: `attackRollOf` finds the d12 record, the
  hit stores its own total, a reroll keeps the d12 and adds the target's disadvantage; Draining Bane before the roll:
  `defaultOn` in the view, clear by default, unticked keeps the Stress.
- e2e `tests/e2e/combat-feature-reactions.spec.ts`: new "after an Armor Slot a dwarf still gets Increased Fortitude; a
  warlock's Dark Aegis leaves no Hit Point marked; the GM's undo restores all" (Mark, then Increased Fortitude, Done;
  the warlock levelled to 8 (mastery): Draining Bane's tick checked before the roll, Pass, Mark, Dark Aegis: 0 HP, no
  slot; a remaining fitting card (Umbral Veil) waits with Done; undo restores Favor and slots). Axe and 44 px targets on
  the after-armor prompt; shot in `test-results/visual/DA-DA8/`.

**Deviation (e2e):** "a Stable stance PC answers a hit without armor" has no e2e: no public function lets a character
learn a stance (`classState.martial.known` is set by nothing a player or GM can call; `combatFeatures.shiftStance` only
shifts into a known one). The convex test seeds it and covers the server path. Follow-up: a "learn stance" mutation (or
the level-up / creation path) for Martial Artists.

## QUESTIONS

1. **Slot substitutes on direct damage.** CB p.99: "Direct damage is physical or magic damage that Armor Slots can't be
   used to reduce." Stable (HF p.12): "spend a Focus instead of an Armor Slot to reduce damage"; Celestial Wings (HF
   p.19): "spend a Hope instead of marking an Armor Slot". Built: as the hit's armor reduction, neither is offered on
   direct damage. Should they work on direct damage (the user's Wings answer says "any hit while flying")?
2. **Substitute and extra Armor Slots.** I Am Your Shield (CB p.341): "you can mark any number of Armor Slots"; Iron Will
   (CB p.36) one more. Built: a substitute is the hit's armor answer, so no real slot is marked after it (and Iron Will
   is not offered once armor is answered). Should Stable / Wings be usable alongside the extra slots a card allows?
3. **"Don't mark" ends the hit PC's turn.** Built: after "Don't" (or OK) the window doesn't keep offering answers: every
   answer that fit was offered next to that choice and nothing changed the hit. After a marked slot or a substitute every
   answer that still fits stays until Done. Is that the reading the user wants?
4. **Dark Aegis and other on-hit marks.** User: "any extra 'mark HP' from them is also ignored". Built: forced HP riders
   are skipped, and a Stress rider past a full track (CB p.92: "you must instead mark 1 Hit Point") marks no HP. A forced
   Armor Slot (CB p.195 Shredding Strike: "must mark an Armor Slot without gaining its benefit") is still marked. Right?
5. **Zero damage.** CB p.91: "If you ever reduce incoming damage to 0 or less, you don't mark any HP." Built: once the
   damage is 0 (Dark Aegis), answers triggered by "when you would take damage" (Damage Sink, Stable) are no longer
   offered; answers on other triggers (Umbral Veil, "After an attack roll is made against you") still are. Agreed?
6. **The target's own disadvantage on a reroll.** Built: read from the totals: a target whose own total is below the
   whole roll's kept the lower die for its own disadvantage, so its forced reroll counts one more disadvantage. With two
   equal dice that can't be told, and the reroll uses the whole roll's advantage / disadvantage. The exact count needs
   `convex/lib/adversaryActions.ts` (DA1's file, outside DA8's owns) to pass each hit's residual disadvantage.
7. **Drained critical.** CB p.148: "Whenever you roll a 20 on the d20, your roll automatically succeeds." Built: a
   Drained attacker's d12 (and its reroll) is never critical. Confirm.

## Follow-ups (outside DA8's owns)

- `convex/adversaryActions.ts` `pending` returns validator: the `armorAnswered` comment still says "a severity-gated
  feature (Thick Skin) or Done is left"; now every fitting answer is.
- `convex/lib/adversaryActions.ts`: pass each hit's residual disadvantage (`HitDraft.attackDisadvantage`) so QUESTIONS 6
  needs no derivation.
- A way for a Martial Artist to learn stances (no public function today), then an e2e for Stable.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test` (348 files, 8732 tests incl. 1 expected fail), e2e on ports 3131 / 3374:
`combat-feature-reactions.spec.ts` (3), `incoming-hit.spec.ts`, `combat-adversary.spec.ts` (8 with the first),
`encounter-actions.spec.ts`, `visual/CA-AA5.spec.ts` (4); `node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA8`
(the two widened validator files outside owns, named above).
