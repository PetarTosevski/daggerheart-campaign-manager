# TASK-SESSIONS-HUB: Sessions as the hub

Status: Review. User request 2026-10-21: the Adversaries and Combat Map tabs felt like they do the Sessions tab's job.
The agreed answer is not to move them, but to make Sessions pull them in.

## Goal
From a session's Play stage the GM sees and starts the session's encounter, jumps straight to it in the tracker or to
the map, and gets back to the session from either place with one click. The nav puts Sessions before the two tabs it
pulls in.

## What was built
1. **Encounter card in the Play stage** (`src/components/sessions/play/encounter-card.tsx`, mounted by `PlayStage`
   at the top of the right column, above the Session log; own error boundary and loading line). GM only: the Play
   stage is mounted for the GM only, and both queries are GM wrappers.
   - No linked encounter: "No encounter is linked to this session. Build or link one in Prep." (a link to
     `?s=<id>&stage=prep`).
   - Linked: the name, a status chip (Draft / Running / Ended), and each adversary with HP and Stress marked
     (`HP 2/5 · Stress 0/3`, "Defeated" struck through). The data comes from S4's `sessionPrep.get` (the link) and
     D8's `encounters.get` (the instances). It is read-only here.
   - Actions: "▶ Start encounter" calls D8's `encounters.start`. The optimistic update flips the status in both
     cached queries; a refusal rolls back and shows D8's message in `role=alert` ("Another encounter is already
     running. End it first."). A running encounter gets "Open in tracker" instead. "Open the map" (Combat Map) is
     always there.
2. **Deep link to the tracker.** The Adversaries page reads `?tab=catalogue|encounters|environment` and
   `?encounter=<id>` (encounter used only with `tab=encounters`) once per URL. The tab opens, and the encounter is
   selected in the builder (new optional `initialEncounterId` on `BuilderProps`) and opened in the tracker. Without
   params nothing changes (Catalogue). Tab changes are still local state and write nothing to the URL. An unknown
   tab means the Catalogue. A bad or foreign id shows D8's existing "no longer exists" notices. Prep's
   "Open Adversaries" link now uses the same deep link (closes TASK-D10-S4 question 2).
3. **Nav order** (`src/lib/campaign-sections.ts`): Dashboard · Party · World · Characters & Locations · Sessions ·
   Combat Map · Adversaries · Notes. Slugs, labels and `gmOnly` (Adversaries only) are unchanged, so player access is
   unchanged. No existing test pinned the order; the new spec does.
4. **"Session N" chips** (`src/components/sessions/session-chip.tsx`) link to
   `/campaigns/<id>/sessions?s=<sessionId>&stage=play`, with a green dot when the session is live. Each chip has its
   own boundary, so a failing chip disappears instead of taking down the page it sits on.
   - Encounter tracker (in the top bar next to the status, and in the draft / ended notice): shown when the open
     encounter is the live (else newest planned) session's linked encounter. Source: the new `sessionPrep.current`.
   - Combat Map header (GM): shown while a session is live. Source: the existing `sessionWrap.dashboard.live`.

## Server
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `sessionPrep.current` | `gmQuery` | `{}` | `{ sessionId, n, live, encounterId } \| null` |

It returns the live session, else the newest planned one, if that session links an encounter that still exists in
the campaign; otherwise null. A played session is never used. S8's private `sessionEncounterOf` moved to
`convex/lib/sessions.ts` as `currentSessionEncounter`. `combatTokens.sessionEncounter` / `placeSessionEncounter`
call the helper with unchanged behaviour (their 10 tests pass unchanged). No schema change and no new error code.

## Acceptance evidence
- `tests/convex/session-hub.test.ts` (3 tests): access (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player
  FORBIDDEN, GM ok). Null without a session, without a link, and after D8 deletes the encounter. Prefers the live
  session over a newer planned one, else the newest planned one; a played one gives null.
- `tests/e2e/sessions-hub.spec.ts` (3 tests):
  - The nav order.
  - The Play card:
    - Without a link, the Prep link opens Prep.
    - With a link: 'Session 1 encounter', Draft, two Bandits at HP 0. Start is refused while 'Wolves' runs (alert,
      still Draft). After Wolves ends, Start makes it Running and 'Open in tracker' appears. HP marked through the
      tracker's mutation shows up live (HP 2/5).
    - Screenshots at 1440 and 390. At 390 there is no horizontal scroll and the links are at least 44 px.
  - The deep link lands on the Encounters tab with the encounter in the builder and the tracker. The tracker's
    'Session 1' chip returns to Play. 'Open the map' opens the Combat Map, which has no chip until
    `sessions.start`; then 'Session 1, live' returns to Play.
  - The Adversaries page without params (Catalogue; a tab click keeps the URL), `?tab=environment`, and an unknown
    tab.
- `pnpm lint`, `pnpm typecheck` clean. `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 157 files, 1886 tests
  passed.
- e2e, one run of 16 specs, 37 passed: sessions-hub, sessions-shell, session-play, session-prep, session-records,
  session-wrap, sessions-flow, sessions-live, session-encounter, adversaries, encounter-tracker, encounter-builder,
  combat-map-shell, combat-tokens, combat-map-flow, world.

Screenshots: `test-results/visual/SESSIONS-HUB/play-encounter-{1440,390}.png`.

## Notes and questions
1. The card only reads HP and Stress. Marking them stays in the tracker ("Open in tracker"), as asked.
2. "Open in tracker" is offered only for a running encounter. A draft or ended one offers Start (D8's Start re-runs
   an ended encounter, as its builder does).
3. The tracker chip also shows for the newest planned session's encounter, not only a live session's (as asked).
   The Combat Map chip shows only while a session is live.
