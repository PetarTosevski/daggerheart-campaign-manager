# TASK-D10-S6: Wrap-up - recap, loot, threads, milestone; the dashboard's last-session query

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S6 (wave 3, depends on S2). Bead: `dcm-bxp.9`.

## Goal
In Wrap-up the GM writes the recap, loot and threads and calls the party's level-up milestone, and a public query
hands the dashboard the session number, next date and last recap.

## Rules this tracer implements
- **B5** "Wrap-up: Recap ('This shows on the dashboard as Last Session'), 'Loot & gold', 'Countdowns & threads', and
  'Milestone reached: the party levels up' with 'Open Party to level up' (see Q5)."
- **B9** "Dashboard: hero line 'Session N' (the live one, else the last played, else 'No sessions yet') and 'Next session
  <date>' / 'Next session not scheduled'; the 'Last Session' card shows the last played session's recap, else 'Session N
  was played, but no recap was written. Add one in the session's Wrap-up.', else 'No sessions played yet. Write a recap in
  a session's Wrap-up stage and it will appear here.'" -> `sessionWrap.dashboard` (text from S1 `summary.ts`).
- **Q4** (default b) players read live and played sessions with their recap; "Always GM-only: planned sessions (only the
  next date reaches the dashboard) ...". Loot and threads stay GM-only (option c was not taken).
- **Q5** (default a) "a one-way action: it runs the roster's 'Party levels up' (flags every active PC, K5) and records
  the milestone on the session, then shows 'Open Party to level up'; it cannot be unticked (there is no 'unflag')."
- **K5** "When your party reaches a milestone in a campaign, the GM will tell you that it's time to level up ... All
  party members level up at the same time." (CB p.109) -> `convex/lib/partyLevelUp.ts` (S0), reused unchanged.
- **K8** "every few sessions, at the end of an arc, or at special moments when it makes sense in the fiction—loot can be
  an exciting reward" (CB p.176) and "If you ever need to continue a countdown across sessions, record the current
  countdown value" (CB p.162): loot and threads are free text the GM writes; nothing touches countdowns.

## Public functions (`convex/sessionWrap.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `get` | `gmQuery` | `{ sessionId: string }` | `{ sessionId: Id<"sessions">, n: number, recap?: string, loot?: string, threads?: string, milestoneAt?: number } \| null` (null: not one of this campaign's sessions) |
| `setRecap` | `gmMutation` | `{ sessionId: string, recap: string }` | `null` (on `sessions`; trim, > 6000 INVALID, empty clears) |
| `setLoot` | `gmMutation` | `{ sessionId: string, loot: string }` | `null` (on `sessionPrep`, created on the first non-empty write; > 2000 INVALID) |
| `setThreads` | `gmMutation` | `{ sessionId: string, threads: string }` | `null` (on `sessionPrep`, as loot; > 4000 INVALID) |
| `callMilestone` | `keyedGmMutation` (`idempotencyKey`) | `{ sessionId: string }` | `{ flagged: number, called: boolean, milestoneAt: number }` |
| `dashboard` | `campaignQuery` need view | `{}` | `SessionDashboard` (below) |

`sessionId` is `v.string()`. The writes load it with `loadSession`: a malformed, foreign or deleted id is
SESSION_NOT_FOUND. `get` returns null for such an id instead (as S2's slots show 'not available' rather than throw), so
a stale `?s=` shows a line in the stage and the page's shared stage boundary never trips (S0's `sessions-shell.spec.ts`
switches stages with a placeholder id). Every
function has `returns`; RETURNS_PENDING is unchanged; no new error code.

`callMilestone` runs `partyLevelUp(ctx, campaignId, actorId)` and patches `sessions.milestoneAt` in the same mutation
inside `ctx.once("session_milestone", { sessionId })`. A session that already has `milestoneAt` returns
`{ flagged: 0, called: false, milestoneAt: <the first stamp> }` and changes nothing (no flag, no log row, no unflag).

```ts
type SessionDashboard = {
  dashboardNumber: string;              // 'Session N' (live, else last played) | 'No sessions yet'
  nextSessionLine: string;              // 'Next session Oct 24, 2026' (en-US, no weekday) | 'Next session not scheduled'
  nextDate: string | null;              // 'YYYY-MM-DD' of the first planned session with a date (lowest number)
  live: { sessionId: Id<"sessions">; n: number } | null;
  lastPlayed: { sessionId: Id<"sessions">; n: number; recap: string | null } | null;
  lastSessionText: string;              // the last played recap, else the two B9 fallbacks
};
```
It reads three indexed queries (`by_campaign_status_n`: the live one, the last played one, the planned ones, at most
MAX_SESSIONS) and hands them to S1's pure functions. No titles, no prep, no planned recaps reach it.

## UI (`src/components/sessions/wrap/`)
- `WrapStage` (export name and props from `slots.ts`): one `sessionWrap.get` subscription; the body is keyed by the
  session id (identity), so a draft never crosses sessions.
- The board's grid (1.3fr / 1fr): the Recap card with its hint, then 'Loot & gold', 'Countdowns & threads' and the
  milestone card. Each textarea is labelled by its card heading, capped by `maxLength`, and saves on blur and after
  800 ms without typing (one field per write, optimistic update on the `get` cache; the text follows the server only
  while unfocused). A failed save shows `role=alert` under the field.
- Milestone: the board's row button (`aria-pressed`, the 22 px box ticked in the accent). One click calls it
  (optimistic tick), the status line says 'N characters can level up.'; once called the row stays pressed and disabled
  ('This can't be undone.' as its title) and 'Open Party to level up →' links to `/campaigns/<id>/party`.
- Players: no stage tabs (S0), so no Wrap-up; they read the recap in S2's `PlayerSessionView` (from
  `sessionRecords.list`).
- `wrap.css`: grid, milestone row and box; under 900 px one column (Recap first), the link 44 px tall.

## Acceptance evidence
- `tests/convex/session-wrap.test.ts` (11 tests): `get` empty / filled; `setRecap` trim, clear, INVALID past 6000, no prep
  row; `setLoot` / `setThreads` create the prep row on the first non-empty write, patch it, keep S4's scenes and hooks,
  caps, clear; `callMilestone` flags only active characters below 10 (away and level 10 left out), one log row, stamps
  `milestoneAt`, the same key returns the same result, a new call is a no-op (no re-flag after the player cleared the flag,
  no log row), another session can call its own; `dashboard` empty fallbacks, the 'no recap' fallback, the recap, the
  next date (a live session's date is not 'Next'), the live session first, planned titles and recaps never included, GM
  and player get the same object; `get` null and SESSION_NOT_FOUND on the four writes for foreign and malformed ids; authz
  for all six: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN (`get` and writes) / reads (`dashboard`),
  GM succeeds.
- `tests/e2e/session-wrap.spec.ts` (2 tests): the GM writes the recap (saved by the pause, checked through the API), loot
  and threads (blur), reloads and sees all three; calls the milestone ('2 characters can level up.', pressed, disabled,
  still after reload), marks the session played, follows 'Open Party to level up →' and both characters show 'Level up
  pending'; `dashboard` returns 'Session 1' and the recap; a player reads the written recap on the session view and
  never sees loot, threads or the Wrap-up stage, even with `?stage=wrap`. Phone: 390 px, one column, labelled fields,
  milestone row >= 44 px, no horizontal scroll.
- Full counts: `pnpm vitest run --maxWorkers=4` 141 files, 1630 tests passed; `pnpm lint` and `pnpm typecheck` clean.
  e2e (`E2E_VISUAL=1`): session-wrap (2), visual/D10-S6 (1), session-records (2), sessions-shell (5), level-up (1): 11 passed.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S6.spec.ts`): `test-results/visual/D10-S6/{wrap-empty,wrap}-{1440,1024,390}.png`.
Board (`node scripts/board-shots.mjs sessions:wrap`): `test-results/visual/board/sessions-wrap-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Recap card | Matches: Cinzel 'Recap', the hint copy, the 10-row serif textarea and placeholder. |
| Loot & gold / Countdowns & threads | Matches: headings, 4-row serif textareas, the board's placeholders. |
| Milestone card | Matches the row button and 22 px box (accent fill and ✓ once called) and the ghost 'Open Party to level up →'. Deviation: one way (Q5) — once called the row is disabled instead of a toggle; a status line 'N characters can level up.' shows after the click (gone on reload). |
| 1024 | Two columns as on the board. |
| 390 | One column, Recap first, no horizontal scroll (the board has no phone layout). |

## QUESTIONS
1. The milestone fires on one click (like the roster's 'Party levels up', which is also one click and one way). If an
   accidental click is a concern, a second-click confirm ('Click again to level up the party') as on Delete is a small
   UI-only change.
2. `dashboard.nextSessionLine` is formatted on the server in en-US (the server has no viewer locale); `nextDate` is
   returned so S7 can format it in the viewer's locale with S1's `formatSessionDate` / `nextSessionLine`.
3. The milestone may be called on a session of any status (the board allows it on any session).

## Notes for S7
- Hero: `dashboardNumber`, then `nextSessionLine` (or format `nextDate` locally). 'Session N in progress': `live`
  (`live.sessionId` for the link `/sessions?s=<id>&stage=play`).
- Last Session card: `lastSessionText`; `lastPlayed` gives the number and id if the card links the session.
- One subscription for every member; it re-runs only when a `sessions` row changes (prep typing never touches it).
