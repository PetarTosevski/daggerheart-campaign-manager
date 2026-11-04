# TASK-CONFIG-U1: Campaign settings, At the table

Plan `.omc/plans/config.yaml`, wave 3, tracer U1; briefs `.omc/plans/config-briefs.md` (U1-U5 block, "User answers
2026-11-04", "Questions 2026-11-05": defaults taken); bead dcm-jh6d.15. Design
`reference/designs/config/Settings.dc.html` (`.s-table`). Mode: add. UI only; no server change, no codegen.

## What landed

`src/components/config/sections/table/index.tsx` fills S1's `TableSection` slot with the board's five rows, using
the shared `cfg-row` / `cfg-sw` / `cfg-seg` classes (plus `table.css` for the lock label and the error line):

| Row (board text) | Hint | Control | Reads | Writes |
|---|---|---|---|---|
| Players can see each other’s hands | Each player can still hide their own hand. | switch | `combatCardsReads.handSharing` | `campaigns.setPlayersSeeHands` (reused) |
| Players see the GM’s Fear | The Fear banner on the Combat Map. | switch | `campaigns.get` `settings.playersSeeFear` | `campaignSettings.set` |
| Out-of-range actions | When a card or attack targets something beyond its range. | segmented Ask me / Refuse (glass neutral, `aria-pressed`) | `settings.outOfRange` | `campaignSettings.set` |
| Show spotlight balance to players | The bars in the session recap. | switch | `settings.spotlightToPlayers` | `campaignSettings.set` |
| Show adversary HP, Stress and Difficulty to players | Players see Hit, Miss or Defeated instead. | disabled switch + lock icon 'Always off' | - | - (no setting) |

- Switches are `<button role="switch" aria-checked aria-label>`. Each click sends one field (rule 12) with an
  optimistic update. Hand sharing patches `combatCardsReads.handSharing`, the same update the Combat Map's switch
  makes. The others patch `campaigns.get`'s `settings`, which the shell passes in as `props.campaign`. A refused save
  rolls back and shows its message in the polite live line under the rows. Clicking the current segment writes
  nothing.
- Hand sharing (Q10 b): the settings row and the Combat Map's Map tools switch ("Players can see each other's
  cards") read and write the same field, so they always agree. The e2e test flips it from each side.
- The Fear, out-of-range and spotlight rows save the setting only. What they change is built by R1 (Fear "?"), R2
  (Refuse) and JO3 (spotlight bars).
- While hand sharing is loading, its row shows 'Loading …' (`role="status"`).

## The locked row's test

`tests/convex/config-table-adversary-stats.test.ts`: the test sets up a running encounter with an SRD Bear and a
custom Bandit on the live map, next to the player's PC. It then runs every player-facing combat query as the player
(`combatVision.playerView` / `doors`, `combatHud.party` / `scene` / `sheet`, `combatTokensReads.party`,
`combatActions.targets` / `riders`, `combatSpotlight.state`, `combatMaps.live`, `combatAreas.list`,
`combatCardsReads.pending`, `combatFeaturesReads.drawer` / `pending`, `combatRequestsReads.mine` / `difficulties` /
`forcedAttacks`, `adversaryActions.pending`). It asserts that no object naming an adversary (token id, instance id or
name) carries `hp`, `hpMax`, `stress`, `stressMax`, `difficulty` or thresholds. Self-checks:
- the player's view and target list do name the adversaries;
- the same finder does flag the GM's token list.

**Result: no leak, so no bead filed.**

## Decisions

- Text follows the board ('hands'), while the Combat Map's switch keeps its own 'cards' label. Both are the same
  setting.
- The segmented buttons are glass neutral (`glassButtonClass`), as slots.ts asks for `cfg-seg`, not the board's flat
  `.seg2`.
- There is one inline error line for the section, not one per row: only one save is in flight at a time.

## Files

| File | Change |
|---|---|
| `src/components/config/sections/table/index.tsx` | The section (was S1's stub). |
| `src/components/config/sections/table/table.css` | Lock label and error line. |
| `tests/unit/config/table.test.tsx` | Rows and hints, values, lock, hand-sharing intent and optimistic update, one-field `set` calls, rollback and inline error, loading. |
| `tests/e2e/config-table.spec.ts` | GM and player, Combat Map: hand sharing off in settings → the player's view of Brannoc's hand turns private live; Fear / Refuse / spotlight reach the player's `campaigns.get`; Map tools switch in step both ways; axe; 1440 and 390 shots. |
| `tests/convex/config-table-adversary-stats.test.ts` | **Outside owns** (approved by the orchestrator): the locked row's test needs convex-test, which runs only in `tests/convex`. |

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/config.yaml U1`: flags only the approved convex test.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/config` (36) and the convex test pass. Full suite:
  535 files, 11741 passed, 2 expected fail, 1 todo.
- e2e: `config-table.spec.ts` passes on ports 3937 / 4037, `--workers=1`, with managed servers. The worktree needed
  `pnpm e2e:setup` first: the copied `.env.e2e.local` secret didn't match the fresh local backend, so test sign-in
  failed.

## Shots

`test-results/config-u1/` and `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u1/`: `gm-table-1440`,
`player-hand-private-1440`, `gm-table-changed-1440`, `gm-table-390`.
