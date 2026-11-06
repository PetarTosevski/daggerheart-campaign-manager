# TASK-RULES-RC1: PC attacks and cards on the map (C1, M1, D6, damage modes, C2 on weapon attacks)

Plan `.omc/plans/rule-switches.yaml`, tracer RC1. Built on RS0 (`ruleModesOf`, `postRuleNote`), RDM (pure damage
functions take `DamageRules`) and RA. Every Manual note is a GM-only `rule` row in the action's `groupId` (undoing the
attack or card use undoes it), without `characterId`.

## Rules and behaviour

| Rule | Book passage | Book (unchanged) | Manual / variant |
|---|---|---|---|
| C1 `conditionDice` | CB p.102 "While Hidden, any rolls against you have disadvantage" / "While you are Vulnerable, all rolls targeting you have advantage" | A weapon attack on a Vulnerable target gets an advantage die, on a Hidden / Cloaked one a disadvantage die (`conditionEdge`) | No die; notes "Bandit is Vulnerable: add advantage?", "Bandit is Hidden: disadvantage?" (`conditionNotes`) |
| M1 `lineOfSight` | CB p.104 "attack rolls against you are made with disadvantage … You have line of sight if you can see the target" | A target the attacker doesn't see or has no line to: COMBAT_NO_LINE_OF_SIGHT; cover adds one disadvantage | Nothing refused or added (weapon attack, rider-added targets, the sanction's pre-check through `coverApplies`); notes "No line of sight to the Lurker", "Bandit is behind cover: disadvantage?" (`sightRule`). An unseen token that isn't a valid target still answers COMBAT_NO_LINE_OF_SIGHT. The map and `targets` hints still show sight and cover |
| D6 `minions` | CB p.201 "For every X damage a PC deals to this adversary, defeat an additional Minion within range the attack would succeed against" | The attacker's Minion offer (`pickMinions`) | `gmPicks` (not in the books, Q5 a): the offer is stored with `picker: "gm"`; the result carries `minionsForGm` (count) instead of `minionOffer`; `pickMinions` refuses a player (FORBIDDEN); the GM's HUD shows the offer with the same panel, the player sees "The GM picks them". Manual: no offer, only the hit Minion fell; note "Ash's 8 damage: defeat 8 more Minions? (in range: Rats, More rats)" |
| D2 `resistance` | CB p.99 | Halved | Full damage; note "Bandit resists: halve? (17 taken in full; halved: 9)" (immune: "… is immune: no damage?") |
| D8 `adversaryDefeated` | CB p.208 | Defeated at the last HP | Stays up (public row "Hit"); note "Bandit marked its last HP: defeated?" (weapon hit, riders, Death Strike pick, card use and its post riders). A Minion group still falls with its last Minion (D6) |
| Massive Damage | CB p.91 | Off | On: an adversary hit by a PC's weapon at twice its Severe threshold marks 4 HP; GM row "Severe (Massive)" |
| C2 `hiddenEnds` (orchestrator) | CB p.42, p.102 | An ordinary Cloaked ends on a weapon attack | The sheet keeps it; note "Mira attacks with Longsword: remove Cloaked?" (`hiddenAttackNote`) |

## Code

- `src/lib/domain/combat-actions/sight.ts`: `sightRule(name, sight, mode, seen)`.
- `src/lib/domain/combat-actions/damage.ts`: `minionPicker`, `minionNote`, `damageRuleNotes`.
- `convex/lib/combatActions.ts`: `conditionEdge` / `targetEdge` / `targetsEdge` take the C1 mode; `conditionNotes`;
  `checkTargets` / `addedTargets` read M1 (`CheckedTarget.unseen`); `coverApplies`; `resolveAttack` passes
  `ruleModesOf(campaign)` to `applyDamageTo` and `instanceWrites`, collects the notes and posts them after the GM row;
  `dealMinions` (shared with cards).
- `convex/lib/cardRows.ts`: `instanceWrites(..., lookup, rules)` (D8), `lastHpNotes`, `resistanceNotes`,
  `resolvedCardValidator.minionsForGm`.
- `convex/combatCards.ts`: modes into `instanceWrites`, D2 / D8 notes, `dealMinions`.
- `convex/combatActions.ts`: `pickMinions` refuses a player on a GM-picked offer; the sanction pre-check uses `coverApplies`.
- `convex/lib/validators/combatRequests.ts`: `minionOffer.picker?` (widened).
- `src/components/combat-map/hud/pick-attack/prompts.tsx`: GM Minion offers under `gmPicks`; the player's waiting card.

## Not done (outside RC1's files)

1. **Card damage modes (D2, D4, Massive)**: the card engine (`src/lib/domain/card-effects/run.ts`) calls
   `applyDamageTo` / `applyStressTo` / `applyHpTo` without rules. Needs `RunContext.damageRules` (as RA2's `hopeFear`)
   set by `buildRun` (`convex/lib/cardRunner.ts`) to `ruleModesOf(campaign)`. `resistanceNotes` already posts the D2 note
   once the plan carries `resistanceApplied: false`. D4 on cards and riders (weapon-attack riders run through the same
   engine) is not noted: in Book the engine's `overflow` means HP was marked, so a note can't be told apart until the
   engine has the mode.
2. **M1 on cards and features**: the refusal and the cover disadvantage are in `convex/lib/cardRunner.ts` (target
   resolution, `cover`). Manual still refuses there.
3. **C1 on cards**: card rolls never apply the Vulnerable / Hidden die, in either mode (no `conditionEdge` in the card
   path).
4. **M1 in the picker**: `src/components/combat-map/hud/pick/model.ts` marks a target without line of sight as `los`
   (not pickable). Under Manual the server accepts it, but the HUD picker doesn't let the player pick it.
5. **Player result text**: `hud/result/model.ts` shows "pick them in the prompt" only for `minionOffer`; `minionsForGm`
   could show "The GM picks N more Minions".
6. Feature uses (`convex/lib/featureRunner.ts`, `instanceWrites` without modes) and areas (`convex/lib/combatAreas.ts`)
   keep D8 Book.

## Tests

`tests/convex/rules-pc-attacks.test.ts`: the pure helpers; C1, M1, D6 (Book / gmPicks / Manual), D2, D8, Massive on a
weapon attack; D8 and D6 on a card; C2 on a weapon attack; every roll's dice within their sides.
