# TASK DA-DA3: Cloaked ends on a move only when a revealed enemy can see the rogue

Plan `.omc/plans/drawer-answers.yaml`, tracer DA3 (bead dcm-bxp.99.19; closes dcm-bxp.99.19.48 (1); pin
dcm-bxp.99.19.42).

Status: Review (implemented and tested in the worktree).

## What it does

- `convex/combatTokens.ts` `move` calls `uncloakAfterMove` (convex/lib/combatMovement.ts) after the token patch, for any
  move that changes the square (a drop on the same square is not a move). The SD5 orchestrator note is done.
- `uncloakAfterMove` ends the Cloaked condition of the PC whose token ended the move on the live map when at least one
  enemy token
  1. is revealed: not an adversary with the Hidden condition, not a defeated (or missing) adversary, not a custom token
     with the Hidden condition (`unseeingEnemies`);
  2. has a clear line to the rogue's token (`lineOfSight` from combat-actions: walls and closed doors block, cover does
     not; as SD5);
  3. can see the rogue under the map's light (`enemySees`): by day and in the dim phases (R8: dim is "full vision")
     every square in line is seen; at night the rogue's square must be clear (level 2) from the enemy's eye under the
     enemy's own night vision (clear in Melee) or carried light, other tokens' carried lights (the rogue's own torch
     too), the map's lit lights and glowing terrain (R9). The enemy has no vision cone: it looks straight at the rogue
     with the widest cone, so facing never decides.
- The change is one public, undoable `feature` row ("<name> ends a move in sight of an adversary and is no longer
  Cloaked") with the sheet's `before`; undo restores Cloaked (the token stays where it moved).
- Vanishing Act's Cloaked is never ended by a move (pin dcm-bxp.99.19.42). The sheet stores Cloaked as a bare condition,
  so `cloakedByVanishingAct` reads the character's newest 20 feed rows (`by_character_at`, undone rows skipped): a
  Vanishing Act use ("<name> uses Vanishing Act", the feature runner's row) newer than the row that turned Cloaked on
  means the Cloaked is Vanishing Act's. Stop-gap, see follow-ups.
- `inSightOfAdversary(scene, at, hidden?)` keeps its SD5 call shape (the new `hidden` set is optional), so
  tests/convex/combat-riders.test.ts still compiles and passes.

## Rules quoted (printed pages)

- CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
  longer Cloaked."
- CB p.42 (Nightwalker, Vanishing Act): "Mark a Stress to become Cloaked at any time. When Cloaked from this feature, you
  automatically clear the Restrained condition if you have it. You remain Cloaked in this way until you roll with Fear or
  until your next rest."
- User 2026-10-30 (dcm-bxp.99.19.48 (1)): only a revealed (not hidden) enemy token with a clear line AND able to see the
  rogue given the map's day / dim / night and lights ends it.

## Tests

- tests/convex/cloaked-move.test.ts: by day in line -> ends, public undoable row, undo restores; at night in an enemy's
  torch light -> ends; at night on a dark square, enemy without light -> stays; the only enemy is Hidden -> stays; a wall
  between -> stays; Vanishing Act (used through `combatFeatures.useFeature`) -> stays; a drop on the same square and a
  rogue who is not Cloaked -> nothing.

## QUESTIONS (built as stated; please confirm)

1. **Dim light at night (R10).** The light check counts the rogue as seen only when its square is *clear* light for the
   enemy. A square in dim light (e.g. 2-3 squares from an enemy without a light, or 7-12 squares from a torch) does not
   end Cloaked, as R10 hides a token in dim light from a PC unless the GM reveals it. Should dim light count as seeing?
2. **"Revealed (not hidden)".** Read as: the enemy is not under the Hidden condition (CB p.102). A defeated adversary is
   also left out (it can't see). Is that the meaning, or did "revealed" mean something else (e.g. a token the players
   can see on the map)?
3. **GM fog marks (R12)** are the players' view; they do not change what an enemy sees here. OK?
4. **An enemy-side PC or companion token** counts as revealed (no Hidden check is read for it). OK?

## Follow-ups (for beads)

- Record a condition's source on the sheet (the card / feature runner: `writeSheetChanges` stores a standard condition
  with no source), so Vanishing Act's Cloaked can be told apart without reading the feed; then replace
  `cloakedByVanishingAct`. DA2 (attack ends Cloaked except Vanishing Act's) can reuse `cloakedByVanishingAct` from
  convex/lib/combatMovement.ts until then.
- Vanishing Act's own end events (a roll with Fear, the next rest: `endsOn: ["rollWithFear"]`, duration `rest`) are not
  enforced by the server for a standard condition.
