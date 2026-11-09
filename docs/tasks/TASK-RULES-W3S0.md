# TASK-RULES-W3S0: wave 3 foundation, the 15 Book-only rules get their modes

Status: Review. Rule switches wave 3, tracer W3S0 (epic dcm-jh6d part A, bead dcm-bxp.134). Inputs:
`.omc/plans/rule-switches-wave3-questions.md`, its section "User answers (2026-11-09)" (binding) and its "Build plan"
table. Same meanings as waves 1-2: Book = the app does what the book says; a variant is printed unless marked *not in
the books*; Manual = the app stops doing it and posts a GM-only note (`postRuleNote`, `convex/lib/ruleModes.ts`).

Nothing changes at the table yet. None of the 15 ids is in `WIRED_RULES`
(`src/components/config/sections/rules/model.ts`), so House rules shows each row's mode as text with "Coming soon"
(test: `tests/unit/config/rule-switches.test.tsx`, "shows a rule with modes that isn't wired yet"). The orchestrator
adds each id there when its build tracer (WR, WD, WS, WF) merges.

## What landed

| Piece | File |
|---|---|
| 15 rules from `bookOnly` to `switch`, with modes and (W3) a number | `src/lib/rules/registry.ts` |
| 15 new optional mode fields + `doomTrackSessions`, and their change members (widened only, rule 7) | `convex/lib/validators/ruleModes.ts` |
| M4 migration: `tableSettings.outOfRange` → `ruleModes.outOfRange` | `convex/migrations/outOfRange.ts` |
| Counts (61 listed: 42 with modes, 19 Book-only; 71 in all), the 15 rules' modes, wave-3 resolving | `tests/unit/rules/registry.test.ts` |
| Migration test | `tests/convex/migrations-out-of-range.test.ts` |
| `campaigns.ruleModes` doc | `docs/data-model.md` |

The 19 read-only rows stay read-only (Q16 a): R1, R4, R5, R9, R11, F1, D1, D3, A2, A3, C3, T5, S3, L1, L2, K2, K3,
E1, W8.

## Modes

Stored literals, in House rules order (`book` first, `manual` last). Unset = `book`.

| Rule | Id | Modes | Answer |
|---|---|---|---|
| R2 | `criticalSuccess` | `book` · `manual` | Q1 a |
| R6 | `experienceCost` | `book` · `manual` | Q2 a |
| R7 | `helpAnAlly` | `book` · `manual` | Q3 a |
| R8 | `tagTeam` | `book` · `noSessionLimit` "No session limit" (*not in the books*) · `manual` | Q4 a |
| R10 | `criticalDamage` | `book` · `manual` | Q5 a |
| F4 | `adversaryExperienceFear` | `book` · `manual` | Q6 a |
| F5 | `fearFeatures` | `book` · `manual` | Q6 a |
| D7 | `hordes` | `book` · `manual` | Q7 a |
| C4 | `unconscious` | `book` · `manual` | Q8 a |
| T1 | `twoDowntimeMoves` | `book` · `manual` | Q9 a |
| T3 | `downtimeMoveEffects` | `book` · `manual` | Q10 a |
| X3 | `scars` | `book` · `manual` | Q11 a |
| M4 | `outOfRange` | `book` "Ask the GM" · `refuse` "Refuse" · `manual` | Q12 a |
| L3 | `domainCardLevels` | `book` · `manual` | Q13 a |
| W3 | `doomTrack` (Journey to Horizon only) | `book` · `everyNSessions` "Every N sessions" (*not in the books*) · `manual`; number `doomTrackSessions` "Sessions per box", 1–4, default 1, shown only in `everyNSessions` | Q14 a |

Notes:

- M4 keeps the convention that the first mode is `book` (the resolver, `isChanged` and the drift test rely on it), so
  "Ask the GM" is stored as `book`, not `ask`. Old `ask` = `book`, old `refuse` = `refuse`. Neither is marked *not in
  the books*: CB p.103 says out-of-range targets "usually can't be targeted".
- W3's variant: the HF p.177 tip says to adjust how often the track is marked but gives no number, so it is marked *not
  in the books*, as the brief asked. `doomTrackSessions` resolves to 1 outside Journey to Horizon and when out of range
  (`resolveRuleModes`); `ruleSettings.set` already refuses a number outside 1–4.
- `does` (the row's line) now describes Book as it will be once wired: R7 "The roller ticks the PCs who help…" (Q3 a)
  and W3 "each tier's rule applies once it is reached" (Q14 a, Tiers 1 and 3 automated). Until WR / WS merge, the row
  says "Coming soon" under that line.
- R2 Book (user note on Q1): a critical gives +1 Hope and clears 1 Stress in total, not +1 for "with Hope" plus +1.
  `dualityEffects` already does this; WR adds the test that pins it (`src/lib/domain/dice/index.ts` is WR's file).

## M4 migration (widen → migrate → narrow)

`convex/migrations/outOfRange.ts` exports `copyTableSetting` (`@convex-dev/migrations`, batched, resumable,
idempotent) on `campaigns`, every row including deleted and archived ones. It mirrors the table setting: when
`tableSettings.outOfRange` is `refuse`, `ruleModes.outOfRange` becomes `refuse`; otherwise (unset or `ask`) it becomes
Book (left unset when already unset). A row that already matches is not written; every other field is kept. The old
`tableSettings.outOfRange` is not removed and nothing reads the new field yet.

Mirroring (rather than filling only unset keys) is deliberate: until WF the table setting is the one a GM can change,
so rerunning with `reset: true` just before the deploy that ships WF picks up any change made since the first run.

Commands (orchestrator), dev after W3S0 is merged and deployed:

```bash
npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting", dryRun: true}'
npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting"}'
npx convex run --component migrations lib:getStatus --watch
# just before the deploy that ships WF:
npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting", reset: true}'
```

Prod: only when the user deploys, the same commands with `--prod`, before the deploy that ships WF. Narrow (remove
`outOfRange` from `tableSettings`, `TABLE_SETTING_DEFAULTS`, `campaignSettings.set` and the At the table section) waits
until the migration has run on every deployment, like RD1 → RD2.

## Readers: what each build tracer switches

Engine code reads a mode with `ruleMode(campaign, "<id>")` (`convex/lib/ruleModes.ts`) or `ruleModesOf(campaign)` and
passes it into the pure domain functions as a parameter (as `dualityEffects(kind, outcome, mode)` already takes R3).
Manual posts its note with `postRuleNote` in the action's `groupId`, so undo removes it.

### WR: roll costs (R2, R6, R7, R8, R10)

- **R2 `criticalSuccess`**: `dualityEffects` (`src/lib/domain/dice/index.ts`): Manual drops the critical's `hope` and
  `clearStress` but keeps the outcome a success with Hope. `resolveDuality` in `convex/lib/rolls.ts` reads it next to
  R3 and returns it, so `convex/lib/combatActions.ts` needs no new read. Other callers: `convex/rolls.ts` (Tag Team),
  `src/lib/domain/card-effects/run.ts` / `convex/lib/cardRunner.ts`.
- **R6 `experienceCost`**: `experienceBonus` (`src/lib/domain/dice/index.ts`) and the `spendHope` after it, in
  `convex/lib/rolls.ts` (about line 624) and `convex/lib/cardRunner.ts` (about line 740). Manual: modifier added, no
  Hope, no NOT_ENOUGH_HOPE.
- **R7 `helpAnAlly`**: the `help` field in `convex/lib/rolls.ts` (`rollArgs`, about line 95) and
  `convex/lib/combatActions.ts`; Book replaces it with named helpers (Hope from each, refused if one has none, feed line
  per helper, undo refunds). UI: `src/components/party/dice/dice-box.tsx` and the attack panel's help field. Manual is
  today's counter plus a GM note.
- **R8 `tagTeam`**: `tagTeam` in `convex/rolls.ts` (`TAG_TEAM_HOPE`, the `featureUses` key `tagTeam` until
  `session`). `noSessionLimit` skips the once-per-session check; Manual skips Hope and the limit. UI:
  `src/components/party/dice/tag-team.tsx`.
- **R10 `criticalDamage`**: `rollDamage` (`src/lib/domain/dice/index.ts`, `critical: true`). Callers:
  `convex/lib/rolls.ts`, `src/lib/domain/card-effects/run.ts`, `src/lib/domain/adversary-actions/attack.ts`,
  `convex/lib/adversaryHits.ts` (the hit's `critical`).

### WD: rests and unconscious (T1, T3, C4 sheet side)

- **T1 `twoDowntimeMoves`**: `validateChoice` (`src/lib/domain/rest/index.ts`) against `MOVES_PER_REST`
  (`src/lib/domain/rest/moves.ts`); Manual accepts 0–4 moves. Server `convex/rests.ts`; UI
  `src/components/party/rest/picker.tsx`.
- **T3 `downtimeMoveEffects`**: `applyMoves` (`src/lib/domain/rest/index.ts`) and `applyMovesWithDice`
  (`src/lib/domain/rest/feature-moves.ts`), called from `convex/rests.ts` when the rest finishes. Manual lists picks,
  rolls and applies nothing.
- **C4 `unconscious`**: refusal in `loadCharacter` (`convex/lib/characterSheet.ts`, CHARACTER_UNAVAILABLE); waking in
  `applyResourceDelta` (`src/lib/domain/characters/index.ts`) and `restedSheet` (`src/lib/domain/rest/index.ts`).
  Manual: badge only, GM notes "wake her?". (The "can't be targeted" half is WF's.)
- W3 Tier 1 (long-rest Fear rolled twice, keep the higher) lives in `convex/rests.ts` near `restFearRule` (about line
  277): WD owns that line, or WS waits for WD.

### WS: sessions, scars, level-up (X3, W3, L3)

- **X3 `scars`**: `avoidDeath` (`src/lib/domain/death/index.ts`) adds the scar; called from `convex/deathMoves.ts`.
  The session-end retirement list is `journeyEnds` in `convex/sessions.ts` (about line 231). `hopeMax(scars)` stays.
- **W3 `doomTrack`** and `doomTrackSessions`: the session-end reminder `doomTier` in `convex/sessions.ts` (about line
  274; `everyNSessions` reminds only every N-th session); Tier 4 Fear `fearForMark` and `tierRuleActive`
  (`src/lib/frames/trackers/horizon.ts`, server `convex/trackers/horizon.ts`); Tier 3 Dark-Hearted is WF's.
- **L3 `domainCardLevels`**: `cardTakeProblem` / `cardProblem` (`src/lib/domain/level-up/index.ts`), used by
  `validateLevelUp` (`convex/levelUp.ts`) and `takeCard` (`convex/characters.ts`, about line 796). Creation keeps
  level-1 cards in both modes. Pickers show higher cards "Above level" in Manual.

### WF: GM Fear costs, Hordes, out of range (F4, F5, D7, M4, C4 targeting, W3 Tier 3)

- **F4 `adversaryExperienceFear`**: `experienceFear` in `convex/lib/adversaryActions.ts` (about line 1068, the
  `confirmFear` step).
- **F5 `fearFeatures`**: `featureFear` in the same function, through `upfrontFear`
  (`src/lib/domain/adversary-effects/run.ts`) and `featureFearCost` (`src/lib/domain/adversaries/index.ts`);
  environments: `spendFear` in `convex/environmentActions.ts` (FEAR_EMPTY).
- **D7 `hordes`**: `hordeHalved` (`src/lib/domain/encounters/damage.ts`) and `standardAttackDamage`
  (`src/lib/domain/adversary-actions/attack.ts`, about line 263).
- **M4 `outOfRange`**: one chokepoint, `refusesOutOfRange` in `convex/combatActions.ts` (line 73, today
  `resolveTableSettings(campaign.tableSettings).outOfRange === "refuse"`), called from `convex/combatActions.ts`,
  `convex/combatFeatures.ts` and `convex/combatCards.ts`. Switch it to `ruleMode(campaign, "outOfRange")`: `refuse`
  refuses, `book` opens the GM's sanction request as today, `manual` lets the attack through with a GM note. Narrow
  afterwards: `src/lib/config/campaign-settings.ts`, `convex/lib/validators/campaigns.ts`, `convex/campaignSettings.ts`,
  `src/components/config/sections/table/index.tsx` (only once the migration has run).
- **C4 can't be targeted** (Q8 a, Book): the adversary attack paths in `convex/lib/adversaryActions.ts` /
  `src/lib/domain/adversary-actions/`.
- **W3 Tier 3** Dark-Hearted (Q14 a): offered on adversary rolls for 1 Fear, in `convex/lib/adversaryActions.ts`.

## Tests

- `tests/unit/rules/registry.test.ts`: counts (61 listed: 42 with modes, 19 Book-only, listed by code; 71 in all); the
  15 rules' modes, labels, `notInBooks` and W3's number; drift registry ↔ validator (fields, literals in order);
  defaults include `doomTrackSessions: 1`; W3 and its number resolve only in Journey to Horizon, 5 falls back to 1.
- `tests/unit/config/rule-switches.test.tsx`: an unwired rule with modes (R2, R8, M4) shows its mode and "Coming
  soon" with no radio; wired, M4 shows "Ask the GM" / "Refuse".
- `tests/convex/migrations-out-of-range.test.ts`: unset, `ask` (with another table setting), `refuse` with other rule
  modes, a deleted `refuse` campaign, one already `refuse`, a stale `refuse` rule mode with the table setting back on
  `ask`. A dry run changes nothing; the run mirrors the setting, keeps the old field and other fields, leaves matching
  rows unwritten; a second run and a `reset: true` run change nothing.
