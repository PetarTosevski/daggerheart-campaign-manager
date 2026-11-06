# TASK-GLASS-G9: the live encounter tracker uses glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G9; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.10.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). The tracker sits on the
Adversaries page's Encounters tab and is GM-only (a player gets the page's GM-only note), so every glass button here
wears the GM's colours: confirm Fear purple, cancel Hope gold.

## Buttons per file

| File | Button | Role | Was |
|---|---|---|---|
| `top-bar.tsx` | End GM turn | neutral | `trk-btn` |
| | End scene (`EndSceneButton`, G11's component) | danger: the top bar passes `brandButton({ variant: "danger" })` | `className="trk-btn"` |
| | + Fear ("Gain 1 Fear") | neutral | `trk-btn trk-btn-fear` |
| | Spend Fear | confirm (spending Fear = confirm, briefs G9 note) | `trk-btn trk-btn-fear` |
| | Spend Fear dialog: − / + ("Spend less / more Fear") | neutral, sm, icon (Q7) | `trk-step` |
| | Spend Fear dialog: Additional GM move / Fear feature / Experience / Interrupt | confirm (each one spends; see Questions) | `trk-btn trk-btn-fear` |
| `instance-card.tsx` | HP / Stress − / + ("Clear / Mark 1 … on …") | neutral, sm, icon (Q7) | `trk-step` |
| | Resistant | neutral + `aria-pressed` (Q6) | `trk-chip` |
| | Apply (damage) | confirm | `trk-btn` |
| | Minions: − / + ("One fewer / more Minion") | neutral, sm, icon | `trk-step` |
| | Defeat N | danger | `trk-btn trk-btn-danger` |
| | Hidden / Restrained / Vulnerable / Distracted | neutral + `aria-pressed` | `trk-chip` |
| | ✕ "Remove tag …" | neutral, sm, icon (Q7) | `trk-tag-x` |
| | Spotlight | neutral; **danger** while `data-maxed="true"` (at or past the limit: the old warning colour was ember) | `trk-btn trk-spot-btn` |
| `actions/panel.tsx` | Target chips (PC names) | neutral + `aria-pressed` | `trk-chip trk-chip-parch` |
| | Normal / Advantage / Disadvantage | normal / advantage / disadvantage + `aria-pressed` | `trk-seg button` |
| | Reaction chips ("Use on this attack") | neutral + `aria-pressed` | `trk-chip trk-chip-parch` |
| | ⚔ Attack … with … | confirm | `trk-btn trk-btn-attack` |
| | Fear question: Spend N Fear / Cancel | confirm / cancel | `trk-btn trk-btn-parch trk-btn-fear` / `trk-btn trk-btn-parch` |
| `actions/feature-use.tsx` | Use (per feature) | confirm, sm (with `glass`) | `trk-btn trk-btn-parch trk-btn-sm` |
| `actions/result.tsx` | Clear | cancel, sm (with `glass`) | `trk-btn trk-btn-parch trk-btn-sm` |
| | Use {reaction}? Yes / No | confirm, sm / cancel, sm (with `glass`) | same |
| `actions/choices.tsx` | Use {feature} (submit) / Cancel | confirm / cancel (with `glass`) | `trk-btn trk-btn-attack` / `trk-btn` |
| `actions/windows.tsx` | Escaped | neutral | `trk-btn` |
| | Resolve now | confirm (the row's action) | `trk-btn` |
| `boundary.tsx` | Try again | neutral | `trk-btn` |

Totals: confirm 13 (Spend Fear, 4 reasons, Apply, Attack, Spend N Fear, Use, Yes, Use {feature}, Resolve now), cancel
4 (Fear question Cancel, Clear, No, choices Cancel), danger 3 (End scene, Defeat N, maxed Spotlight), roll toggle 3,
neutral the rest (steppers, chips, End GM turn, + Fear, Escaped, Try again, tag ✕).

### The Combat HUD shares three components

The HUD's stat block (`combat-map/hud/statblock/panel.tsx`) mounts `FeatureUse`, `FeatureChoices` and
`ActionResultView` from this folder and styles their `trk-btn` pills itself (`statblock.css .hsb-af-use .trk-btn`,
`tablet.css`). The HUD stays untouched, so each of the three takes a new optional `glass` prop (default `false`: the
old classes); the Encounter tab's `ActionPanel` passes `glass`. No file outside the owns changed.

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `instance-card.tsx` | HP hearts / Stress diamonds (`sh-pip`) | pips (`encounter-tracker.spec` asserts the classes) |
| `instance-card.tsx` | the card's name (`trk-card-name`, `aria-pressed`) | a row title that selects the card and opens its stat block |
| `actions/choices.tsx` | radio / checkbox options (`<label>`) | form controls |
| `actions/panel.tsx` | Experience `<select>` | a form control |
| `.trk-act` | — | not a button: the actions panel's section (layout), listed in the acceptance by mistake |

## Classes deleted (`tracker.css`)

- `trk-chip`, `trk-chip-parch`, `trk-step`, `trk-tag-x`, `trk-spot-btn[data-maxed]`, `trk-btn-fear`, `trk-btn-danger`,
  `trk-btn-crit`, `.trk-btn-parch.trk-btn-fear`, the `trk-seg` segment drawing (`.trk-seg` is now a layout-only gap row).
- Dead since AA3b (no markup uses them): `trk-rolls`, `trk-roll-out`, `trk-flat`, `trk-fear-acts`.
- Kept for the HUD only, with a comment: `trk-btn`, `trk-btn-parch`, `trk-btn-sm`, `trk-btn-attack`. GZ (or whoever
  restyles the HUD stat block) can drop them once the HUD stops using them.
- `.trk-tag` became a slightly squarer chip with room for the small glass ✕.

## Shots

`tests/e2e/visual/GLASS-G9.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G9/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g9/`:

- `tracker-gm-{1440,1024,390}`: the whole tracker with the Bandit selected (stat block and actions panel).
- `adversaries-player-{1440,1024,390}`: the player's GM-only note (no tracker).
- `top-gm-hover-spend-fear`, `top-gm-focus-end-turn`: a hovered confirm and a keyboard-focused button (axe clean).
- `card-gm-hover-apply` (axe clean), `minion-gm-defeat`.
- `panel-gm-hover-attack`, `panel-gm-focus-advantage`, `fear-question-gm-hover-spend` (axe clean), `result-gm`,
  `windows-gm`.
- `spend-fear-dialog-gm-hover-reason` (axe clean), `end-scene-dialog-gm`, `choices-gm-focus-cancel` (axe clean).

The spec also asserts every role above, the GM's Fear confirm, `sh-pip` on the pips and 44 px for every glass button
at 1024 and 390.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G9`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/encounter-damage.test.ts`, `tracker-actions`,
  `tracker-held-attack`, `hud/statblock-panel`, `hud/blocked-gm`, `tests/unit/brand`: 6 files, 88 passed; the full
  suite: 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3885 / 3985, `E2E_REUSE_SERVERS=1`, `E2E_VISUAL=1`, `--workers=1`:
  encounter-tracker, encounter-actions, adversary-actions-flow, adversary-actions-a11y, visual A4, CA-AA3 and
  GLASS-G9: 13 passed.
- The first shots showed the disabled Attack (before a target is picked) as muddy, unreadable grey on the parchment;
  `tracker.css` now gives `.trk-act .gb:disabled` the opaque dark glass (the same fix as G5's `wizard.css`).

## Questions (defaults taken)

- **End scene's dialog.** `EndSceneButton` applies the class it is given to its opener and to its dialog's Cancel and
  End scene, so until G11 changes the component the dialog's Cancel is ember too (shot `end-scene-dialog-gm`). G11
  owns it; default: leave it to G11.
- **Spend Fear's four reasons.** Each one spends Fear and closes the dialog, and none is the main one, so all four are
  confirm rather than one confirm and three neutral.
- **Spotlight at its limit.** It used to turn ember; glass has no warning tone, so it is danger while
  `data-maxed="true"` (never blocked, as before) and neutral otherwise.
- **Glass on the stat block's parchment.** The goal puts Attack / Use as confirm; Q5 (a) names only the Notes page, the
  recap paper and the Tome book, so the actions panel inside the parchment gets glass.
- **Tag ✕.** Removing a tag is trivially undone, so it is a grey neutral ✕ (Q7), not danger.
