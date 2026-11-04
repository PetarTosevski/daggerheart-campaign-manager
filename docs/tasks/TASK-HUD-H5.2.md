# TASK-HUD-H5.2: the adversary stat block and the GM attack picker

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 6, tracer H5.2 (boards GMDesktop 'Adversary acting', CmpPicking,
CmpTokens). Briefs: "Common rules", "Board elements" (adversary stat panel + attack picker), "Wave 6", "User answers
2026-11-01" (2, 6a, 7a). Parent bead dcm-bxp.99.32 (no own bead). Mode: add; everything renders only inside the HUD
shell (switch on, Play, GM).

## What landed

All in `src/components/combat-map/hud/statblock/`:

| File | What |
|---|---|
| `index.tsx` | `HudStatBlock` (the H0 stub's name and props): reads `useHud().sheet`; `{ kind: "adversary", tokenId }` mounts the panel (`next/dynamic`, CL8: the SRD stat blocks load only when the GM opens one). Stays mounted with no panel open and owns FearConfirm and the action intents, so a Fear question asked from the purple picking panel still gets its answer after the stat block closes. |
| `panel.tsx` | `StatBlockPanel` on H0's `SidePanel` (non-modal `<aside>` "<label>’s stat block", 400 px, Esc / ✕ close, heading focus on load, focus back to the opener). Parchment block: face letter, name, "Tier 1 Leader"; Motives; Difficulty / Thresholds / Attack tiles; HP / Stress pips with "n of N marked" (answer 2) and − / + (`encounterTracking.markHp` / `markStress`, the tracker's optimistic `useTracker`); weapon "Javelin · Close · 1d8+3 phy" and Experiences; conditions (chips; a condition a Fear spend ends shows **End · n Fear** from `combatEffects.fearEnds` → `endByFear`; other chips ✕ = `toggleCondition`; "+ Condition" adds one); features with kind, Fear cost pill and **Use** (classic `FeatureUse`, which reads `featureAsk`; Momentum is automatic, answer 7a, so no Use); **Spotlight · 1 Fear** and **Attack**; the last result (classic `ActionResultView`); refusals under it (`role="alert"`); CmpBlocked layer 1 on Fear spends the GM can't pay ("Needs 1 Fear · you have 0"). Reads: `combatTokens.list`, `encounters.list` / `get`, `encounterTracking.customBlocks`, `campaigns.fear`, `combatEffects.fearEnds`, `combatMaps.get` (line of sight). All GM-only queries. |
| `attack.tsx` | `gmAttackSession`: H3.0's pick session for the purple panel "Acting for the <label>" (rule line "Javelin · Close · 1d8+3 phy · +2", actor = the adversary's token, rows = the PCs, `extra` = Normal / Advantage / Disadvantage, options = each Experience "Use Local Knowledge +2 · Costs 1 Fear" (Fear pill) and each opt-in reaction, footer "Spotlight: 1 Fear · Momentum on a hit", one primary "Attack Brannoc"). `gmFeatureSession`: the same panel for a feature that names PC targets (Coup de Grace). |
| `acts.tsx` | `useGmActs`: `adversaryActions.attack` / `useFeature` (optimistic Fear); on `confirmFear` asks FearConfirm and sends again with `spendFear` (answer 6a); a resolved action calls `combatSpotlight.gmTake` (the adversary acted, so the GM holds the scene spotlight). `useFearAsk`: one FearConfirm at a time as a promise. |
| `model.ts` | Pure: lines, thresholds, spotlight costs (`spotlightCost`: the turn's second spotlight costs 1 Fear, CB p.153; `actionSpotlightCost`: free when this adversary already holds it this turn), footer, labels, `gmAttackRows` (band from the adversary, `los` without line of sight, `out` beyond the printed range, `in`; side "enemy"), Fear reasons, condition chips, `featureUsable`. |
| `fear-confirm.tsx`, `fear-shim.tsx` | The ONE FearConfirm import (see merge-time actions) and the interim stand-in. |
| `statblock.css` | Board values (`.adv`, `.ad-*`, `.af`, `.ad-acts`) and the GM purple (`.gpk`, `.g-ring.*`, `.g-seg`, `.g-cost`, `.g-pay`) as `.hud-pk-gm` / `.hud-tg-gm`; the stand-in's `.hsb-fc`. |

Fear spends through FearConfirm (answer 6a): Spotlight (when it costs), End · n Fear, Fear features and Experiences
(both via the server's `confirmFear`), and an attack's own spotlight. Spotlight button: `encounterTracking.spotlight`
then `combatSpotlight.gmTake`.

### Out-of-owns edits (minimal; please accept)

- `src/components/combat-map/tokens/tokens-layer.tsx` (acceptance 1): restored `if (target) hud.toggleSheet(target);`
  (reverts the orchestrator's interim adversary skip, 36737ed0).
- `tests/e2e/hud-tokens.spec.ts` (acceptance 1): restored the three lines expecting `hud-sh-open hud-sh-<tokenId>` and
  `aria-pressed` on the Lieutenant, then the toggle off (reverts 36737ed0).
- `src/components/combat-map/hud/pick/panel.tsx` (+5 lines) and `hud/pick/layer.tsx` (+3 lines): the purple GM variant,
  keyed on `spec.source.kind === "adversary"`: class `hud-pk-gm` / `hud-tg-gm`; out of range reads "Out of range" (row,
  picked row, accessible name) instead of "GM approves", no GM-approval footer line and no "GM" ring badge (the GM is
  the one who would approve; HANDOFF "GM attack picking"). Player sessions are unchanged (unit test).
- `tests/e2e/hud-make-room.spec.ts`: unchanged; it passes again against the real stat block.

## Board states matched (shots: `E2E_VISUAL=1 … playwright test tests/e2e/visual/HUD-H5.2.spec.ts` → `test-results/visual/HUD-H5.2/`)

- `gm-statblock-1440.png`, `gm-statblock-panel.png`: GMDesktop 'Adversary acting' stat block (the seed's Lieutenant
  set to the board's 2 HP / 1 Stress marked, Vulnerable). Matches the board's parchment, header, tiles, tracks, weapon,
  condition chip, features with kind / Fear pill / Use, Spotlight + Attack.
- `gm-adversary-acting-1440.png`, `gm-picker-panel.png`: the purple panel beside Brannoc, rows (picked lavender, out of
  range amber "Out of range"), roll segment, Local Knowledge with the Fear pill, footer, "Attack Brannoc"; rings purple.
- `gm-spend-fear-1440.png`: the FearConfirm stand-in (H5.3 replaces it).
- `gm-adversary-acting-1024.png`: tablet look (340 px panel).
- Board render: `reference/designs/combat-hud/preview/GMDesktop.dc.html` (state 'Adversary acting', click the Lieutenant).

Deviations: conditions without a Fear end get a ✕ (and "+ Condition"), the board shows only End (GM edit, answer 5a
spirit); the seed's Vex is not Hidden, so no `g-hid` row shows in the shots (unit-tested); the token's "Spotlight" tag
(`.tk-gm`) is the tokens layer's (not in owns; follow-up below); Spotlight / Attack sit at the end of the block, as the
board, with bottom room so the app's floating "Ask the Lorekeeper" button doesn't cover them.

## What moved out of the old column

Nothing removed (mode add). The HUD now covers the classic "Adversaries" card's Attack, feature Use (with the classic
choices dialog), Fear questions and the tracker's marks / conditions / spotlight for an enemy token. Still in Map tools:
reaction windows ("Resolve now", H5.1's queue), keyword asks, GM-owned hits.

## Tests

- `tests/unit/hud/statblock-panel.test.tsx` (14): the block's content, mark intents + optimistic, Spotlight with / without
  cost (FearConfirm, Cancel spends nothing, then spotlight + gmTake), Fear-short disabling with the reason, End · 1 Fear,
  Attack session (id, source, rule, actor, rows, options, label, footer) and its send (confirmFear → FearConfirm →
  spendFear resend with a new key → gmTake → result), No keeps the panel ("No Fear spent. Nothing was rolled."), feature
  with PC targets opens the purple panel / plain feature sends, loading and no-encounter lines, model.
- `tests/unit/hud/statblock-pick.test.tsx` (2): the purple variant of H3.0's panel and rings; player copy unchanged.
- `tests/e2e/hud-statblock.spec.ts` (2): GM opens the Lieutenant (400 px aside, focus, content, axe), marks HP / Stress
  on the server and the token ring follows, adds / removes Vulnerable, a free Spotlight (no question; holder → GM),
  the Sniper's "Spotlight · 1 Fear" (Cancel keeps Fear, Spend lowers it), Esc, keyboard Enter / Esc focus back; Attack →
  purple panel, rows / "Out of range" / purple rings, Local Knowledge footer, Advantage, axe, FearConfirm "Spend 1 Fear?",
  the attack resolves, result line, holder → GM.
- `tests/e2e/visual/HUD-H5.2.spec.ts` (1, `E2E_VISUAL=1`).

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused: `statblock-panel` 14 / 14, `statblock-pick` 2 / 2. Full suite (`--maxWorkers=2 --testTimeout=120000`):
  466 files, 10425 passed + 1 expected fail, 1 failed: `tests/convex/lane4-s1-card-switches.test.ts` "Rune Ward held by
  an ally" (an unseeded Ward Die rolled 8; unrelated to the HUD; passes on rerun, 17 / 17; filed **dcm-bnrw**).
- e2e (ports 3104 / 3320, servers started by hand, `E2E_REUSE_SERVERS=1`; host shared with other agents' e2e runs):
  `hud-statblock` 2 / 2; `visual/HUD-H5.2` 1 / 1; restored `hud-tokens` 2 / 2 and `hud-make-room` 2 / 2 (unchanged spec,
  passes against the real stat block). All `tests/e2e/hud-*.spec.ts` with `--retries=1`: 22 passed, 2 flaky (hud-hit,
  hud-tokens player: sign-in / seeding timeouts under load), 1 failed (hud-hand: sign-in timeout, then a player-hand
  wait); rerun alone: hud-hand + hud-hit 2 / 2.
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H5.2 rebuild HEAD`: the out-of-owns files listed above only.

## Beads

- Filed **dcm-bnrw** (P3 bug): the flaky Rune Ward convex test above.
- Follow-up (orchestrator's call): the token's purple "Spotlight" tag on GMDesktop (`.tk-gm` above the
  adversary holding the spotlight) belongs to `tokens/` / `hud/token` (H1.3's owns).

## Merge-time actions

1. **FearConfirm swap** (after H5.3 merges): in `src/components/combat-map/hud/statblock/fear-confirm.tsx` replace
   `export { FearConfirm } from "./fear-shim";` with `export { FearConfirm } from "../fear";`, delete
   `hud/statblock/fear-shim.tsx` and the `.hsb-fc*` rules (the "INTERIM FearConfirm stand-in" block) at the end of
   `statblock.css`. Contract used: `<FearConfirm amount={number} reasons={string[]} onConfirm={() => void} onCancel={() => void} />`,
   rendered only while asking (mount = open). If H5.3's `reasons` is a single string, pass `reasons.join(", ")` in
   `acts.tsx` `useFearAsk` (the one call site). The e2e spec finds it by `getByTestId("hud-fear-confirm")` and the buttons
   "Cancel" / "Spend n Fear": keep those or adjust `tests/e2e/hud-statblock.spec.ts` and `visual/HUD-H5.2.spec.ts`.
2. Accept the out-of-owns edits above.
3. No Convex change, no codegen, no schema, no authz entry.

## QUESTIONS (safest reversible defaults taken)

1. **Pips: marked or left?** The board's stat block lights the marked HP (2 red of 6 for "4/6"), the HUD's PC sheet
   lights what is left (H2.1, answer 2). Built: marked (the board, the tracker's look); text "2 of 6 marked". Reversible
   in `Track` (panel.tsx).
2. **Attacking a PC out of the attack's range.** CB (core.txt PAGE 101): "Move within Close range and make a standard
   attack." The server does not refuse range for adversaries (the GM decides, analysis B4), as the classic column. Built:
   out-of-range PCs are listed amber "Out of range" and stay pickable. Alternative: make them unpickable.
3. **Hidden PCs.** CB (core.txt PAGE 348): "Hidden: While you’re out of sight from all foes and they don’t know where you
   are, you gain the Hidden condition. While you’re Hidden, any rolls against you have disadvantage." The board shows Vex
   "Hidden" as a dotted, unpickable ring. Built: only line of sight makes a row unpickable ("Can’t see"); a Hidden PC in
   sight stays pickable with the condition shown on its row (the GM can set Disadvantage; the roll is the engine's).
   Confirm, or say whether Hidden PCs should be unpickable for adversaries.
4. **Spotlight after an attack.** Any resolved adversary action also calls `combatSpotlight.gmTake` (the adversary
   acted). The brief names only the Spotlight button. Reversible in `acts.tsx` `run`.
