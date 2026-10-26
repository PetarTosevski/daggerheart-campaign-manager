# TASK-D10-S7: Dashboard - hero session line, Start Session, Last Session card, Witherwild Wither panel; the temporary card goes

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S7 (wave 4, depends on S3, S6). Bead: `dcm-bxp.9`.

## Goal
The dashboard shows the session number and the next date, the GM's Start Session starts the newest planned session and
opens it on Play, the Last Session card shows the last recap, Witherwild shows the Wither Tokens panel with End Session,
and the D5 temporary session card is gone.

## Rules this tracer implements
- **B8** "The dashboard's 'Start Session' (GM) starts the newest planned session, creating one when there is none, and
  opens it on Play." -> `sessions.start` without `sessionId` (S3), then `/sessions?s=<id>&stage=play`.
- **B9** "Dashboard: hero line 'Session N' (the live one, else the last played, else 'No sessions yet') and 'Next session
  <date>' / 'Next session not scheduled'; the 'Last Session' card shows the last played session's recap, else 'Session N
  was played, but no recap was written. Add one in the session's Wrap-up.', else 'No sessions played yet. Write a recap in
  a session's Wrap-up stage and it will appear here.'; 'All sessions' links to the Sessions tab." -> `sessionWrap.dashboard`
  (S6); the next date is formatted in the viewer's locale with S1 `formatSessionDate` (no weekday, as the board).
- **B12** "Witherwild only (CampaignHub l.263-272): the 'Wither Tokens' panel ('N on sheets · M in pool'; 'At the end of
  each session, clear all Wither tokens from the PCs' sheets and gain an equal amount of Fear.') with 'End Session ·
  convert N to Fear'."
- **K4** CB p.261 (re-checked): "At the end of each session, clear all Wither tokens from the PCs’ sheets and gain an
  equal amount of Fear." The pool: the book's "about 20 Wither tokens" (`WITHER_POOL`, reference only, never a cap).
- **K10** "Start/End are GM only"; players see the dashboard's last session.
- Decision 12 / E2: the temporary Session card (`src/components/party/session/index.tsx`) is deleted;
  `boundary.tsx` stays (the Wither counter and the new panels import it). End and the XC1 switch live on S3's live card.

## UI
- `campaign-shell.tsx` hero (dashboard only): `HeroSessionLine` -> 'Session N' · 'Tier T · Level L' · 'Next session
  <date>' (board l.137). `HeroSessionAction` next to 'Open the Tome': GM, nothing live -> the board's accent pill 'Start
  Session' (Cinzel, 52 px; errors in `role=alert`); GM, a session live -> the same pill as a link 'Session N in progress'
  to `/sessions?s=<id>&stage=play`; player, a session live -> a chip with a green dot 'Session N in progress' (no link, no
  button). Both sit in `SlotBoundary`; the line falls back to 'Tier · Level'.
- `last-session.tsx`: the board's card (Cinzel 22 px heading, ghost 'All sessions' link 44 px, EB Garamond 19 px text).
- `wither-panel.tsx` + `dashboard.css`: the board's panel (forest art `/design-assets/c48f7b3b….jpg` under the board's
  wash, the eight spores, which stop under `prefers-reduced-motion`), 'N on sheets · M in pool' from
  `characters.listByCampaign` (every PC, as `end` clears every PC's tokens; corrupt sheets count 0), the rule text, and
  for the GM 'End Session · convert N to Fear' opening the brand `Modal` 'End the session?' with the live card's text and
  buttons 'Cancel' / 'End session'; the report is S3's `endReportLines` in a `role=status` region. Placed under GM Fear as
  on the board.
- `page.tsx`: `SessionButtons` removed, `LastSession` and `WitherPanel` mounted.

## Moved e2e specs (same button and dialog names, scoped to the live card)
- `wither.spec.ts`: Start / End on the Sessions tab ('+ New session', live card 'Start session' -> dialog 'Start the
  session?', 'End session' -> 'End the session?'); every old check stays (Wither badge, 'N Wither token(s) → +N Fear.',
  Fear N pressed, N+1 not, badge gone), plus the panel count before ('N on sheets · 20-N in pool', the End button label)
  and after ('0 on sheets · 20 in pool').
- `class-features.spec.ts`: the GM starts a session on the Sessions tab before the Bard rallies, and ends it there;
  every check stays (Rally refreshed, held dice cleared, 'Session ended.').
- `players.spec.ts` (XC1): the switch is absent before Start and after End, and on the Sessions tab's live card;
  every check stays.
- `dashboard.spec.ts` new test: fallbacks, 'All sessions' href, Wither panel 0/20, no 'Session' card; 'Start Session'
  creates and starts Session 1 and lands on `?s=…&stage=play` with Play selected; back on the dashboard 'Session 1' and
  the 'Session 1 in progress' link to that URL; the panel's End (confirm, 'Session ended.' report) brings 'Start Session'
  back and the 'no recap' fallback; a recap and a dated planned session reach the card and 'Next session …24…2026'; a
  player sees the line and card, no Start button, no panel button, and the chip (not a link) while Session 2 runs.

## Acceptance evidence
- e2e (worktree, ports 3174 / 3460), one run: dashboard (6, incl. the new S7 test), wither (1), players (5), class-features
  (2), sessions-live (1), sessions-shell (4), session-play (3), session-wrap (2), session-records (2): **26 passed**.
  `E2E_VISUAL=1` visual/D10-S7 (1) passed (also with the first run of the four moved specs: 14 passed + the S7 test, fixed
  for S1's straight apostrophe and rerun green).
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 144 files, 1676 tests passed. `pnpm lint` clean (zero warnings),
  `pnpm typecheck` clean. No Convex change.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S7.spec.ts`):
`test-results/visual/D10-S7/{hero-empty,hero,hero-live,hero-player-live,last-session-empty,last-session,wither-panel-empty,wither-panel,wither-panel-player}-{1440,1024,390}.png`.
Board: `node scripts/board-shots.mjs hub:last-session hub:wither-panel` -> `test-results/visual/board/hub-{last-session,wither-panel}-{1440,1024,390}.png`;
the hero has no board-shots region, so an ad-hoc shot of the board header (same story) -> `test-results/visual/board/hub-hero-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Hero line | Matches the board's row ('Session N · Tier · Level · Next session Oct 24, 2026'). Deviation (binding B9): the board counts 'Session 2' (played + 1 upcoming); the app shows the live one, else the last played ('Session 1'). |
| Start Session | Matches the accent pill (Cinzel, letter-spaced, 52 px) right of 'Open the Tome'. Additions: 'Session N in progress' pill (GM) and chip (players) while live; the board has neither. |
| Last Session | Matches heading, ghost 'All sessions', serif recap. |
| Wither panel | Matches heading, '3 on sheets · 17 in pool', rule text, purple End button. The art shows (the board shot cannot load `/_blob/` images, so its panel is plain dark). Players: the panel without the button. |
| 1024 | Hero buttons wrap under the line when the title is long (flex-wrap, as the board). Cards as at 1440. |
| 390 | One column, buttons stacked under the line, no horizontal scroll (checked by `visual()`); the board has no phone layout. |

## QUESTIONS
1. The hero's 'Start Session' starts at once, without the live card's confirm (the board starts at once and the plan's
   acceptance names no dialog). The start is undoable from the feed (E6), and the Play stage's log shows 'Session
   started.' A confirm would be a small UI-only change.
2. The Wither panel's 'End Session' is enabled also with no session live (the board's button always works, and E2 keeps
   `end` meaningful without a live session: tokens become Fear, session effects clear). It could instead be disabled
   until a session is live.
3. `class-features.spec.ts` no longer exercises 'End with no session live' through the UI (E2's no-live path); the
   Sessions live card only offers End while live. The path is still covered by `tests/convex/sessions.test.ts` and is
   reachable through the Wither panel. The spec now starts the session before the rally, which is the real table flow.

## Notes for S9
- Dashboard 'Start Session' = `sessions.start({ campaignId })`; the result's `sessionId` is opened on Play.
- Test ids: `hero-session`, `hero-next-session`, `last-session-text`, `wither-panel-count`.
