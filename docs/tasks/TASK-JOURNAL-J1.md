# TASK-JOURNAL-J1: Journal page shell

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer J1 (wave 1, no dependencies). Bead: `dcm-z9rz.2`.
Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`.

## Goal
`/campaigns/<id>/journal` renders the design's frame for the GM and players: campaign line, H1 'Journal', sub line,
the header-actions slot, the 'Sessions N' / 'Notes N pages' sub-tabs, the Sessions columns with the GM's Plan / Log &
recap toggle and the gold 'Play on the Combat Map' link. Every feature slot is a stub. The old `/sessions` and `/notes`
pages are untouched (mode add; the nav switches in JX1).

## What landed
- **Route** `src/app/(gm)/campaigns/[campaignId]/journal/`: `page.tsx` and `error.tsx` (the session-ended redirect
  plus 'The journal failed to load.' and Try again, like the sessions and notes segments). `<title>` is
  'Journal · <campaign>'.
- **Styles** `src/components/journal/journal.css`: `--jr-*` tokens (page, band, card, gold accent from the settings
  `--brand`, live green, parchment, the four scene-type colours), shared classes (`jr-card`, `jr-card-h`, `jr-lbl`,
  `jr-muted`, `jr-chip`, `jr-type`, `jr-parchment`, `jr-ghost`, `jr-alert`, `jr-m0`), the page shell, the tablet
  breakpoint (1100 px: 260 px list; the right column moves under the centre) and the phone breakpoint (720 px: one
  column, list first). 44 px targets on tablets and coarse pointers. Motion is off under `prefers-reduced-motion`.
- **Contract** `src/components/journal/slots.ts`: the slot table (folder, tracer, exports, where they mount), the
  layout per role and view, the URL state, the rules, every props type, and `parseTab`, `parseSessionView`,
  `defaultSessionId` (the live session, else the newest) and `journalHref`.
- **Shared UI** `src/components/journal/ui/index.tsx`: `SlotBoundary` (CL1, Try again remounts the slot), `Card`
  (gold serif title or small-caps label, plus actions), `Chip` (planned / live with a dot / played / neutral),
  `Parchment` (optional label), `TypeChip` and `SCENE_TYPE_DISPLAY` (Exploration / Social / Combat / Downtime, lucide
  icons).
- **Stubs** (each renders nothing and keeps its name and props): `header/` `JournalHeaderActions`; `session-list/`
  `SessionList`, `PlanSessionButton`, `CampaignSoFar` (plus `useSessionList`, which is real:
  `sessionRecords.list`, read by the page); `session-head/` `SessionHeading`; `plan/index.tsx` `PlanView` and
  `PlanAside` (PlanAside frames JP2's Battle Points panel in the right column, so JP1 picks the scene); `plan/encounter.tsx`
  `SceneEncounter`; `plan/battle-points.tsx` `BattlePointsPanel`; `log/` `SessionLog`; `recap/` `Recap` and
  `AfterSession`; `tally/` `SessionTally` and `Spotlight`; `threads/` `ThreadsRaised`; `notes-tab/` `NotesTab`.
- **Page behaviour**:
  - URL: `?tab=sessions|notes` (default sessions; sessions removes the param), `&s=<id>`, `&sv=plan|log` (GM default
    plan; players always log). Every change uses `router.replace` without scrolling and keeps every other param, so the
    Notes params `view` / `page` / `journal` survive a tab switch. Bad values fall back. `?s` is untrusted (the slots'
    queries load it with `loadSession`).
  - Header: campaign line = the frame name ('The Witherwild'; a Custom-frame campaign shows its own name), H1
    'Journal', sub line, `JournalHeaderActions` on the right.
  - Sub-tabs: ARIA tabs (arrow keys, Home, End). 'Sessions N' = `sessionRecords.list` length (players: live and played
    only). 'Notes N pages' = the caller's `notes.journal` `pageCount`, or the number of default pages before the
    first write.
  - Sessions sub-tab: a left column ('All sessions', list, '+ Plan session' for the GM, Campaign so far). The session area:
    the heading slot; the GM's Plan / Log & recap toggle (ARIA tabs over a tabpanel); the gold 'Play on the Combat Map'
    link (`brandButton` solid, rounded, serif; map and arrow icons) to `/combat-map`, for both roles; then two columns:
    - GM Plan: `PlanView` | `PlanAside`.
    - GM Log & recap: `SessionLog`, `Recap` | `SessionTally`, `Spotlight`, `ThreadsRaised`, `AfterSession`.
    - Player (Q5): `SessionLog`, `Recap` | `ThreadsRaised`, `AfterSession`.
  - Empty states: 'Loading sessions…' (`role="status"`) while the list loads; a 'No sessions yet' card when there is
    none (GM: plan the first one on the left; player: sessions show once the GM starts one).
  - Every slot sits in its own `SlotBoundary`; the body sits in a Suspense boundary for `useSearchParams`.
- **Tests**
  - `tests/unit/journal/j1-shell.test.tsx`: the URL helpers; the page's header, counts, default view, link, tab and
    view switching that keeps params, arrow keys, fallbacks, the player without a toggle, loading and empty states,
    and the Notes count before the journal exists.
  - `tests/unit/error-boundaries-redirect.test.tsx`: the journal segment was added.
  - `tests/e2e/journal/helpers.ts`: `seedJournal(browser)`, the design's table: GM and the e2e player (tests/e2e/live.ts);
    PCs Moss (the player's), Brannoc, Vex and Oriel; sessions 2-7 (2-5 played, 6 'Ambush at the Forest Camp' live,
    7 planned; session 1 is deleted); session 6's four scenes with their texts; the GM prep note; the encounter
    'Jagged Knife ambush' (Lieutenant, Bandit x2, Sniper, Lackey x4). Also `openJournal` and the `JOURNAL_*` constants.
  - `tests/e2e/journal-shell.spec.ts`: the GM and the player load both sub-tabs, check axe and no sideways scroll at
    1440x900 and 390x844, URL state and fallbacks; a `@visual` test writes the shots.

## Buttons
The brand buttons are used, not Arcane Glass: the gold link is `brandButton({ variant: "solid" })` with the
`jr-play` shape; slot alerts use `jr-ghost`. The page has no other buttons (the toggle and the sub-tabs are tabs).
`glassButtonClass` has no gold "go there" role, so it does not fit the Combat Map link.

## Design states matched (shots)
Shots: `test-results/visual/JOURNAL-J1/{gm-plan,gm-log,gm-notes,player-sessions}-{1440,390}.png`, copied to
`C:\Users\Petar\Downloads\dcm-screens\journal-j1\`. Design crops to compare with: header and tabs = the top band of each
panel; Sessions frame = panel 1 (Plan) and panel 2 (Log & recap). With every slot a stub, only the frame matches:
the campaign line, the H1 and sub line, the tab bar (the selected tab joins the lighter band), the 300 px list column
label, the toggle and the gold link at the top right of the session area, and the centre and right columns.

## Data gaps
- Scene titles and states are not stored yet (J0 widens the scene). The seed sets type and text only.
  `JOURNAL_SCENES` carries the titles for JD4 / JP1. The encounter is the session's single encounter until JD4 links
  it per scene.
- Hours at the table, recap sharing and the log windows come with J0 / JD5.

## Not in owns (for later tracers / the orchestrator)
- The plan's common rule names `tests/e2e/visual/JOURNAL-<id>.spec.ts`, but J1's owns do not list it. The shots are a
  `@visual` test inside `tests/e2e/journal-shell.spec.ts` (runs only with `E2E_VISUAL=1`).
- `tests/e2e/unauthenticated.spec.ts` does not list `/journal` yet (JX1 owns it; add `${c}/journal` there).

## Questions (recommended default taken)
1. The player's right column under Log & recap: Q5's answer names the list, heading, recap and log. J1 also mounts
   `ThreadsRaised` (the player's own Notes pages) and `AfterSession`, but not the tally or the spotlight. Default:
   keep them; JTh / JR may render nothing for players.
2. Campaign line: the design shows the frame name ('THE WITHERWILD'); the old Sessions and Notes pages show the
   campaign name. Default: the frame name; a Custom-frame campaign shows its own name.
3. 'Play on the Combat Map' for players: the acceptance does not limit it to the GM. Default: both roles see it.

## Merge-time actions
None: no Convex file changed, no codegen needed.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 493 files, 10709 passed, 1 expected fail.
- `E2E_VISUAL=1 E2E_PORT=3745 E2E_CONVEX_PORT=3845 pnpm test:e2e tests/e2e/journal-shell.spec.ts --workers=1`: 3 passed.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml J1`: OK.
