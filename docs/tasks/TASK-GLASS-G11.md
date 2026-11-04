# TASK-GLASS-G11: the Combat Map's play side outside the HUD uses glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G11; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.12.
Design `reference/designs/buttons/arcane-glass.html`. Built on the default answers (Q1-Q9 = a). Follows the "Notes for
the area tracers" in `docs/tasks/TASK-GLASS-G0.md`.

A restyle: labels, accessible names, `aria-*`, `type`, `data-testid`s, disabled logic and handlers are unchanged.
The Combat HUD's own files (`hud/**`), the card face (`hand/face.tsx`), the vault deck (`hand/dock.tsx`, card art),
tokens and map art are untouched.

## What is still rendered (after the HUD cut-over, H8.1 / H8.2)

| File | Where it shows |
|---|---|
| `requests/index.tsx` (`DifficultyRequests`) | The GM's classic Charge flow inside the HUD sheet (`drawer/use`) |
| `drawer/use/index.tsx` (`FeatureUse`) | The HUD sheet's classic Use flow (Warden's Protection count, Charge, point areas) |
| `drawer/prompts/index.tsx` (`DrawerPrompts`) | The HUD sheet's ally-roll prompts (Cannonball) |
| `drawer/list/controls.tsx` | HUD sheet: `D5Use` (feature rows), Flying, Beastform, stances (`hud/sheet/class.tsx`) |
| `drawer/boundary.tsx` | The fallback of the above when a read fails |
| `actions/reactions/prompt.tsx` (`PendingHits`, `HitBoundary`) | The character sheet's incoming-hit prompt (parchment); `HitBoundary`'s fallback also wraps the HUD hit window |
| `actions/hand/result.tsx` (`CardResult`) | The HUD hand's card result ("Done" on a manual step) |
| `actions/scene/index.tsx` (`EndSceneButton`) | The Encounter tab's top bar (`adversaries/tracker/top-bar.tsx`, G9) |
| `actions/roll-controls/index.tsx` | Only its helpers are imported (the HUD has its own roll options); `Stepper` and `RollOptions` are not mounted. Restyled anyway, so GZ's guard finds no hand-styled button. |

`GmOwnHits` is exported but not mounted (H8.2 moved the GM column's hits into the HUD); its buttons are
`PendingHits`'.

## Buttons per file

### `src/components/combat-map/requests/index.tsx` (the GM's Difficulty answer)

| Button | Role | Was |
|---|---|---|
| Roll (aria "Roll: …") | allow (gold for every viewer) | `cm-btn cm-sm` |
| Decline (aria "Decline: …") | deny (purple for every viewer) | `cm-btn cm-sm cm-danger` |

Medium (44 px), as before (`.dfr-actions .cm-btn { min-height: 44px }`).

### `src/components/combat-map/actions/scene/index.tsx` (`EndSceneButton`)

| Button | Role | Was |
|---|---|---|
| End scene (opener) | danger, by default (`className` defaults to `brandButton({ variant: "danger" })`); the tracker's top bar passes its own class (`trk-btn` today, G9's glass next) | `className`, default `cm-btn` |
| Cancel (confirmation) | cancel | the opener's `className` |
| End scene (confirmation) | danger | the opener's `className` |

The opener keeps `style={{ minHeight: 44 }}` so the tracker's `trk-btn` stays 44 px until G9 passes glass.

### `src/components/combat-map/drawer/use/index.tsx` (HUD sheet, classic Use flow)

| Button | Role | Was |
|---|---|---|
| ✕ Close <feature> | cancel, icon, round (G0: a panel's Close ✕) | `cm-btn cm-sm` |
| Pick the square on the map / Pick n squares on the map | confirm | `cm-btn` |
| Roll the number of allies | confirm | `cm-btn` |
| Use <feature> | confirm | `cm-btn` |
| Roll Agility and charge | confirm | `cm-btn` |

### `src/components/combat-map/drawer/prompts/index.tsx` (ally rolls)

| Button | Role | Was |
|---|---|---|
| Ask to throw · 1 Stress | confirm, small | `cm-btn cm-sm` |
| Roll the throw | confirm | `cm-btn` |
| Cancel (the GM's waiting ally roll) | cancel, small | `cm-btn cm-sm` |

### `src/components/combat-map/drawer/list/controls.tsx` (HUD sheet class controls)

| Button | Role | Was |
|---|---|---|
| Flying | neutral, `aria-pressed` (switched on = gold glow, Q6) | `cm-btn` |
| Refocus | neutral | `cm-btn cm-sm` (44 px by `.sd-refocus .cm-btn`) |
| Shift · 1 Focus, Shift · 1 Stress | neutral (two options side by side, neither the main one) | `cm-btn cm-sm` (44 px) |
| Use (D5 out-of-combat feature) | confirm | `cm-btn cm-sm` (44 px) |
| Drop out (of a Beastform) | neutral (a game choice, not a removal) | `cm-btn cm-sm` (44 px) |

All medium: they were 44 px by the `.sd-* .cm-btn` rules.

### `src/components/combat-map/drawer/boundary.tsx`

| Button | Role | Was |
|---|---|---|
| Try again | neutral, small | `cm-btn cm-sm` |

### `src/components/combat-map/actions/reactions/prompt.tsx` (the incoming-hit prompt)

Roles follow the HUD's hit window (`hud/hit`): the answer that takes the hit forward is confirm, the back-out cancel.

| Button | Role | Was |
|---|---|---|
| Mark (one Armor Slot) | confirm | `ih-btn ih-go` |
| Don't | cancel | `ih-btn` |
| Mark n · step (I Am Your Shield, several counts) | confirm (alternatives of the same answer) | `ih-btn ih-go` |
| Don't · step | cancel | `ih-btn` |
| OK (no armor to mark) | confirm | `ih-btn ih-go` |
| Pass (an ally, before the roll) | cancel | `ih-btn` |
| Done (after the armor answer) | confirm | `ih-btn ih-go` |
| Spend (a grant), Use (a reaction card / feature) | confirm | `ih-btn ih-go` |
| Try again (`HitBoundary`) | neutral, small | `ih-btn` |

All medium (44 px, as `.ih-btn` was), so `incoming-hit` / `combat-feature-reactions` touch checks still hold.

**Parchment.** On the character sheet the prompt is parchment (`.ih-wrap[data-variant="sheet"]`). Q5 (a) keeps
ink-on-paper for the Notes page, the recap and the Tome; this prompt is not one of them, and the acceptance asks for
confirm / cancel by viewer, so it follows G5 / G8 (glass on parchment) with two scoped rules in `reactions.css`: the
focus ring in the sheet's wine (`--ih-acc`), and opaque disabled glass (`#0d1417`, as the wizard).

### `src/components/combat-map/actions/hand/result.tsx` (HUD hand's card result)

| Button | Role | Was |
|---|---|---|
| Done (aria "Done: <step>") | neutral, small | `cm-btn cm-sm` |

### `src/components/combat-map/actions/roll-controls/index.tsx` (not mounted)

| Button | Role | Was |
|---|---|---|
| − / + (Less / More advantage, help dice) | neutral, small, icon | `cm-btn cm-sm` |
| Experience chips | neutral, small, `aria-pressed` | `cm-chip` |

There is no Normal / Advantage / Disadvantage toggle in G11's files: the acceptance's roll toggle is the HUD's own
(`hud/**`, unchanged). The unmounted Advantage stepper stays a stepper (behaviour unchanged).

### Left alone

- `actions/hand/dock.tsx` (`VaultDeck`): a stack of card art that opens the vault, card-face territory.
- `actions/hand/face.tsx`: the card face (`CardMore` comes from `cards/`).
- `actions/targets`, `actions/adversary/flash.tsx`: map overlays, no buttons.
- `actions/actions.css` `.cm-chip[aria-pressed="true"]`: also styles the Combatants panel's chips (G10's).

## CSS deleted

- `requests.css`: `.dfr-actions .cm-btn` (the 44 px stays on `.dfr-num`).
- `drawer.css`: `.sd-shift .cm-btn, .sd-refocus .cm-btn` and `.sd-d5 .cm-btn, .sd-form .cm-btn, .sd-flying .cm-btn`
  (min-height 44 px; the buttons are medium glass now).
- `use.css`: `.sdu-panel .cm-btn` became `.sdu-panel .gb { max-width: 100% }`; the selects keep their 44 px.
- `reactions.css`: `.ih-btn` (+ `.ih-go`, focus, disabled), the `--ih-acc-ink` tokens; `.ih-rc .ih-btn` became
  `.ih-rc > .gb` (grid placement), the phone `.ih-actions .ih-btn` became `.ih-actions .gb` (flex grow).
- Comments in `slots.ts` and `actions.css` no longer name `cm-btn` / `cm-go`.

## Per role

| Role | Buttons |
|---|---|
| confirm | Pick the square(s), Roll the number of allies, Use <feature>, Roll Agility and charge, Ask to throw, Roll the throw, D5 Use, Mark, Mark n, OK, Done (hit), Spend, Use (reaction card / feature) |
| cancel | Close ✕ (Use flow), Cancel (ally roll), Don't, Pass, Cancel (End scene confirmation) |
| danger | End scene (opener, default), End scene (confirmation) |
| allow / deny | Roll / Decline (Difficulty request) |
| neutral | Flying (pressed), Refocus, Shift ×2, Drop out, Try again ×2, Done (card result), steppers, Experience chips |

The player sees confirm gold and cancel purple; the GM (HUD sheet, character sheet, Encounter tab) the reverse
(Q1 a). Allow / deny and danger look the same for both.

## Checks and shots

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G11`: every change owned.
- vitest, touched areas (`--maxWorkers=1 --testTimeout=120000`): drawer-prompts, sheet-drawer, drawer-use,
  incoming-hit, combat-hand, adversary-panel, hud/{sheet-panel, sheet-class-controls, hit-window, hit-model,
  action-ring, card-pick, blocked-player}, `tests/unit/brand`: 14 files, 192 passed. Full suite: 519 files, 11051
  passed, 1 expected fail.
- e2e (servers started by hand on 3893 / 3993, `E2E_REUSE_SERVERS=1`, `--workers=1`): a11y-combat-hand,
  combat-actions-a11y, combat-actions-flow, combat-adversary, combat-cannonball, combat-cards, combat-end-scene,
  combat-feature-reactions, combat-riders, hud-dock, hud-fear-confirm, hud-sheet, hud-shell, incoming-hit,
  live-combat, encounter-tracker: 32 passed, 1 skipped (the existing `test.fixme` in a11y-combat-hand).
  `visual/GLASS-G11` (`E2E_VISUAL=1`): 2 passed (roles asserted, axe clean with a button hovered and with one
  keyboard-focused, every glass button at least 44 px at 1024 and 390).

Shots in `test-results/visual/GLASS-G11/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g11/`:

- `hit-{player,gm}-{1440,1024,390}`, `hit-{player,gm}-hover-mark`, `hit-{player,gm}-focus-dont`: the reaction prompt
  on the character sheet (parchment).
- `end-scene-gm-{1440,1024,390}`, `end-scene-gm-hover-end`, `end-scene-gm-focus-cancel`: the Encounter tab's End scene
  confirmation.
- `charge-player-1440`, `charge-player-focus-close`: the player's waiting Charge in the HUD sheet.
- `difficulty-gm-{1440,1024,390}`, `difficulty-gm-hover-roll`, `difficulty-gm-hover-decline`,
  `difficulty-gm-focus-decline`: the GM's Difficulty request.
