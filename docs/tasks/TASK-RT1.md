# TASK-RT1: Rest tick settings stored, rolled and applied on rests (domain, schema, server, migration)

Status: Review. Plan: `.omc/plans/rest-ticks.yaml`, tracer RT1 (wave 1). Bead: dcm-674k.
The user's decisions (2026-11-12) and the answers Q1–Q3 are in the plan header; this tracer follows them as written.

## Decisions applied

- Core, every campaign, every dashboard countdown type. Two settings, `onLongRest` (a FINISHED long rest) and `onShortRest` (a short rest, and an interrupted long rest, Q1). An interrupted short rest gives nothing; T4 Manual "Interrupted rest" closes a rest without applying anything, so nothing ticks there either.
- Amounts: fixed N (1..20), the PCs who took part (`restingParty`, the same count as the long-rest Fear's "+ N PCs"), a die (d4..d20), a die plus the PCs. Mode: Automatic or Reminder.
- The rest rolls every setting once when it ends (server `rollDie`), Automatic and Reminder alike, and stores the results on `rests.restTicks`; a Reminder ticks exactly that amount and a reload never rerolls. A computed amount of 0 ticks nothing and shows no Reminder.
- Chase pairs share the setting (`setRestTick` and `createChase` write both rows), roll once, move both rows by the same amount (one `countdownTicks` row each, same entryId), and show one Reminder named "<rivals' name> chase", whose click ticks both rows. A side that already ended (completed) is skipped.
- Feed: Automatic ticks write at most two rows in the rest's undo group (skipped at the 50-row group cap): one public row for Public countdowns ("Short rest: Storm ticks 5 (1d6 3 + 2 PCs)"), one GM-only row for Private / Partly hidden ticks, long-term step lines and the Reminders ("Reminder: tick Storm 3 (1d6 3)?"). A Reminder's roll stays GM-only until the click (Q2); the click writes "<label>: Storm ticks 3 (1d6 3)" public or GM-only by visibility, into the rest's group while it has room (the tick itself is undone with the rest either way). Step text stays GM-only (D12). Labels: "Long rest", "Short rest", "Interrupted long rest".
- Long-term (Q3): `armed` means "ticks on PC action rolls" for every type; long-term rest behaviour lives only in `onLongRest`.

## Shapes and API (for RT2 / RT3)

- Domain `src/lib/domain/countdowns/rest-ticks.ts`: `RestTickAmount`, `RestTick = { amount, mode: "auto" | "remind" }`, `RestTickRest = "long" | "short"`, `restTicksOf(row) -> { long, short }` (null = off; legacy long-term mapping), `restTickRestFor(rest)`, `restTickAmount(amount, pcs, rng) -> { amount, pcs?, die? }`, `restTickText` ("5 (1d6 3 + 2 PCs)", "2" for fixed), `restTickRollText` ("1d6 3 + 2 PCs", null for fixed), `restTickFeedAudience(visibility)`, `restTickAmountLabel` ("Fixed 2", "PCs who rested", "d6", "d6 + PCs who rested"), constants `REST_TICK_KINDS`, `REST_TICK_DICE_SIDES`, `MAX_REST_TICK_FIXED`, `LEGACY_LONG_TERM_AMOUNT`.
- Validators: `countdownRestTickAmountValidator`, `countdownRestTickValidator` (convex/tables/countdowns.ts); `restTickResultValidator` (convex/tables/rests.ts); zod `restTickAmountSchema`, `restTickSchema` (src/lib/validation/countdowns.ts), also on `countdownDetailsSchema` (`onLongRest` / `onShortRest`, any mode).
- `countdowns.setRestTick({ campaignId, countdownId, rest: "long" | "short", setting: RestTick | null, idempotencyKey }) -> { rest, setting }` (keyedGmMutation). NOT_FOUND frame-owned / foreign; COUNTDOWN_RULE cancelled; INVALID fixed outside 1..20.
- `countdowns.create` and `countdowns.createChase` take optional `onLongRest` / `onShortRest`.
- `countdowns.listByCampaign`: new `onLongRest` / `onShortRest` (effective settings, null when off and for players). On long-term rows `armed` (= has a long-rest setting) and `restMode` (= its mode, "auto" when off) are derived for old clients.
- `countdownTracks.afterRest({ campaignId }) -> null | { restId, kind: "long" | "short", lines: [{ countdownId, name, currentValue, line }], reminders: [{ countdownId, name, currentValue, amount, rollText: string | null }] }`. null when the latest rest did not end with benefits or nothing ticked / reminds. `kind` is the setting fired ("short" for an interrupted long rest).
- `countdownTracks.tickOnRest({ campaignId, restId, countdownId, idempotencyKey }) -> { currentValue, status, line }`, any type. COUNTDOWN_RULE for a non-latest rest, no stored Reminder for that countdown (also an Automatic one), a second click, a non-active countdown.
- `rests.finish` / `rests.interrupt` result: `countdownLines?` now lists every Automatic tick ("Storm ticks 3 (1d6 3)"; long-term: the track line, plus "(ticked 5 (1d6 3 + 2 PCs))" when the amount was not fixed).
- Compatibility shims (go at the narrow step): `countdownTracks.setRestMode` (long-term only) sets `onLongRest.mode`, creating fixed 1 when absent; `countdowns.setArmed` on a long-term row sets (current setting, else fixed 1 Automatic) or clears `onLongRest`. `create` with long-term `armed: true` + `restMode` stores `onLongRest` only. None of them writes `armed` / `restMode` on a long-term row.

## Migration (rule 7)

- Widen (this tracer): `countdowns.onLongRest?` / `onShortRest?`, `rests.restTicks?`; `restMode` and long-term `armed` kept in the validator.
- Migrate: `convex/migrations/countdownRestTicks.ts` `moveLongTermRest` (batched, idempotent): each long-term row with `armed` or `restMode` gets the mapped `onLongRest` (unless already set) and loses both. The orchestrator runs it on each deployment after merge:
  - `npx convex run migrations/run:run '{fn: "migrations/countdownRestTicks:moveLongTermRest", dryRun: true}'`
  - `npx convex run migrations/run:run '{fn: "migrations/countdownRestTicks:moveLongTermRest"}'`
  - add `--prod` for production; status: `npx convex run --component migrations lib:getStatus --watch`.
- Narrow (not here; follow-up bead once it ran on prod and phone builds use RT3): drop `restMode` from the table, the view and `create`; drop the legacy branch of `restTicksOf`; remove `setRestMode` and the long-term branch of `setArmed`.

## Deviations and notes

- `rests.restTicks` is added in `convex/tables/rests.ts` (`{ ...restFields, restTicks }`) rather than in `convex/lib/validators/rests.ts`, which is outside RT1's `owns`.
- `tickLongTermOnRest` is replaced by `tickCountdownsOnRest` (convex/countdownTracks.ts); the rest path reads `by_campaign_owner` (`.take(100)`) instead of `by_campaign_armed`, which is now used only by rolls.
- `afterRest` returns null (instead of an empty panel) for a finished rest where nothing ticked and nothing reminds.
- The authz entry for `tickOnRest` now sets a Reminder on the world's long-term countdown before finishing the long rest (a rest without a stored Reminder refuses the tick).

## Tests

- `tests/unit/countdown-rest-ticks.test.ts`: `restTicksOf` (new fields, legacy armed + restMode absent/auto/remind, unarmed, non-long-term armed), `restTickRestFor`, all four amount kinds (every die size, 0 PCs), texts, labels, feed audience.
- `tests/unit/countdown-validation.test.ts`: `restTickSchema` / `countdownDetailsSchema` accept every kind on every mode and reject fixed 0 / 21 / 1.5, other dice, unknown kinds and modes.
- `tests/convex/countdowns-rest-ticks.test.ts` (14): setRestTick per role, INVALID / COUNTDOWN_RULE / NOT_FOUND, view GM vs player; each amount kind with mocked server dice and the stored rolls; d20 stops at 0 and triggers; long vs short vs interrupted long (Q1) vs interrupted short; paused / completed / cancelled skipped; Reminder stored, pre-rolled amount, no reroll on reload, one click ticks exactly once, refusals; Public reminder stays GM-only until the click; chase pair (shared setting, same amount, one reminder, undo reverts both); undo of Automatic + clicked Reminder ticks clears `restTicks`; feed visibility Public / Partly hidden / Private through the player's feed query.
- `tests/convex/countdown-rest-ticks-migration.test.ts`: armed auto, armed remind, armed with restMode absent, unarmed, already migrated, both set, standard row; idempotent reset; a long rest ticks identically (values and panel) before and after, and the GM's list is unchanged.
- Updated: `tests/convex/countdowns-long-term.test.ts` (afterRest shape, reminder text with amount, compatibility shims), `tests/convex/countdowns-chase.test.ts` (createChase rest settings), `tests/convex/authz/countdowns.entries.ts` (setRestTick entry, tickOnRest setup).
