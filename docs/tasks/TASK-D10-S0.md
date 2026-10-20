# TASK-D10-S0: D10 foundation

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S0 (wave 1, foundation, no dependencies). Bead: `dcm-bxp.9`.
Rules: B1–B12, K1–K10, E1–E7 and the answers Q1–Q12 (all defaults, user 2026-10-20) in the plan header.

## Goal
The sessions tables and the widened campaignState exist and are purged with their campaign, the session error codes and
helpers are wired, and `/campaigns/<id>/sessions` opens a board-look page (header, nav with Sessions current, list column
and detail column with stage tabs and stubs) for the GM and a read-only stub for players.

## Rules this tracer implements
- Data model of the plan header: every table, field and index below; "Widen only: no existing validator changes shape."
- B1 "A session has a number (highest + 1 on create; gaps after a delete are kept) … status Planned / Live / Played" →
  `insertSession` / `nextNumber`, `sessionStatusValidator`.
- B2 "Three stages per session, as tabs: Prep, Play, Wrap-up." → the page's tabs, `?stage=prep|play|wrap`.
- Q3 (tally from the Fear history and finished rests) → `tallyRows`.
- Q4 (players: read-only list of live and played sessions, never prep) → players get no stage tabs, live card or stages.
- Q5 (milestone runs the roster's 'Party levels up') → `convex/lib/partyLevelUp.ts`, shared by `levelUp.partyLevelUp`.

No new public Convex function (the first ones come with S2), so nothing is new for the authz matrix and RETURNS_PENDING
is unchanged. `levelUp.partyLevelUp` keeps its args, returns and behaviour.

## What was built
- **Tables** (`convex/tables/sessions.ts`, composed in `convex/schema.ts`; validators once in
  `convex/lib/validators/sessions.ts`, no `v.any()`, typed so no `schemaVersion`):
  - `sessions` {campaignId, n, title?, date? ('YYYY-MM-DD'), status planned|live|played, startedAt?, endedAt?, recap?,
    milestoneAt?, tally? {fearGained, fearSpent, shortRests, longRests}, createdAt, updatedAt}; indexes `by_campaign_n`,
    `by_campaign_status_n`, `by_campaign_started`, `by_campaign_ended`.
  - `sessionPrep` {campaignId, sessionId, scenes [{id, type combat|social|exploration|downtime, text}], hooks?, loot?,
    threads?, encounterId? (Q1), updatedAt}; indexes `by_session`, `by_campaign`.
  - `sessionLog` {campaignId, sessionId, at, text, by (users), auto}; indexes `by_session_at`, `by_campaign`.
  - `sessionSpotlights` {campaignId, sessionId, characterId, count}; indexes `by_session_character`, `by_campaign`.
  - `campaignState.liveSessionId?` (`v.id("sessions")`), widen only; `sessionStartedAt` / `extraCharactersSession` unchanged.
- **Caps** (`convex/lib/validators/sessions.ts`): MAX_SESSIONS 300, MAX_SCENES 20, MAX_LOG_ENTRIES 500, `SESSION_TEXT_MAX`
  (title 120, scene 300, log 300, hooks 4000, recap 6000, loot 2000, threads 4000), `SESSION_STATUSES`,
  `SESSION_SCENE_TYPES`, and the types `SessionStatus`, `SessionSceneType`, `SessionScene`, `SessionTally`.
- **Helpers** (`convex/lib/sessions.ts`): `loadSession` (normalizeId, campaign-scoped, SESSION_NOT_FOUND), `liveSession`,
  `newestPlannedSession`, `lastPlayedSession`, `sessionsNewestFirst`, `sessionPrepOf`, `nextNumber`, `insertSession`
  (SESSION_LIMIT; optional title / date / status / times for S2, S3 and the S3 migration), `assertCanAddLog`
  (SESSION_LOG_LIMIT), `cleanText(field, value)` (trim + cap, INVALID), `isSessionDate` / `assertSessionDate`,
  `deleteSessionRows` (prep, log, spotlights; the linked encounter stays), `tallyRows(ctx, campaignId, from, to?)`
  (Fear history rows by `by_campaign_at`, rests by `by_campaign_started`, each `.take(MAX_TALLY_ROWS + 1)` with a
  `truncated` flag).
- **Party level-up** (`convex/lib/partyLevelUp.ts`): `partyLevelUp(ctx, campaignId, actorId)`, the unchanged body of
  `levelUp.partyLevelUp`, which now calls it inside its `ctx.once`.
- **Errors** (`src/lib/errors/sessions.ts`, joined into `AppErrorCode` and `convex-errors`): SESSION_NOT_FOUND,
  SESSION_LIMIT, SESSION_LIVE, SESSION_LOG_LIMIT, SESSION_LOG_NOT_FOUND, SESSION_SCENE_LIMIT, SESSION_SCENE_NOT_FOUND,
  SESSION_NO_ENCOUNTER, SESSION_HAS_ENCOUNTER.
- **Purge** (`convex/cleanup.ts`): one step per sessions table by its campaign index. schema-guard: the four tables are
  CAMPAIGN_SCOPED.
- **Page** (`src/app/(gm)/campaigns/[campaignId]/sessions/`): `page.tsx`, `error.tsx`, `sessions.css` (the board's
  classes and `--ss-*` tokens, accent from the settings `--brand`). Header: campaign name, H1 "Sessions", header line
  slot, '+ New session' slot (GM). Left column "All sessions" + list slot. Detail: GM gets header card, live card, the
  Prep / Play / Wrap-up tabs (ARIA tabs, arrows / Home / End) and the stage slot in a tabpanel; players get the read-only
  view only; nothing selected → "No session selected". URL state `?s=<id>&stage=…` via `router.replace`; a bad stage
  is Prep. Every slot sits in its own error boundary; `<title>` "Sessions · <campaign>". The nav entry existed (not
  gmOnly); the static route replaces the `[section]` placeholder.
- **Slots** (`src/components/sessions/slots.ts`, the contract with its table): `SessionStage`, `SESSION_STAGES`,
  `parseStage`, `SessionsPageProps`, `SessionSlotProps` (campaignId, sessionId, isGm, stage, onStage) and the props of
  each slot. Stubs: `list/` (`useDefaultSessionId` → null, `SessionHeaderLine`, `NewSessionButton` disabled,
  `SessionList` empty state), `detail/` (`SessionHeaderCard`, `PlayerSessionView`, `NoSessionSelected`), `live/`
  (`LiveCard` idle), `prep/` (`PrepStage`), `play/` (`PlayStage`), `wrap/` (`WrapStage`).
- **Visual tooling**: `scripts/board-shots.mjs sessions:<empty|list|prep|play|wrap|live>` and
  `hub:<last-session|wither-panel>` at 1440, 1024, 390 (fixed localStorage story: party of two with Wither tokens, three
  sessions, Session 3 fully filled); `tests/e2e/visual/helpers.ts`: `D10_VIEWPORTS`, `openSessions(page, {frame, query})`.

## Acceptance evidence
- `tests/convex/cleanup.test.ts`: the seed has a row in each sessions table (the coverage test fails for a campaign
  table not seeded); the purge test leaves nothing; a new test deletes one session's rows (33) and keeps the linked
  encounter and another session's log.
- `tests/convex/party-level-up.test.ts`: active / away / level 10 / already flagged / unreadable characters; the
  mutation's result, flags and log rows; the helper gives the identical outcome; idempotency; anonymous, outsider,
  player, GM. The same file passes against the pre-S0 `convex/levelUp.ts` (4/4), so the behaviour is unchanged.
- `tests/e2e/sessions-shell.spec.ts`: GM nav, title, header line, '+ New session', empty list and detail; tabs follow
  `?stage` (click, keyboard, reload, bad value → Prep); a player has no new-session button, tabs, live card or stage
  even with `?s&stage` in the URL; 390 px one column, no horizontal scroll, tabs ≥ 44 px.
- Full counts: see the tracer report.

## Visual comparison
App: `test-results/visual/D10-S0/{empty,prep}-{1440,1024,390}.png` (E2E_VISUAL=1).
Board: `test-results/visual/board/sessions-{empty,list,prep,play,wrap,live}-{1440,1024,390}.png`,
`test-results/visual/board/hub-{last-session,wither-panel}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Header (campaign name, title, header line, '+ New session') | Matches the board's type, line and gold pill. Deviation: the art banner, wordmark, nav and Back link come from the shared campaign shell above the page (as on D9), so the title block sits on the page background. The pill is disabled until S2. |
| List column (empty) | Matches the board's "All sessions" label and dashed empty box. Entries (`ss-item`, `ss-chip`) are styled for S2. |
| Detail (none selected) | Matches the board's card and copy. |
| Detail (session selected, Prep) | Card order, live card idle look and the tab strip match the board; card bodies are stubs until S2–S6. |
| 1024 | Two columns, list 260 px (board: 300 px) to give the detail more room. |
| 390 | One column (list, then detail), full-width tabs and pill, 44 px targets, no horizontal scroll. The board has no phone layout (its detail collapses; the board's 390 stage shots are full-page for that reason). |

## QUESTIONS
1. The plan names `tests/e2e/visual/<id>.spec.ts` for D10 tracers, but `tests/e2e/visual/S0.spec.ts` … `S13.spec.ts`
   already exist (sheet redesign) and S2–S9 would overwrite them. Reversible minimum here: S0 shoots from its own shell
   spec into `test-results/visual/D10-S0/`. Suggest the orchestrator renames the D10 visual specs in the plan to
   `tests/e2e/visual/D10-S<n>.spec.ts` with shot folders `D10-S<n>`.
2. No shared `<Loading>` component exists (the plan names one); as on D9, slots use `<p role="status" className="ss-muted">`.
3. Added three codes the plan did not list but its acceptance implies (setScene / removeLog with a stale id; one
   encounter per session): SESSION_SCENE_NOT_FOUND, SESSION_LOG_NOT_FOUND, SESSION_HAS_ENCOUNTER. Unused codes cost nothing.
