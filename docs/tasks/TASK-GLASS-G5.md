# TASK-GLASS-G5: the Party page, the wizard and the shared rest / level-up / import launchers use glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G5; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.6.
Design `reference/designs/buttons/arcane-glass.html`. Built on the default answers (Q1-Q9 = a; Q3 a: the character
sheet's own buttons stay as they are). Follows the "Notes for the area tracers" in `docs/tasks/TASK-GLASS-G0.md`.

Behaviour is unchanged: same labels, accessible names, `aria-*`, `data-testid`s, disabled logic and handlers. The
roster's Delete is still a two-tap confirm.

## Buttons per file

### `src/app/(gm)/campaigns/[campaignId]/party/page.tsx`

| Button | Role | Was |
|---|---|---|
| + Create character (link) | confirm, large | `primary` xl (already confirm large; now named) |

### `src/app/(gm)/campaigns/[campaignId]/party/roster.tsx` (roster card)

| Button | Role | Was |
|---|---|---|
| Kill (hover reveal, top-right corner) | danger, small | hand-styled red pill |
| Open character sheet (link) | confirm, full width | hand-styled green block |
| Delete | danger, small | `SMALL_BTN` + red text |
| Keep (in the delete alertdialog) | cancel, small | `SMALL_BTN` |
| Delete character (in the alertdialog) | danger, small | hand-styled solid red |

- The Kill button's corner position and hover reveal moved onto a wrapper `<span>`: `.gb` sets `position: relative`,
  so an `absolute` utility on the button itself has no effect (G0 cascade note). `focus-visible:opacity-100` became
  `focus-within:opacity-100` on the wrapper, so a keyboard user still sees it.
- `SMALL_BTN` deleted.
- Left alone: the dashed "Create Character" tile (`CreateCard`, a tile that opens a page), the owner / Hope & Fear
  badges, the Player `<select>`.

### `src/components/party/party-card.tsx` (shared by the dashboard card and the roster)

| Button | Role | Was |
|---|---|---|
| Revive (`FallenOverlay`, GM) | confirm, small | hand-styled gold pill |
| Send away / Bring back (`BenchButton`) | neutral, small | hand-styled outline |
| Kill (HP tile corner, hover reveal) | danger, small | `PILL` + red |
| Scars · N (Hope tile corner, `aria-expanded`) | neutral, small | `PILL` + red outline |
| − / + heal / mark a scar (scar popover) | neutral, small, icon | hand-styled 28 px squares |
| − / + on each resource tile | neutral, small, icon | `STEP_BTN` |

- `STEP_BTN` deleted; `PILL` now only holds the wrapper's placement and hover reveal (same reason as the roster's Kill).
  The Scars wrapper stays visible while the popover is open (was `aria-expanded:opacity-100` on the button).
- `BenchButton` has **no `aria-pressed`**, although the briefs suggest "neutral with `aria-pressed`". It is one
  button whose label flips between "Send away" and "Bring back" (an action, not a switch); adding `aria-pressed`
  would turn it into a toggle button whose name changes with its state, which ARIA advises against, and would change
  its semantics for the specs. It is a plain neutral button.
- Left alone: the card's portrait / name link (a row that opens the sheet), the HP / Stress / Hope tiles and their
  segments (pips), the badges.

### `src/components/party/portrait.tsx`

| Button | Role | Was |
|---|---|---|
| Add portrait / Change portrait / Uploading… | neutral, small (camera icon) | hand-styled outline |

Shared by the roster card and the sheet's identity box (`sections/identity.tsx`), so the sheet shows it too (shot
`sheet-player-*`). The portrait image itself is untouched.

### `src/app/(gm)/campaigns/[campaignId]/party/new/wizard.tsx`

| Button | Role | Was |
|---|---|---|
| Start over (header, clears the whole draft) | danger, small | `wz-ghost` |
| ✕ Cancel character creation (link) | cancel, icon, round | `wz-close` |
| ‹ Back | cancel, large | `wz-outline` |
| Cancel (link, step 1) | cancel, large | `wz-outline` |
| Next: … › (`aria-disabled` until the step is complete) | confirm, large | `wz-primary` |
| Create character (`aria-disabled` until ready) | confirm, large | `wz-primary` |

- `aria-disabled="true"` draws the glass disabled look (grey, no fill) while the button stays focusable, as before;
  the reason (`wz-req`) still sits beside it.
- Left alone: the step dots (`wz-dot`, the wizard's step navigation, like page tabs).

### `src/app/(gm)/campaigns/[campaignId]/party/new/steps-1-4.tsx`

| Button | Role | Was |
|---|---|---|
| Use suggested (traits) | neutral, small | `wz-ghost` |
| Clear (traits) | neutral, small | `wz-ghost` |

Left alone: every picker on the paper (class / subclass / portrait tiles, ancestry / community chips, trait modifiers:
radio labels styled as cards and chips), the Mixed ancestry tile (`wz-mxbtn`, a mode tile in the row of ancestry
chips with its own Hope / Fear gradient), the Pronouns label switch (an inline text switch inside a form label).

### `src/app/(gm)/campaigns/[campaignId]/party/new/steps-5-9.tsx`

| Button | Role | Was |
|---|---|---|
| Use suggested loadout / armor | neutral, small | `wz-ghost` |

Left alone: equipment / potion pickers (radio cards), the Experience example chips (`wz-ex`, suggestion chips on the
paper form), the domain cards' Choose (`wz-dk-btn`, part of the card face).

### `src/app/(gm)/campaigns/[campaignId]/party/new/wizard.css`

Deleted: `.wz-ghost`, `.wz-ghost:hover`, `.wz-outline`, `.wz-primary`, `.wz-primary[aria-disabled]`, `.wz-close`.

Added: `.wz-paper .gb:disabled, .wz-paper .gb[aria-disabled="true"] { background: #0d1417 }`. The disabled glass is
translucent (`rgba(13, 20, 23, 0.6)`), which turns a muddy grey on the parchment and made "Next: …" hard to read; on
the paper it is the opaque dark glass it looks like on the app's dark pages (shot `wizard-*-next-disabled`).

### `src/components/party/rest/launcher.tsx` (the dashboard's rest panel)

| Button | Role | Was |
|---|---|---|
| Start short rest | confirm, small (neutral while blocked by the three-short-rests limit) | outline |
| Start long rest | neutral, small (confirm while the short rest is blocked) | outline |
| Undo rest | danger, small | danger |
| Finish rest | confirm, small | solid |
| Interrupt | danger, small | danger |

Two starts side by side: only the main one is confirm (briefs). The short rest is the usual one; once three short
rests are taken it is disabled and the long rest becomes the main action.

### `src/components/party/rest/long-term.tsx`

| Button | Role | Was |
|---|---|---|
| Tick −1 (per long-term countdown reminder) | neutral, small | outline + `min-h-11` |

`min-h-11` dropped (it had no effect on a glass button; small is 44 px on touch by itself).

### `src/components/party/level-up/index.tsx`

| Button | Role | Was |
|---|---|---|
| Party levels up (GM, Party page) | neutral, large | outline xl |

Left alone (Q3 a / Q5 a): the sheet header's ▲ level-up badge and − undo (`lv-up`, `lvl-down`), small badges on the
paper level circle that belong to the sheet. `history.tsx` and `tier-pickers.tsx` (the sheet's tier boxes, GM
correction and the level-up choosers, `lu-opt`) are sheet paper too and unchanged.

### `src/components/party/import/index.tsx`, `flow.tsx`, `review.tsx` (photo import, GM)

| Button | Role | Was |
|---|---|---|
| Import from photo (Party page) | neutral, large | pill xl |
| Read photos | confirm, large | primary lg |
| Cancel | cancel, large | outline lg |
| Close (after saving) | cancel | outline |
| Remove (an Experience row of the draft) | danger, small | outline sm |
| Add Experience | neutral, small | outline sm |
| Save character | confirm, large | primary lg |

Left alone: "Open …'s sheet" (a plain text link). The modal's ✕ is G0's.

### Not changed: `rest/picker.tsx`, `rest/rest.css`, `level-up/history.*`, `level-up/tier-pickers.tsx`, `badge.tsx`

The rest picker (downtime-move chips, Save moves, Oasis rerolls) and the level-up history / choosers render only on
the character sheet's paper; Q3 (a) keeps the sheet's buttons. `party/error.tsx` has no button of its own.

## Shots

`tests/e2e/visual/GLASS-G5.spec.ts` (`E2E_VISUAL=1`), in `/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g5/` and
`test-results/visual/GLASS-G5/`:

- `party-{gm,player}-{1440,1024,390}`: the Party page (full page).
- `party-{gm,player}-hover-create`: a hovered "+ Create character" (confirm; Fear for the GM, Hope for the player).
- `party-{gm,player}-focus-open-sheet`: "Open character sheet" focused from the keyboard.
- `roster-delete-gm-{1440,1024,390}`, `roster-delete-gm-hover-danger`: a roster card's delete confirm.
- `wizard-{gm,player}-{1440,1024,390}`, `wizard-{who}-next-disabled`, `wizard-{who}-hover-next`,
  `wizard-{who}-focus-start-over`: the wizard.
- `dashboard-gm-*`, `rest-idle-gm-*`, `rest-idle-gm-hover-start`: the dashboard and its rest launcher.
- `party-card-gm-hover-tile`: the dashboard party card with the HP tile hovered (Kill pill, steppers).
- `rest-open-gm-*`, `rest-open-gm-hover-interrupt`, `rest-open-gm-focus-finish`, `rest-after-gm-1440`: a rest under
  way (Finish / Interrupt) and after it (Undo rest).
- `dashboard-player-*`: the player's dashboard during the rest.
- `sheet-player-*`: the sheet (portrait button glass; the ▲ level-up badge unchanged).

Photo import has no shots: the e2e backend has no `ANTHROPIC_API_KEY`, so its button stays hidden
(`photo-import.spec.ts`). Its buttons are covered by the `photo-import-flow` / `photo-import-review` unit tests.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G5`: every change owned.
- vitest, touched areas (`--maxWorkers=1 --testTimeout=120000`): party-card, wizard-steps, wizard-logic,
  photo-import-flow, photo-import-review, sheet-render, identity-label, tier-boxes, rest-feature-moves,
  lazy-boundaries(-2), motherboard, `tests/unit/brand`: 13 files, 148 passed. Full suite: 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3853 / 3953 with `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - party-roster, character-wizard, photo-import, rest, rest-frame-hooks, live-party, a11y-party, level-up,
    lane4-vitality-level-up: 29 passed (one rest test timed out at sign-in under load and passed on its own rerun).
  - glass-foundation: 4 passed. visual/GLASS-G5: 1 passed (axe clean with a confirm / danger hovered and a button
    keyboard-focused; small buttons 44 px at 1024).
