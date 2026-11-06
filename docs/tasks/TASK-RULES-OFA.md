# TASK-RULES-OFA: optional rule "Falling and collision damage", a GM quick button

Plan `.omc/plans/rule-switches.yaml`, tracer OFA (registry id `fallingDamage`, kind `optional`, off by default). Built on
RS0 (`ruleMode`) and RC2 (the incoming hit with the rule modes). User answer Q10 (a), 2026-11-05: "GM button in the token
menu; the app rolls and applies through the normal hit path (collision direct)."

## The book

CB p.168, "Optional GM Mechanics", FALLING AND COLLISION DAMAGE:

> If a character falls to the ground, you can use the following as a guide to determine the damage they take:
> • A fall from Very Close range deals 1d10+3 physical damage.
> • A fall from Close range deals 1d20+5 physical damage.
> • A fall from Far or Very Far range deals 1d100+15 physical damage, or death at the GM's discretion.
> If a character collides with an object or another character at a dangerous speed, they take 1d20+5 direct physical
> damage.
> You can always increase or decrease the damage dice to fit the story.

## What landed

| Piece | File |
|---|---|
| The table (`HAZARDS`: dice, flat, direct, "death at the GM's discretion"), `rollHazard`, `hazardLine` | `src/lib/domain/hazards.ts` |
| `combatHazards.fall` (keyed GM mutation `{ tokenId, kind: "veryClose" \| "close" \| "far" \| "collision" }`, returns `{ groupId, requestId, damage, resolved }`) | `convex/combatHazards.ts` |
| Hazard hits in the incoming-hit rows: log kind `combat`, public words "Ash took damage from a fall from Close range" | `convex/lib/incomingHits.ts` (`hitLogKind`, `hitWords`) |
| GM "Fall" pill on PC tokens (HUD, switch on) and the choice box | `src/components/combat-map/hud/token/fall.tsx`, `token.css`, `index.ts` |
| Tests | `tests/convex/rules-falling.test.ts`, `tests/convex/authz/rules-hazards.{entries,test}.ts` |

## Behaviour

- **Off (default):** no pill; `combatHazards.fall` refuses with `MECHANIC_DISABLED`.
- **On:** the GM hovers or focuses a PC's token on the Combat Map HUD, presses **Fall**, and picks Very Close (1d10+3),
  Close (1d20+5), Far or Very Far (1d100+15) or Collision (1d20+5 direct). The server rolls (one d100 for the long fall:
  the server's `rollDie` rolls any size), writes a GM-only row with the roll ("Ash: Fall from Close: 1d20+5 = 17
  physical"; the long fall adds ", or death at the GM's discretion"), a public row without the number ("Ash falls from
  Close range", Q14), and opens the normal incoming hit on the PC (`openIncomingHit`, attacker `{ kind: "hazard" }`):
  - the Armor Slot prompt, except the collision (direct, CB p.99: it resolves at once when nobody else can answer);
  - ally reaction cards and features as for any hit (the window's own eligibility);
  - the rule modes: A1 Manual (no slot, full severity, the GM note), Massive Damage (4 HP; one Armor Slot makes it
    Severe, 3 HP, user 2026-11-06), D2 / D4 as RC2;
  - a last HP mark makes the death move due (X1 as RX built it).
- One undo of the group (the GM row) reverts the fall and its hit. The call is keyed: a retry rolls nothing new.
- `COMBAT_TOKEN_NOT_FOUND` for a token of another campaign; `COMBAT_TARGET_INVALID` for a token that is not an active
  PC's.
- Death at the GM's discretion is the GM's call: the app names it, it never kills a PC by itself.
- "Increase or decrease the damage dice to fit the story" is not built (Q10 c was not chosen); the GM uses a free roll and
  the sheet for that.

## Outside OFA's owns (needed; for the orchestrator)

The incoming-hit row's `attacker` had only two shapes (an adversary instance, a PC's card). A fall has no creature
behind it, so the hit needed a third shape, a **widen** (rule 7: a new union member, no stored row changes):

- `convex/lib/validators/combatRequests.ts`: `hazardAttackerValidator` `{ kind: "hazard", hazard, label, feature? }`
  joins `incomingHitPayloadValidator.attacker`; type `HazardAttacker`.
- `convex/lib/adversaryHits.ts`: `isHazardAttacker`, `isAdversaryAttacker`; the helpers that read `attacker.instanceId`
  after `!isPcAttacker` now ask `isAdversaryAttacker` (gold for HP, armor cost, keyword: a hazard is known and carries
  none, mark-HP keyword, attacker token / bands / areas: none, `attackerCombatant`: null, `windowHitOf.attackerId`
  `hazard:<kind>`, the attack roll: none). Adversary and PC attackers behave exactly as before.
- `convex/adversaryActionsReads.ts`: `attackerIds` gives neither id for a hazard.
- `src/components/combat-map/tokens/tokens-layer.tsx`: mounts `FallButton` / `FallBox` (the Revive pill's pattern).

## Questions

None open. Q10 (a) is built as answered.
