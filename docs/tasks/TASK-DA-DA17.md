# TASK DA17: Several disadvantage sources on one target count once

Plan `.omc/plans/drawer-answers.yaml`, tracer DA17 (wave 5). Bead `dcm-bxp.99.19.53` (answers DA1 QUESTIONS 1).
Status: Review.

## User answer implemented (2026-10-30)

When one target has several disadvantage sources against an adversary attack (Sturdy plus Harrowing Invocation), they
count once, on or off. One advantage source cancels it. DA1 counted them per source (two sources needed two advantage
sources to cancel). DA1's per-target split is kept.

## Book passages

- CB p.68, Sturdy (Orc): "When you have 1 Hit Point remaining, attacks against you have disadvantage."
- HF p.14, Harrowing Invocation: "you can spend a Favor to give them disadvantage on the roll."
- CB, "Advantage and Disadvantage" (core.txt page 101): "Advantage and disadvantage always cancel each other out when
  applied to the same roll" … "if you have two sources of advantage and one of disadvantage, one of the advantage dice
  and the disadvantage die cancel each other out, so you would have advantage on the roll."
- CB p.161: "If an NPC has advantage, roll an extra d20 and take the highest result. Similarly, if an NPC has
  disadvantage, roll an extra d20 and use the lowest result."

## What changed

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/attack.ts` | `ownDisadvantage(sources)`: 0 or 1. `splitTargetDisadvantage` reads each target's sources through it (common and residual are 0 or 1). `adversaryAttack`'s per-target net uses it. |
| `convex/lib/adversaryActions.ts` | Comment only: the server already sends each target's summed sources (Sturdy + its `disadvantageAgainst`) through `splitTargetDisadvantage`, so the change reaches the server roll there. |

The roll's own sources (the GM's advantage / disadvantage, cover, Goad Them On, the instance's disadvantage) still
count one for one, as before.

## Tests

- `tests/unit/adversary-actions/attack-per-target.test.ts`: `ownDisadvantage`; the split's residual for two sources is 1;
  an orc with two sources keeps the lower die as with one; one advantage source cancels both (multi-target and alone);
  two advantage sources give advantage.
- `tests/convex/adversary-attack-defences.test.ts` (Ash a warlock orc at 1 HP, Harrowing answered): one advantage
  source: one die, 18 hits; two advantage sources: the higher die kept; Ash (Sturdy + Harrowing) with Bryn (Harrowing)
  and one advantage source: no residual, one die for both.

## Not done: DA8 QUESTIONS 6 (exact own disadvantage on a reroll)

Not a one-line change inside DA17's owns. The hit's stored `attackDisadvantage` is computed in
`convex/lib/incomingHits.ts` (`ownAttack`, from the totals), and `HitDraft` (`convex/lib/adversaryHits.ts`) has no field
to carry it from the action. The fix: add `attackDisadvantage?: number` to `HitDraft`, set it in
`convex/lib/adversaryActions.ts` next to `attackTotal` (`h.hit.attackDisadvantage = residual.get(h.targetId)`), and
have `ownAttack` prefer `input.hit.attackDisadvantage`. Needs a tracer owning those two files.

## QUESTIONS

1. **The roll's own disadvantage plus a target's own.** Built: only a target's own sources (Sturdy, Harrowing) collapse
   to one. A whole-roll source (cover, the GM's disadvantage, Goad Them On) still counts separately, so cover plus
   Sturdy against one advantage source is still disadvantage. Should every disadvantage on the attack against a target
   count once?

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test` (355 files, 8819 passed + 1 expected fail), `node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA17`; e2e `tests/e2e/combat-adversary.spec.ts` on ports 3117 / 3346: the first run timed out building the web server and the second failed one 5 s visibility wait (line 169, "Adversary resolutions" rows) under load; that test passed alone, the other passed.
