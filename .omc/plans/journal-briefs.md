# Journal: tracer briefs (2026-11-03)

Plan: `.omc/plans/journal.yaml` (4 waves, 21 tracers; `node scripts/plan-check.mjs .omc/plans/journal.yaml` OK, no file
owned twice in a wave). Design: `reference/designs/journal/journal_views.jpg` (2200x614, three panels: Sessions / Plan,
Sessions / Log & recap, Notes; crop and zoom it to read the small text). Epic: bead dcm-z9rz.

**Status:** the plan follows the recommended default of every open question at the end of this file. Before launching a
tracer whose acceptance names a question (Qn), check the user's answer; if it differs, rewrite that tracer's acceptance
first. No tracer runs before the user has answered Q4, Q6 and Q8: those change data.

## User answers 2026-11-03 (binding)

- One **Journal** tab replaces Sessions and Notes, where Sessions was: Dashboard, Party, Codex, World Map, Combat Map,
  Adversaries, Journal, Lorekeeper (`src/lib/campaign-sections.ts`). `/sessions` and `/notes` redirect to the Journal
  sub-tabs.
- **Delete** the old Sessions UI the design does not show (Play stage with its tracker link and chips, the session
  feature panels, …). Keep all data. The removal list below gives each piece per file.
- **Spotlight per PC per live session** is new data: count every spotlight move to a PC during the live session
  (`convex/lib/spotlight.ts`, H1.S); the GM can reset it.
- **Session log** = automatic from the action feed during the session (time span or tagged) plus GM add / edit / hide.
  Hiding never deletes feed rows.
- **Reuse, don't duplicate:** encounters and Battle Points come from the Adversaries builder
  (`src/components/adversaries/builder/*`, `budget-panel.tsx`, `encounters.get`); play happens on the Combat Map.

## Batches and launch order

| Wave | Batch | Tracers | Start |
|---|---|---|---|
| 1 | - | J0, J1, JD1 | at once (no shared files) |
| 2 | A | JD2, JD3a, JD3b, JD4, JD5, JD6 | when J0 is merged (at most 5 at once: JD3b last) |
| 2 | B | JH, JN | when J1 is merged (may run beside batch A) |
| 3 | A | JS, JP1, JP2, JL, JR | when their server tracer is merged |
| 3 | B | JT, JTh, JN2 | JT after JD1 + JD3a, JTh after JD6 + JN, JN2 after JN and the user's Q12 / Q13 answers |
| 4 | A | JX1 | every wave 3 tracer merged, full e2e suite green, the user's go-ahead |
| 4 | B | JX2 | when JX1 is merged |

At most 5 tracers run at once. Only the orchestrator merges, in dependency order, one squashed commit each; codegen
after every merge that adds or changes a Convex file (J0, JD1-JD6). `convex/schema.ts` needs no change: J0 adds its two
tables to `sessionTables` in `convex/tables/sessions.ts`, which the schema already composes. Each server tracer has its
own authz area file (`tests/convex/authz/journal-<area>.entries.ts`), so no entries file is shared.

**Concurrency with other plans.** While this plan runs, keep other lanes off: `convex/lib/spotlight.ts` (JD1, the HUD's
H1.S file: check no combat-hud tracer owns it), `convex/lib/characterSheet.ts` (JD3b, engine-shared), `convex/sessions.ts`
and `convex/lib/sessions.ts` (J0, JD4), `src/components/adversaries/builder/budget-panel.tsx` (JP2),
`campaign-shell.tsx` (JX1). The combat-hud plan's `hud/scene/index.tsx` reads `sessionWrap.dashboard`; JD5 keeps that
return shape.

## Design element → code / data

| Design element | Existing code today | Data | Gap → tracer |
|---|---|---|---|
| Nav "Journal" | `campaign-sections.ts` has Sessions + Notes | - | JX1 |
| Header "THE WITHERWILD / Journal / Every session…" | Sessions header (`ss-head`), Notes hero (`bj-hero`) | campaign frame | J1 |
| "Session 6 · live" chip + End session | Live card (`sessions/live`): Start / End dialogs, Wither choice, report | `sessions.current`, `sessions.start/end` | JH (reuses the helpers) |
| Tome button | dashboard "Open the Tome" (`useOpenTome`) | - | JH |
| "Open threads 5" | Notes `ThreadsButton` | `notesThreads.threads` (caller's open tasks + unresolved Fear) | JH (Q1) |
| Sub-tabs "Sessions 6" / "Notes 11 pages" | - | `sessionRecords.list`, journal `pageCount` | J1 |
| All sessions list, Planned / Live chip | `sessions/list` `SessionList` | `sessionRecords.list` | JS |
| "+ Plan session 8" | `NewSessionButton` | `sessionRecords.create` | JS |
| Campaign so far: sessions played, party level | - | sessions list, `campaign.level` | JS + JD5 `summary` |
| Campaign so far: hours at the table | - | **new**: `sessions.playedMs` (J0 accumulates at End) | J0, JD5, JS (Q3) |
| Campaign so far: open threads | Notes threads | `notesThreads.threads` | JS (Q1) |
| Heading "Session 6 · Sun 2 Nov · 19:10", title, Live | `SessionHeaderCard` (inputs) | `sessions` title / date / startedAt | JS (Q11) |
| Plan / Log & recap toggle | Prep / Play / Wrap-up tabs | URL | J1 |
| "Play on the Combat Map →" | session chips link back from the map | - | J1 (link) |
| Planned scenes: type chip, text | `sessions/prep/scenes.tsx` (select + input) | `sessionPrep.scenes` {id, type, text} | JP1 |
| Scene title; Done / Playing now / Next | - | **new** scene `title?`, `state?` (J0 widen) | JD4, JP1 (Q7) |
| "Scene 1 began · The old road north" log line | - | **new** sessionLog `event: 'scene'` | JD4 writes, JD2 lists |
| Combat scene's encounter: name, adversary chips, BP cost | `sessions/prep/encounter.tsx` (one encounter per session) | `sessionPrep.encounterId`, `encounters.get` | JD4 per-scene link **new** `scene.encounterId?`, JP2 (Q6) |
| "On the Combat Map", "Open map", "Edit in Adversaries" | `encounterTrackerHref`; `combatTokens.placeSessionEncounter` | tokens of the encounter | JD4 `onMap`, JP2 |
| Battle points · Scene 3 panel | `adversaries/builder/budget-panel.tsx` | `encounters.get`, `encounters.setBudget` | JP2 adds a `journal` variant |
| GM prep parchment | "Hooks & loose threads" textarea | `sessionPrep.hooks` | JP1 (same field) |
| Session log lines with icons, x, caption | Play stage `LogCard` (GM lines only) | `sessionLog` + **new** merge of `actionLog`, `history` (Fear), `encounters` in the live windows | J0 windows, JD2, JL |
| Hide / edit a feed line | `feed.remove` (feed-wide, display only) | **new** `sessionLogOverrides` | J0, JD2, JL |
| "Add a log entry…" + Add | `LogCard` add | `sessionPlay.addLog` | JL (reuse) |
| Recap parchment + Edit recap | Wrap-up recap textarea | `sessions.recap` | JR |
| Share with players | players read every recap (D10 Q4) | **new** `sessions.recapSharedAt` | J0, JD5, JR (Q4) |
| Tally: Fear gained / spent | Play `TallyCard` | `history` + stored `tally` | JD3a, JT |
| Tally: Hope spent, HP marked | - | **new** `sessionCharacterStats` via a `saveSheet` hook | J0, JD3b, JD3a (Q8) |
| Tally: Adversaries defeated, Critical successes | - | derived: encounter instances, roll outcomes in the windows | JD3a (Q8) |
| Spotlight bars, Reset, "least spotlight" line | Play `SpotlightCard` (manual taps) | `sessionSpotlights` (exists) + **new** auto count on moves | JD1, JT (Q9) |
| Threads raised + "In Notes" | Wrap-up "Countdowns & threads" text | open entries on pages linked to the session (`journalPages.sessionId`) | JD6, JTh (Q2) |
| After the session: Level-ups, Loot | Wrap-up Milestone button, Loot textarea | `actionLog` levelUp rows, `milestoneAt`, `sessionPrep.loot` | JD5 `after`, JR |
| Notes: Writing as chips | dropped by D11 A2; GM has "Players' journals" list | `notesJournals.playerJournals`, `journalView` | JN2 (Q12) |
| Notes: search, groups, page, bullets, @mentions, Migrate open tasks, Quick keys | `src/components/notes/**` | journals / pages / entries | JN (moved as is), JN2 (Q13) |
| Page "Linked to Session 6 · written by the GM" | page header with the linked session (N2) | `journalPages.sessionId` | JN (as is) |

## Common rules (every tracer)

- Read CLAUDE.md, AGENTS.md, docs/workflow.md, docs/best-practices.md (sections 1-2 for server tracers, 3-4 for UI),
  docs/testing.md, this brief, your block in `journal.yaml`, and the task docs of the tracers you depend on
  (`docs/tasks/TASK-JOURNAL-*.md`). Look at the design (crop the panel you build).
- First step, before any edit: `git switch -C journal-<id> rebuild` (e.g. `journal-j0`, `journal-jd3a`). Then
  `node scripts/worktree-setup.mjs` and `E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm e2e:setup` once.
- Owns are binding: `pnpm tracer:guard journal <ID>`. An edit an existing test forces outside owns: stop and report.
- **Add, don't delete, until wave 4.** The old `/sessions` and `/notes` pages and their specs keep working until JX1 /
  JX2. Journal tracers may import from `src/components/sessions/**` only where the plan says so (JH: the live helpers);
  everything else is rebuilt under `src/components/journal/**` so JX2 can delete the old folders.
- **Server work** (J0, JD1-JD6): wrappers from `convex/lib/functions.ts` (`gmQuery`, `gmMutation`, `keyedGmMutation`,
  `campaignQuery`), access only through their `need:` (permissionFor), `args` and `returns` validators, no `v.any`,
  indexed reads with a bounded `.take` (no `.filter` on queries), widen only (optional fields), errors as
  `ConvexError<AppError>` with codes from `src/lib/errors/sessions.ts` (J0 adds them all), authz entries in your own area
  file for anonymous / outsider / player / grantee / GM, tests assert `ConvexError.data.code`.
- **Growing data:** `sessionLogOverrides` (capped per session), `sessionCharacterStats` and `sessionSpotlights` (one row
  per PC per session) are bounded per session and deleted with the session (`deleteSessionRows`) and the campaign
  (`cleanup.ts` purge). No table here only grows, so rule 8 needs no new cron; if a reviewer disagrees, add the cron in
  J0, not later.
- **Live windows:** a session can be started again after it was played (D10 B7). Every "during the session" read uses
  J0's `liveWindows(ctx, session)`, never `startedAt` alone.
- **UI rules:** an error boundary around every `useQuery` subtree; `undefined` = loading with a `role="status"` line;
  mutations are intents with optimistic updates where a click has visible latency (scene state, Reset, hide, recap,
  share); no mutations or prop copies in effects; no `key=` on live content; modals on `src/components/brand/modal.tsx`;
  motion off under `prefers-reduced-motion`; 44 px targets; axe clean.
- **Board match:** each UI tracer writes `tests/e2e/visual/JOURNAL-<id>.spec.ts` (runs with `E2E_VISUAL=1`) at 1440x900
  and 390x844 and puts the shots beside the matching crop of the design in its task doc. Sample content (Moss, Brannoc,
  Vex, Oriel, "Ambush at the Forest Camp") comes from `tests/e2e/journal/helpers.ts`.
- Checks: `pnpm lint`, `pnpm typecheck`, vitest (`--maxWorkers=1 --testTimeout=120000`; focused while iterating, full
  suite once before the commit), your e2e specs.
- Write `docs/tasks/TASK-JOURNAL-<id>.md`: what landed, design states matched (with shots), data gaps, questions,
  merge-time actions. Commit once on your branch, author petar, no Co-Authored-By trailer. Never push, merge or close beads.

## Per-tracer briefs

### Wave 1

**J0 · Data foundation.** Widen `convex/lib/validators/sessions.ts` (scene `title?`, `state?`, `encounterId?`; session
`playedMs?`, `recapSharedAt?`; log line `event?`, `editedAt?`) and add `sessionLogOverrides` and `sessionCharacterStats`
to `sessionTables`. `convex/sessions.ts`: Start / End lines get `event`, End adds the window to `playedMs`. Add
`liveWindows` to `convex/lib/sessions.ts` (legacy lines matched by their text), extend `deleteSessionRows` and the
campaign purge in `cleanup.ts` (and `tests/convex/cleanup.test.ts`). Add every new error code. Pure helpers in
`src/lib/domain/journal/` with unit tests. No UI, no new public function.

**J1 · Page shell.** New route `journal/` (page, error, css), `src/components/journal/slots.ts` (the contract table, as
`src/components/sessions/slots.ts` does), shared `ui/` (Card, Chip, Parchment, TypeChip, SlotBoundary), and a stub
`index.tsx` for every slot folder plus the two JP2 stubs (`plan/encounter.tsx` `SceneEncounter`, `plan/battle-points.tsx`
`BattlePointsPanel`) so JP1 and JP2 can work in the same wave. URL state: `?tab`, `?s`, `?sv`, plus the notes params.
The default selected session: the live one, else the newest. The e2e seed in `tests/e2e/journal/helpers.ts` is the
design's scene; every later spec uses it.

**JD1 · Spotlight auto-count.** One change in `setHolder` (`convex/lib/spotlight.ts`): after a real move to a PC, if a
session is live, upsert `sessionSpotlights` + 1. It runs inside `handTo`'s keyed `once`, so a retry counts once. Do not
touch `combatSpotlight.ts` or the HUD.

### Wave 2

**JD2 · Session log.** `convex/journalLog.ts`. Merge per window: `actionLog` (`by_campaign_at`, leave out undone rows;
GM-only rows are fine since the log is GM only; rows the GM removed from the feed stay unless hidden here), `history`
fear rows (`by_campaign_at`), encounters with `startedAt` / `endedAt` in a window (a campaign's encounters are bounded;
read by campaign index), and the session's `sessionLog` lines. Apply overrides. Format title / sub with J0's helpers
(a roll row: title = summary or the GM's override, sub = "Vex rolled 16 with Hope · Presence"). `hide`, `unhide`,
`setText` write overrides only; GM lines are edited in place. Reuse `sessionPlay.addLog` / `removeLog`.

**JD3a · Tally.** `convex/journalTally.ts`, read-only. Reuse `tallyRows` and `windowTally` for Fear; count criticals
from roll rows; count defeated instances of encounters started in the windows; sum `sessionCharacterStats`.

**JD3b · Hope / HP counters.** The only engine-file tracer. In `saveSheet`, compare the stored sheet with the new one;
when a session is live, add the Hope drop and newly marked HP to `sessionCharacterStats`. Check how the sheet stores HP
(marked count or HP left) before writing the diff. Run the whole convex suite: every sheet write passes through here.

**JD4 · Plan server.** `convex/sessionPrep.ts` + `currentSessionEncounter` in `convex/lib/sessions.ts`. Per-scene
encounters use D8's rows; a legacy session encounter is read as the first Combat scene's (no migration). `setSceneState`
writes the "Scene N began" line only while live. Keep `combatTokens.sessionEncounter` / `placeSessionEncounter` /
`sessionPrep.current` shapes (the Combat Map and the tracker chip use them).

**JD5 · Recap, hours, after, summary.** `shareRecap`; recap gating for players in `sessionRecords.list` and
`sessionWrap.dashboard` (the dashboard's Last Session card for players then shows the newest shared recap or the
fallback); the batched migration in `convex/migrations/journalRecap.ts` registered in `run.ts`; `summary`; `after`.

**JD6 · Threads raised.** `convex/journalThreads.ts`: the caller's own journal only (as `notesThreads.threads`), pages
whose `sessionId` is the session, open entries.

**JH · Header actions.** Import the End / Start helpers from `src/components/sessions/live` (JX2 moves them). The extras
switch (XC1) moves into the live chip's menu (Q10). The Start report and End report show in a polite status under the
chip.

**JN · Notes sub-tab.** Move `NotesBody` out of `notes/page.tsx` into `src/components/notes/notes-body.tsx` with a
`chrome` prop; move `notes.css` next to it (the route imports it from there). The old route keeps rendering the hero, so
every notes spec passes unchanged until JX1.

### Wave 3

**JS · List, Campaign so far, heading.** Define `useSessionList` in `journal/session-list` (do not import the old
`sessions/list`). Players: live and played sessions only. Title / date edit and the menu per Q11.

**JP1 · Scenes and GM prep.** Scene cards as in the design (number badge, type chip with icon, title, serif text, state
at the right; the playing Combat scene has a gold ring). Mounts JP2's components.

**JP2 · Encounter card and Battle Points.** Add `variant="journal"` to `BudgetPanel` (same intent, same optimistic
update); the default rendering and the Adversaries specs stay unchanged. Add a unit test for both variants.

**JL · Log.** Icons per source (scene, social roll, combat, spell, Fear, hit, defeat). Hidden lines: "Show N hidden".

**JR · Recap and After.** Share state visible on the button. Player view: shared recap only.

**JT · Tally and Spotlight.** Six tiles, bars, Reset, the least-spotlight line. No +1 tap (Q9).

**JTh · Threads raised.** "In Notes" opens the page in the Notes sub-tab.

**JN2 · Writing as and groups.** Only after the user answers Q12 / Q13. With the defaults: chips over the existing
journal view, labels unchanged.

### Wave 4

**JX1 · Nav, redirects, links, notes specs.** See the plan. The Last Session card and the hero session line stay on the
dashboard (they are on the CampaignHub board), only their links change.

**JX2 · Delete the old Sessions UI.** Work through the removal list. Move the live helpers. Rewrite or delete every
listed spec, naming the Journal spec that covers each deleted case. List the server functions left without a UI in the
task doc (see "Follow-up beads").

## Removal list (old Sessions UI, per file; consumers grepped 2026-11-03)

Consumers of `src/components/sessions/**` outside the folder: `sessions/page.tsx`, `wither-panel.tsx` (live helpers),
`combat-map/page.tsx` (`LiveSessionChip`), `adversaries/tracker/index.tsx` and `top-bar.tsx` (`TrackerSessionChip`).
Consumers of the `/sessions` URL: `campaign-shell.tsx` (HeroSessionAction), `last-session.tsx`, `session-chip.tsx`.
Consumers of `/notes`: none in src outside the route.

| File | Piece | Replacement / fate | Tracer |
|---|---|---|---|
| `src/lib/campaign-sections.ts` | Sessions and Notes nav entries | one Journal entry where Sessions was | JX1 |
| `src/app/(gm)/campaigns/[campaignId]/sessions/page.tsx` | page shell, H1 "Sessions", header line "N sessions · M played · Next", Prep / Play / Wrap-up stage tabs, `?stage` | redirect to `/journal?tab=sessions`; H1 → Journal header; header line **dropped** (counts on the sub-tab); stage tabs → Plan / Log & recap toggle | JX1 |
| `…/sessions/sessions.css`, `…/sessions/error.tsx` | styles, error page | deleted; error.tsx kept minimal for the redirect segment or dropped with the test entry | JX1 |
| `…/notes/page.tsx` | Notes route and hero (`JournalHeading` "Game Master's Journal", ThreadsButton, Download) | redirect to `/journal?tab=notes`; hero → Journal header (Open threads); Download → Notes index column; `JournalHeading` **dropped** in the Journal | JN, JX1 |
| `src/components/sessions/slots.ts` | slot contract | `src/components/journal/slots.ts` | J1, JX2 |
| `sessions/list/index.tsx` | `SessionList`, `useSessionList`, `useDefaultSessionId`, `SessionHeaderLine`, `NewSessionButton` | `journal/session-list` (list, hook, "+ Plan session N"); header line **dropped** | JS, JX2 |
| `sessions/detail/index.tsx` | `SessionHeaderCard` (title input, date input, Mark as played, Delete twice) | `journal/session-head` inline edit + menu (Q11) | JS, JX2 |
| `sessions/detail/index.tsx` | `PlayerSessionView` (number, status, title, date, recap) | Journal for players: list + session heading + shared recap | JS, JR, JX2 |
| `sessions/detail/index.tsx` | `NoSessionSelected` copy | J1 empty state | J1, JX2 |
| `sessions/live/index.tsx` | `LiveCard`: dot, "Session in progress / Not running", Start / End buttons and dialogs, start / end report | header live chip, End / Start dialogs, report under the chip | JH, JX2 |
| `sessions/live/index.tsx` | "Allow extra characters this session" switch | live chip menu (Q10) | JH |
| `sessions/live/index.tsx` | `endReportLines`, `useWitherChoice`, `WitherChoiceField`, `endDialogText` | moved to `journal/end-session` (wither-panel imports them) | JX2 |
| `sessions/prep/scenes.tsx` | `Scenes` (type select, text input, x, "+ Scene") | JP1 scene cards ("+ Add scene") | JP1, JX2 |
| `sessions/prep/scenes.tsx` | `Hooks` textarea "Hooks & loose threads" | GM prep parchment (same `hooks` field) | JP1, JX2 |
| `sessions/prep/encounter.tsx` | `NoEncounter` (create / link), `LinkedEncounter` builder, instance rows with x, "+ Add adversary" dialog, "Open Adversaries", "Unlink" | JP2 encounter card on the Combat scene (create / link / unlink kept; adding / removing adversaries **dropped** here: "Edit in Adversaries") and the Battle Points panel | JP2, JX2 |
| `sessions/prep/index.tsx`, `prep.css` | Prep stage layout | Plan view | JP1, JX2 |
| `sessions/play/index.tsx` | `SpotlightCard` (tap +1 pills, Reset) | JT bars, automatic counts, Reset (tap **dropped**, Q9) | JT, JX2 |
| `sessions/play/index.tsx` | `TallyCard` (Fear gained / spent, short / long rests) | JT six tiles (rest tiles **dropped**; data kept) | JT, JX2 |
| `sessions/play/index.tsx` | `LogCard` (GM lines, add, x) | JL session log | JL, JX2 |
| `sessions/play/encounter-card.tsx` | Play-stage Encounter card (status, Start encounter, adversary list, tracker link, "Session N" chips) | **dropped**; the Plan view's encounter card and "Play on the Combat Map" replace it | JX2 |
| `sessions/play/play.css` | styles | deleted | JX2 |
| `sessions/wrap/index.tsx` | Recap textarea | JR recap parchment, Edit recap, Share | JR, JX2 |
| `sessions/wrap/index.tsx` | "Loot & gold" textarea | JR "After the session: Loot" (inline edit) | JR, JX2 |
| `sessions/wrap/index.tsx` | "Countdowns & threads" textarea | **dropped** from the UI (field kept; Q2) | JX2 |
| `sessions/wrap/index.tsx` | "Milestone reached: the party levels up" button | **dropped** (Party tab's "Party levels up" stays); "Level-ups" line is read-only | JX2 |
| `sessions/wrap/wrap.css`, `detail.css`, `list.css`, `live.css` | styles | deleted | JX2 |
| `src/components/sessions/session-chip.tsx` | `sessionPlayHref` → Play stage | kept; href → Journal log view | JX1 |
| `campaign-shell.tsx` | `HeroSessionLine`, `HeroSessionAction` (Start Session, "Session N in progress") | kept (CampaignHub board); links → Journal log view | JX1 |
| `last-session.tsx` | Last Session card, "All sessions" link | kept (CampaignHub board); link → "Open the Journal" | JX1 |
| `wither-panel.tsx` | End Session from the dashboard | kept; import path moves | JX2 |

Specs moved or deleted in the cut-over: JX1 owns the notes specs (`notes-*.spec.ts`, `live-notes.spec.ts`,
`visual/D11-*`), `dashboard`, `horizon`, `unauthenticated`, `a11y-play`, `visual/D10-S7`; JX2 owns the sessions specs
(`session-encounter`, `session-play`, `session-prep`, `session-records`, `session-wrap`, `sessions-flow`, `sessions-hub`,
`sessions-live`, `sessions-shell`, `live-sessions`, `session-features-flow`, `class-features`, `wither`, `players`,
`visual/D10-S2..S6`, `visual/helpers.ts`). Convex tests of the session functions stay (the server stays).

## Risks

- **Engine hook (JD3b).** `saveSheet` is called by most engine mutations. One extra read per save and a write per Hope
  or HP drop during a live session; concurrent saves of one PC already conflict on the character, so the per-PC stats row
  adds no new contention. GM corrections (Hope -1 by hand) count as "spent"; undo does not subtract. Named in Q8.
- **Restarted sessions.** Without `liveWindows`, a played session started again would lose its first window from the log
  and the tally. Legacy start / end lines have no `event`; J0 matches their text, so a GM-typed line reading "Session
  started" could fool it (GM lines are `auto: false`; match `auto` lines only).
- **Log size.** A long session can hold hundreds of feed rows. Each source is read with a bounded take and the result
  says when it was cut. If GMs hit the cap, page it (follow-up).
- **Recap gating (Q4)** changes what players see today: unshared recaps disappear from the player view and the
  dashboard card. The migration marks every existing recap as shared, so nothing visible today disappears.
- **Per-scene encounters (Q6)** change what the Combat Map's "+ Session encounter" places (the playing scene's encounter).
  JD4 keeps the function shapes; the combat-map session-encounter tests must stay green.
- **BudgetPanel variant (JP2)** touches a file the Adversaries tab renders; keep the default path byte-identical in
  output and run the adversaries specs.
- **HUD in flight.** combat-hud waves may own `convex/lib/spotlight.ts` or `combat-map/page.tsx`; check before launching
  JD1 and JX1. This plan never edits `combat-map/page.tsx`.
- **Nav switch timing.** Until JX1 the Journal is reachable only by URL. Wave 3 specs go to `/journal` directly.
- **Writing as (Q12)** reverses D11 A2 ("No 'Writing as' switcher"). JN2 waits for the answer.

## Beads to create (one per tracer, children of dcm-z9rz, label `ui` / `server` as fits)

| Tracer | Bead title |
|---|---|
| J0 | Journal J0: widen session shapes, log overrides and per-PC tally tables, live windows, error codes |
| J1 | Journal J1: /journal page shell, sub-tabs, Plan / Log toggle, slot stubs, URL state |
| JD1 | Journal JD1: count spotlight moves to a PC per live session |
| JD2 | Journal JD2: session log server (feed, Fear, encounters, GM lines; hide / edit) |
| JD3a | Journal JD3a: session tally server (six numbers) |
| JD3b | Journal JD3b: Hope spent / HP marked counters in saveSheet |
| JD4 | Journal JD4: scene title / state, per-scene encounters, "Scene N began", current scene encounter |
| JD5 | Journal JD5: recap sharing + migration, hours at the table, after the session, campaign summary |
| JD6 | Journal JD6: threads raised on a session's Notes pages |
| JH | Journal JH: header live chip with Start / End, tome, Open threads |
| JN | Journal JN: Notes sub-tab (existing Notes UI, NotesBody extracted) |
| JS | Journal JS: All sessions list, Plan session N, Campaign so far, session heading |
| JP1 | Journal JP1: Plan view scenes and GM prep |
| JP2 | Journal JP2: Combat scene encounter card and Battle Points panel (BudgetPanel journal variant) |
| JL | Journal JL: session log view |
| JR | Journal JR: Recap with Share, After the session |
| JT | Journal JT: Session tally tiles and Spotlight bars |
| JTh | Journal JTh: Threads raised with In Notes |
| JN2 | Journal JN2: Writing as chips and page groups (after Q12 / Q13) |
| JX1 | Journal JX1: nav Journal, /sessions and /notes redirects, links, notes specs |
| JX2 | Journal JX2: delete the old Sessions UI, move End helpers, move sessions specs |

Follow-up beads (create when JX2 lands): "Remove or keep the session functions left without UI after the Journal
cut-over" (`sessionPlay.bumpSpotlight`, `sessionPlay.tally`, `sessionPlay.log`, `sessionWrap.get`,
`sessionWrap.setThreads`, `sessionWrap.callMilestone`, `sessionPrep.createEncounter` / `linkEncounter` /
`unlinkEncounter` if JP2 no longer calls them, and `sessionRecords` header-line helpers); "Page the session log past its
read cap" (only if seen).

## Open questions for the user

Each has a recommended default (marked **default**); the plan is built on the defaults.

**Q1. What is "Open threads" (header count and Campaign so far)?**
- (a) **default** The Notes open threads: open tasks and unresolved Fear lines in the viewer's own journal (today's
  "Open threads" in Notes). Each person sees their own count; the button opens the threads list in Notes.
- (b) The session prep's "Hooks & loose threads" text of the next session.
- (c) A new "thread" bullet type in Notes, counted campaign-wide.

**Q2. What is "Threads raised" in Log & recap?**
- (a) **default** Open threads (tasks / unresolved Fear) on the viewer's Notes pages linked to this session; "In Notes"
  opens the page.
- (b) Open threads written anywhere in the viewer's journal while the session was live.
- (c) Keep the old Wrap-up "Countdowns & threads" text box here instead.

**Q3. Is "Hours at the table" tracked?**
- (a) **default** Yes: the app adds up the time each session was live (Start → End, every restart counted from now on;
  older sessions count their last start → end).
- (b) The GM types the hours per session.
- (c) Drop the row.

**Q4. Recap: who writes it and what does "Share with players" do?**
- (a) **default** The GM writes and edits it; players see a recap only after the GM shares it (and the GM can unshare).
  Every recap written so far counts as shared, so players lose nothing.
- (b) Players always see the recap (as today); "Share with players" copies a link / posts it to the party.
- (c) As (a), and players may also add to the recap.

**Q5. What do players see in the Journal's Sessions sub-tab?**
- (a) **default** As today: the list of live and played sessions, the session heading and the shared recap. No plan,
  log, tally, spotlight or GM prep.
- (b) (a) plus the session log's public lines (no GM-only rolls, no GM lines).
- (c) (b) plus the tally and the spotlight.

**Q6. One encounter per session, or one per Combat scene?** (The design's panel says "Battle points · Scene 3".)
- (a) **default** One per Combat scene. The Battle Points panel follows the scene being played (else the first Combat
  scene). Today's session encounter shows on the first Combat scene. The Combat Map's "+ Session encounter" places the
  playing scene's encounter.
- (b) Keep one per session (today's rule); every Combat scene shows the same encounter.

**Q7. How do scenes become Done / Playing now / Next?**
- (a) **default** The GM marks a scene "Playing now"; the scene that was playing becomes Done; "Next" is the first
  scene after it that is not done. While the session is live this writes "Scene N began · <title>" to the log.
- (b) The GM sets each scene's state by hand; nothing goes to the log.

**Q8. How are the new tally numbers counted?** (Hope spent, HP marked, Adversaries defeated, Critical successes)
- (a) **default** Hope spent and HP marked are counted per PC as they happen during the live session (every sheet
  save that lowers Hope or marks HP; a manual Hope -1 by the GM counts; undo does not subtract). Defeats and criticals
  are counted from the session's encounters and rolls. Short / long rests leave the tally (still stored).
- (b) Count everything from the roll feed only (simpler, but damage applied without a feed row is missed).
- (c) Show only Fear gained / spent and the defeats / criticals; drop Hope spent and HP marked.

**Q9. Spotlight: automatic only?**
- (a) **default** Counted automatically from spotlight moves; the GM can Reset. No tapping.
- (b) Also let the GM tap a bar to add one.

**Q10. Where does "Allow extra characters this session" go?** (Today it is on the Live card, which is removed.)
- (a) **default** In a small menu on the live-session chip in the Journal header.
- (b) On the Party tab.
- (c) Drop the switch from the UI.

**Q11. Where do the GM rename, re-date, mark as played and delete a session?** (The design shows title and date as
text.)
- (a) **default** Click the title or the date to edit them; a "⋯" menu next to the Live chip holds Mark as played /
  not played and Delete session.
- (b) As (a) without Mark as played (End session marks it played; planned sessions are deleted, not marked).

**Q12. Notes: the "Writing as" chips.** (D11 decided no switcher, A2.)
- (a) **default** Add them: the GM's chips are "Game Master" plus each PC's journal; picking a PC opens that journal
  (the GM reads and adds lines as the sharing rules already allow). A player sees only their own chip.
- (b) No chips: keep today's "Players' journals" list in the index column.

**Q13. Notes: the page groups and Quick keys.** The design shows "Campaign / Session pages / GM only" and "• looming
Fear"; the app has "Session logs / Collections / Future log" and "+ Hope · ^ Fear".
- (a) **default** Keep today's groups, names and keys.
- (b) Rename only: Collections → Campaign, Session logs → Session pages, Future log → GM only.
- (c) Rename as (b), and "GM only" holds the GM's private pages (Future log folds into Campaign); Quick keys as designed.

## User answers 2026-11-03 (bind every tracer; override the defaults above where they differ)

| # | Question | Answer |
|---|---|---|
| Q1 | Open threads | Notes lines marked as threads, per viewer (default) |
| Q2 | Threads raised | Open threads on the Notes pages linked to the session (default) |
| Q3 | Hours at the table | Automatic from live time (default) |
| Q4 | Recap | **Everyone can write; always visible to the table** (no share gate; drop recapSharedAt / "Share with players" gating - JD5 / JR adjust) |
| Q5 | Player view of Sessions | **List, heading, recap AND the session log** (GM-hidden lines excluded); not the plan / prep / battle points |
| Q6 | Encounters | One per Combat scene; the old session encounter moves to the first Combat scene (default) |
| Q7 | Scene progress | **Automatic from the Combat Map**: starting a scene's encounter marks it Playing now (previous -> Done, next -> Next, "Scene N began" logged); the GM marks non-combat scenes |
| Q8 | Hope spent / HP marked | Counted as they happen during the live session (default) |
| Q12 | Writing as | Add Writing-as chips (default; reverses A2) |
