# TASK-RULES-RFB: Spotlight Tracker, the user's answers (CB p.89)

Plan `.omc/plans/rule-switches.yaml`, tracer RFB (wave 11, bead dcm-bxp.134; builds on RT, docs/tasks/TASK-RULES-RT.md).
User answers 2026-11-06 (binding): PCs on the live map spend (as built), tokens refill when an encounter starts, a Tag
Team spends a token of both PCs, undoing a roll gives its token back, and the GM gets a "spend a token" button for a
significant action without a roll.

## Book passage

CB p.89, "Optional Tool: Spotlight Tracker": "when a battle begins, every player places action tokens on their character
sheets … each time they make an action roll or perform a significant action while in the spotlight, they remove 1 token
from their sheet". CB p.97, Tag Team Roll: one roll for the pair.

## What the app does (rule on; off: nothing changes)

| Answer | Behaviour | Code |
|---|---|---|
| Refill on encounter start | `encounters.start` refills every PC when the encounter starts (not when it already runs). | `convex/encounters.ts` |
| Tag Team: both spend | `tagTeamApply` runs the aftermath once; the aftermath reads the roll's group and, when it holds only the two PCs' action rolls (a Tag Team's two rolls and two results), spends one token of each (`rollersOf`). A PC at 0 or off the map spends nothing; the other still does. No change in `convex/rolls.ts`. | `convex/lib/rollAftermath.ts`, `convex/lib/actionTokens.ts` |
| Undo refunds | Every spend writes a record in the action's group: a GM-only `rule` row, `ruleId: "spotlightTracker"`, naming the PC by its live-map token in `targets` (no `characterId`, which would make it the PC's "latest row" for the Slayer choice and the Tag Team checks). A roll's record is hidden from the feed at once (`removedAt`). A plain roll gets a group for it, as for a GM note (the planned spend is in `Aftermath.notes`). `undoEntry` calls `refundTokenSpends`: one token back per record, unless the tokens were refilled since (the PC's row is gone, or was made after the record). No stored shape changed. | `convex/lib/actionTokens.ts`, `convex/lib/actionLog.ts` |
| GM "spend a token" | `combatSpotlight.spendToken({ characterId })`, keyed GM mutation (GM and co-GM), returns `{ spent, refilled }`; MECHANIC_DISABLED when off, NOT_FOUND for a character not in the campaign; a PC off the map or at 0 spends nothing. Logged as a shown GM-only feed line whose Undo gives the token back. HUD: "Spend an action" beside "Refill actions" (Party tab) opens a PC picker (a PC at 0 disabled); the pick is optimistic (`afterSpend`). | `convex/combatSpotlight.ts`, `src/components/combat-map/hud/spotlight/` |

Interpretations (reversible):

- Undo of the roll that emptied everyone (and so refilled all) gives nothing back: the refill stands.
- Undo of a roll made at 0 gives nothing back (it spent nothing, so it has no record).
- A record whose map token is gone (the PC left the map) gives nothing back.
- The GM's spend is not tied to the spotlight holder: the GM picks any PC on the live map.

## For the orchestrator (files outside RFB's owns)

- `convex/combatTokens.ts` `placeSessionEncounter` also starts an encounter (`startEncounter`); for answer 1 there too:
  `if (started && trackerTokens(ctx.campaign) !== null) await refillActionTokens(ctx, campaignId);` (imports from
  `./lib/actionTokens`).
- `tests/unit/hud/spotlight-spend-token.test.tsx` (the HUD unit test the acceptance asks for) is outside `owns`.

## Tests

- `tests/convex/rules-action-tokens.test.ts`: RFB blocks (encounter start, Tag Team both / partner at 0 and its undo,
  plain-roll undo, roll at 0, after a refill, the emptying roll, off = no record and no group, the GM's spend: access,
  off, at 0, off the map, NOT_FOUND, the feed line and its Undo, the last token refilling, not blocking an older undo).
- `tests/convex/authz/rules-tokens.entries.ts`: `combatSpotlight.spendToken`.
- `tests/unit/hud/spotlight-spend-token.test.tsx`: the button, the picker, the optimistic call, `afterSpend`.
