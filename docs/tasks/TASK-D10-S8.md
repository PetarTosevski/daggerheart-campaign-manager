# TASK-D10-S8: Combat Map '+ Session encounter' (dcm-bxp.50)

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S8 (wave 4, depends on S4). Bead: `dcm-bxp.50`
(the orchestrator closes it at merge).

## Goal
On the Combat Map the GM places the live (or newest planned) session's encounter with one click; the button shows
which session and adversaries it will place, and stays disabled without one.

## Rules this tracer implements
- **B11** "Combat Map '+ Session encounter': uses the live session, else the newest planned one; disabled with the
  title 'No planned session with an encounter'; enabled title 'Session N: 2× Bruiser, 1× Leader'; Solo adversaries
  take 2 × 2 squares (see Q2)." Board (Combat.dc.html l.709): `sess = (liveSess && sessions.find(...)) ||
  [...sessions].reverse().find((x) => !x.played)`; l.767: `sessDis: sessRoles.length && map ? null : true`.
- **Q2** (default a + refuse, approved 2026-10-20) "the button starts it and places every unplaced, undefeated
  adversary (Solo 2 × 2) ... When ANOTHER encounter is running: refuse with ENCOUNTER_RUNNING ('End the running
  encounter first')".
- **Q1** the session links one D8 encounter (`sessionPrep.encounterId`, S4); a missing or dangling link is
  SESSION_NO_ENCOUNTER.
- Starting goes through D8's start rules: `startEncounter(ctx, campaignId, encounter, runningMessage?)` is now a shared
  helper in `convex/lib/encounters.ts`, called by both `encounters.start` (behaviour unchanged) and
  `placeSessionEncounter` (orchestrator-approved addition to owns, 2026-10-20).

## Public functions (`convex/combatTokens.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `sessionEncounter` | `gmQuery` | `{ mapId: string }` | `{ title: string, session: null \| { sessionId, n, encounterId, encounterName, status, adversaries, unplaced } }` |
| `placeSessionEncounter` | `keyedGmMutation` | `{ mapId: string, idempotencyKey }` | `{ n: number, added: number, started: boolean }` |

- `sessionEncounter`: live session, else newest planned (`liveSession` / `newestPlannedSession`), its linked
  encounter (checked with `ctx.db.get` + campaign id). `title` is S1's `sessionEncounterTitle` over every instance of
  the encounter (types resolved from the SRD bundle or the campaign's custom block), e.g. 'Session 1: 2× Standard,
  1× Solo'; 'Session N: no adversaries planned' for an empty encounter; 'No planned session with an encounter' with
  `session: null`. `unplaced` = undefeated instances not on this map (0 for an unknown map).
- `placeSessionEncounter`: COMBAT_MAP_NOT_FOUND for an unknown map; SESSION_NO_ENCOUNTER without a linked encounter;
  a draft or ended encounter is started (ENCOUNTER_RUNNING, message 'End the running encounter first.', while another
  runs); a running one is left alone; then every unplaced, undefeated instance is placed as `placeAdversaries` does
  (enemy side, Solo size 2, free-square search, COMBAT_TOKEN_LIMIT past the cap). One transaction: any refusal writes
  nothing (the encounter stays a draft). Keyed: a retry returns the stored result; a second click with a new key
  adds 0.

## UI (`src/components/combat-map/tokens/combatants-panel.tsx`)
The 'Comes with Sessions' stub is gone. '＋ Session encounter' is enabled when the query has a session with at least
one adversary (the board's `sessRoles.length`); its `title` is the server's title. A click reports 'Added Session N's
encounter.' (board copy) in a `role=status` line, or 'Session N's encounter is already on the map.' when it added
nothing; errors go to the card's existing `role=alert` line.

## Acceptance evidence
- `tests/convex/session-encounter.test.ts` (10 tests): authz for both functions (anonymous UNAUTHENTICATED, outsider
  NOT_FOUND, player FORBIDDEN, GM ok); null + 'No planned session with an encounter' with no session, an unlinked
  session and after D8 deletes the linked encounter (place: SESSION_NO_ENCOUNTER each time); title in the board's role
  order ('Session 1: 1× Standard, 2× Bruiser, 1× Solo', 'no adversaries planned'); live session beats a newer planned
  one, else newest planned, a played one is never used; unknown / foreign map: `unplaced` 0 and
  COMBAT_MAP_NOT_FOUND, encounter stays a draft; a draft starts and a Solo (size 2) plus two Standards are placed with
  no overlapping footprints, a keyed retry returns the stored result, a second click adds 0, the Combatants queue is
  empty; another running encounter: ENCOUNTER_RUNNING, nothing written, after it ends the place works; an ended
  encounter restarts, defeated and already placed instances are skipped; a running one is placed without restarting
  (`startedAt` unchanged); COMBAT_TOKEN_LIMIT leaves the encounter a draft and adds no token.
- Existing D8 encounter tests (`encounters.test.ts`, `encounter-tracking.test.ts`) pass unchanged with the extracted
  `startEncounter`.
- `pnpm test`: 145 files, 1686 tests passed. `pnpm lint` and `pnpm typecheck` clean.
- `tests/e2e/session-encounter.spec.ts` (2 tests + 1 @visual, pass): disabled with 'No planned session with an
  encounter' until the encounter is linked, then 'Session 1: 2× Standard, 1× Solo'; a click shows 'Added Session 1's
  encounter.', three tokens, the encounter runs, the Solo token is twice a Standard's width, the queue is gone; a
  second click shows 'Session 1's encounter is already on the map.' and still three tokens. Another running encounter:
  'End the running encounter first.' and no tokens, the session encounter stays a draft.
- Also passing: `encounter-builder.spec.ts` (2), `session-prep.spec.ts` (2). `combat-tokens.spec.ts` needs the
  one-line update below (verified passing with it, then reverted since the file is outside owns).

## Visual comparison
App (`E2E_VISUAL=1`, the @visual test in `tests/e2e/session-encounter.spec.ts`; the plan's
`tests/e2e/visual/D10-S8.spec.ts` is not in S8's owns): `test-results/visual/D10-S8/{combatants-ready,combatants-placed,map-placed}-{1440,1024,390}.png`.
Board: Combat.dc.html l.146 / l.767 (no `board-shots` region exists for the Combatants card).

| Region | Verdict |
|---|---|
| Combatants card | Matches the board: '＋ Party (n)', '＋ Session encounter' (cm-btn), 'Clear tokens'; the title carries the session line. The notice line under the card is new (board shows it in its top message bar; the panel has none, so it sits in the card). |
| Map after the click | Solo 2 × 2 on the right half next to the two Standards, enemy ring, as `placeAdversaries`. |

## QUESTIONS
1. A second click when everything is placed shows 'Session N's encounter is already on the map.' (no board copy; the
   board's import always adds placeholders). The button stays enabled while the encounter has adversaries (the
   board's rule), so the GM gets this notice instead of a disabled button.
2. The title counts every instance of the encounter (the plan), not only the unplaced ones; `unplaced` is returned
   for a client that wants it.
3. ENCOUNTER_RUNNING carries the message 'End the running encounter first.' (Q2's copy) only from this mutation; D8's
   own Start keeps 'Another encounter is already running. End it first.'
4. An encounter with no adversaries: the button is disabled (board), the server still accepts the call and starts it.

## Outside owns
- `convex/lib/encounters.ts`, `convex/encounters.ts`: `startEncounter` extracted (approved by the orchestrator
  2026-10-20, added to S8's owns on rebuild).
- `tests/e2e/combat-tokens.spec.ts` line 67 (D9 C6), needed for that spec to pass:
  `-  ...toHaveAttribute("title", "Comes with Sessions");` `+  ...toHaveAttribute("title", "No planned session with an encounter");`
