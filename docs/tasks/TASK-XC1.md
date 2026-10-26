# TASK-XC1: GM allows extra active characters per player for the current session

Status: Review. Plan: `.omc/plans/followups-2.yaml`, tracer XC1. Builds on X6 (`TASK-X6-one-active-character.md`).

## Rule (user, 2026-10-18)

- "add a gm option to temporarily allow more than 1 character per player for specific sessions".
- Extras at session end: "keep them".

## What works

- `campaignState.extraCharactersSession` (optional number, widened): the `sessionStartedAt` of the session the allowance applies to. It applies only while it equals the running session's `sessionStartedAt`. `sessions.start` and `sessions.end` clear it, so a new session never inherits it.
- `sessions.allowExtraCharacters({ allow })`: keyed GM mutation (`keyedGmMutation`, players FORBIDDEN). INVALID ("Start a session first.") with no session running. Switching to the current value writes nothing. Each change logs a public, non-undoable `session` row.
- `sessions.current` also returns `extraCharacters: boolean`.
- `assertOneActive` (`convex/lib/characterSheet.ts`) returns early while `extraCharactersAllowed` (one indexed read of `campaignState`) is true. Every caller is covered: `characters.create`, `assignOwner`, `setStatus`, `deathMoves.returnFromAway`, `deathMoves.undo` and `actionLog.undoEntry`.
- Session end keeps every active character active.

## UI

- The GM's Session card shows the "Allow extra characters this session" switch while a session runs, with an optimistic update. Players don't see the card. The End confirmation mentions that the allowance ends and the extras stay.
- Roster card (`src/app/(gm)/campaigns/[campaignId]/party/roster.tsx`): when a player has more than one active character, each of those cards shows "N active: send one away", for every viewer. The GM's own characters are exempt. It reads the same `listByCampaign` query as the page, so there is no extra fetch.

## Tests

- `tests/convex/one-active.test.ts`: no allowance means still refused during a session. While allowed: create, bench and bring back, and hand-over all pass. After End the extras stay active, and create and bring back are refused again. A new session doesn't inherit the allowance. Switching it off mid-session restores the rule.
- `tests/convex/sessions.test.ts`: authz for `allowExtraCharacters` (anonymous, outsider, player FORBIDDEN, GM). Refused with no session. End clears it, and a new start doesn't inherit it.
- `tests/e2e/players.spec.ts`: the GM starts a session and switches it on, the player's second character is created, both roster cards warn, the warning stays after End, a third is refused, and benching one clears the warning.
