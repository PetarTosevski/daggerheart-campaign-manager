# TASK-D10-S4: Prep - planned scenes, hooks, the session's encounter with Battle Points

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S4 (wave 3, depends on S2). Bead: `dcm-bxp.9`.

## Goal
In Prep the GM plans typed scenes, writes hooks, and creates or links the session's D8 encounter, building it with
D8's Battle Points builder in place.

## Rules this tracer implements
- **B3** "Prep: planned scenes (type Combat / Social / Exploration / Downtime + 'What happens here?'), 'Hooks & loose
  threads' (text), and the 'Encounter builder' card with Battle Points (see Q1 for what it is built on)."
- **Q1** (default b) "the session links ONE D8 encounter and Prep shows D8's builder for it (create 'Session N
  encounter' or link an existing draft) ... one Battle Points source (K6), real stat blocks reach the tracker and the
  map; more fights in a session use the Adversaries tab as today."
- **K6** "Battle Points: '(3 × the number of PCs in combat) + 2' with the adjustments and costs of CB p.197, already in
  src/lib/domain/encounters/budget.ts (D8). D10 reuses it, never a second copy." The server summary uses `budgetFor`,
  `spentFor` and `verdict`; the UI is D8's `BudgetPanel` (which uses `battlePoints`). CB p.197 was quoted and
  re-checked by S1 (TASK-D10-S1.md) and is quoted in budget.ts's header; this tracer adds no rule text of its own.
- **K10** "players never see session prep": every function is a GM wrapper (player FORBIDDEN, outsider NOT_FOUND).

## Public functions (`convex/sessionPrep.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `get` | `gmQuery` | `{ sessionId: string }` | `{ scenes: {id, type, text}[], hooks: string, encounter: null \| { _id, name, status, pcs, adversaries, budget, spent, verdict } }` |
| `addScene` | `gmMutation` | `{ sessionId: string, type?: SceneType }` | `{ sceneId: string }` (server UUID; type default combat; SESSION_SCENE_LIMIT past 20) |
| `setScene` | `gmMutation` | `{ sessionId: string, sceneId: string, type?: SceneType, text?: string }` | `null` (exactly one of type / text, else INVALID; text trimmed, > 300 INVALID; stale id SESSION_SCENE_NOT_FOUND) |
| `removeScene` | `gmMutation` | `{ sessionId: string, sceneId: string }` | `null` (stale id SESSION_SCENE_NOT_FOUND) |
| `setHooks` | `gmMutation` | `{ sessionId: string, hooks: string }` | `null` (trimmed, > 4000 INVALID, empty clears; a blank first write creates no row) |
| `createEncounter` | `keyedGmMutation` | `{ sessionId: string }` | `{ encounterId }` (D8 draft 'Session N encounter', pcs = active PCs, 4 when none, max 12; ENCOUNTER_LIMIT past 200; SESSION_HAS_ENCOUNTER when one is linked) |
| `linkEncounter` | `gmMutation` | `{ sessionId: string, encounterId: string }` | `null` (campaign's encounter else NOT_FOUND; another linked: SESSION_HAS_ENCOUNTER; the same: no-op) |
| `unlinkEncounter` | `gmMutation` | `{ sessionId: string }` | `null` (no link: no-op; the encounter stays) |

`sessionId` goes through `loadSession` (bad, foreign, deleted: SESSION_NOT_FOUND). The prep row is created by the
first write. A dangling `encounterId` (D8 deleted the encounter) reads as `encounter: null` and does not block
creating or linking a new one. Every function has `returns`; RETURNS_PENDING is unchanged.

## UI (`src/components/sessions/prep/`)
- `index.tsx` `PrepStage` (slot name and props unchanged), keyed on the session id; the board's grid (1.25fr / 1fr).
- `scenes.tsx`: 'Planned scenes' (ordered list; type select, 'What happens here?' saved on blur / Enter, × remove,
  '+ Scene', the board's empty copy, '+ Scene' disabled at 20) and 'Hooks & loose threads' (textarea saved on blur).
  Optimistic updates on add (a pending row, disabled until the real id arrives), type / text, remove and hooks.
- `encounter.tsx`: no encounter: the 'Encounter builder' card with 'Create the session encounter' (keyed intent)
  and 'Link an encounter' (select of the campaign's encounters from `encounters.list`, then Link). With one: D8's
  `BudgetPanel` (party stepper, bar, 'Spent X of Y', verdict, six adjustments with hints; D8's optimistic update), a
  'Session encounter' card (name, status chip, the adversaries with tier / type / cost and ×, '+ Add adversary' opening
  D8's `AddAdversaryDialog`, 'Open Adversaries', 'Unlink' with an optimistic update) and nothing copied from D8 except
  the 4-line `costLabel` (D8's `InstanceRow` is not exported; see "Outside owns").
- `prep.css`: grid, scene rows, the link row, and the `--adv-*` tokens D8's builder.css reads, mapped onto `--ss-*`
  (on `.adv-root.ssp-enc`, so D8's `--enc-*` tokens apply too). 900 px: one column. 720 px: scene type and × share a row,
  the text goes full width; 44 px targets.

## Acceptance evidence
- `tests/convex/session-prep.test.ts` (21 tests): empty get writes nothing; add (default and given type, distinct
  ids), setScene type / trimmed text, exactly-one-field INVALID, 301 chars INVALID; remove, stale id
  SESSION_SCENE_NOT_FOUND for set and remove (also before any prep row); SESSION_SCENE_LIMIT at 20; hooks trim / clear
  / 4001 INVALID / blank first write creates no row; prep per session, deleted and malformed session
  SESSION_NOT_FOUND; foreign session SESSION_NOT_FOUND on get / addScene / createEncounter; createEncounter name,
  draft, pcs = 3 of 3 active + 1 away, idempotent retry, summary budget 11 → two Bandits + Bear 'spent 8, 3 BP left' →
  second Bear 'Over by 1 BP' → 'hard' '1 BP left'; 4 PCs with nobody active; SESSION_HAS_ENCOUNTER on a second create
  and on linking another, re-linking the same a no-op; ENCOUNTER_LIMIT at 200 links nothing; link foreign / bad id
  NOT_FOUND, unlink keeps the encounter, unlink twice no-op; a D8-deleted encounter reads as none and a new one can be
  created; summoned and deleted-custom adversaries cost nothing; authz for all 8 functions: anonymous
  UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM succeeds.
- `tests/e2e/session-prep.spec.ts` (2 tests, pass): the GM adds a Combat and a Social scene, writes hooks, creates
  'Session 1 encounter', adds two Bandits through D8's dialog ('Spent 0 of 14 / 14 BP left' → 'Spent 4 of 14 / 10 BP
  left'), toggles 'Harder or longer fight' and steps the party down (4 of 13); reload keeps scenes, types, hooks and
  the budget; removes a scene; unlinks and links the encounter again; marks the session played, and a player opening
  `?s=<id>&stage=prep` sees only the read-only view (no tabs, scenes, hooks, encounter or textboxes). Phone: 390 px,
  one column, no horizontal scroll, every control >= 44 px.
- Also passing in the same run: `sessions-shell.spec.ts` (S0, 5), `session-records.spec.ts` (S2, 2),
  `encounter-builder.spec.ts` (D8, 2), `visual/D10-S4.spec.ts` (1): 12 passed.
- `pnpm test`: 141 files, 1640 tests passed. `pnpm lint` and `pnpm typecheck` clean.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S4.spec.ts`): `test-results/visual/D10-S4/{prep-empty,prep,detail}-{1440,1024,390}.png`.
Board (`node scripts/board-shots.mjs sessions:prep`): `test-results/visual/board/sessions-prep-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Planned scenes | Matches: heading, '+ Scene' ghost, 140 px type select, 'What happens here?' input, × button, board empty copy. |
| Hooks & loose threads | Matches (serif textarea, 6 rows, board placeholder). |
| Encounter builder (Battle Points) | Matches the board card from D8's `BudgetPanel`: party stepper on the dark strip, bar, 'Spent 6 of 10' / '4 BP left' in the accent, the six adjustments with the pressed style, the budget note. Same numbers as the board's story. Deviation (Q1): no role steppers; the adversaries are listed in a 'Session encounter' card under it (name, Draft chip, rows with tier / type / cost, '+ Add adversary', 'Open Adversaries', 'Unlink'). |
| No encounter | No board counterpart (the board always has a counter): the builder card with copy, the gold 'Create the session encounter' pill and 'Link an encounter' select + Link. |
| 1024 | Two columns as the board; the builder column wraps its heading / labels. |
| 390 | One column (scenes, hooks, builder, encounter); scene type and × share a row, the text goes full width; 44 px targets; no horizontal scroll. The board has no phone layout. |

## QUESTIONS
1. The board's builder card lists role steppers (Minion group ... Solo); Q1 replaces them with real stat blocks, so
   the card shows D8's panel and, under it, the encounter's adversaries with '+ Add adversary'. Adding by role is
   not offered (it would need a stat block per role).
2. Start / End of the encounter stay in the Adversaries tab (D8's tracker); Prep shows the status chip and an 'Open
   Adversaries' link. The Adversaries tab keeps its own local tab state, so the link opens its Catalogue tab, not the
   encounter. A deep link (`?tab=encounters&encounter=<id>`) would need a D8 change.
3. 'Link an encounter' offers every encounter of the campaign (running, drafts, the newest 20 ended), not only drafts;
   the server accepts any of the campaign's encounters (acceptance: "an existing encounter of the campaign").
4. One encounter may be linked to two sessions; nothing in the plan forbids it.

## Outside owns
- None required. Optional D8 change that would remove the duplicated `costLabel` and the compact row markup in
  `encounter.tsx`: export `InstanceRow` from `src/components/adversaries/builder/encounter-detail.tsx`
  (`-function InstanceRow(` → `+export function InstanceRow(`), then `encounter.tsx` renders
  `<InstanceRow campaignId instance first last />` (it brings D8's reorder buttons too).
- `convex/sessionPrep.ts` repeats D8's private `activePcs` (8 lines) and the ENCOUNTER_LIMIT check of
  `encounters.create`. A shared `insertDraftEncounter(ctx, campaignId, name, pcs?)` in `convex/lib/encounters.ts`
  (D8's file) would make both call one helper.

## Notes for S8 (Combat Map '+ Session encounter')
- The session's encounter is `sessionPrepOf(ctx, session._id)?.encounterId`; check `ctx.db.get` and the campaign id,
  a dangling id means no encounter (SESSION_NO_ENCOUNTER). `sessionPrep.get` (GM) returns the same as
  `encounter: { _id, name, status, pcs, ... } | null`.
- The instances (`encounterAdversaries` by `by_encounter_order`) carry `source`; resolve `type` as `budgetEntries` in
  `convex/sessionPrep.ts` does (SRD bundle or campaign custom, null when gone) for `sessionEncounterTitle`.
