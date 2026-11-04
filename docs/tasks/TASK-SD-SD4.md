# TASK SD4: Feature reactions in the reaction window, before-roll prompts and after-hit autos

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD4 (wave 4; depends on SD3 and the FE-* tables). Bead `dcm-bxp.99.19`.
Status: Review.

When an adversary attacks or hits a PC, the target and their allies are offered every ready feature reaction (armor
extras, damage reduction, redirects, rerolls) next to their reaction cards; PCs holding a before-roll defence answer
before the roll (Q2); after-hit features run or are offered; all inside the existing window and the action's undo group.

## User answers implemented

- **Q2 (a)** before-roll prompt: an adversary attack on PCs is held, unrolled, in a `combatRequests` row of kind
  `preRoll` (SD0's validator) when a PC holds a ready, affordable before-roll defence (a `reaction` use whose trigger is
  `whenAttacked {stage: targeted}` or `whenCreatureAttacked {stage: targeted}` that fits one of the targets: Harrowing
  Invocation, Draining Bane, Keen Defenses). Only those PCs see "Before the roll: Bandit attacks Mira" with Use / Pass;
  nothing waits for anyone else. The last answer, or the GM's Resolve now (combat-actions Q17), replays the attack in
  the same action group. After-roll answers (Wings, Natural Evasion, Danger Sense, Not This Time) join the reaction
  window; a changed roll can turn the hit into a miss.
- **Q3 (a)** Not This Time is offered in the window of any adversary hit on any PC when the attacker is within Far of the
  wizard (unknown band without a map: offered, combat-actions Q18). "The attack roll": the server rerolls it (seeded, the
  new result stands, CB p.107) and compares it with the target's Evasion; "the damage roll": the standard attack's
  damage is rolled again. The wizard sees no numbers; the hit PC sees their own new damage (Q14).
- **Q6 (a)** halving answers (Increased Fortitude, Damage Sink) round up: SD1's runner folds `ceil(amount / 2)`.
- **CB p.107** ("the player controlling the effects … can apply the effects in any order"): the hit PC may answer armor
  first and then a feature that fits the hit as the slot left it (Thick Skin on a Major hit the slot made Minor), or the
  feature first. Eligibility is re-read after every answer from the hit as the answers so far left it.
- **combat-actions Q13 / Q14 / Q17 / Q18 / U1 / U4**: unchanged rules, now for features: players see that they were hit
  and the hit PC their own damage and severity, never the roll; the window closes when everyone answered or on Resolve
  now; every write is in the action's actionLog group, so the GM's undo restores sheets (Hope, Stress, Armor, Favor,
  held dice, feature limits) and the instance (its HP / Stress / tags).

## What changed

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/window.ts` | `WindowPc` carries the actor and its features; `Responder.featureIds`; `HitChoice` `feature`; `eligibleFeatures` / `featureReady` (a dry run of SD1's `runFeature`: limit, costs incl. Favor / Focus / held dice, NV7 requirements); `whenCreatureAttacked` (rolled / succeeded) in `triggerFits`; `preRollFits` (Q2); `progress` and `featureAnswers` (what fits now); `awaiting` keeps the target after armor while a severity-gated feature fits; new folds `hpMarked` (NV4), `rerollAttack` / `rerollDamage` and their server-rolled `attackRoll` / `damageRoll`; halving folds as `reduceDamage`; `resolveWindow` applies them in order; `runReactionFeature`; `afterHitFeatures` (`whenYouMarkHp.sourceWithin`, `whenYouTakeDamage`, `wouldMarkStress`); `respond(..., {replay})`. |
| `convex/lib/adversaryHits.ts` | `featureActor`, `answeringFeatures` (owned + FE-* entry + upgrades), `attackerBandsOnMap`, the window's PCs with features, feature answers replayed for their folds (`featureReplayActor`, spent Prayer Dice kept as the `spentDice` choice), the attack roll read from the action's GM row (`attackRollOf`), `resolveRerolls`. |
| `convex/lib/incomingHits.ts` | feature answers in `respondToHit` (paid with `actorSheetAfter`, attacker writes with `adversaryBefore`), after-hit feature autos and offers in `resolveIncomingHit`, feature answers in `respondAfterHit` (Brave Face's Stress → Hope), `hitView.features` / `armorAnswered`, `featureView`. Feature ids ride in the stored `cardIds` lists (told apart by their `<source>:` prefix; the validators are SD5's and unchanged). |
| `convex/lib/adversaryActions.ts` | `holdForPreRoll`, `respondPreRoll`, `replayHeld` (Replay: disadvantage, +Evasion by PC, Harrowing's Stress on a failed roll), Drained (a `Drained` tag: d12 attack dice until a failed roll). |
| `convex/adversaryActions.ts` | `respond` accepts `{kind: "feature", featureId, useId?, choices}` (SD0's stored shape) and answers `preRoll` rows; `pending` lists before-roll prompts and feature views; `windows` lists held attacks (`preRoll: true`); `resolve` rolls a held attack; `attack` / `useFeature` return `held`. |
| `src/components/combat-map/actions/reactions/*` | Feature items (name, text, counts, picks, optional steps, situations, Use), the before-roll mode (Use / Pass), the after-armor mode (Use / Done), optimistic updates. |
| `tests/unit/feature-window.test.ts`, `tests/convex/feature-reactions.test.ts`, `tests/e2e/combat-feature-reactions.spec.ts` | Book-derived checks (below). |

No schema or validator change; no new public function. `respond`, `pending`, `windows`, `resolve`, `attack` and
`useFeature` keep their authz-matrix entries (the matrix allows one entry per function); the before-roll role rows
(another player FORBIDDEN, a stranger refused, the GM answers for the PC) are in `tests/convex/feature-reactions.test.ts`.

## Features covered (acceptance list)

Reaction window: Iron Will, Partners-in-Arms, Loyal Protector, Revenge, Scales, Thick Skin, Increased Fortitude, Damage
Sink, Dark Aegis, Prayer Dice (reduce incoming damage), Not This Time, Danger Sense, Wings, Natural Evasion. Before the
roll: Harrowing Invocation, Draining Bane, Keen Defenses. After the hit: Unshakable (auto), Elemental Incarnation Fire
(auto, while Channeling Fire), Not Done Yet, Deadly Vengeance, Eye for an Eye, Brave Face (offers).

## Tests

- Unit (`tests/unit/feature-window.test.ts`, the real FE-* entries): Iron Will 16 Severe → two slots → Minor 1 HP; not on
  magic damage; Increased Fortitude 15 → 8 (Major 2 HP), refused with 2 Hope; Thick Skin after the slot (Major → Minor →
  0 HP) or Done; Scales; Dark Aegis with / without a Favor; Partners-in-Arms at Very Close (not Close); Loyal Protector
  only at ≤ 2 unmarked HP, redirect; Wings only while flying, +2 Evasion makes 11 a miss; Not This Time within / beyond
  Far, the rerolled 7 misses; Prayer Dice 3 + 4 off 9; `preRollFits` for Harrowing and Keen Defenses; after-hit offers and
  autos (Not Done Yet, Eye for an Eye, Deadly Vengeance, Unshakable, Brave Face, Fire).
- Convex (`tests/convex/feature-reactions.test.ts`): Iron Will end to end; NOT_A_RESPONDER for an unheld feature;
  Increased Fortitude 17 → 9 and undo; Thick Skin after armor; Revenge marks the Bear's HP and undo restores it;
  Partners-in-Arms (no numbers in the ally's view); Not Done Yet after Severe; the held attack (the other player sees
  nothing, no roll in the view, GM `windows`); Harrowing Invocation with server d20s 15 and 2: disadvantage keeps 2, a miss,
  the Bear marks a Stress, undo gives back the Favor and the Stress; Pass with a 15 hits; Resolve now; no prompt without
  a Favor; roles on a held attack.
- e2e (`tests/e2e/combat-feature-reactions.spec.ts`): a Guardian's Iron Will and two slots; a dwarf's Increased
  Fortitude at 390 px (the damage shown halves, rounded up); the GM's undo restores both; a level-2 warlock's Harrowing
  Invocation before the Cutpurse's roll (Favor spent, the attack rolls, undo returns the Favor). Axe and 44 px targets on
  each prompt; shots in `test-results/visual/SD-SD4/`.

**Deviation (e2e):** the e2e server rolls fair dice and has no dice rail, so the e2e can't force "a hit turned into a
miss"; it checks the before-roll flow and that the outcome matches (a miss opens no hit prompt). The forced miss
(15 → 2 with disadvantage) is the convex test, with the server's d20s set.

## QUESTIONS

1. **Harrowing Invocation's "fails the roll" with several targets.** HF p.14: "When an adversary targets you or an ally
   within Very Close range with an attack, you can spend a Favor to give them disadvantage on the roll. If the adversary
   fails the roll, they must also mark a Stress." One roll is compared with every target's Evasion (CB p.96). Built: the
   adversary marks the Stress when the roll fails against every PC the invocation covered (the targets within Very
   Close of the warlock, or the warlock). Should a failure against any one of them count?
2. **Drained's end.** HF p.14: "While Drained, the target uses a d12 instead of a d20 for attack rolls (including for
   advantage or disadvantage) until they fail a roll." Built: a `Drained` tag on the instance; its attack rolls use d12s;
   it ends when one of its attack rolls misses every target. Adversary reaction rolls made in the tracker are not
   watched. Should a failed reaction roll end it too, and should "fail" mean missing any target?
3. **Forced rerolls (Not This Time, CB p.50; Danger Sense, CB p.63).** CB p.107: "When a feature allows you to reroll a
   die, you always take the new result." Built: the attack is rerolled with the same advantage / disadvantage; a natural
   20 on the reroll still hits, but a reroll does not add (or remove) critical damage. The damage reroll is automated for
   the standard attack only (a feature attack's damage reroll is a GM line). Is that the intended reading?
4. **Halving and resistance order (Increased Fortitude, Damage Sink).** CB p.107: "When a feature refers to incoming
   damage, it's describing the damage amount a target is currently receiving." Built: the halving applies to the damage
   before the PC's own resistance (as reductions do today, `damageBeforeArmor`). Should it apply after resistance?
5. **One answer per ally.** combat-actions Q17 lets an ally answer once (a card or Pass). Built: one answer per ally,
   card or feature (a Guardian picks Partners-in-Arms or I Am Your Shield, not both). CB p.107 allows several effects
   if all resolve. Should an ally be able to answer with more than one?
6. **After armor.** Built: once the hit PC answered armor, only features whose trigger names a severity (Thick Skin,
   Scales) are still offered; Iron Will, halving and rerolls must come first. Is that the reading of CB p.107's "any
   order" the user wants?
7. **Unshakable (CB p.59): "When you would mark a Stress, roll a d6. On a result of 6, don't mark it."** The FE table
   makes the 6 a manual line (no step un-marks a Stress), so the hit's Stress is marked and the line tells the table.
   Brave Face (HF p.32) is offered after the hit for Stress the hit made them mark (riders, conversions) and removes it
   for a Hope.

## Follow-ups (not in SD4's owns)

- `src/lib/domain/feature-effects/run.ts` `actorExtras` reads `classState.favor` only when set, while D5's `favorOf`
  reads an unset Favor as 3 (HF p.14): a warlock who never had a session start can't pay a Favor on the map (SD1).
- `src/components/adversaries/tracker/actions/windows.tsx` shows a held attack (`preRoll: true`) as "hit Mira: 0
  physical damage"; it should say "attacks Mira, before the roll". The tracker's action result (`held`) shows the
  waiting line as a manual prompt.
- The adversary's roll record keeps `sides: 20` for a Drained attacker's d12s (`rollD20` in card-effects/run.ts).
- A held attack keeps only `heldAttackValidator`'s fields, so a feature attack with picks, options, situations,
  splits or a trigger is not held (no before-roll prompt). Widening the validator is SD5's file.
- A feature answer's effect on a PC attacker (Revenge against a card's hit) is a GM line, not written.
