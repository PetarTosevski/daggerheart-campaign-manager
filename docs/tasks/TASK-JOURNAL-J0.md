# TASK-JOURNAL-J0: Journal data foundation

Plan `.omc/plans/journal.yaml`, tracer J0 (bead dcm-z9rz.1). Server and domain only; no UI and no new public function.

## What landed

**Widened shapes** (`convex/lib/validators/sessions.ts`, optional fields only, rule 7):

- Scene (`sessionSceneValidator`): `title?`, `state?` (`"planned" | "playing" | "done"`, absent = planned; Q7),
  `encounterId?` (Q6: one encounter per Combat scene).
- Session (`sessionFields`): `playedMs?`, which is the summed length of the finished live windows (Q3).
- Log line (`sessionLogFields`): `event?` (`"start" | "end" | "scene"`), `editedAt?`.
- New constants: `MAX_LOG_OVERRIDES` (500), `SESSION_SCENE_STATES`, `SESSION_LOG_EVENTS`, `SESSION_LOG_SOURCES`
  plus their validators, and `SESSION_TEXT_MAX.sceneTitle` (120).
- **Not added:** `sessions.recapSharedAt`. The user's Q4 answer is "everyone can write; always visible to the
  table", so there is no share gate. JD5 and JR must not build `shareRecap`, the recap gating or the
  `journalRecap` migration.

**New tables** (`convex/tables/sessions.ts`, in `sessionTables`, so `convex/schema.ts` is unchanged):

- `sessionLogOverrides { campaignId, sessionId, source: "feed" | "fear" | "encounter" | "auto", sourceId: string,
  hidden: boolean, text?, updatedAt }` with indexes `by_session_source [sessionId, source, sourceId]` and
  `by_campaign`. Cap: `MAX_LOG_OVERRIDES` per session. The writer (JD2) checks the cap and throws
  `SESSION_LOG_OVERRIDE_LIMIT`.
- `sessionCharacterStats { campaignId, sessionId, characterId, hopeSpent, hpMarked }` with
  `by_session_character` and `by_campaign`. Cap: one row per PC, `MAX_SESSION_CHARACTER_STATS`
  (= `MAX_CHARACTERS_PER_CAMPAIGN`, exported from `convex/lib/sessions.ts`).

**`convex/sessions.ts`:** the Start and End stamps carry `event: "start"` / `"end"`, and their `at` is exactly the
session's `startedAt` / `endedAt`. End adds `endedAt - startedAt` to `playedMs`. Windows played before J0 are not
counted in `playedMs`; `hoursAtTable` counts the last start → end of such a session.

**`convex/lib/sessions.ts`:**

- `liveWindows(ctx, session, now = Date.now())` returns `{ from, to, open }[]`, oldest first. It reads the session's
  auto lines (bounded by `MAX_LOG_ENTRIES`).
  - Tagged lines count by `event`. Older auto lines count by their text, 'Session started…' or 'Session ended…'.
    GM-typed lines (`auto: false`) and `event: "scene"` lines never count.
  - Starts pair with ends. A start with no end closes at `endedAt` (played) or at `now` (live, `open: true`).
  - The latest `startedAt` is always covered, so a session without stamps reads as `[startedAt, endedAt ?? now]`.
  - A planned session that never started has no windows.
- `deleteSessionRows` also deletes the session's overrides (`take(MAX_LOG_OVERRIDES + 1)`) and stats rows.

**`convex/cleanup.ts`:** the campaign purge deletes `sessionLogOverrides` and `sessionCharacterStats` by `by_campaign`.
Every row of both tables is bounded per session and deleted with it, so no new cron is needed (rule 8).

**`src/lib/errors/sessions.ts`:** `SESSION_LOG_SOURCE_NOT_FOUND`, `SESSION_LOG_OVERRIDE_LIMIT`, `SESSION_SCENE_STATE`.

**`src/lib/domain/journal/`** (pure, unit-tested in `tests/unit/journal-domain.test.ts`):

- `windowsFromMarks(marks, session, now)`, `logMark(row)`, `inWindows(windows, at)`. These are the core of
  `liveWindows`; JD2 and JD3a filter rows by time with `inWindows`.
- `mergeLog(sources)`: sorts by `at`, stable by source order, then by position inside the source.
- `nextSceneId(scenes)`: the first scene after the playing one that is neither done nor playing. Without a playing
  scene, the first scene that is not done. `null` when there is none.
- `sceneEncounterId(scene, index, prep)`: the scene's own encounter. Otherwise, only for the first Combat scene,
  the legacy `prep.encounterId` (Q6).
- `leastSpotlightLine(entries)`: 'Oriel has had the least spotlight this session.' Tied PCs are named together
  ('A, B and C have had …'). It returns `null` when there are no PCs or every PC has the same count.
- `hoursAtTable(sessions, now)`: hours, not rounded. Sums `playedMs`; a played session without `playedMs` counts
  its last start → end; a live session adds `now - startedAt`.

## Tests

- `tests/convex/journal-foundation.test.ts`:
  - The stamps carry their events, and `playedMs` adds up across a restart.
  - `liveWindows` handles a restarted live session, legacy text stamps (a GM line is ignored), the
    `startedAt` / `endedAt` fallback, and scene lines.
  - The widened fields are stored.
  - `deleteSessionRows` deletes the new rows.
  - The new error codes are covered.
- `tests/convex/cleanup.test.ts`: the seeded campaign has a row in both new tables. The purge removes them, and the
  per-session delete removes only that session's rows.
- `tests/convex/schema-guard.test.ts`: both tables are listed as `CAMPAIGN_SCOPED`. The orchestrator added this file
  to J0's owns.

## Design states

None: J0 has no UI. Data gaps closed for the design: the scene title and state, per-scene encounters, hours at the
table, the "Scene N began" event tag, hide / edit of log lines, and Hope spent / HP marked counters. The writers come
later: JD2, JD3b, JD4.

## Questions (defaults taken)

1. `leastSpotlightLine` when every PC has the same count, including all zero: `null` (no line). The design shows a
   single name. The other option is to name everyone.
2. `nextSceneId` without a playing scene: the first scene that is not done. The design only shows the case with a
   scene playing.
3. `liveWindows` with an unmatched legacy start on a played session closes it at `endedAt`, merging overlapping
   windows. This only happens when an end stamp is missing, which happens when the log was full.
4. `hoursAtTable` is unrounded; the UI decides the rounding.

## Merge-time actions

- Run codegen (`convex/_generated`) after the merge: there are two new tables, though no new functions.
- JD5 / JR: Q4 means there is no `recapSharedAt` (see above).
- JD2: the override writer must check `MAX_LOG_OVERRIDES` with a `by_session_source` `.take` and throw
  `SESSION_LOG_OVERRIDE_LIMIT`. Use `SESSION_LOG_SOURCE_NOT_FOUND` for a source row that is not in the session's
  windows.
- JD4: write "Scene N began" lines with `auto: true, event: "scene"`. `liveWindows` ignores them.
