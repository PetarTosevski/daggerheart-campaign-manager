# TASK-RULES-RFC: the card and feature engine follows the damage, sight, condition and defeat modes

Plan `.omc/plans/rule-switches.yaml`, tracer RFC (bead dcm-jh6d.70). Finishes RC1's "Not done" list
(`docs/tasks/TASK-RULES-RC1.md`) on the card path, built like RA2's `RunContext.hopeFear`. Modes come from
`ruleModesOf(campaign)`; Manual notes are GM-only `rule` rows posted with `postRuleNote`.

## Rules and behaviour

| Rule | Book passage | Book (unchanged unless said) | Manual / on |
|---|---|---|---|
| D2 `resistance` | CB p.99 "they halve damage of that type before comparing it to their damage thresholds" | Halved (round up) | Full damage (`resistanceApplied: false` on the plan's `damage` step); "Bandit resists: halve? (9 taken in full; halved: 5)" |
| D4 `stressOverflow` | CB p.92 "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1 Hit Point" | 1 HP | Extra Stress dropped, no HP (the `mark` step keeps `overflow: true`, `hpMarked: 0`); "Bandit: Stress full, mark 1 HP?" |
| Massive Damage | CB p.91 "If you ever take damage equal to double your Severe threshold, you mark 4 Hit Points" | Off | On: 4 HP on an adversary at twice its Severe threshold |
| D8 `adversaryDefeated` | CB p.208 "When an adversary marks their last Hit Point, they are defeated" | Defeated | Feature uses and area-triggered uses leave it up; "Bandit marked its last HP: defeated?" (cards: RC1) |
| M1 `lineOfSight` | CB p.104 "attack rolls against you are made with disadvantage … You have line of sight if you can see the target" | No line of sight / unseen: COMBAT_NO_LINE_OF_SIGHT; cover: one disadvantage | Nothing refused or added for a named enemy; "No line of sight to the Lurker" (any named enemy: targets, picked, follow-up, chain links), "Bandit is behind cover: disadvantage?" (a target of a use that rolls). An unseen token that isn't a valid enemy still answers COMBAT_NO_LINE_OF_SIGHT. "All targets in range" still takes only enemies with a clear line |
| C1 `conditionDice` | CB p.102 "While Hidden, any rolls against you have disadvantage" / "While you are Vulnerable, all rolls targeting you have advantage"; Cloaked CB p.42 | **New (user 2026-11-06: card attack rolls get the dice like weapons)**: a card or feature attack roll (`roll.kind` attack, or Difficulty `target`) gets an advantage die when the target is Vulnerable, a disadvantage die when it is Hidden / Cloaked; with several targets only what every target gives (as `targetsEdge`). Conditions: the instance's (or PC sheet's), its tags, and the areas it stands in or behind | No die; "Bandit is Vulnerable: add advantage?", "Bandit is Hidden: disadvantage?" |

The HUD:

- `hud/pick/model.ts` `buildRows({ sightMode })`: under M1 Manual (`ruleSettings.get`, read in `hud/pick/scene.ts`; Book
  until loaded) a target the server's hint marks without line of sight keeps its range reach (`in` / `out`), carries
  `noLineOfSight` and can be picked; its label says "no line of sight: the GM decides".
- `hud/result/model.ts` `minionNotes`: a card's or weapon attack's result says "The GM picks N more Minions." when
  `minionsForGm` is set (D6 `gmPicks`).

## Code

| Piece | File |
|---|---|
| `RunContext.damageRules` into `applyDamageTo` / `applyStressTo` / `applyHpTo` | `src/lib/domain/card-effects/run.ts` |
| `conditionDice`, `targetsConditionDice`, `conditionDiceNotes`, `stressOverflowNotes`, `UseRuleNote` | `src/lib/domain/card-effects/rule-notes.ts` |
| `buildRun`: modes, `Creatures(…, sightMode)` (`EnemyCreature.unseen`), cover through `sightRule`, the C1 dice, `BuiltRun.ruleNotes`; `ruleNotesOfUse(built, plan)` (M1, C1, D4) | `convex/lib/cardRunner.ts` |
| Feature uses: `instanceWrites` with the modes; posts D2, D8, M1, C1, D4 in the use's group | `convex/lib/featureRunner.ts` |
| Area-triggered uses: `instanceWrites` with the modes; posts the same notes without a group (the move's rows are not undoable) | `convex/lib/combatAreas.ts` |

C1's helpers repeat `conditionEdge` / `conditionNotes` of `convex/lib/combatActions.ts` in the domain: cardRunner can't
import combatActions (combatActions imports cardRunner).

## Not done (outside RFC's files)

1. **Card uses don't post the M1 / C1 / D4 notes.** `convex/combatCards.ts` already posts D2 (`resistanceNotes`, which
   now fires) and D8. It needs, next to them (and in the card-sanction path that runs `resolveCard`):
   `for (const n of ruleNotesOfUse(built, plan)) await postRuleNote(ctx, campaign, { ruleId: n.ruleId, summary: n.summary, groupId, actorId });`
   The behaviour (no refusal, no die, no HP) already holds on cards.
2. Other `buildRun` callers that write their own rows (`convex/lib/allyPicks.ts`, `convex/featurePrompts.ts`, the riders
   in `convex/lib/combatActions.ts` / `convex/combatCards.ts`) run with the modes but post no RFC notes and call
   `instanceWrites` without them.
3. A target's own passive (`disadvantageAgainst`, Wind Lord) and `attackedRider` advantage are still weapon-only.

## Tests

`tests/convex/rules-card-modes.test.ts` (D2, D4, Massive, D8, M1, C1 on a card and a feature, Book and Manual; the
dice of every roll within their sides); `tests/unit/card-effects/rule-modes.test.tsx` (the engine with `damageRules`,
the C1 / D4 helpers, the picker under M1, the Minion result line).
