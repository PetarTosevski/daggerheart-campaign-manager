# TASK-D10-S2: Session records - create, list, title, date, played, delete, header line, player list

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S2 (wave 2, depends on S0, S1). Bead: `dcm-bxp.9`.

## Goal
The GM creates sessions, sees them newest first with their status, edits title and date, marks one played or not,
deletes one with a second click, and the header shows the board's line; players see the read-only list of live and
played sessions with their recaps.

## Rules this tracer implements
- **B1** "A session has a number (highest + 1 on create; gaps after a delete are kept), a title ('e.g. The Bridge at
  Dawn'), a date (calendar date only, 'No date set'), and a status Planned / Live / Played. 'Mark as played' / 'Mark as
  not played' flips Played by hand WITHOUT running the start or end effects. Delete asks twice ('Click again to
  delete'). The list column shows the newest first: 'SESSION n', status chip, title or 'Untitled session', formatted
  date. Header line: 'N sessions · M played · Next: <date of the first planned session that has one>'. '+ New session'
  opens the new session on Prep."
- **Q4** (default b) "a read-only list of live and played sessions: number, title, date, status, recap ... Always
  GM-only: planned sessions ..., scenes, hooks, the encounter, the spotlight, the tally and the session log." Enforced
  in `sessionRecords.list` on the server.
- **Q10** (default a) "refuse (SESSION_LIVE, 'End the session first')" for deleting the live session. The same code
  refuses 'Mark as played / not played' on the live session (S0's message for SESSION_LIVE names both).

## Public functions (`convex/sessionRecords.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `list` | `campaignQuery` need view, enough owner | `{}` | `Array<{ _id, n, title?, date?, status, startedAt?, endedAt?, recap? }>` newest first. GM: every session, with `startedAt` / `endedAt`, no recap. Player: only live and played, with `recap`, no times. |
| `create` | `keyedGmMutation` (`idempotencyKey`) | `{}` | `{ sessionId: Id<"sessions">, n: number }` (`insertSession`: highest + 1, planned; SESSION_LIMIT past 300) |
| `setTitle` | `gmMutation` | `{ sessionId: string, title: string }` | `null` (trim; > 120 INVALID; empty clears) |
| `setDate` | `gmMutation` | `{ sessionId: string, date: string \| null }` | `null` ('YYYY-MM-DD'; null or '' clears; else INVALID) |
| `setPlayed` | `gmMutation` | `{ sessionId: string, played: boolean }` | `null` (planned <-> played; live: SESSION_LIVE; no start / end effects) |
| `remove` | `gmMutation` | `{ sessionId: string }` | `null` (`deleteSessionRows` + the row; linked encounter stays; live: SESSION_LIVE) |

`sessionId` is `v.string()` and goes through `loadSession`, so a URL id that is malformed, foreign or deleted is
SESSION_NOT_FOUND, never a validator error. Every function has `returns`; RETURNS_PENDING is unchanged.

## UI
- `src/components/sessions/list/`: `useSessionList` (the one `list` subscription every S2 slot shares),
  `useDefaultSessionId` (newest visible session), `SessionHeaderLine` (S1 `headerLine`), `NewSessionButton`
  (`useIntent(create)`, error in `role=alert`; the page opens the new session on Prep), `SessionList` (`ul` of
  `button.ss-item` with `aria-current`, `SESSION n`, `ss-chip[data-status]`, S1 `sessionTitle` / `formatSessionDate`).
  `list.css`: entry typography (board l.64-69).
- `src/components/sessions/detail/`: `SessionHeaderCard` (labelled title input saved on blur / Enter, date input saved
  on change, 'Mark as played' / 'Mark as not played', 'Delete' -> 'Click again to delete'; both buttons disabled with
  the title 'End the session first' while live; optimistic updates on the list cache for title, date and played),
  `PlayerSessionView` (number, chip, title as h2, date, 'Recap' with the text or a fallback), `NoSessionSelected`
  (unchanged). `detail.css`: the board's bottom-aligned row card; phone: fields full width, buttons share a row.
- Both detail components read the session from `list`, so an id the caller may not see (bad, deleted, or planned for a
  player) shows "That session isn't available" in the `Session` region instead of throwing; this also keeps S0's
  `sessions-shell.spec.ts` (placeholder id) passing.
- The delete confirmation is keyed by session id (switching sessions cancels it without an effect) and is cancelled on
  blur.

## Acceptance evidence
- `tests/convex/session-records.test.ts` (14 tests): numbering, idempotent create, gaps kept (1, 2, 3 -> delete 2 ->
  next is 4); SESSION_LIMIT at 300; setTitle trim / clear / INVALID > 120; setDate valid / clear (null and '') /
  INVALID for '2026-02-30', '24.10.2026', '2026-10-24T18:00', 'soon'; setPlayed flips both ways, idempotent, writes no
  campaignState or actionLog change, refuses live with SESSION_LIVE; remove deletes prep / log / spotlights of that
  session only, keeps the linked encounter, then SESSION_NOT_FOUND, refuses live with SESSION_LIVE; list GM vs player
  exact shapes (planned session with recap never reaches the player); foreign and malformed ids SESSION_NOT_FOUND on
  every mutation; authz for `list`, `create`, `setTitle`, `setDate`, `setPlayed`, `remove`: anonymous
  UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN (writes) / filtered read, GM succeeds.
- `tests/e2e/session-records.spec.ts` (2 tests): GM creates two sessions (opens on Prep), titles and dates them, list
  newest first with chips and ring, header line follows, marks the first played and back and played again, deletes the
  second with two clicks (URL drops `?s`), creates a planned third; a player sees only the played session, its title and
  the Recap section, no inputs, buttons, stage tabs or '+ New session'. Phone: 390 px, no horizontal scroll, title,
  date, both buttons and '+ New session' >= 44 px.
- `tests/e2e/sessions-shell.spec.ts` (S0, 5 tests) still passes.
- Full counts: `pnpm test` 140 files, 1619 tests passed; `pnpm lint` and `pnpm typecheck` clean.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S2.spec.ts`): `test-results/visual/D10-S2/{list,header-card,player}-{1440,1024,390}.png`,
`header-card-confirm-1440.png`. Board (`node scripts/board-shots.mjs sessions:list sessions:prep`):
`test-results/visual/board/sessions-{list,prep}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| List column | Matches: 'SESSION n' Cinzel small caps, chip top right (planned gold on brown, played green), title in Cinzel 17 px, formatted date 'Sat, Oct 24, 2026', the current entry ringed in the accent. |
| Header line | Matches the board's line ('3 sessions · 2 played · Next: Sat, Oct 24, 2026'). |
| Header card | Matches: 'SESSION 3 TITLE' label, growing title input (18 px), Date input, 'Mark as played' ghost, red-outlined 'Delete' / 'Click again to delete', bottom aligned. Deviation: both buttons are disabled while the session is live (Q10, B1 server refusal); the board has no such state. |
| 1024 | Two columns as S0; the header card keeps one row. |
| 390 | One column; the header card stacks title and date full width, the two buttons share a row at 44 px; no horizontal scroll. The board has no phone layout. |
| Player view | No board counterpart (the board is GM-only). Same card look: number, chip, title (h2), date, 'RECAP' label and the recap in the serif text style, or 'No recap was written for this session.' / for a live one 'This session is being played right now.' |

## QUESTIONS
1. A player's header line counts only the sessions they can see (live and played), so it never shows 'Next: <date>'.
   Q4 says only the next date reaches the dashboard (S7), so this is the reversible minimum. If players should see
   'Next:' here too, `list` can return a separate `nextDate` for players.
2. The e2e player check sees the recap fallback ('No recap was written for this session.') because no public function
   writes a recap before S6; the recap text itself is covered by the Convex test (`list` returns it to players). S6's
   e2e should assert a written recap on the player view.
3. 'Mark as played / not played' on the live session is refused with SESSION_LIVE (acceptance says so) and the UI
   disables both buttons while live. The live card (S3) is the way to end it.

## Notes for later tracers
- S3: after start / end, `list` already shows the status and times; the header card disables played / delete while
  live. `create` is the keyed intent for '+ New session'; B8's dashboard Start should call `insertSession` directly.
- S6 / S7: `list` returns `recap` only to players; the GM's recap comes from S6's own query (or widen `gmItem`).
- Every S2 slot shares one `sessionRecords.list` subscription via `useSessionList` (exported from `list/index.tsx`).
