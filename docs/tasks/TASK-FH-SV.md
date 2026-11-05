# TASK-FH-SV: the server halves of the Combat Map player actions and the Lorekeeper

Plan `.omc/plans/finish-hud-lk.yaml`, tracer FH-SV (beads dcm-bxp.82.14, dcm-bxp.99.19.60, dcm-bxp.99.32.*). Server and
pure libs only; the HUD wiring is FH-UI2's (list below).

## What landed (one commit per bead)

| Bead | Server change | Migration to run |
| --- | --- | --- |
| dcm-bxp.82.14 | `lorekeeperLimitRequests.by_status_decidedAt`; `adminRetention.expireLimitRequests` expires decided requests a year after `decidedAt` (range starts at 0, so a row without it is never swept early). docs/lorekeeper.md: the "GMs only" row past 120% and where the API key is read. | `migrations/limitRequestDecidedAt:backfillDecidedAt` (dry run first) |
| dcm-bxp.99.19.60 | Nothing: the widen and the migration landed earlier. The narrow waits for `migrations/targetCountExpiresAt:clearExpiresAt` on production. | (already defined) |
| dcm-bxp.99.32.17 | `combatRequests.status` gains `withdrawn`; `combatWithdraw.withdraw` writes it; `expireCombatRequests` sweeps it. | `migrations/combatRequestWithdrawn:markWithdrawn` |
| dcm-bxp.99.32.2 | `AppError.shortfall?: { resource, need, have }` on CARD_COST_UNPAID, FEATURE_COST_UNPAID, NOT_ENOUGH_FEAR, NOT_ENOUGH_HOPE (`shortfalls()` in card-effects/availability.ts; `RuleError` and `appError` carry it). | none |
| dcm-bxp.99.32.19 | `combatFeatures.riders({ characterId, featureId, useId?, trait?, weapon? })` → `riderOptionValidator[]` (edit on the character). | none |
| dcm-bxp.99.32.23 | needsChoice `split` asks carry `amount?` (the prompt's total). | none |
| dcm-bxp.99.32.27 | New request kind `gmPrompt`: an adversary feature use stores its GM prompts open; `adversaryPromptsReads.pending` (GM) and `adversaryPrompts.answer({ requestId, done })` (keyed, GM). Undo and the encounter's end close them. | none |
| dcm-bxp.99.32.25 | `combatRequests.seedHeldAttackForE2e` (internal, local e2e backend only): an `afterRoll` request with fixed Hope / Fear dice and options. | none |
| dcm-bxp.99.32.1 | Optional `conditionSources` `[{ condition, source, casterId?, until?, endsWhen? }]` on the sheet and on `encounterAdversaries`; `storedSheet` drops an entry whose condition is gone. Writers fill it in later beads. | none (additive) |
| dcm-bxp.99.32.40 | `combatRequestsReads.withdrawn` (GM): the latest 5 withdrawals, `{ requestId, characterId, characterName, useName, withdrawnAt }`. | none |
| dcm-bxp.99.32.24 | Not built: needs the user's answers (see the report). | none |

## Client wiring for FH-UI2

- **.32.2**: read `error.data.shortfall` on the four codes for CmpBlocked's "costs N X. You have M."; keep the client
  computation as the fallback.
- **.32.19**: the feature picker (`hud/pick-feature/model.ts` `featureRiderOptions` / `featureRiderPhase`) reads
  `combatFeatures.riders`; delete the mirror.
- **.32.23**: nothing new: `hud/result/model.ts` `splitTotal` / `splitLeft` already read `amount`.
- **.32.27**: the queue (`hud/queue`) adds one card per `adversaryPromptsReads.pending` row (`prompt`, `text`,
  `instanceLabel`, `feature`), answered with `adversaryPrompts.answer` (`done: true` "Done", `false` "Dismiss",
  optimistic drop). The stat block's own list of `useFeature`'s returned prompts can stay or defer to the queue.
- **.32.25**: `tests/e2e/hud-result.spec.ts` and `tests/e2e/visual/HUD-H4.1.spec.ts` seed the held roll with
  `node scripts/convex-e2e.mjs run combatRequests:seedHeldAttackForE2e '{"characterId":…,"targetTokenId":…,"hope":3,"fear":7,"options":[{"featureId":…,"useId":"main"}]}'`.
  The options must be after-roll features the character holds for Use to work; Pass works with any. The after-roll
  split needs no seed: give the PC a split card (Splintering Strike) and two low-Difficulty enemies.
- **.32.1**: the sheet panel and the stat block show `conditionSources` when present ("From <source> - until
  <endsWhen or until>"), else today's static until.
- **.32.40**: the GM HUD subscribes to `combatRequestsReads.withdrawn` and toasts "<characterName> withdrew <useName>" for
  rows with `withdrawnAt` after it started listening (remember the ids already toasted).
- **.32.17**: a request read with status `withdrawn` exists now (no current read returns closed rows).
