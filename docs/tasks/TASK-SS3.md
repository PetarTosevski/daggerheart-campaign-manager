# TASK-SS3: Players undo a level-up only within the session it happened

Status: Review. Plan: `.omc/plans/slots-spellcast.yaml`, tracer SS3 (wave 3). User answers 2026-10-18: decision 16
"yes" (undo sets "level up pending" again; refused after a GM correction; unchanged) and decision 33 "let a player
undo only for the session they did the levelup".

## What changed

- **Data**: each advancement gains an optional `at` (ms; zod `advancementSchema` and the view `advancementValidator`,
  widened, `SHEET_VERSION` stays 2). `applyLevelUp` takes it from the caller (`ctx.at`); `levelUp.apply` passes
  `Date.now()`. `revertLevelUp` drops it with the entry.
- **Rule** (`convex/levelUp.ts`, `undoRefusal`): the GM (campaign permission `owner`) may always undo. A player is
  refused with `LEVEL_UP_RULE` "Only the GM can undo a level-up from an earlier session." when the latest entry has
  no `at` (older data) or a session boundary lies after it (`sessionBoundaryAfter`):
  - a session is running (`campaignState.sessionStartedAt`): boundary iff it started after `at` (an end clears the
    field, a new start stamps a later time, so a session started at or before `at` ran throughout);
  - none running: the campaign's `actionLog` rows from `at` on (index `by_campaign_at`, at most 200) are checked
    for a real session start/end row (`convex/sessions.ts` campaign rows "Session started" / "Session ended…");
    more than 200 rows counts as a boundary. Scene ends (`convex/scenes.ts`, also kind `session`) are not boundaries.
- **Query** `levelUp.canUndo({ characterId })` (boolean): the same rule for the viewer; false without edit access or
  without an undoable entry.
- **UI** (`src/components/party/level-up/index.tsx`): the header's − shows for the GM whenever there is an entry to
  undo; for a player only while `canUndo` is true (the query is skipped for the GM and when there is nothing to undo).

## Deliberate choices

- There is no sessions table (sessions are `campaignState.sessionStartedAt` plus log rows), so the "no running
  session" case reads a bounded range of the action log and matches the session rows by their summary text (sessions.ts
  not owned). A `sessionEndedAt` on `campaignState` or a sessions table (D9) would make this a single read.
- A boundary in the same millisecond as the level-up counts as after it (conservative).

## Verification

See the tracer report (lint, typecheck, unit and convex tests, e2e).
