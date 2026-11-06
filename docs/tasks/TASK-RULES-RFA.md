# TASK-RULES-RFA: Hidden ends like Cloaked, Vulnerable PCs give advantage, adversary actions always take the spotlight

Plan `.omc/plans/rule-switches.yaml`, tracer RFA (wave 11). Builds the user's answers of 2026-11-06 (bead dcm-bxp.134)
to the questions RM and RC2 left. Built on RM (C2 notes), RC1 (C2 on weapon attacks) and RC2 (C1 / S1 adversary side).

## Rules and behaviour

| Rule | Book passage | Book | Manual |
|---|---|---|---|
| C2 `hiddenEnds`, Hidden | CB p.102: "After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." | An ordinary Hidden (no source of its own) ends like Cloaked: the PC's own move into an enemy's clear sight ends it; dim light asks the same Finesse roll (DA18), a failure ends it; an attack ends it (weapon attack, Charge, card attacks); an enemy token that moves to where it sees the Hidden PC ends it (clear) or asks the Finesse roll (dim). A Cloaked PC stays unseen when an adversary moves (CB p.42: "while Cloaked you remain unseen if you are stationary when an adversary moves to where they would normally see you"). A Hidden with its own source (a card's) stays | Nothing ends, no roll. The existing notes post; an enemy's move adds "Bear moved to where it sees Mira: remove Hidden?" ("in dim light" when only dimly) in the move's group |
| C1 `conditionDice`, adversary side, Vulnerable | CB p.102: "While you are Vulnerable, all rolls targeting you have advantage" | Per target, like Hidden's disadvantage: a Vulnerable PC target reads the higher of two d20s; when every target is Vulnerable the whole roll has advantage. A target both Hidden and Vulnerable rolls plain (one advantage source cancels its own disadvantage, DA17). A 20 only the Vulnerable target keeps is critical for that target alone (its own run, same damage dice) | No die; one note per Vulnerable PC target "Brute attacks Ash (Vulnerable): roll with advantage?" in the attack's group (beside RC2's Hidden note) |
| S1 `spotlightToGm`, adversary side | CB p.194: "For an adversary to use an action, they must have the spotlight" | An adversary action moves the spotlight to the GM (its live token lit) | The same: S1 Manual stops only the PC-roll half (`convex/lib/rollAftermath.ts`). RC2's note "Brute acts: take the spotlight for the GM?" is gone |

## Code

- `convex/lib/combatMovement.ts`: `endableHides` (the bare Hidden / Cloaked), `uncloakAfterMove` and
  `uncloakAfterAttack` end both; `rollCloak` / `cloakRoll` / `answerCloakDifficulty` work for Hidden too (feed text
  names the condition); `unhideAfterEnemyMove` and `hiddenSeenNote`.
- `convex/combatTokens.ts` `move`: calls `unhideAfterEnemyMove` after the token is patched.
- `convex/lib/combatActions.ts`: `uncloakedByAttack` drops a bare Hidden too (weapon attacks).
- `src/lib/domain/adversary-actions/attack.ts`: `splitTargetEdge` (signed per-target edge); `splitTargetDisadvantage`
  is a wrapper.
- `src/lib/domain/adversary-actions/rule-notes.ts`: `vulnerableTargetNote`; `adversarySpotlightNote` removed.
- `convex/lib/adversaryActions.ts`: `targetAdvantage`; the attack uses `splitTargetEdge`; the critical split runs
  any target whose kept die is critical when the roll's is not (and the reverse); C1 Manual notes; `spotlightActor`
  always moves the spotlight.

## Not done (outside RFA's files)

1. `tests/convex/rules-map-movement.test.ts` "Book: a Hidden PC's move changes nothing and posts nothing (unchanged)"
   asserts RM's old Book behaviour; under RFA a Hidden PC moving into clear sight loses Hidden. Update it to expect
   the loss (and the row "… ends a move in sight of an adversary and is no longer Hidden").
2. `tests/convex/rules-adversary-attacks.test.ts` "Manual: the spotlight stays; the GM gets a note …" asserts RC2's
   S1 Manual note; under RFA the attack moves the spotlight in Manual too. Replace it with RFA's expectation (covered
   in `tests/convex/rules-hidden-vulnerable.test.ts`).
3. `convex/cloakPrompts.ts` / `convex/lib/cloakPrompts.ts`: a non-attack use on an enemy asks the GM about Cloaked
   only; Hidden is not asked (not in the user's answer).
4. The GM's Difficulty request for a dim-light roll (`ask.kind: "cloak"`) is reused for Hidden; HUD wording that says
   "Cloaked" is outside RFA's files. The roll's feed text after the GM answers reads "ends a move in dim light …" even
   when an enemy's move asked it.
5. `convex/lib/spotlight.ts` header comment (RC2 noted it) is still stale.

## Tests

`tests/convex/rules-hidden-vulnerable.test.ts`: each answer in Book and Manual; the pure helpers; dice fixed or read
back from the roll record.
