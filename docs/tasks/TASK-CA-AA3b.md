# TASK AA3b: Encounter tab follow-ups - remove the old untargeted roll buttons, a choices dialog for features, read-only map pane

Plan `.omc/plans/combat-actions.yaml`, tracer AA3b (depends on AA2c, AA3; built on rebuild 83df4d7 with AA2c and AA5).
Answers TASK-CA-AA3.md QUESTIONS 1-3. Server API: `docs/tasks/TASK-CA-AA2c.md` (`featureAsk`). Status: Review.

## User answers implemented (2026-10-22, quoted from the plan)

- "remove the head's 'Roll attack' / 'Roll damage' (the targeted Attack is the one way)"
- "features that need choices ask in a dialog (reads AA2c's featureAsk)"
- Orchestrator: "the map pane must not delete tokens (read-only flag on TokensLayer for moves only)"

## What landed

| File | What |
|------|------|
| `src/components/adversaries/tracker/selected-block.tsx` | The head's "Roll attack" / "Roll damage" / "Critical damage" and the hidden `rolls.gmRoll` path are gone. The head holds only the 3D dice stage for the server's attack rolls (state-held element, not a ref read in render). Props: `rules`, `renderActions`. |
| `actions/ask.ts` (new) | Pure: `needsChoices`, `initialAnswers`, `missing`, `askFear`, `choiceArgs`, `pick`, `pickable`, `capOf`, `creaturesFor`, `pickableUses`; types `FeatureAsk`, `Answers`, `Creature`. |
| `actions/feature-use.tsx` (new) | `FeatureUse`: each non-passive feature's Use button reads the live `adversaryActions.featureAsk` (skipped for a defeated adversary). `aria-haspopup="dialog"` when it will ask; disabled with the server's reason ("Used up this scene") when `available` is false. Until the ask loads, or if the server refuses it (own boundary), Use sends at once as in AA3. |
| `actions/choices.tsx` (new) | `FeatureChoices`: brand `Modal` titled "<Adversary>: <Feature>". Asks the use (feature with more than one), the creature lists (`targets` / `picked` / `allies` / `followUp`; radios for one pick, check boxes with a cap otherwise; "every PC within …" for `count: "all"`), one group per `choose` step, `either` costs ("Pay one", Fear recomputed), damage / clear splits, the hand-fired trigger (who set it off, who it's about, amount), optional steps (unticked: Q19 default No) and situations to confirm. Shows "Asks N Fear (you hold M). <Actor> marks N Stress. Takes the spotlight." and what is still missing; "Use <feature>" is off until it is answered. |
| `actions/panel.tsx` | Use goes through `FeatureUse`; a use that `needsChoices` opens the dialog, otherwise it fires as before. The dialog's answers are merged into the same `useFeature` intent, so the "Spend N Fear?" question still follows (Q19). New optional prop `adversaries?: {id, name}[]` for the ally lists. Other props unchanged. |
| `actions/use-adversary-actions.ts` | The hook also returns `campaignId` (the panel's `featureAsk` reads it), so `ActionPanel` needs no new required prop. |
| `actions/map-pane.tsx` | `<TokensLayer … noDelete />`; doc comment. |
| `src/components/combat-map/tokens/tokens-layer.tsx` | `noDelete?: boolean` (default false): Delete / Backspace don't remove the selected token. The Combat Map doesn't pass it, so it is unchanged. |
| `index.tsx` | Passes the encounter's standing adversaries to `ActionPanel`; `SelectedBlock`'s new props. |
| `tracker.css` | `trk-ask*` (dialog, dark shell, 44 px option rows, `--adv-name` legends for contrast), `trk-act-why`; the empty dice stage leaves no gap in the head. |

## What "needs choices" means (`needsChoices`)

A `choose` step, an optional step, a situation, a split, an `either` cost, a `picked` / `allies` / `followUp` list, a
`targets` list that isn't PCs (allies / any), a hand-fired trigger with a source, subject or amount, or more than one
non-passive use. A use whose only question is its PC targets (Bite, an attack, a manual custom feature) fires at once
with the panel's target chips, as in AA3. The panel's picked PCs carry into the dialog's targets (capped).

## Player vs GM

- GM only: the Encounter tab (and AA5's map controls, which reuse `ActionPanel`) are GM-only; `featureAsk` is a `gmQuery`.
- Players get nothing new; their view of an adversary action is unchanged (the hit prompt, "Bandit hit Mira").

## AA5 (Combat Map controls)

`ActionPanel`'s props stay compatible; the dialog shows on the map too. One-line follow-up for
`src/components/combat-map/actions/adversary/controls.tsx` (not owned here): pass
`adversaries={instances.filter((i) => !i.defeated).map((i) => ({ id: i._id, name: i.label }))}` to `ActionPanel` so ally
lists list the encounter's adversaries there too (without it they list no one).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 285 files, 7652 passed, 1 expected fail. `tests/unit/tracker-actions.test.tsx`
  20 tests (7 new: needsChoices, answers / missing / arguments / Fear; the dialog flow with one useFeature call; Cancel
  and a no-choice feature firing at once; the use picker reading the other use's featureAsk; a used-up feature and no
  featureAsk for a defeated adversary; a refused featureAsk keeps the plain Use). `tests/unit/adversary-panel.test.tsx` (AA5) unchanged and passing.
- e2e (ports 3118 / 3348, `E2E_REUSE_SERVERS=1`, `E2E_VISUAL=1`): 29 passed: `encounter-actions` (4, new: "a feature that
  needs choices asks them in a dialog before useFeature" with Deeproot Defender's Grab and Drag, axe on the open
  dialog; test 2 now presses Delete / Backspace in the map pane and the token stays), `encounter-tracker` (3, updated:
  no Roll attack / Roll damage, the targeted Attack on Mira with the 3D dice, the player's feed and pending hit carry no
  roll; reduced motion: no 3D dice on the attack), `visual/CA-AA3`, `adversaries`, `adversary-catalogue`,
  `custom-adversaries`, `encounter-builder`, `environments`, `combat-adversary` (AA5), `combat-tokens` (the Combat Map's
  Delete unchanged).
- Screenshots (`test-results/visual/CA-AA3/`, 1440 and 390): `panel-picked-*` (head without the roll buttons, no gap),
  `choices-dialog-*`, `choices-page-*` (no horizontal scroll at 390), plus AA3's shots. The board has no actions panel
  or dialog; the dialog uses the brand Modal like the tracker's Spend Fear dialog. Fixed after the first shots: legend
  contrast (axe), the empty head hid the dice stage's width (3D dice didn't play), a legend wrapping at 390.
- `pnpm tracer:guard .omc/plans/combat-actions.yaml AA3b`: passes.

## QUESTIONS

1. **Fear of optional steps**: featureAsk reports an optional step's Fear separately ("their Fear comes from the GM's
   Fear"); the dialog lists it beside the step and doesn't add it to "Asks N Fear". Should ticking it raise the Fear
   asked up front instead?
2. **Situations open the dialog**: a use whose only question is a situation to confirm (including the passives'
   situations) also opens the dialog. Fine, or fire such uses at once with none confirmed?
3. **featureAsk subscriptions**: one live `featureAsk` per non-passive feature of the selected adversary (3-5
   subscriptions). Acceptable, or fetch it only on the tap?
