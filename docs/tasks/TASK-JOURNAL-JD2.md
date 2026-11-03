# TASK-JOURNAL-JD2: Session log server

Plan `.omc/plans/journal.yaml`, tracer JD2 (bead dcm-z9rz.4). Server only; the view is JL.

## What landed

`convex/journalLog.ts`:

- **`list({ campaignId, sessionId })`**: `campaignQuery` with `need: "view"` and `enough: "owner"`, as `feed.list`.
  It returns `{ lines, truncated }`. Each line is `{ key, source, sourceId, at, title, sub?, icon, hidden, edited,
  removable }`, oldest first (`mergeLog`). The sources, all read inside the session's `liveWindows`:
  - `feed`: `actionLog` rows read through `by_campaign_at`, one bounded range per window. Players read through
    `by_campaign_visibility_at` (public rows only). Undone rows are left out. Rows the GM removed from the feed
    stay; the GM can hide them here. A roll row gets a sub such as 'Vex rolled 16 with Hope' or 'The GM rolled 20 ·
    critical success'. Damage rolls get no sub.
  - `fear`: `history` rows with `kind: "fear"` and a changed value. A spend reads 'The GM spent 1 Fear' with the
    sub 'Fear 4 → 3', and a gain reads 'The GM gained N Fear'. A set, adjust or undo reads 'Fear 3 → 5'.
  - `encounter`: the campaign's encounters (`by_campaign_status_updated`, `take(MAX_ENCOUNTERS + 1)`). An encounter
    whose `startedAt` or `endedAt` falls in a window gives the line 'Combat began: <name>' or 'Combat ended: <name>'.
    The `sourceId` is `<encounterId>:began` or `<encounterId>:ended`.
  - `auto` / `gm`: the session's `sessionLog` lines. Icons are `start` / `end` / `scene` (legacy stamps are matched
    by their text), else `auto`. GM lines get the icon `note` and are `removable`.
  - Overrides are applied: `hidden`, and `text` in place of the title (`edited`).
  - Caps: `MAX_LOG_FEED_ROWS` 1000, `MAX_LOG_FEAR_ROWS` 500 and `MAX_ENCOUNTERS`. When one is hit,
    `truncated: true` and the oldest lines are kept.
  - Icons (`journalLogIconValidator`): the feed's action kinds plus `fear`, `combatBegan`, `combatEnded`, `start`,
    `end`, `scene`, `auto` and `note`.
- **Players (user Q5):** live and played sessions only. A planned session is `SESSION_NOT_FOUND`, because the
  player's session list leaves it out. Hidden lines and GM-only feed rows are left out, and `removable` is always
  false. GM lines are included.
- **`hide` / `unhide({ campaignId, sessionId, source, sourceId })`**: `gmMutation`. `source` is `feed | fear |
  encounter | auto`. These write `sessionLogOverrides` only.
- **`setText({ campaignId, sessionId, source, sourceId, text })`**: `gmMutation`. `source` may also be `gm`.
  - Text is trimmed, with at most 300 characters (`INVALID` past that).
  - For a GM line, the `sessionLog` row itself is patched (`text`, `editedAt`). Empty text is `INVALID`.
  - For any other line, an override text is written. Empty text clears it, so the generated title shows again.
  - An override that is neither hidden nor re-worded is deleted, so it no longer counts toward the cap.
- **Refusals:**
  - `SESSION_LOG_SOURCE_NOT_FOUND`: the source is not a line of this session. That covers a bad id, another
    campaign's row, a row outside every window, an undone feed row, an encounter id without its `:began` / `:ended`
    suffix, an auto line of another session, and a GM `setText` that names an auto line.
  - `SESSION_LOG_OVERRIDE_LIMIT`: a new override when the session already has `MAX_LOG_OVERRIDES`, counted with
    `by_session_source` `.take`. Changing an existing override still works.
- Adding and deleting GM lines stay `sessionPlay.addLog` / `removeLog`. Nothing was copied.

## Tests

- `tests/convex/journal-log.test.ts` covers:
  - The merge across a played and restarted session, with rows before, between and after the windows.
  - That hide, unhide and setText leave the `actionLog` row byte-identical.
  - The GM-line edit in place, and `removeLog`.
  - Every not-found case.
  - The override cap.
  - The player view.
  - A truncated source.
- `tests/convex/authz/journal-log.{entries,test}.ts`, area `journal-log`:
  - `list`: anonymous UNAUTHENTICATED, outsider NOT_FOUND, both players and the grantee ok (Q5).
  - Writes: player, other player and grantee FORBIDDEN, GM ok.

## Design states

None: this tracer has no UI. JL renders the list.

## Questions (defaults taken)

1. **Player access.** The plan's acceptance says `list` is a gmQuery and players are FORBIDDEN. The user's Q5 answer
   overrides it: players read the log minus GM-hidden lines. They also get no GM-only feed rows (hidden GM rolls)
   and no planned sessions. GM-typed lines and encounter names are shown to players. The other option is to keep GM
   lines from players, as Q5 (b) suggested.
2. **Fear text.** The arrow is '→', not the ASCII '->' written in the acceptance.
3. **Duplicate start / end.** The campaign-wide feed rows 'Session started' / 'Session ended; …' show next to the
   auto stamps 'Session started.' / 'Session ended.'. The feed row carries the Wither → Fear conversion, so both are
   kept and the GM can hide either.
4. **Roll sub.** There is no trait ('· Presence'): the stored roll does not record the trait. The summary already
   names it in most rows.
5. **Feed rows the GM removed from the feed** (`feed.remove`) stay in the session log, for players too, until hidden
   here. This follows the brief: 'rows the GM removed from the feed stay unless hidden here'.
6. **Encounter run again.** Only an encounter's latest start and end are stored, so an earlier run leaves no line.

## Merge-time actions

- Run codegen (`convex/_generated`): there is a new module, `journalLog`.
