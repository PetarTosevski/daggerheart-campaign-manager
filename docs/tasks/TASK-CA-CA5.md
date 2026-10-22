# TASK CA5: Map UI - attack bar, target picking, map dice box, mini feed, GM resolutions, mobile sheet

Plan `.omc/plans/combat-actions.yaml`, tracer CA5 (depends on CA3). Analysis: `.omc/autopilot/combat-actions-analysis.md`
(git-ignored). Server API: `docs/tasks/TASK-CA-CA3.md`. Status: Review.

## What landed

| File | What |
|------|------|
| `src/components/combat-map/actions/targets/state.tsx` | `ActionsProvider` / `useCombatTargets` (picked targets, single-select `toggleTarget`, multi-select `toggleExtraTarget` for CA6's cards, the weapon `slot`), `useActor` (the player's character and the enemies it sees, from C7's `playerView`), `seenTargets`. |
| `src/components/combat-map/actions/targets/index.tsx` | `TargetsLayer` (rings and band labels on picked targets, own overlay above fog and tokens, `pointer-events: none`), `TargetList` / `TargetRows` (enemies in sight with band and hint), `hintOf`, `BAND_LABEL`. |
| `src/components/combat-map/actions/attack/index.tsx` | `AttackBar`: weapon picker with damage at Proficiency, trait picker for "choice" weapons, Experiences, advantage / disadvantage, help dice, `combatActions.attack`; `AttackResult`; the player's waiting sanctions and the Minion pick dialog (`combatActions.pickMinions`). |
| `src/components/combat-map/actions/dice/index.tsx` | `MapDice` (the sheet's `DiceBox`, loaded with `next/dynamic`, compact via CSS) and `MiniFeed` (latest 6 `feed.list` rows). |
| `src/components/combat-map/actions/gm/index.tsx` | `Resolutions`: sanctions waiting (Allow / Decline, `combatRequests.sanction`) and the latest GM `combat` rows with Undo (`actionLog.undo`). |
| `src/components/combat-map/actions/index.tsx` | `ActionsPanel`: cards in the player column (desktop, tablet), a bottom sheet with tabs Hand / Attack / Dice / Feed at <=760px; per-part error boundaries. |
| `src/components/combat-map/actions/actions.css` | All styles (board tokens from combat-map.css). |
| `src/components/combat-map/vision/vision-layer.tsx` | A player's click on an enemy token also calls `toggleTarget`; its label adds ", your target". |
| `tests/unit/combat-actions-ui.test.tsx` | 9 tests: target rows, hint priority, single-select, result view, damage label, resolution filter. |
| `tests/e2e/combat-attack.spec.ts` | 2 two-browser specs (desktop flow with undo and sanction; phone sheet), axe on both. |
| `tests/e2e/visual/CA-CA5.spec.ts` | Shots at 1440 and 390 (`test-results/visual/CA-CA5/`). |

No server file, schema or validator changed.

## User answers implemented (quoted from the plan)

- **U1** "Players never see an enemy's HP, Stress or thresholds. They only learn hit or miss." The player UI only reads
  `combatActions.targets` (band and booleans), `combatActions.attack`'s result (own dice, damage total, Hit / Miss /
  Defeated), `combatRequests.mine` (names, bands, counts) and public feed rows. The result view and mini feed are checked
  against `HP|Stress|Difficulty|threshold|Minor|Major|Severe` in unit and e2e tests.
- **U2** "Rolls made on the map also appear in the roll feed." Attacks and the map dice box write ordinary feed rows; the
  mini feed shows them, and so does the dashboard feed.
- **U4 / Q10** "Damage applies automatically; the GM can undo it." "no approval step". Resolutions lists the GM rows with Undo.
- **Q1** "an attack ... on a target outside its range needs the GM's sanction". The target list says "Out of range: the GM
  decides"; the attack returns `pending`, the player sees "Waiting for the GM", the GM sees Allow / Decline in Resolutions.
- **Q2** line of sight required, cover gives disadvantage: hints "No line of sight" / "Cover: disadvantage".
- **Q5 / Q6** the player sees their own damage total; a Minion offer opens the pick dialog (also from `combatRequests.mine`,
  so an offer after a GM-approved attack can be picked too).
- **Q11** bottom sheet at <=760px with tabs Hand / Attack / Dice / Feed, 44px targets, no sideways scroll.
- **Orchestrator / user answer 2026-10-22**: "a plain weapon attack targets ONE enemy (CB p.96 'By default, each attack
  roll can only target one adversary')". `toggleTarget` is single-select (another enemy replaces the pick, the same one
  clears it) and the Attack bar sends one target. `toggleExtraTarget` adds to the pick for CA6's multi-target cards.

## How it works

- **Who sees what.** Players: `ActionsPanel` in the player column (page slot), `TargetsLayer` on the map. The GM:
  `Resolutions` at the bottom of the GM column. The GM does not pick targets (no player character on the map).
- **Picking.** A click on an enemy token (vision-layer's `OtherTokens`) selects it as before and toggles it as the target;
  the list rows toggle too (keyboard and the phone sheet's "confirm in the sheet", Q11). `seenTargets` drops a pick the
  character no longer sees. The hints and rings use the weapon chosen in the Attack bar (`slot` in the provider).
- **Attack.** One `combatActions.attack` per click through `useIntent` (fresh idempotency key); the button reads
  "Rolling…" and is disabled while pending (rule 12). Experiences cost 1 Hope each, checked against the sheet first.
- **Resolutions.** `feed.list` (first 40 rows) filtered to `kind: "combat"`, `visibility: "gm"`, newest 8. Undo has an
  optimistic update marking the row undone in every loaded `feed.list` page; Allow / Decline remove the sanction from
  `combatRequests.mine` optimistically; Minion picks remove the offer the same way.
- **Rule 11 / 13.** The page wraps each slot in a boundary; inside the panel every part (`Hand`, targets, Attack bar,
  dice, feed) has its own `PartBoundary`. No mutation runs from an effect; the phone layout is read with
  `useSyncExternalStore(matchMedia)` during render.

## Visual check (1440 and 390)

The board (`reference/designs/project/Combat.dc.html`) has no attack UI. Shots were compared with its `combat:player-day`
and `combat:gm-play` regions (`node scripts/board-shots.mjs combat:player-day combat:gm-play`): same 360px column of
`cm-card`s (14px radius, `#141e22`, Cinzel headings, uppercase letter-spaced labels, gold accent for the pressed state),
the gold `cm-go` pill for the main action, and the map's dashed gold language for rings. Shots in
`test-results/visual/CA-CA5/`: `player-picked-1440`, `attack-card-picked|result|waiting-1440`, `map-dice-1440`,
`mini-feed-1440`, `gm-resolutions-1440|390`, `gm-page-1440`, `sheet-closed|attack|dice|feed|hand-390`,
`player-full-390`. The map dice box keeps the sheet's parchment look (it is the sheet's `DiceBox`, reused as the plan
asks), tightened to one column.

## Checks

- `pnpm typecheck`, `pnpm lint` on the changed files: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 262 files, 6363 passed, 1 expected fail.
- e2e (`E2E_REUSE_SERVERS=1`, ports 3161 / 3434): `combat-attack.spec.ts` 2 passed (axe: no serious or critical
  violation in the player column, the GM column and the phone sheet); `visual/CA-CA5.spec.ts` passed; all
  `tests/e2e/combat-*.spec.ts` (combat-attack included): 20 passed.

## Notes and QUESTIONS

1. Resolutions are the campaign's latest GM `combat` rows, not filtered to the map's encounter: feed rows carry no
   encounter id, and only one encounter runs at a time. A `combatActions.resolutions` query (analysis section 6) could
   filter by encounter later.
2. The Hand tab is CA6's; until CA6 lands it is empty.
3. Switching between the desktop cards and the phone sheet (resizing past 760px) remounts the Attack bar, so the last
   result is not carried over.
