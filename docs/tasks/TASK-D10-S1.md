# TASK-D10-S1: Pure domain - status, header line, next and last session, spotlight, tally, encounter title

Status: Done. Plan: `.omc/plans/d10-sessions.yaml`, tracer S1 (wave 1, no dependencies). Bead: dcm-bxp.9.
Rules implemented: B1 (status, order, date, header line), B4 (spotlight due, tally rows), B7 (restart adds to the tally),
B9 (dashboard number, next session line, last session text), B11 (encounter title); K1, K6, K7; Q3 (a), Q12 (caller side).

## Goal
A pure, tested TypeScript module answers every derived value the Sessions board and the dashboard show, from plain
session, history, rest and instance rows. No framework imports, no Convex imports, no new dependency; Convex functions
(S2, S3, S5, S6, S8) and the browser use the same code, like `src/lib/domain/combat-map` (D9 C1).

## Files
- `src/lib/domain/sessions/status.ts`: `SessionStatus`, `SESSION_STATUSES`, `statusLabel`, `sessionTitle`,
  `newestFirst`, `NO_DATE`, `isSessionDate`, `formatSessionDate`.
- `src/lib/domain/sessions/summary.ts`: `SessionSummaryInput`, `liveSession`, `lastPlayedSession`, `nextPlannedSession`,
  `headerLine`, `dashboardNumber`, `nextSessionLine`, `lastSessionText`.
- `src/lib/domain/sessions/spotlight.ts`: `SpotlightRow`, `SpotlightEntry`, `spotlight`, `dueCharacters`.
- `src/lib/domain/sessions/tally.ts`: `SessionTally`, `FearHistoryRow`, `RestRow`, `TallyWindow`, `EMPTY_TALLY`,
  `windowTally`, `addTally`, `TALLY_ROWS`.
- `src/lib/domain/sessions/encounter-title.ts`: `NO_SESSION_ENCOUNTER`, `ENCOUNTER_ROLE_ORDER`, `EncounterTitleEntry`,
  `encounterRoleList`, `sessionEncounterTitle`.
- `src/lib/domain/sessions/index.ts`: re-exports all five.
- `tests/unit/sessions-domain.test.ts`: 33 tests.

## Public API
```ts
type SessionStatus = "planned" | "live" | "played";
statusLabel(status: SessionStatus): string;                                  // Planned / Live / Played
sessionTitle(title: string | null | undefined): string;                      // 'Untitled session' fallback
newestFirst<T extends { n: number }>(sessions: readonly T[]): T[];
isSessionDate(value: string): boolean;                                       // real 'YYYY-MM-DD' only
formatSessionDate(date: string | null | undefined, options?: { locale?: string; weekday?: boolean }): string;

type SessionSummaryInput = { n: number; status: SessionStatus; date?: string | null; recap?: string | null };
liveSession / lastPlayedSession / nextPlannedSession<T extends SessionSummaryInput>(sessions: readonly T[]): T | null;
headerLine(sessions, options?: { locale?: string }): string;                 // 'N sessions · M played · Next: <date>'
dashboardNumber(sessions): string;                                           // 'Session N' / 'No sessions yet'
nextSessionLine(sessions, options?: { locale?: string }): string;            // 'Next session <date>' / '... not scheduled'
lastSessionText(sessions): string;                                           // recap or the two fallbacks

spotlight<Id extends string>(characterIds: readonly Id[], rows: readonly { characterId: Id; count: number }[])
  : { characterId: Id; count: number; due: boolean }[];
dueCharacters<Id extends string>(characterIds, rows): Id[];

type SessionTally = { fearGained: number; fearSpent: number; shortRests: number; longRests: number };
windowTally(fearRows: readonly { kind?: string; action: string; before: number; after: number; at: number }[],
            restRows: readonly { kind: "short" | "long"; status: "open" | "finished" | "interrupted"; startedAt: number }[],
            window?: { from: number; to?: number }): SessionTally;
addTally(stored: SessionTally | null | undefined, current: SessionTally): SessionTally;

sessionEncounterTitle(input: { n: number; instances: readonly { type: AdversaryType | null }[] } | null): string;
encounterRoleList(instances): string;                                        // '1× Leader, 2× Bruiser'
```

## How S0's documents map onto the input types
The module declares structural types, so Convex documents pass straight in (extra fields are fine; `Id<"characters">`
is a string subtype and flows through `spotlight`'s generic).
- `sessions` row -> `SessionSummaryInput` (`n`, `status`, `date`, `recap`); `newestFirst` needs only `n`;
  `sessions.tally` is a `SessionTally` (same four field names as S0's data model).
- `sessionSpotlights` rows -> `SpotlightRow` (`characterId`, `count`); `characterIds` = the active PCs' ids (Q12), in
  the order the card lists them.
- `history` rows of kind `"fear"` (S0 `tallyRows`, index `by_campaign_at`) -> `FearHistoryRow` (`kind`, `action`,
  `before`, `after`, `at`); rows of another kind are ignored, so `tallyRows` may pass them unfiltered.
- `rests` rows (index `by_campaign_started`) -> `RestRow` (`kind`, `status`, `startedAt`).
- `TallyWindow` = `{ from: session.startedAt, to: endedAt }` (omit `to` while live). The window filter checks Fear rows
  by `at` and rests by `startedAt`, the same fields S0's indexes bound, so filtering twice changes nothing.
- `encounterAdversaries` rows -> `EncounterTitleEntry`: S8 resolves each instance's `type` from its `source` (SRD
  catalogue or custom adversary; `null` when the custom adversary is gone) and passes the instances it will place.

## Rules quoted
- **B1** "A session has a number (highest + 1 on create; gaps after a delete are kept), a title ('e.g. The Bridge at
  Dawn'), a date (calendar date only, 'No date set'), and a status Planned / Live / Played. ... The list column shows the
  newest first: 'SESSION n', status chip, title or 'Untitled session', formatted date. Header line: 'N sessions · M played
  · Next: <date of the first planned session that has one>'." -> `statusLabel`, `sessionTitle`, `newestFirst`,
  `formatSessionDate`, `headerLine`.
- **B4** "Spotlight (tap a character for each moment; the least-spotlit are ringed as due ...), Session tally (Fear
  gained, Fear spent, Short rests, Long rests; see Q3)". -> `spotlight`, `TALLY_ROWS`.
- **B7** "A played session can be started again; its start effects run again". With **Q3**: "Restarting a played
  session (B7) adds the new window to the stored counts." -> `addTally`.
- **B9** "Dashboard: hero line 'Session N' (the live one, else the last played, else 'No sessions yet') and 'Next session
  <date>' / 'Next session not scheduled'; the 'Last Session' card shows the last played session's recap, else 'Session N
  was played, but no recap was written. Add one in the session's Wrap-up.', else 'No sessions played yet. Write a recap in
  a session's Wrap-up stage and it will appear here.'" -> `dashboardNumber`, `nextSessionLine`, `lastSessionText`.
- **B11** "uses the live session, else the newest planned one; disabled with the title 'No planned session with an
  encounter'; enabled title 'Session N: 2× Bruiser, 1× Leader'". -> `sessionEncounterTitle` (session choice is S8's).
- **Q3 (a)** "automatic and read-only: Fear gained / spent from the Fear history between the session's start and end
  (increases = gained, decreases = spent; an 'undo' row cancels the change it undoes), short / long rests from the
  FINISHED rests in that window". -> `windowTally`.

## Book pages (re-checked in `.reference-private/` extracted text; printed pages)
- **CB p.154**, "Tracking Fear" (K1): "Fear carries over between sessions, so note how many Fear you have at the end of
  each session and begin the next time with that same pool." The tally only counts history; it never resets Fear.
- **CB p.176**, "Sharing the Spotlight" (K7): "It's rare that every PC will organically have the same amount of spotlight
  time during a given session. In any group, some players are more outgoing than others—and some PCs are instigators,
  while others are more cautious. As the GM, you can help ensure that the story's focus rotates between the PCs, so each
  player has ample time in the spotlight." -> due = the lowest count.
- **CB p.197**, "Battle Guide" (K6): "(3 × the number of PCs in combat) + 2" and "Spend 1 point for each group of Minions
  equal to the size of the party. • Spend 1 point for each Social or Support adversary. • Spend 2 points for each Horde,
  Ranged, Skulk, or Standard adversary. • Spend 3 points for each Leader adversary. • Spend 4 points for each Bruiser
  adversary. • Spend 5 points for each Solo adversary." -> the title's role order is this cost order (the Sessions
  board's ROLES), and a Minion group counts as one entry. Battle Points themselves stay in
  `src/lib/domain/encounters/budget.ts` (no second copy).

## Decisions within the tracer
- Fear `undo` rows (`revertFear`) do not name the row they revert, so they cancel by direction: a decrease takes back
  Fear gained, an increase gives back Fear spent; neither count goes below 0 (undoing a change from before the window
  cancels nothing in it). Rows are applied in `at` order.
- "First planned" / "last played" follow the board's array (creation) order: the planned session with a date and the
  lowest number; the played session with the highest number. A live session's date is not "Next" (B1 says planned).
- `formatSessionDate` formats in UTC at noon, so a 'YYYY-MM-DD' never shifts a day with the viewer's time zone; the
  locale defaults to the runtime's (board: `toLocaleDateString(undefined, ...)`); the dashboard line drops the weekday
  as CampaignHub's `fd` does.
- An instance whose type is unknown (deleted custom adversary) is listed last as 'Adversary'.

## Deviations from the board (deliberate)
- The encounter title lists roles in the board's role order, so the board's example reads '1× Leader, 2× Bruiser'
  (B11's '2× Bruiser, 1× Leader' is the board's insertion order of `Object.entries(roles)`). See QUESTIONS.
- Minion groups are labelled 'Minion group' (Sessions board ROLES) rather than the Combat board's 'Minion', because a D8
  Minion instance is a whole group.
- `dashboardNumber` follows B9 (live, else last played) instead of CampaignHub's count of played + 1.

## Acceptance evidence
- `pnpm vitest run tests/unit/sessions-domain.test.ts`: 1 file, 33 tests pass. Covered: every status label, newest
  first, 'Untitled session', date formats (en-GB, en-US, no weekday, no date, unparsable, no time-zone shift) and
  `isSessionDate`; header line (plural, singular, no next date, live date ignored); live / last played / next planned;
  dashboard number (live first, last played, 'No sessions yet'); next session line; last session recap and both
  fallbacks; spotlight due (lowest, all equal, no rows, unlisted rows, empty party); tally (every action, an undone Fear
  gain, an undo giving Fear back, undo below zero, time order, other kinds, finished rests only, windows, a restarted
  session's tally); encounter title (role order, every role, Minion groups, unknown types, empty encounter, null).
- `pnpm lint` (0 problems), `pnpm typecheck` (clean) and the full `pnpm vitest run --maxWorkers=4`: 138 files, 1600 tests pass.
- No visual spec: S1 has no UI.

## QUESTIONS (reversible minimum taken)
1. Encounter title order: the board's role order (taken) gives '1× Leader, 2× Bruiser'; B11's example shows
   '2× Bruiser, 1× Leader'. If the example should win, the order becomes descending cost (Solo, Bruiser, Leader, ...):
   one array reversal in `ENCOUNTER_ROLE_ORDER`.
2. Minion label: 'Minion group' (taken) or the Combat board's 'Minion'.
3. 'Next session': the planned session with a date and the lowest number (board order, taken), or the earliest date?
4. B9 says 'No sessions yet' when only planned sessions exist (nothing live or played); taken as written.
