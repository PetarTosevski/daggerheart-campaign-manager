# TASK LN-C3: Cloaked follow-ups (Charge ends Cloaked, unconscious / dead drops it, dusk is dim)

Plan `.omc/plans/lanes.yaml`, tracer C3. Beads: dcm-bxp.99.19.59, dcm-bxp.99.19.62 items (2) and (3). Item (1) of .62
(the GM enters a Difficulty for an enemy without one) is tracer B2's and is not built here.

Status: Review (implemented and tested on branch `lane-c3`).

## Built

- `convex/lib/combatMovement.ts`
  - `uncloakAfterMove(ctx, campaign, map, token, actorId, options?)` takes `UncloakOptions`:
    - `groupId`: the Cloaked rows (the clear-light `feature` row, or DA18's roll row and GM row) join that actionLog
      group, so one undo reverts the use, its move and Cloaked together (dcm-bxp.99.19.59). Without it they form their
      own group, as before.
    - `byGm`: the GM moved the token. Unless the GM owns the character, that drag is not the rogue's move: no roll, no
      outright end, Cloaked stays (.62 (2)).
  - An unconscious or dead Cloaked rogue whose token moves drops Cloaked (public, undoable `feature` row "<name> is
    unconscious / dead and no longer Cloaked"), whoever moved it and whatever sees it, Vanishing Act's Cloaked too
    (.62 (2)).
  - `enemySight`: in a dim time phase (R8: Nautical Twilight, Nightfall; `lightOf(phase) === "dim"`) a sighting the
    vision engine reads as clear is read as dim, so Cloaked asks for DA18's Finesse roll instead of ending (.62 (3)).
    `enemySees` / `inSightOfAdversary` (clear only) follow.
  - `cloakRoll` takes the group id; its "can't act" guard is now away only (unconscious / dead dropped Cloaked first).
- `convex/combatTokens.ts` `move`: passes `byGm: atLeast(ctx.permission, "owner")`; doc comment.
- `convex/featurePrompts.ts` `charge`: after a successful Charge moved the token, calls `uncloakAfterMove` with the use
  row's `groupId` (the Firbolg's own move, whoever clicked: no `byGm`).
- Tests: `tests/convex/feature-prompts.test.ts` (Charge by day ends Cloaked, its row is in the use's group, undo of the
  use restores Cloaked and the square; a failed Charge keeps Cloaked); `tests/convex/cloaked-move.test.ts` C3 block
  (Nautical Twilight: Finesse roll, success keeps Cloaked; Nightfall: failure ends it, no outright end; unconscious rogue
  dragged by the GM drops Cloaked, undo restores; dead rogue drops it; GM drag of a conscious rogue in clear and in dim
  sight keeps Cloaked with no row).

## Decisions

- "Witherwild dusk and dawn" read as R8's two dim phases (`DIM_PHASES` in src/lib/domain/combat-map/light.ts:
  Nautical Twilight and Nightfall). Dawn and Nautical Dawn stay day (R8 board fix), so Cloaked still ends outright there.
- In a dim phase every sighting is dim, even next to a torch: R9's light reach applies at night only.
- "A GM drag of a conscious rogue is not the rogue's move" applied to clear light too (no outright end), since the reason
  given covers both. The GM's own character moved by the GM is its own move.
- The unconscious / dead drop is lazy (on the token's next move): the places where a character becomes unconscious or
  dead (convex/deathMoves.ts, the GM's condition toggle in convex/characters.ts) are outside C3's owns. Filed
  dcm-bxp.99.19.63 (label lane:w0-n2-characters) to drop it there.

## Rules quoted

- CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
  longer Cloaked."
- CB p.59 (Firbolg, Charge): "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range
  with one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
- User 2026-10-30 (dcm-bxp.99.19.62): "(2) a rogue who is unconscious or dead drops Cloaked (a GM drag of a conscious
  rogue stays: no roll); (3) Witherwild dusk and dawn count as dim light, so being seen then asks for the Finesse roll
  instead of ending Cloaked."

## QUESTIONS (built as stated; please confirm)

1. **Dawn.** R8 makes only Nautical Twilight and Nightfall dim; "Dawn" (DAY day 1) and "Nautical Dawn" (NIGHT day 7)
   are day. Should either of them also count as dim for Cloaked?
2. **Torches at dusk.** In a dim phase a rogue standing in a torch's clear radius is still only seen dimly (roll). Should
   a light source make it clear (Cloaked ends outright) in a dim phase, as at night?
3. **GM drag in clear light.** Built: the GM's drag never ends Cloaked, not even in clear light. OK?
4. **Vanishing Act while unconscious.** Built: an unconscious or dead rogue drops Cloaked whatever its source, Vanishing
   Act's too (CB p.42: "You remain Cloaked in this way until you roll with Fear or until your next rest."). OK?
5. **Charge's Stress damage as an attack.** Charge's 1d12 to every enemy in Melee does not end Cloaked as an attack
   ("After you make an attack ..."); only its move does. Is the Stress damage an attack for Cloaked?

## Follow-ups

- dcm-bxp.99.19.63: drop Cloaked where a rogue becomes unconscious or dead (death moves, condition toggle).
