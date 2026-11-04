# TASK-LN-N2: Characters, sheet and actionLog follow-ups

Status: Review. Plan: `.omc/plans/lanes.yaml`, tracer N2 (wave 1, branch `lane-n2`).
Beads: dcm-bxp.28, dcm-bxp.31, dcm-bxp.40 (not item 10, lane N3's), dcm-bxp.15, dcm-bxp.61, dcm-bxp.38.

## What changed

### dcm-bxp.38: creation cap and read bound (user 2026-10-30)
- `convex/lib/characterSheet.ts`: `MAX_CHARACTERS_CREATED_PER_CAMPAIGN = 50` (the creation cap; lowered to 10 only when the
  user says testing is over) and `CHARACTER_READ_BOUND = 50` (every bounded party read). `MAX_CHARACTERS_PER_CAMPAIGN` stays
  exported as the read bound, so rests, combatScenes, lib/sessions, lib/cardHand, sessionPlay and combatMaps
  (`MAX_COMBAT_REVEALS`) keep compiling unchanged. `partyOf` takes the read bound.
- `characters.create` (`assertRoom`) checks the creation cap. `listByCampaign` / `partySummary` read through `partyOf`
  (bounded) instead of `.collect()`.

### dcm-bxp.28: sheet narrowing, delta intents, corrupt characters
1. Narrowing (widen -> migrate -> narrow, CD4). Not narrowed: `versionSheets` is run by hand per deployment and this lane
   can't verify every deployment ran it. Added the tools for the narrow step:
   - `storedSheetValidator` (`convex/lib/validators/characters.ts`): `{ schemaVersion, ...sheetValidator }`, the target of
     `characters.sheet`.
   - `migrations/characters:auditSheets`: read-only, logs every character whose stored sheet fails it
     (`sheetNarrowingProblem`). Narrow `characters.sheet: v.any()` to `storedSheetValidator` once `versionSheets` then
     `auditSheets` log nothing on every deployment (dev, e2e, prod):
     `npx convex run migrations/run:run '{fn: "migrations/characters:auditSheets", reset: true}'` (add `--prod`).
   - The same applies to the bead's other narrow steps (maps.data v2, the `frameTrackers` fallback in characterExtras):
     untouched here.
2. Delta intents (CL3): `characters.setTrait` takes `value` or `delta`; `characters.setExperience` takes `delta` besides
   `name` / `value` (exactly one of `value`/`delta`; a delta is a whole number of at most 15 either way and the result is
   kept within -5..+10). The sheet's trait steppers send `delta`; the Experiences box now sends one intent per edit
   (`setExperience` name / value, `addExperience`, `removeExperience`) instead of the whole list through `updateSheet`.
   No optimistic update: the unit tests' `useMutation` mocks have no `withOptimisticUpdate`, and deltas already make every
   click count.
3. Corrupt characters: `CorruptNotice` and `cardLabel` (`src/components/party/party-card.tsx`) mark a `corrupt: true` row
   on the dashboard card and the roster ("This sheet can't be read …", accessible name "<name> (unreadable sheet)").

### dcm-bxp.31: actionLog follow-ups
1. Not done: the character's `updatedAt` before each logged action. Callers save the sheet before `logAction`, so
   `logAction` sees the action's own stamp. Tried and reverted: `saveSheet` keeping `characters.prevUpdatedAt` and
   `logAction` recording `actionLog.priorUpdatedAt`, telling the mutation's own stamp by `updatedAt === Date.now()`. That
   needs `Date.now()` to stand still for a whole mutation; convex-test doesn't hold it (10 existing undo tests broke: a
   save and its log row land a millisecond apart), and the production behaviour isn't verified here. Options for a
   follow-up: (a) `LogEntry.priorUpdatedAt?` passed by the callers that read the character before saving (36 files;
   optional, so source-compatible); (b) store a hash of the sheet after each row and compare it with the next row's
   `before` (no time assumption); (c) `logAction` before `saveSheet` everywhere (contract change).
2. Distinct codes in `src/lib/errors/actionLog.ts`: `UNDO_EXPIRED` (a player's dice row past `PLAYER_DICE_UNDO_MS`) and
   `UNDO_USE_REST` (a group holding a rest row, from `actionLog.undo`). `undoEntry`'s signature is unchanged.
3. Not done: before-snapshots in their own table. It needs `convex/cleanup.ts` (purge and `stripActionLogSnapshots`),
   `convex/crons.ts`, `convex/rolls.ts:293` (reads `row.before`) and their tests, none in N2's owns. Plan for a follow-up:
   table `actionLogSnapshots { campaignId, actionLogId, characterId, before, at }` with `by_action` and `by_campaign`;
   `logAction` writes it; a `readBefore(ctx, row)` helper reads the table, then `row.before`; a batched migration moves
   `before`; the strip and purge delete snapshot rows; then narrow `actionLog.before` away.
4. Not done: importable subclass rank / multiclass for imported characters above level 1 (`convex/photoImport.ts`, outside
   the owns, and a mechanic question for the user).

### dcm-bxp.40: sheet redesign leftovers
- Item 4: `death.css` drops its local `color-scheme` (the `.sh-modal` sets it for every PaperModal).
- Item 5: the Castle High reason picked with Blaze of Glory carries to its finish step (state held in
  `DeathMoveControls`; the server still takes the reason only at finish).
- Item 6: `InventoryBox` takes `cls` from page-two.
- Item 7: `TextField` (`fields.tsx`) no longer remounts with `key={value}`: it follows the PaperText pattern (shows the
  saved value while unfocused, keeps the typed text until the live value catches up, drops it when `onSave` resolves to
  false). Unused `Track` and its `cs-slot-row` / `cs-pip` / `cs-scar` rules are gone. Story SVGs not moved (optional).
- Item 9: the 44 px damage-field rule moved from `sheet.css` to `sections/hp-stress.css`.
- Not done: item 1 (dice-box, lane SD-H's files), item 2 (Downtime reference text for Make a Feast, Keep Watch, Tribute,
  Halt lycanthropy: needs the rule text, see questions), item 3 (`docs/tasks/TASK-SR-S0.md` is outside the owns: drop
  "Advancements" from its frozen button list), item 8 (vault starts gathered: needs the e2e and unit specs that use the
  spread vault, outside the owns), item 10 (lane N3).

### dcm-bxp.15: one set of character display helpers
- `ancestryLabel` and `portraitAncestryId` live in `src/components/party/party-display.ts` only (format "Elf / Orc",
  "Shapeshifter (Elf form)", mixed name trimmed); `sheet-helpers.ts` re-exports them (`ancestryArtId` is the alias).
- The wizard's `gearSummary` uses `derivedDefense` and `derivedThresholds` at level 1 (the "while" guard, thresholds with
  the level and the subclass passives).

### dcm-bxp.61
- `tests/convex/level-up.test.ts` pins (2): an End pressed with no live session is no level-up boundary (user 2026-10-23:
  keep). (1) was pinned before.

## Files outside N2's owns

Changed because the behaviour they assert changed (plan amendment needed, as J4's schema-guard.test.ts):
- `tests/convex/action-log.test.ts`: the rest row expects `UNDO_USE_REST`, the two expired dice rows `UNDO_EXPIRED`.
- `tests/convex/combat-attack.test.ts` (line 506): the expired combat row expects `UNDO_EXPIRED`.
- `tests/unit/convex-errors.test.ts`: the actionLog codes list.
- `tests/unit/purposeful-design.test.ts`: the +11 field sends `characters:setExperience` with `value: 10`.
- `tests/unit/party-display.test.ts`: the mixed heritage reads "Elf / Human".
- New: `tests/convex/lane-n2-characters.test.ts`.

## Checks
- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 8902 passed, 1 failed (auth-signup "global sign-up bucket" timed out at load 25; passes alone).
- e2e (`E2E_REUSE_SERVERS=1`, `--workers=1`): character-wizard, death, character-sheet: 12 passed. In parallel at load 36 six failed at campaign creation / sign-in (timeouts), before any changed UI.
