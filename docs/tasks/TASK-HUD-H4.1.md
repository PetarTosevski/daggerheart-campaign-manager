# TASK-HUD-H4.1: the result panel, the after-roll hold, damage splits and ally picks

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 5 batch A, tracer H4.1 (boards Main 'Card result',
CmpPromptsPlayer 'Your roll waits', CmpPicking 'After the roll'). Parent bead dcm-bxp.99.32 (no own bead). Mode: add;
everything renders only inside the HUD shell (switch on, Play).

## What landed

All in `src/components/combat-map/hud/result/` (H0's `HudResult` stub, mounted by the shell in the pop region, filled):

| File | What |
|---|---|
| `model.ts` | Pure. `outcomeTag` ("Success with Hope", "Failure with Fear", "Critical success"; "With Hope" for an attack that hit some targets and missed others), `dualityParts` (Hope die, Fear die, the rest as one signed number, total), `gainsOf` ("+1 Hope", a critical's "Clear a Stress", "GM +1 Fear"; CB p.95), `damageFormula` ("1d8+1" from the counted dice and the roll's modifier; a critical's dice maximum is named after it, "1d8+1 +8 critical", CB p.98), the damage type (a card use's damage step, a weapon's "phy" / "mag"), the roll word ("Spellcast Roll", "<Trait> Roll"), `cardResultView` / `attackResultView` (the server's resolved answer → what the panel shows), `heldSub` / `heldPrimary` (the held roll), and the after-roll asks: `groupAsks` (plain choices, splits, per-chooser picks of one step), `splitTotal` / `splitLeft`, `choseCount`, `asksProblem`, `asksPrimary` ("Deal the damage"), `withAnswers`. |
| `store.ts` | `hudResults`: one external store (`useSyncExternalStore`, like H3.2's `report.ts` and H3.3's square-picking store) for what the panel shows next: a result (`show`, `markDone`, `clear`) or a card use's after-the-roll asks (`ask`); and the weapon each held attack used (`noteHeld` / `heldMeta`). |
| `index.tsx` | `HudResult` (one panel at a time; nothing while a pick session is open): 1. "Your roll waits" from `combatRequests.mine` (`afterRoll`, players), 2. "After the roll" (the store's asks), 3. the result (the store's), with the open damage-phase rider picks (`riderPick`) under it, or on their own as "After your hit". Senders: `showCardResult`, `showAttackOutcome`, `askAfterRoll`. |
| `panel.tsx` | `ResultPanel` (Main `.res`): card art (next/image), title, "<actor> · <roll>", the outcome tag, ✕; the dice line; one row per target: name, Hit / Miss / Defeated, the actor's own damage on a hit ("1d8+1 → 7 physical"; several damage rolls list under the rows instead), the condition names the target carries now (answer 10a, from the player's own view); the table steps left (a manual step gets Done), notes (riders that applied, skipped riders, the Minion offer). `role="status"`, Esc closes from inside. |
| `held.tsx` | `HeldRoll` (CmpPromptsPlayer 'Your roll waits'): "Brannoc · 15 with Hope · before damage", the dice, Hit / Miss per target, the features as radio rows with their costs (the first preselected), Pass / "Use and roll damage" → `combatActions.afterRoll` (one intent, optimistic drop of the request); the resolved attack then shows as the result, named by the weapon the picker noted. `RiderAsk` (Main's follow-up ask `.res-ask`; HF p.8 Death Strike): "<cost>: <rider> <target>?" with Not now / "<rider> · <cost>", chips when several creatures → `combatActions.riderPick` (optimistic). |
| `asks.tsx` | `AsksPanel` (CmpPicking 'After the roll'): a split as steppers per target with "Split 14 damage between your targets" and "n left" (the primary waits for 0 left), each ally's own pick as a chip row per ally under "<step> · each ally picks their own" with "n of m chose", a plain choice as chips; Cancel / "Deal the damage" (or Confirm). A refusal stays under the primary (`role="alert"`). |
| `parts.tsx` | `CardArt`, `DiceLine` (Hope / Fear dice as labelled images, modifier, total, gains), `VerdictPill`. |
| `result.css` | Board values on the `--hud-*` tokens. The spot is Main's (left `--hud-pop-res-left` = 820, moving to 592 with an open sheet; 250 px above the bottom; 440 wide), kept on screen at 1024; a bottom sheet with 44 px controls at ≤ 760 px; motion stops under `prefers-reduced-motion`. |

Placement: the board's fixed spot (Main `.res`), not measured beside the target token like the picking panel: the
shell already reserved `--hud-pop-res-left` for it (H2.2's make-room), and the panel then never covers the target's
rings or the hand.

## What replaced what (interim results and classic dialogs)

| Before | Now |
|---|---|
| H3.1: the classic `CardResult` above the fan for a resolved card (`hud-hand-result`) | the result panel (`hud/hand/body.tsx` `settle` → `showCardResult`) |
| H3.1: the classic `AfterRollDialog` (modal) for a card's after-the-roll asks (split, per-ally choice, a choice) | "After the roll" (`settle` → `askAfterRoll`; the answer re-sends the use with `withAnswers`, as the dialog did) |
| H3.2: the `.hud-atk-res` line ("Bandit: Hit · your damage 9") in `hud/pick-attack/prompts.tsx` | the result panel (`use-attack.tsx` → `showAttackOutcome`) |
| H3.2: "Your roll waits: answer it in Map tools" (the held attack in the classic `AfterRollPrompt`) | "Your roll waits" in the HUD, from the server's open request (survives a reload) |
| Classic `RiderPickPrompt` (Death Strike) in Map tools | the rider ask under the result / "After your hit" |

Still elsewhere (not in this tracer's scope or owns): a feature use's result stays H3.3's one line in the square-picking
bar (bead dcm-bxp.99.32.26); a chain link after the roll stays H3.3's chain session; the GM's out-of-range line for a
card the GM plays for a PC stays above the fan (`CardResult` pending; the GM queue is H5.1); the GM's "Resolve now" on a
player's held attack stays in Map tools (H5.1's queue); H3.2's `report.ts` / `reportOf` stay (unused by the HUD now;
its `.hud-atk-launch` / `.hud-atk-res` CSS is dead).

## Board states matched (shots: `E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm exec playwright test tests/e2e/visual/HUD-H4.1.spec.ts`)

`test-results/visual/HUD-H4.1/`: `player-card-result-{1440,1024}.png`, `player-card-result-panel.png`,
`player-card-result-sheet-1440.png` (beside an open sheet), `player-attack-result-{1440,390}.png` (390: the bottom
sheet; the phone hand fan is H7.x's, so the phone shot is an attack's), `player-attack-result-panel.png`. Board to compare: `reference/designs/combat-hud/preview/Main.dc.html` (Preview: Card
result).

- Main 'Card result': art, "Vicious Entangle", "Moss · Spellcast Roll", the gold tag, Hope / Fear dice, "+2", "= 15",
  "★ +1 Hope", the Lieutenant's row "Hit · 1d8+1 → 7 physical" with its condition. Matched on the seed's real roll.
  The board's follow-up "Spend a Hope to also Restrain the Bandit?" is a rider chosen before the roll in this engine
  (H3.1's switch, "If it hits, also Restrain…"); the result's follow-up row is the damage-phase rider the engine does
  ask after the roll (Death Strike), with the board's Not now / "<rider> · <cost>" buttons.
- CmpPromptsPlayer 'Your roll waits': title, "<name> · 15 with Hope · before damage", the body line, the options as radio
  rows with the cost on the right, Pass / "Use and roll damage". Matched (plus the dice and Hit / Miss rows, which the
  classic prompt showed and the board leaves out).
- CmpPicking 'After the roll': "Split 14 damage between your targets" + "0 left", steppers per target, "Deal the
  damage"; "Rousing Strike · each ally picks their own" + "2 of 3 chose", a chip row per ally. Deviations: no Major /
  Minor tags on the split rows (they would tell a player an adversary's thresholds, HANDOFF hard rule 2); no portraits
  in the ally rows (the ask has token ids only); the allies' picks are made on the actor's screen (engine; QUESTIONS 1);
  "n left" needs the split's total, which the server's ask does not carry yet (bead dcm-bxp.99.32.23; until then the
  row says "n shared" and the primary doesn't wait on it).
- No visual shots of 'Your roll waits' and 'After the roll': the e2e scene has no deterministic trigger (bead
  dcm-bxp.99.32.25); the unit tests cover both.

## Out-of-owns edits (minimal, forced)

- `src/components/combat-map/hud/hand/body.tsx` (H2.3 / H3.1): `settle` sends a resolved card to `showCardResult` and a
  non-chain `needsChoice` to `askAfterRoll` (instead of `setLast` and the classic `AfterRollDialog`); the dialog's JSX
  and its import, and the unused `chainAskOf` import, removed; `play` clears the last result (`hudResults.clear()`);
  header comment. The GM's pending line (`CardResult` pending) is unchanged. Reason: the hand is where the card's answer
  arrives; there is no other seam.
- `src/components/combat-map/hud/pick-attack/use-attack.tsx` (H3.2): the `attack` call passes its answer to
  `showAttackOutcome` (with the actor's name, the weapon, the token names from the player's view); `open` clears the
  last result. Reason: the picker's `onReport` carries no dice.
- `src/components/combat-map/hud/pick-attack/prompts.tsx` (H3.2): the `.hud-atk-res` line and its `useAttackReport`
  removed (the plan said "keep the result line until H4.1"); header comment.
- `tests/unit/hud/card-pick.test.tsx` (H3.1): the chain test's last check reads the result store instead of
  `hud-hand-result`; `afterEach` resets the store.
- `tests/unit/hud/attack-pick.test.tsx` (H3.2): renders `HudResult` beside `HudAttack`; resolved answers carry a roll;
  the result checks read the panel's rows (`hud-result-row`: "BanditHit1d8+1 → 9 magic", "OrielMiss"); the held answer
  shows no result (it comes from the server's request); `afterEach` resets the store.
- `tests/e2e/hud-card-pick.spec.ts` (H3.1): the cast's result is `hud-result` (was `hud-hand-result` in the hand).
- `tests/e2e/hud-attack-pick.spec.ts` (H3.2): the Defeated / Hit / Miss checks read `hud-result-row` (was
  `hud-attack-result`).

## Tests

- `tests/unit/hud/result-panel.test.tsx` (11): model (tags, dice parts, damage formula, gains, damage types, card and
  attack views, held lines, splits with / without a total, grouped ally picks, answers merged); HUD: a card's result
  (art-less in jsdom, name, sub, tag, dice images, total, +1 Hope, rows with damage and the Lieutenant's Restrained, no
  adversary number, Done, ✕); an attack's result and nothing while a pick session is open; 'Your roll waits' (radio rows,
  Use and roll damage → `afterRoll` args, the result named by the noted weapon); Pass, and the GM sees no hold; the
  Death Strike ask alone and under a result (pick → Use, Not now → pass); 'After the roll' (split steppers, "3 left" →
  "0 left", no Major / Minor, ally chips "0 of 2" → "1 of 2", answers sent as `split:` / `by:` choices); a refusal stays,
  Cancel.
- `tests/e2e/hud-result.spec.ts` (2): Moss casts Vicious Entangle → the panel (heading, "Moss · Spellcast Roll", art,
  tag, Hope / Fear dice, total, the Lieutenant's verdict and own damage on a hit, no adversary number, at x 820 / 440
  wide, axe); the GM's screen has no result; a new Use clears it. An attack through the action ring at 390 × 844 → the
  attack's result as a bottom sheet (full width, on the bottom edge), axe, ✕ closes.
- `tests/e2e/visual/HUD-H4.1.spec.ts` (`@visual`): the shots above.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean. tracer-guard: OK for owns (plus the out-of-owns edits listed above).
- vitest focused: `tests/unit/hud` 16 files, 221 passed (11 new). Full suite (`--maxWorkers=2 --testTimeout=120000`):
  461 files, 10369 passed + 1 expected fail.
- e2e (ports 3194 / 3500): `hud-result.spec.ts` 2 / 2; visual `HUD-H4.1.spec.ts` 1 / 1; all `tests/e2e/hud-*.spec.ts`
  23 / 24. The one failure, `hud-make-room.spec.ts` "the GM: a stat block makes room…", is not mine: rebuild's
  commit 36737ed0 (a GM click on an adversary token only selects it until H5.2) left that spec expecting the stat block
  to open (`hud-sh-open`). It fails on `rebuild` without this change; fix it at merge or with H5.2.

## Beads

Filed (parent dcm-bxp.99.32):
- **dcm-bxp.99.32.23** (lane:w1-e3-steps-saves): the split ask carries its amount ("n left").
- **dcm-bxp.99.32.24** (lane:needs-user-answer): per-ally picks answered on each ally's own screen (QUESTIONS 1).
- **dcm-bxp.99.32.25** (lane:w0-d-adversary-e2e): an e2e seed for a held attack / after-roll split, for shots.
- **dcm-bxp.99.32.26**: a feature use's result in the result panel (replace H3.3's bar line).

## Merge-time actions

- Accept the out-of-owns edits above (3 source files, 4 test files). No Convex change, no codegen, no schema, no authz
  entry.
- Optional cleanup: delete `.hud-atk-launch` / `.hud-atk-res` from `hud/pick-attack/attack.css` and, if nothing else
  reads them, `hud/pick-attack/report.ts` + `reportOf` / `onReport` (H3.2's) — kept here to stay out of H3.2's model.
- H4.2 (hit window) and H4.3 (death modal) also mount in the pop region; the result panel sits at Main's `.res` spot
  (left 820, bottom 250) and hides while a pick session is open. If the hit window opens while a result shows, both are
  visible (the board never shows both); H5.x / H6.x may want a stacking rule.

## QUESTIONS (safest reversible defaults taken)

1. **Who answers an ally's pick** (Rousing Strike, CB p.343: "Once per rest, when you critically succeed on an attack,
   you and all allies who can see or hear you can clear a Hit Point or 1d4 Stress."). The board says allies answer on
   their own screens ("2 of 3 chose"); the engine asks the acting player for every chooser at once. Default: one chip
   row per ally on the actor's screen, counted there ("n of m chose"), sent together (the engine's contract). Bead
   dcm-bxp.99.32.24 holds the server work if the answer is "each ally on their own screen".
2. **"+1 Hope" on the result.** CB p.95: "CRITICAL SUCCESS… You gain a Hope and clear a Stress." and a roll with Hope
   gains a Hope. The panel shows "+1 Hope" (and "Clear a Stress" on a critical) from the outcome alone; at 6 Hope the
   sheet can't take it (the server is right; the line is the rule). Default kept; say if it should read the sheet.
3. **Tag on a mixed multi-target attack**: "With Hope" (neither Success nor Failure, since one roll hit some targets and
   missed others). Confirm.
