# TASK I7: Test and code chores

Plan `.omc/plans/followups-8.yaml`, tracer I7 (wave 1, no dependencies). Beads `dcm-bxp.107`, `.112`, `.60`, `.61`,
`.15`, `.27`, `dcm-hlj`, `dcm-bxp.82.8`, `.82.9`, `.82.6`. Status: Review.

## Per bead

| Bead | Result |
|------|--------|
| `dcm-bxp.82.6` claude.ts move | Done. `convex/lib/claude.ts` gains `messagesCreate` (one plain call: 120 s timeout, `ClaudeFailure` reasons `unavailable` / `timeout` / `network` / `HTTP n` / `refusal` / `too long` / `no answer`, the key never logged) and `defaultModel()` (`ANTHROPIC_MODEL`, else Sonnet 5.5). `convex/combatMapGenerate.ts` and `convex/photoImport.ts` lose their own fetch, key read and `MESSAGES_URL`; `ANTHROPIC_API_KEY` is now read in `convex/lib/claude.ts` only. Combat map: a Claude failure gives its `ClaudeFailure.reason`, an unusable reply `UnusableReply` ("no JSON", "unusable layout"), as before. Photo import: any failure is `PHOTO_IMPORT_FAILED` as before (now with the 120 s timeout). Existing tests pass unchanged. |
| `dcm-bxp.27` RuleError | Done in the owned modules. `src/lib/frames/trackers/{andaluria,weredragon,colossus,age-of-umbra,five-banners,horizon}.ts` and `src/lib/frames/extras/{beast-feast,beastform,companion,motherboard}.ts` throw `RuleError` with their wrapper's code (`INVALID`, `TRACKER_RULE`, `WEEK_RULE`, `TRACKER_CORRUPT`, `EXTRA_RULE`; horizon has only the corrupt-state throw, its Doom rules already return codes); five-banners `loadState` and horizon `parseHorizonState` give `TRACKER_CORRUPT`. No plain `throw new Error` is left under `src/lib/frames`. Left: deleting the exact-`Error` branch in `convex/lib/trackers.ts` `applyTrackerRule` and the comment in `convex/characterExtras.ts` (not in I7's owns; follow-up). |
| `dcm-bxp.112` axe | Already done by D12 H1: `@axe-core/playwright` 4.13.0 is a devDependency and `tests/e2e/a11y.ts` is the shared helper. `tests/e2e/notes-a11y.spec.ts` now uses it (no injected `axe.min.js`) and also scans the whole page once (the campaign shell). `docs/testing.md` lists the spec. No dependency change. |
| `dcm-bxp.82.8` expect timeouts | Done for the two left after G2: `tests/e2e/visual/D13-L6.spec.ts` and `D13-L7.spec.ts` use `const expect = baseExpect.configure({ timeout: 20_000 })` and lose their fake-model / ingest `beforeAll` (`scripts/e2e-setup.mjs` does both; `docs/testing.md` says to rerun `pnpm e2e:setup` once per checkout). |
| `dcm-bxp.82.9` fake failure | Done except the lorekeeper-flow step. A question containing `FAKE-FAIL` makes `fakeEvents` send `overloaded_error` (`ClaudeFailure` "HTTP 529", `LOREKEEPER_FAILED`); only the fake model reads it. `D13-L6.spec.ts` shoots the error card (`error-<w>.png`) after Try again is visible. Left: a Try again step in `tests/e2e/lorekeeper-flow.spec.ts` (not owned). |
| `dcm-bxp.61` level-up boundary | Part (1) pinned: `tests/convex/level-up.test.ts` "a pre-D10 'Session started' / 'Session ended' log row without a session row is no boundary". Part (2) (End with no live session is no boundary) needs the user's confirmation; see questions. |
| `dcm-bxp.60` test gaps | Lunar Phases: already covered since session-features U6 (`tests/convex/sessions.test.ts` "U6, K4: a Moon Witch at mastery rolls the moon die at Start"; the Q8 reminder became automation). Doom Track stamp: the server side is covered (`tests/convex/horizon.test.ts` stores `session: 3`); the client's choice of the live / last-played number has no test, and the step belongs in `tests/e2e/horizon.spec.ts` (not owned). Follow-up. |
| `dcm-bxp.15` display helpers | Not done: every file involved (`party/new/wizard-logic.ts`, `party/[characterId]/sheet-helpers.ts`, `src/components/party/party-display.ts`) is outside I7's owns. Follow-up. |
| `dcm-bxp.107` player-b account | Not done: the specs to switch (`notes-sharing`, `notes-flow`, `notes-journals`, `notes-shell`) are outside I7's owns. Checked: each spec creates its own campaign, so `e2e-player2@` as player B in one spec and outsider in another does not collide. See questions. |
| `dcm-hlj` Fear spiral 44 px | Design decision; see questions. |

## Tests

- `tests/unit/frames/rule-errors.test.ts` (new): one expected violation per tracker module and two extras assert
  `RuleError` and its code (`INVALID`, `TRACKER_RULE`, `WEEK_RULE`, `TRACKER_CORRUPT`, `EXTRA_RULE`).
- `tests/convex/combat-map-generate.test.ts` (1 new): a refusal falls back to keywords with reason `refusal`; the
  120 s timeout of `messagesCreate` (fake timers) falls back with reason `timeout`.
- `tests/convex/level-up.test.ts` (1 new): dcm-bxp.61 part (1).

## Checks

See the commit's handoff report (lint, typecheck, vitest, tracer guard, e2e `notes-a11y`, `visual/D13-L6`,
`visual/D13-L7`, `lorekeeper-flow`).
