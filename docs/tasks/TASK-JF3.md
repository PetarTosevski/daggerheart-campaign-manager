# TASK-JF3: remove the session functions without a screen (bead dcm-z9rz.24)

Plan `.omc/plans/journal-followups.yaml`, tracer JF3. User decision 2026-11-06 (bead notes): remove the UI-less
session functions nothing uses; keep `sessionPrep.createEncounter` / `linkEncounter` (e2e setup) as internal-only.

| Function | Result | Callers checked (src/, tests/, scripts/) |
|---|---|---|
| `sessionPlay.spotlight` | removed | none in src/; the Journal reads `journalTally.spotlight` (`spotlightEntryValidator` / `SpotlightEntry` stay in `convex/sessionPlay.ts`: journalTally and the tally card import them) |
| `sessionPlay.bumpSpotlight` | removed | none in src/; spotlight moves count through `convex/lib/spotlight.ts` |
| `sessionPlay.tally` | removed | none in src/; the Journal reads `journalTally.tally` |
| `sessionPlay.log` | removed | none in src/; the Journal reads `journalLog` |
| `sessionPrep.unlinkEncounter` | removed | none |
| `sessionWrap.setThreads` | removed | none; stored threads are still read by `sessionWrap.get` |
| `sessionPrep.createEncounter` | `internalMutation` (`campaignId`, `sessionId`; no idempotency key) | e2e seeding: `createSessionEncounter` in `tests/e2e/journal/helpers.ts` (`scripts/convex-e2e.mjs run sessionPrep:createEncounter`); convex tests: `t.mutation(internal.sessionPrep.createEncounter, ...)` |
| `sessionPrep.linkEncounter` | `internalMutation` (`campaignId`, `sessionId`, `encounterId`) | e2e: `linkSessionEncounter` (same helper file) in `session-encounter.spec.ts` |

Kept (used by the Journal): `sessionPlay.resetSpotlight`, `addLog`, `removeLog`; every other `sessionPrep` and
`sessionWrap` function.

Tests: authz entries for the removed / internalized functions dropped (`tests/convex/authz/sessions.entries.ts`);
`session-play`, `session-prep`, `session-wrap`, `session-encounter`, `session-hub`, `journal-plan`,
`journal-spotlight` and `authz/sessions.test.ts` follow.
