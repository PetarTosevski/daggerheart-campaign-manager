# TASK AA3: Encounter tab - target PCs, attack and use features, Fear prompts, reaction-window status, map pane

Plan `.omc/plans/combat-actions.yaml`, tracer AA3 (wave 6, depends on AA2). Server API: `docs/tasks/TASK-CA-AA2.md`.
Status: Review.

## What landed

| File | What |
|------|------|
| `src/components/adversaries/tracker/actions/panel.tsx` | `ActionPanel`, in the selected stat block above its features: target chips, Normal / Advantage / Disadvantage, Experience (1 Fear), attack reactions to opt into, `⚔ Attack <targets> with <attack>`, the spotlight note, the "Spend N Fear?" question, the result, and a Use button on every non-passive feature (passives: "Modifier: applies on its own"). |
| `actions/result.tsx` | `ActionResultView`: the GM's roll, Hit / Miss and damage per target, "waiting for answers" / "resolved", Fear gained or spent, GM prompts, reaction offers as Yes / No (default No). |
| `actions/windows.tsx` | `ReactionWindows`: this encounter's open windows from `adversaryActions.windows` ("Bandit hit Mira: 18 physical damage", "Waiting for Mira (armor choice), Tabby (ally reaction)") with "Resolve now". |
| `actions/map-pane.tsx` | `MapPane`: the Combat Map's `MapBoard` + `TokensLayer` in Play (GM) for the live map, 420 px high (320 px on phones). Drags and arrow keys move tokens through `combatTokens.move`, so they show on the Combat Map. Clicking a PC token toggles it as a target; clicking an adversary token selects that adversary. |
| `actions/use-adversary-actions.ts` | `useAdversaryActions`: `attack` / `useFeature` / `resolve`, one idempotency key per call; `confirmFear` kept as the question, `spend()` resends the same intent with `spendFear`; optimistic `campaigns.fear` decrease when Fear is spent (CL4). |
| `actions/model.ts` | Pure: `targetOptions` (Q18), `spotlightNote` (the tracker's `spotlightCostsFear`), `fearPrompt`, `rollText`, `usable`, `toggled`. |
| `actions/live.ts` | `useLiveMap` (live map from `combatMaps.list`), `useTargetData` (party + live-map tokens). |
| `boundary.tsx` | `TrackerBoundary` around the windows, the actions panel and the map pane (rule 11). |
| `index.tsx` | Mounts the windows (under the top bar), `SelectedSide` (the block with the panel) and the map pane; holds the target picks and the action hook so a result survives switching adversaries. |
| `selected-block.tsx` | The manual "Spend N Fear: <feature>" / "<Experience> +N, 1 Fear" buttons are gone (the server now asks and spends); `renderActions` slot. "Roll attack" / "Roll damage" stay as the untargeted hidden GM rolls (see QUESTIONS 1). |
| `tracker.css` | `trk-act*`, `trk-res*`, `trk-seg`, `trk-confirm`, `trk-windows`, `trk-map*`. All controls 44 px. |
| `tests/unit/tracker-actions.test.tsx` | 13 tests (model; panel with Convex mocked: picks, one call per click, confirmFear then spendFear, Cancel, too little Fear, Use on features / none on passives, offers Yes / No, opted-in reactions, refusal; windows and Resolve now). |
| `tests/e2e/encounter-actions.spec.ts` | 3 specs (below). |
| `tests/e2e/visual/CA-AA3.spec.ts` | Shots at 1440 and 390 in `test-results/visual/CA-AA3/`. |

No server file, schema or validator changed.

## User answers implemented (quoted from the plan)

- **Q12** "GM can use the encounter tab to use abilities, they will show up on combat, he can also use combat map if he
  wants": Attack and Use call AA2's `adversaryActions.attack` / `useFeature`, the same API AA5 uses on the map.
- **Q16** "the GM moves tokens, attacks, uses features and spends Fear there, the visuals show on the Combat Map": the map
  pane reuses the Combat Map's board and tokens layer; the hit shows on Mira's token (HP marked) on the Combat Map (e2e).
  The hit flash itself is AA5's `HitFlashLayer` (a stub today).
- **Q17 (a)** "the reaction window closes when the target chose armor and every eligible ally answered Use/Pass; the GM
  can 'Resolve now' anytime; no timer": `ReactionWindows`.
- **Q18 (a)** "with no live map the GM targets PCs from the party list with no range or line-of-sight restrictions":
  `targetOptions`: party without a live map holding the adversary's token; PCs with tokens otherwise (the server checks
  line of sight). Character ids are sent either way (AA2 accepts both).
- **Q19 (a)** "Fear spent only on the GM's tap; Fear-cost features and a second spotlight ask first; optional ones are a
  one-tap prompt defaulting to No": the server's `confirmFear` becomes "Spend N Fear? 1 for the spotlight, 1 for the
  feature." with Spend / Cancel; reaction offers are Yes / No; `beforeDamage` reactions (Heavy Hitter) are opt-in chips
  before the attack (off by default), since they must be sent with the attack.
- **Q14 / U1**: the panel is GM-only (the Adversaries page is GM-only); players get nothing new from it.

## Checks

- `pnpm lint` (changed files), `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 278 files, 7505 passed, 1 expected fail.
- e2e (ports 3135 / 3382, `E2E_REUSE_SERVERS=1`): `encounter-actions.spec.ts` (3), `visual/CA-AA3.spec.ts`, and the
  adversaries specs `encounter-tracker`, `adversaries`, `encounter-builder`, `custom-adversaries`,
  `adversary-catalogue`, `environments`: 25 passed.
  1. The GM picks Mira on the live map and attacks; the roll, "Mira Hit N damage waiting for answers" and the window
     "Waiting for Mira (armor choice)" show; Mira's player answers `armor` with their own client (AA4 builds the prompt);
     the window closes, the sheet has 1 more Armor Slot and HP marked, and Mira's token on the Combat Map reads the HP.
  2. Roar (1 Fear) asks "Spend 1 Fear? 1 for the feature.", Fear stays 3 until Spend, then 2; an attack and "Resolve now";
     Mira's token moved with the arrow key in the map pane lands one square down.
  3. 390 px: no horizontal scroll, every panel button ≥ 44 px, axe on `.trk` with no serious violations (also at 1440 in 1).
- Screenshots compared: panel, Fear question, result, windows, map pane, full page at 1440 and 390 against the board's
  `adversaries:statblock` region (`node scripts/board-shots.mjs adversaries:statblock`): the panel sits where the board
  draws its tracker box (dashed rules), with the parchment ink, the board's kind pills and the red attack strip colour.
  Fixed after the first shots: the map pane took the Combat Map's full viewport height (now 420 / 320 px) and the panel's
  "Features" heading duplicated the block's (now "Use a feature").

## QUESTIONS

1. **"Roll attack becomes Attack"**: the targeted Attack is in the actions panel; the head's "Roll attack" / "Roll
   damage" stay as untargeted hidden GM rolls because `tests/e2e/encounter-tracker.spec.ts` (not AA3's) relies on them.
   Remove them (and that spec's steps) in a follow-up?
2. **Feature choices**: Use sends the picked targets only. Features that need `options`, `picked`/`allies`, `splits`,
   `situations` or `eitherCosts` get the server's default or an INVALID refusal shown in the panel. A choice dialog
   (like CA6's) needs the effect tables client-side (heavy) or a server "what does this use ask" query. Which?
3. **Map pane is the full GM tokens layer**: Delete on a focused token removes it, as on the Combat Map. Keep, or add a
   read-only flag to `TokensLayer` (H22 / tokens owner)?
4. **Death-move prompt / per-instance featureUses (AA2b)**: not shown yet; `windows` and the result will pick up new
   fields once AA2b lands (a refusal for a used once-per-scene feature already shows as an error line).
5. **Player answer in e2e**: done through the player's Convex client until AA4's prompt exists; switch to the UI then.
