# TASK-RULES-OP: the optional rule "Conflict between PCs" (CB p.168)

Plan `.omc/plans/rule-switches.yaml`, tracer OP (epic dcm-jh6d part A, bead dcm-bxp.134). Registry id `pcConflict`
(`src/lib/rules/registry.ts`: optional, off by default; "A PC can attack another PC against Evasion, and the GM can
call a Contest."). User answer Q14 (a, changed from the recommendation, 2026-11-05): "attacks on PCs vs Evasion through
the normal hit path AND a GM 'Contest' request (instigator action roll vs target reaction roll; instigator must beat
it)". The plan's acceptance still quotes Q14 (b); the user's (a) wins, so the Contest is built too.

## The book

CB p.168, "Conflict Between PCs" (Chapter 3: Optional GM Mechanics):

> Sometimes a player might want their character to act against another PC in the scene. Before jumping to rolling dice,
> discuss the situation with both players to decide how to resolve the conflict. A roll might not be necessary to reach
> an outcome—but if rolling will be fun for everyone involved, come to a consensus on the terms of the roll, then
> facilitate the scene according to the results.
>
> On an attack roll against a PC, the attacker rolls against the defender's Evasion, just like an adversary. On any
> other kind of action roll, the instigator makes an action roll and the target makes a reaction roll. To succeed, the
> instigator must beat a Difficulty equal to the total value of the reaction roll.

## What it does

| | Off (default) | On |
|---|---|---|
| Weapon attack on another PC's token (`combatActions.attack`) | COMBAT_TARGET_INVALID (today) | The roll against the defender's Evasion |
| `combatActionsReads.targets` | Enemies only (today) | Enemies and the other PCs the character sees |
| HUD attack picker (`hud/pick-attack`) | Enemy rows (today) | Enemy and PC rows (`conflictRows`) |
| `combatActions.contest` (GM, co-GM) | MECHANIC_DISABLED | The Contest below |

### The attack

- `checkAttackTargets` (convex/lib/combatActions.ts) is `checkTargets` plus PC tokens while the rule is on: the token must
  be seen with a clear line like any target (M1 respected), not the attacker's own token, a PC of the campaign. Its
  Evasion is `pcCombatant(...).evasion` (the sheet's derived Evasion with its effects, the number an adversary attack
  uses). `checkTargets` itself is unchanged (still refuses PC tokens), so `combatRequests.sanction` is unchanged.
- `resolveAttack` takes them as `pcTargets` (`AttackRequest.pcTargets`): the same machinery a rider-added PC uses
  (Surrounded, dcm-bxp.99.19.44). One Duality roll: Hope, Stress, the GM's Fear, countdowns, the spotlight (S1 / S2:
  a miss is a failed action roll) as for any attack. Hit = total ≥ Evasion (+ M3 dim-light Difficulty, OE), a critical
  always hits. One damage roll; the public row reads "Bryn: Hit" / "Bryn: Miss", the GM row the Evasion on a miss.
- A hit opens the defender's incoming-hit window (`openIncomingHit`) in the attack's group: armor (A1 / the Armor Slot
  prompt), reactions, D2 / D4 / D5 / Massive Damage as the campaign's modes say (RC2). The attacker is
  `{ kind: "pc", cardId: <weapon id>, feature: <weapon name> }`; the hit carries the attack's total, which the window
  stores (`ownAttack`), so an Evasion reaction compares against it and the attack counts as succeeded for Rogue's Dodge
  (`attackSucceeded`), as for an adversary's attack. Card damage on an ally (AA2b) and rider-added PCs stay without a
  total, as before.
- C1 (CB p.102) "just like an adversary": a Vulnerable defender gives the roll an advantage die, a Hidden / Cloaked one a
  disadvantage die (`conflictEdge`); Manual posts the GM note instead. Only when the attack names no adversary and every
  named PC gives the same edge.
- No encounter is needed (the book's conflicts happen anywhere on the live map). An attack on PCs only belongs to no
  encounter: its incoming-hit, held after-roll and rider-pick rows carry no `encounterId`.
- Held attacks (an after-roll feature, SD5) keep the PC targets in `targetTokenIds` and check them again on the answer
  (`combatActions.afterRoll`).

### The Contest (`combatActions.contest`)

- Keyed GM mutation (the GM and co-GMs; players FORBIDDEN): `instigator` and `target`, each `{ characterId, trait,
  modifier }`. The server rolls the target's reaction roll first, then the instigator's action roll with the reaction
  total as its Difficulty. Both are ordinary dice-box rolls (`duality` in convex/lib/rolls.ts), each its own undoable
  public row: the action roll gains Hope / Fear / clears Stress on a critical, ticks countdowns and moves the spotlight;
  the reaction roll gains nothing (CB p.99). Returns `{ difficulty, success, reaction, action }`.
- Refusals: MECHANIC_DISABLED (rule off), INVALID (one character on both sides), NOT_FOUND (another campaign's
  character), the roll's own refusals (a character who can't act).

## Interpretations (each reversible)

1. "Beat a Difficulty" is read as the core rule for Difficulties: the total meets or exceeds it (CB p.95, Step 4: "If
   your total meets or exceeds the Difficulty, the action succeeds"). See Questions 1.
2. The Contest is rolled by the server in one GM step with a typed modifier per side; the players don't pick
   Experiences or advantage for it. See Questions 2.
3. An attack that names a PC never waits for the GM's range sanction: a PC out of the weapon's range (or any other target
   or rider-added target out of range in the same attack) is refused with COMBAT_TARGET_OUT_OF_RANGE. The sanction's
   approval (`convex/combatRequests.ts`, outside OP's files) re-checks adversary targets only.
4. "Non-attack conflicts" other than the Contest stay at the table (the book: "A roll might not be necessary").

## Code

- `convex/lib/combatActions.ts`: `checkAttackTargets` (+ private `checkAll`, `isPcToken`), `PcTarget.rider?` /
  `check?`, `AttackRequest.pcTargets`, `conflictEdge`, `targetHints` lists PCs while on, `resolveAttack` with no
  adversary target (`encounterId` optional throughout), the weapon's hit with `attackTotal`.
- `convex/combatActions.ts`: `attack` and `afterRoll` use `checkAttackTargets`; the out-of-range refusal for PC
  targets; `contest`.
- `convex/lib/incomingHits.ts`: `ownAttack` stores a PC weapon attack's total; `attackSucceeded` counts it.
- `src/components/combat-map/hud/pick-attack/`: `conflictRows` (model.ts), `AttackInput.conflictRows`, the rule's side
  `any` with those rows; `use-attack.tsx` reads `ruleSettings.get`.
- Tests: `tests/convex/rules-pc-conflict.test.ts`, `tests/convex/authz/rules-pc-conflict.entries.ts` (+ `.test.ts`).

## Not done (outside OP's files)

1. **GM Contest button**: no UI calls `combatActions.contest` yet. It needs a GM control (two PC pickers, a trait and a
   modifier each), e.g. in the GM's HUD dock or the Party panel, shown only while `ruleSettings.get` has `pcConflict`.
2. **Classic map attack bar** (`src/components/combat-map/actions/attack/**`): still lists enemies only; with the rule
   on it could list the PC hints `combatActionsReads.targets` now returns.
3. **Range sanction for PC targets**: `convex/combatRequests.ts` `sanction` calls `checkTargets`; switching it to
   `checkAttackTargets` (and passing `pcTargets`) would let an out-of-range attack on a PC wait for the GM like any other.
4. **`openAfterRoll`** (`convex/lib/combatRequests.ts`) requires an `encounterId`; an attack on PCs only inserts its held
   row directly. Widening `Where` there would remove that branch.
5. **Card and feature attacks on PCs** (`convex/combatCards.ts`, `convex/lib/cardRunner.ts`, `featureRunner.ts`): card
   targeting keeps its own sides (card damage on allies already opens the window, AA2b).
6. **docs/data-model.md**: `incomingHit.attackTotal` is now also stored for a PC attacker (OP).

## Questions

1. "Beat": CB p.168 "the instigator must beat a Difficulty equal to the total value of the reaction roll." (a) meets or
   beats (the core Difficulty rule, built); (b) strictly higher (a tie fails).
2. Contest flow: (a) the GM rolls both sides in one step with a typed modifier each (built); (b) a request each player
   answers from their own dice box (Experiences, advantage, Help), the reaction first; it needs a new `combatRequests`
   kind (validators outside OP's files).
