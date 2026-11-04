# TASK DA1: Adversary attack roll: per-target disadvantage (Sturdy, Harrowing), Drained d12 record, held-attack label

Plan `.omc/plans/drawer-answers.yaml`, tracer DA1 (wave 1). Bead `dcm-bxp.99.19`; answers dcm-bxp.99.19.45 (3),
dcm-bxp.99.19.46 (3), dcm-bxp.99.19.49 (1) and (3). Status: Review.

## User answers implemented (2026-10-30)

- **Sturdy per target** (dcm-bxp.99.19.45 (3)): on a multi-target adversary attack the disadvantage counts only against
  the Sturdy target. Replaces SD2's whole-roll disadvantage.
- **Harrowing Invocation per protected PC** (dcm-bxp.99.19.46 (3)): disadvantage only against the protected PCs (the
  warlock and allies within Very Close); the adversary marks 1 Stress if the roll fails against **any** protected PC.
- **Drained** (dcm-bxp.99.19.49 (1)): swaps only the d20 attack roll for a d12; ends only on a failed attack roll.
- **Forced rerolls keep advantage / disadvantage** (dcm-bxp.99.19.49 (3)): pinned.

## Book passages (printed pages)

- CB p.68, Sturdy (Orc): "When you have 1 Hit Point remaining, attacks against you have disadvantage."
- HF p.14, Harrowing Invocation: "When an adversary targets you or an ally within Very Close range with an attack, you
  can spend a Favor to give them disadvantage on the roll. If the adversary fails the roll, they must also mark a Stress."
- HF p.14, Draining Bane: "While Drained, the target uses a d12 instead of a d20 for attack rolls (including for
  advantage or disadvantage) until they fail a roll."
- CB p.161: "If an NPC has advantage, roll an extra d20 and take the highest result. Similarly, if an NPC has
  disadvantage, roll an extra d20 and use the lowest result." "When an adversary's action lets you make an attack
  against multiple targets, you make one attack roll and ask if it hits any of the targets."
- CB p.148: "Whenever you roll a 20 on the d20, your roll automatically succeeds. If you critically succeed on an attack
  roll, you also deal extra damage."
- CB p.63, Danger Sense: "Once per rest, mark a Stress to force an adversary to reroll an attack against you or an ally
  within Very Close range." CB p.107: "When a feature allows you to reroll a die, you always take the new result."

## What was built

One roll, one pair of d20s; each target keeps its own die from that pair. What every target carries (a single target's
Sturdy, Harrowing protecting every target) counts for the whole roll, exactly as before; only the difference between
targets is read per target.

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/attack.ts` | `keptDie(first, second, net)`, `splitTargetDisadvantage` (common part / residual per target), `TargetRoll`; `adversaryAttack` judges each target with the die it keeps (`targets`, `hits`); `record` / `total` keep SD2's reading (every source any target carries counted once), so the SD2 tests in `feature-passives.test.ts` pass unchanged. |
| `convex/lib/adversaryActions.ts` | The server rolls the attack's d20s itself (`presetDice`); PC targets' Sturdy is read through `pcTarget` (SD2 follow-up 1, the disadvantage part); `Replay.disadvantage` became `disadvantageAgainst` (per protected PC); the runner sees the whole roll's die, and a target keeping a lower die meets its Evasion raised by the difference (the same hit or miss as its own total). A natural 20 the residual targets don't keep: those targets run a second time on their own die with the first run's damage dice replayed (`joinTargets`); costs, Fear and the attacker's changes are the first run's. Each hit carries its target's own `attackTotal`. Harrowing's Stress: `some` instead of `every`. Stored roll (`attackRecord`): a Drained attacker's attack dice are `sides: 12`; a second die only residual targets read is listed after the kept die, dropped, role `extra`. The held result has no manual prompt. |
| `src/components/adversaries/tracker/actions/windows.tsx` | A held attack (`preRoll`): "Bear attacks Mira, before the roll", no damage line, "Waiting for Mira (before-roll answer)", Resolve now labelled "attacks". |

**Harrowing "every" → "any":** SD4 built `replay.harrowed.subjects.every((id) => !hitIds.has(id))` (Stress only when the
roll missed every protected PC), matching its code comment. Now `some`: a miss against any protected PC marks the Stress.
SD4 also applied the disadvantage to the whole roll; now it counts per protected PC.

**Drained (as built, pinned):** ends when a Drained attack roll misses every target (`hitIds.size === 0`); a hit keeps it;
only attack rolls of the instance use d12s.

## Tests

- `tests/unit/adversary-actions/attack-per-target.test.ts`: `keptDie`, `splitTargetDisadvantage`, per-target totals
  (15 / 4: Mira 17 hit, the orc 6 miss), advantage cancelled only for the orc, a natural 20 critical only for its keeper,
  modifier dice after both d20s, no residual → one die, a single Sturdy target as SD2.
- `tests/convex/adversary-attack-defences.test.ts` (server d20s set, Acid Burrower's Spit Acid at Ash and Bryn): Sturdy
  18 / 2 (Bryn hit, orc miss, the record lists both dice), 2 / 18, no Sturdy one die, a single Sturdy target, a natural 20
  critical only for Bryn with the orc's non-critical hit 12 damage lower (same dice), 20 / 1; Harrowing: hits one, misses
  the other → a Stress; hits both → none; Harrowing + Sturdy on both → whole-roll; Drained record d12s with disadvantage;
  a failed roll ends Drained, a hit keeps it; the reroll pin (`resolveRerolls` keeps disadvantage).
- `tests/unit/tracker-held-attack.test.tsx`: the held line, its feature, Resolve now, a hit's window unchanged.
- `tests/unit/adversary-actions/attack-severity.test.ts`: unchanged, passes.

## QUESTIONS

1. **Two of a target's own sources.** CB p.161 gives an NPC one extra d20 for advantage or disadvantage. Built: each
   source counts one (Sturdy and Harrowing on the same PC are two disadvantage sources), so they cancel two advantage
   sources (as `rollD20` already counts net sources). Is that right, or should a target's disadvantage count once
   however many sources it has?

## Follow-ups (outside DA1's owns)

1. `convex/lib/adversaryHits.ts` `attackRollOf` finds the attack roll by a die with `sides === 20`. A Drained attack's
   record now has `sides: 12`, so a window over a Drained attack has no attack total (Evasion answers can't compare) and a
   forced reroll of it stays for the GM (before, it rerolled d20s, which was also wrong). Fix: match the GM row's
   `roll.kind === "action"` and reroll with the record's die size.
2. `rebuildWindow` reads the attack total from the GM row (the whole roll's). A target with its own disadvantage gets its
   own `attackTotal` only on the hit opened at once; a window rebuilt later compares Evasion answers with the whole
   roll's total, and `resolveRerolls` rerolls it without the target's own disadvantage. The incoming-hit payload would
   need the target's own total and disadvantage (validator widen, SD5/combatRequests owner).
3. `pcTarget`'s Evasion part (Elusive Predator, Scorpion's Poise, Battle-Bonded; SD2 follow-up 1) is still not applied
   on the server; DA1 reads only its disadvantage.
4. Harrowing per protected PC needs a live map to differ from the whole roll (without a map every target is in range,
   Q18); the map case is covered by the same `disadvantageAgainst` path but has no convex test with tokens.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test` (one unrelated failure under load, `tests/convex/auth-signup.test.ts`'s
global sign-up bucket; passes alone), `tests/e2e/combat-adversary.spec.ts` and `tests/e2e/combat-feature-reactions.spec.ts`
(4 passed), `node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA1`.
