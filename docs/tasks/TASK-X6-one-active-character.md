# TASK-X6: One active character per player

Status: Review. Plan: `.omc/plans/followups.yaml`, tracer X6.

User decision (2026-10-18, verbatim): "One character per player (dead / Away characters don't count to that limit, if a player would want to create a new one he must first send his away, and if he wants his old one back he must send the new one away)". The campaign cap stays at 50 while testing.

## Rule

- `assertOneActive(ctx, campaign, owner, except?)` (`convex/characters.ts`, exported) refuses with `INVALID` ("A player has one active character at a time. Send <name> away first.") when `owner` already has another `active` character in the campaign. Dead, retired and away characters don't count. The GM's own (unassigned) characters are exempt.
- It runs on every move into `active`:
  - `characters.create` (inside `ctx.once`, through `assertRoom`, which also checks the campaign cap).
  - `characters.assignOwner`, when an active character changes hands.
  - `characters.setStatus` to `active` (revive, un-retire, bring back).
  - `deathMoves.returnFromAway`.
  - `deathMoves.undo`, when undoing the row puts the character back in play. The throw rolls the undo back.
- `MAX_CHARACTERS_PER_PLAYER` (12) is gone. `MAX_CHARACTERS_PER_CAMPAIGN` stays 50 (bead to lower it to 10 later).

## Benching

- `away.reason` is widened with `benched` (`awayValidator` in `convex/lib/validators/characters.ts`, used by the `characters` table). Stored rows still conform, so no migration is needed.
- `characters.setStatus` takes `away`, which benches the character (`away: { reason: "benched" }`). Only an active character can be benched (`INVALID` otherwise). The owner or the GM can bench. Setting `away` on a character that is already away does nothing, so a Castle High reason is never replaced.
- The owner can move their own benched character back to `active`. Only the GM can move a character out of dead or a Castle High away (`infirmary` / `sentHome`, HF 127), as before.
- Views (`get`, `listByCampaign`): `away` still carries only the two death reasons, and a benched character comes back with `benched: true` instead. This keeps the sheet's exhaustive `AWAY_REASON` map (`sheet.tsx`, not owned here) and `AWAY_REASON_LABELS` type-safe.

## UI

- `BenchButton` (`src/components/party/party-card.tsx`) shows "Send away" on an active character and "Bring back" on a benched one, to the owner and the GM (`canEdit`). It appears on the dashboard party card and on the roster card. A refusal shows in the card's status line.
- The death badge shows "Away · benched". The GM's "Return to play" is only for Castle High away characters.
- The wizard reads `listByCampaign`. When the player (or the player the GM picked) already has an active character, it shows why ("<name> is still active … Send <name> away from the Party page before creating another.") and keeps Create disabled.

## Tests

- `tests/convex/characters.test.ts`: campaign cap of 50; one active per player on create and hand-over, where dead and away characters don't count and the GM is exempt; owner and GM bench and bring back; a Castle High away character returns only through the GM and only into a free slot.
- `tests/convex/death-moves.test.ts`: undo and `returnFromAway` are refused while the player has another active character, and go through once it is benched.
- `tests/unit/party-card.test.ts`: Send away and Bring back call `setStatus`; nothing is shown for a Castle High away character or for a viewer who can't edit.
- `tests/e2e/party-roster.spec.ts`: bench, create a second character, refused bring-back, the GM benches the second, then the first comes back. `tests/e2e/character-wizard.spec.ts`: the blocked notice.

## Questions

- Retired characters don't count towards the limit (like dead ones). If they should count, add `|| c.status === "retired"` in `assertOneActive`.
- The GM is held to the rule for a player's character (for example, the GM can't revive a player's dead character while that player has another active one). The GM's own characters are exempt.
- The generic `actionLog.undo` path (`convex/lib/actionLog.ts` `undoEntry`, not owned here) still returns a dead or away character to active without the check. Only `deathMoves.undo` checks it.
