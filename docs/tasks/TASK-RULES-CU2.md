# TASK-RULES-CU2: undo of a roll puts the spotlight back; ally picks offer Neither; the actor unticks allies

Plan `.omc/plans/rule-switches.yaml`, tracer CU2 (beads dcm-bxp.99.32.10, dcm-bxp.99.32.46). Builds on RA / RA2 (S1 moves
the spotlight to the GM on a PC action roll, `docs/tasks/TASK-RULES-RA.md`), RS2 (players wait) and FH-AP (per-ally
picks, `docs/tasks/TASK-FH-AP.md`).

## 1. Undo puts the spotlight back (dcm-bxp.99.32.10)

CB p.100: "The player characters pass the spotlight between themselves, making moves until someone fails a roll or rolls
with Fear". A Book move (`convex/lib/rollAftermath.ts` `applyPcActionRoll` → `moveToGm`) now stores the spotlight row as
it stood before (null: the whole party) and the moved row's `since` on a row of the roll's action: `actionLog` field
`spotlightBefore` (widened, typed, `convex/lib/validators/actionLog.ts`). The row is the group's first non-note row, or for
a plain roll (no group) the roller's newest row, the roll row just logged. A plain Book roll stays ungrouped.

`undoEntry` (`convex/lib/actionLog.ts` `restoreSpotlight`) puts the row before back, exactly as it stood (its holder,
`since` and reason; a PC no longer in the campaign: the whole party), but only while the GM's hold is still the one the
roll began:

- the GM holds it, its `since` is the move's, its reason is still `rollWithFear` / `failedRoll`, no adversary is lit;
- and the GM made no adversary move since (no live GM `adversary` row since the move, outside the undone group; at most
  50 rows read).

Decision (the bead left it open; reversible): when the GM has acted since (spotlighted an adversary, an adversary acted,
or the GM handed it on), the spotlight stays where it is. The GM's turn has begun and
undoing the roll doesn't undo it; the GM hands it back by hand (`combatSpotlight.handTo`). Only the GM undoes rolls, so
the GM always knows. A restore counts no session spotlight (it is not a new one). Manual S1 moves nothing, so nothing is
stored.

The restore writes `combatSpotlight` in `actionLog.ts`, not through `convex/lib/spotlight.ts`, because spotlight.ts imports
actionLog.ts (no new import cycle).

## 2. Per-ally picks: Neither, and the actor's review (dcm-bxp.99.32.46, user 2026-11-06)

- **Neither.** Rousing Strike (CB p.342: "you and all allies who can see or hear you can clear a Hit Point or 1d4 Stress")
  and Critical Inspiration (CB p.341: "all allies within Very Close range can clear a Stress or gain a Hope") offer a third
  option `neither` (no steps) to each chooser (`src/lib/srd/card-effects/valor.ts`).
- **The actor's review.** A PC rider's `allyPick` row with allies on it opens with `review: true` (widened payload,
  `convex/lib/validators/combatRequests.ts`). While it is set only the actor's player and the GM see the row
  (`allyPicksReads.open`, `review`, each chooser's `self`), and nobody answers (`allyPicks.answer`: NOT_A_RESPONDER). The
  actor unticks allies who can't see or hear them and sends: `allyPicks.send({ requestId, drop })` (keyed campaign
  mutation, rate limit `roll`; the rider's player through `loadCharacter` edit, or the GM; another player FORBIDDEN).
  Refusals: the actor's own pick or an unknown chooser INVALID, already sent (or an adversary's use) NOT_A_RESPONDER. A
  row whose use was undone or whose encounter ended is declined. Every chooser dropped: declined, the card doesn't happen
  and its once-per-rest use is not spent. A rider whose only chooser is the actor (Rousing Strike alone) skips the review.
  Adversary uses (Awesome Size, Locust Swarm, Fire) go out at once, as before.
- **Defined Ranges off** (optional rule `definedRanges`, CB p.103; user 2026-11-06: automatic range effects don't apply,
  the actor decides): the computed list is every other PC on the map (`alliesFor`), and the actor unticks.

HUD (`src/components/combat-map/hud/ally-picks/`): `ReviewCard` ("Untick allies who can't see or hear you", one checkbox
per ally, Send, optimistic `withSent`). Players get their own reviews above their picks; the GM gets every review
(a player who is away, or the GM playing for the PC) on the GM tone. The waiting line shows only after the review.

## Tests

- `tests/convex/rules-spotlight-undo.test.ts`: party and PC holder restored (plain roll, failure, weapon attack), the
  GM's later adversary spotlight / adversary row / hand-on keep it, a roll during the GM's hold stores nothing, Manual.
- `tests/convex/ally-picks.test.ts`: existing flows send the review first; Neither; review visibility and refusals;
  untick an ally; send refusals; adversary uses never wait; Critical Inspiration with Defined Ranges on / off, untick all.
- `tests/unit/hud/ally-picks.test.tsx`: the model (`reviewRows`, `reviewAllies`, `withSent`), the player's review card,
  the GM's review card.
- `tests/convex/authz/ally-picks.entries.ts`: `allyPicks.send`.

## Outside CU2's owns (merge-time)

- `convex/lib/validators/actionLog.ts`: the widened `spotlightBefore` field (needed for item 1).
- `tests/convex/authz/ally-picks.entries.ts`: the matrix entry for the new public function.
- `docs/data-model.md`: `actionLog.spotlightBefore`, the `allyPick` payload's `review`.
- Maestro (Troubadour, CB p.28, "they can gain a Hope or clear a Stress") is also a "can" choice; not changed here (its
  file is not CU2's, and `whenYouGiveDie` never fires yet).
