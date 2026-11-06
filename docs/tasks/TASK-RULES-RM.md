# TASK-RULES-RM: map movement and light (C2 Hidden / Cloaked, M2 walls and doors, M3 darkness Book / Manual)

Plan `.omc/plans/rule-switches.yaml`, tracer RM (epic dcm-jh6d part A). Builds on RS0 (`docs/tasks/TASK-RULES-RS0.md`:
modes through `ruleMode`, Manual notes through `postRuleNote`) and RA (the Cloaked roll calls `afterPcActionRoll`).

## Rules and modes

| Rule | Book passage | Book mode (today) | Manual mode |
|---|---|---|---|
| C2 `hiddenEnds` | CB p.102: "After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." CB p.42 (Cloaked) says the same for Cloaked. | An ordinary Cloaked ends on a move into an enemy's clear sight, a Finesse roll in dim light (DA18), on an attack outside the weapon path (Charge, card attacks) and through the GM's prompt on a non-attack use. Hidden is never ended by the app (see Questions). | Nothing ends, no Finesse roll, no Difficulty request, no prompt. One GM-only note in the action's group: "Mira moved into Bear's sight: remove Hidden?" ("in dim light" when only dimly seen), "Mira attacks with Charge: remove Cloaked?", "Mira used Words of Discord on an enemy while Cloaked: remove Cloaked?". The note names the bare Hidden and the ordinary Cloaked; a condition with its own source (Vanishing Act) is left out. |
| M2 `wallsBlock` | Not in the books. CB p.104 only says a PC may move "within Close range as part of that action". Labelled "App rule". | A player's move through a wall, a closed door or another blocker is refused (`MOVE_BLOCKED`); the GM's goes through with `blocked: true`; `difficult` flags difficult terrain. | Nothing is refused or flagged (`blocked`, `difficult` false). A player's move that went through a blocker or difficult terrain posts a GM-only note ("Mira moved through a wall or closed door: move the token back?", "Mira crossed difficult terrain: a movement roll?"). The GM's own drag posts nothing. |
| M3 `darkness` | CB p.104: "The GM should reflect this by raising the Difficulty of action rolls or imposing disadvantage". | The header pill and the player's "Your view" card show "Dim light: ranged attacks at disadvantage" in dim light; nothing is added to a roll. | No badge; the light rule line reads "Dim light: you see your whole cone." No note (nothing to apply). The variants (disadvantage, +N Difficulty, both) are tracer OE's and keep the Book badge until then. |

Interpretations (each reversible):

- An unconscious or dead rogue still drops Cloaked in Manual: that is dcm-bxp.99.19.62 (2), not C2's "seen or attacking".
- A GM's drag of another player's rogue posts no C2 note (it is not the rogue's move, as in Book).
- Notes carry no `characterId` (as in RA): a move's note gets its own group, a use's note joins the use's group.

## Code

- `src/lib/domain/combat-map/movement.ts`: `moveVerdict(check, byGm, mode = "book")`, `wallsNote`.
- `src/lib/domain/combat-map/light.ts`: `dimLightBadge(light, mode = "book")`.
- `convex/combatTokens.ts` `move`: M2 through `moveVerdict`; the note through `postRuleNote`.
- `convex/lib/combatMovement.ts`: `hiddenEndsManual`, `hiddenLabel`, the note texts; `uncloakAfterMove` and
  `uncloakAfterAttack` read C2.
- `convex/lib/cloakPrompts.ts` `openCloakPrompt`: Manual posts the note instead of the prompt.
- `src/components/combat-map/vision/header.tsx` (`LightPill`) and `panels.tsx` (`YourView`, `lightRule`): read
  `ruleSettings.get`'s `darkness` (Book until it loads).

## Not done (outside this tracer's files)

1. **C2 on weapon attacks.** `convex/lib/combatActions.ts` `resolveAttack` ends an ordinary Cloaked with
   `uncloakedByAttack` (around "Lane C2" in the file). In Manual it should keep the sheet and post
   `hiddenAttackNote(name, weaponName, label)` in the attack's group when `hiddenEndsManual(campaign)` and
   `hiddenLabel(sheet)` is not null (both exported from `convex/lib/combatMovement.ts`).
2. **M2 on Charge.** `convex/featurePrompts.ts` checks `checkMove(...).blocked && !gm` for Charge's landing square; in
   Manual it should pass (`moveVerdict(check, gm, ruleMode(campaign, "wallsBlock")).refused`).

## Tests

`tests/convex/rules-map-movement.test.ts`: the pure verdict, badge and label; C2 per mode on a move (clear sight, dim
light, Hidden, no sight, unconscious), on `uncloakAfterAttack` and on `openCloakPrompt`; M2 per mode (wall, difficult
terrain, the GM's drag); the notes' rule, visibility, group and the players' feed.
