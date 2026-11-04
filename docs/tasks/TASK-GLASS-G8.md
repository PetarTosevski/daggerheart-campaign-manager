# TASK-GLASS-G8: the Adversaries library uses glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G8; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.9.
Design `reference/designs/buttons/arcane-glass.html`. Built on the default answers (Q1-Q9 = a). Follows the "Notes for
the area tracers" in `docs/tasks/TASK-GLASS-G0.md`. The live encounter tracker (`adversaries/tracker/**`) is G9's.

A restyle: labels, accessible names, `aria-*`, `type`, disabled logic and handlers are unchanged. The two-tap deletes
(encounter, custom adversary) stay two-tap.

## Buttons per file

### `src/app/(gm)/campaigns/[campaignId]/adversaries/page.tsx` and `error.tsx`

| Button | Role | Was |
|---|---|---|
| Try again (slot boundary, route error) | neutral, small | `.adv-alert button` |
| Reload page (slot boundary) | neutral, small | `.adv-alert button` |

Left alone: the Catalogue / Encounters / Environment tabs (`role="tab"`, G0 notes).

### `src/components/adversaries/builder/index.tsx`

| Button | Role | Was |
|---|---|---|
| + New encounter (creates an encounter) | confirm | `enc-pill enc-pill-primary` |
| Show more ended encounters | neutral, small | `enc-ghost` |
| + Add to encounter (catalogue stat block head) | confirm, small | `enc-ghost enc-on-paper` |

Left alone: the encounter list items (`enc-item`, rows that open an encounter).

### `src/components/adversaries/builder/encounter-detail.tsx`

| Button | Role | Was |
|---|---|---|
| Delete / Click again to delete | danger | `enc-ghost enc-danger` |
| ▶ Start encounter | confirm | `enc-pill enc-pill-start` (green) |
| Open in tracker | neutral | `enc-ghost` |
| ■ End encounter | danger | `enc-pill enc-pill-end` |
| + Add adversary | neutral, small (opens the dialog; Start encounter is the page's main action) | `enc-ghost` |
| ↑ / ↓ Move (instance row) | neutral, small, icon | `enc-x` |
| × Remove (instance row) | danger, small, icon (deletes a saved row) | `enc-x` |

### `src/components/adversaries/builder/budget-panel.tsx` (shared with the Journal's Battle Points card)

| Button | Role | Was |
|---|---|---|
| − / + player characters (builder variant only) | neutral, small, icon | `enc-step` |

Left alone: the six adjustment rows (`enc-adj` in the builder, the hand-styled rows of the `journal` variant). They
are checklist rows with a check box, label, hint and delta, not switches or chips. The Journal variant has no stepper,
so **the Journal's Battle Points card is unchanged** (`journal-encounter` spec run).

### `src/components/adversaries/builder/add-dialog.tsx` (Add to encounter, SRD)

| Button | Role | Was |
|---|---|---|
| All tiers / Tier 1-4 (filter) | neutral, small, `aria-pressed` (Q6) | `enc-tier` |
| Cancel | cancel | `enc-ghost` |
| Add to encounter | confirm | `enc-pill enc-pill-primary` |

Left alone: the matching adversary picks (`enc-pick`, a single-choice list of rows with `aria-pressed`).

### `src/components/adversaries/catalogue/index.tsx`, `src/components/adversaries/environments/index.tsx`

| Button | Role | Was |
|---|---|---|
| Order / Tier / Type / Book chips | neutral, small, `aria-pressed` (Q6; switched on = gold glow) | `adc-chip` |
| Show N more | neutral, full row width (`m-2.5 w-[calc(100%-20px)]`) | `adc-more` |

Left alone: the tier headings (`adc-tierhead`, fold toggles of the list), the list rows (`adc-item`), the linked
adversary names in an environment (`env-advlink`, inline text links), the type legend (`<details>`).

### `src/components/adversaries/custom/index.tsx`

| Button | Role | Was |
|---|---|---|
| New adversary | confirm | `adx-primary` |
| Duplicate & edit (SRD and custom stat block) | neutral, small | `adx-btn` |
| Edit | neutral, small | `adx-btn` |
| Delete / Confirm delete | danger, small | `adx-btn adx-danger` |

### `src/components/adversaries/custom/add-to-encounter.tsx`

| Button | Role | Was |
|---|---|---|
| + Add to encounter (custom stat block head) | confirm, small | `adx-btn` |
| Cancel | cancel | `adx-btn` |
| Add to encounter | confirm | `adx-primary` |

### `src/components/adversaries/custom/editor.tsx` (parchment editor dialog)

| Button | Role | Was |
|---|---|---|
| Use Tier N improvised statistics | neutral, small | `adx-btn` |
| Remove (Experience) | danger, small | `adx-btn adx-danger` |
| + Add Experience, + Add feature | neutral, small | `adx-btn` |
| ↑ / ↓ Move feature | neutral, small, icon | `adx-btn` |
| Remove feature | danger, small | `adx-btn adx-danger` |
| Cancel | cancel | `adx-btn` |
| Save adversary | confirm | `adx-primary` |

### `src/components/adversaries/environments/feature-actions.tsx`

| Button | Role | Was |
|---|---|---|
| + Fear (Gain 1 Fear) | neutral | `env-act env-act-fear` |
| Spend N Fear | confirm (briefs: spending Fear = confirm; Fear purple for the GM) | `env-act env-act-fear` |
| Start countdown / Start <label> | neutral | `env-act` |
| Undo (after a Fear spend) | cancel | `env-act` |

These stay medium (44 px): `environments.spec` asserts 44 px for + Fear and Spend at desktop width.

### `src/components/adversaries/environments/opened-adversary.tsx`

| Button | Role | Was |
|---|---|---|
| Back to <environment> | cancel, small | `.env-opened-bar button` |
| Close | cancel, small (labelled, so the accessible name stays "Close") | `.env-opened-bar button` |

## Paper (Q5)

The stat blocks and the custom editor's form are parchment. Q5 (a) keeps ink-on-paper for the Notes page, the recap and
the Tome, but this tracer's acceptance names `adx-btn` / `env-act` / `enc-on-paper`, which only exist on that
parchment, and its goal makes Add / Save confirm; the wizard (G5) set the precedent of glass on parchment. So they are
glass here too, with two paper-only rules in `custom.css` (scoped to `.adv-root`, so the HUD is untouched):

- focus ring in the parchment's wine (`--adv-parch-rule`) instead of the pale gold, which disappears on the paper;
- disabled glass opaque (`--adv-page`), as G5 did for the wizard, instead of the translucent grey.

The stat block itself, its art, pips, badges and feature text keep their look.

## CSS deleted

- `adversaries.css`: `.adv-alert button`.
- `builder.css`: `.enc-ghost` (+ hover, `.enc-on-paper` variants, disabled), `.enc-danger`, `.enc-pill` (+ `-start`,
  `-end`, `-primary`, disabled), `.enc-x`, `.enc-step` (+ states), `.enc-tier` (+ pressed, focus), their focus rules,
  the `--enc-danger-border` / `--enc-end` tokens. `.enc-tiers` stays (layout).
- `catalogue.css`: `.adc-chip` (+ hover, pressed, focus), `.adc-more` (+ hover, focus). `.adc-flab` line-height follows
  the small chip (34 px, 44 px on touch).
- `custom.css`: `.adx-btn` (+ hover, disabled, focus), `.adx-primary` (+ disabled), `.adx-danger`, their parchment
  overrides in `.adc-sb-actions` and `.adx-form`; `.adx-exp .adx-btn` became `.adx-exp .gb`.
- `environments.css`: `.env-act` (+ hover, focus, disabled, `-fear`), `.env-opened-bar button` (+ hover, focus);
  `.env-status-row > .env-act` became `> .gb`.

## Per role

confirm 9 (New encounter, Start encounter, Add to encounter ×4: SRD and custom stat blocks and both dialogs, New
adversary, Save adversary, Spend N Fear), cancel 6 (the two add dialogs' Cancel, editor Cancel, Undo, Back, Close),
danger 6 (encounter Delete, End encounter, instance Remove, custom Delete, Remove Experience, Remove
feature), neutral the rest (chips, Show more, steppers, moves, Open in tracker, Add adversary, Duplicate & edit, Edit,
improvised statistics, Add Experience / feature, + Fear, Start countdown, Try again, Reload page).

## Checks and shots

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G8`: every change owned.
- vitest, touched areas (`--maxWorkers=1 --testTimeout=120000`): tracker-actions, adversary-catalogue, budget-panel,
  encounter-budget, custom-adversaries, environment-catalogue, journal/plan-encounter, `tests/unit/brand`: 8 files,
  138 passed. Full suite: 519 files, 11051 passed, 1 expected fail.
- e2e (servers started by hand on 3881 / 3981, `E2E_REUSE_SERVERS=1`, `--workers=1`, `E2E_VISUAL=1`): adversaries,
  adversary-catalogue, encounter-builder, custom-adversaries, environments, journal-encounter, session-encounter and
  the A0, A2, A3, A5, AA1, EA1, EV1 visual specs: 31 passed; a11y-party (Adversaries included): 8 passed;
  visual/GLASS-G8: passed.
- The filter chips got `min-w-11` (44 px wide, as `.adc-chip` was): a one-character chip ("1") was 34 px wide on touch.

Shots in `test-results/visual/GLASS-G8/`, copied to `/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g8/`:

- `catalogue-gm-{1440,1024,390}`, `encounters-gm-{…}`, `add-dialog-gm-{…}`, `environment-gm-{…}`: the GM's tabs.
- `catalogue-gm-hover-add`, `catalogue-gm-focus-chip`, `catalogue-gm-focus-add` (the wine ring on parchment).
- `editor-gm-1440`, `editor-gm-hover-save`: the custom editor.
- `encounters-gm-hover-start`, `encounters-gm-focus-stepper`, `encounters-gm-running-hover-end`.
- `environment-gm-hover-spend`, `environment-gm-undo`.
- `player-{1440,1024,390}`: the player's GM-only panel (no buttons).
- axe is clean with a confirm / danger hovered and a button keyboard-focused; at 1024 and 390 every visible glass
  button on the page is at least 44 × 44 px (asserted).
