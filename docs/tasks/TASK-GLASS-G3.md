# TASK-GLASS-G3: every countdown button is a glass button

Plan `.omc/plans/glass-buttons.yaml`, tracer G3; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.4.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). The Countdowns section
renders on the campaign dashboard (`page.tsx`); a player gets it read-only, with no buttons except the disabled grains.

## Buttons per file

| File | Button | Role | Notes |
|---|---|---|---|
| `index.tsx` | "+ New countdown" | confirm | the section's main action |
| `index.tsx` | "+ New chase" | neutral | two confirms side by side: only the main one is confirm (see Questions) |
| `new-dialog.tsx` | "Cancel" | cancel | |
| `new-dialog.tsx` | "Start at N" / "Roll …" (submit) | confirm | was `solid` |
| `visibility.tsx` | "Cancel" | cancel | Who can see this dialog |
| `visibility.tsx` | "Save" (submit) | confirm | was `solid` |
| `card.tsx` | Who-can-see badge (`data-preset` kept) | neutral, sm | opens the dialog; the gold tint for hidden presets is gone, the label says it |
| `card.tsx` | "Armed" | neutral + `aria-pressed` | a switch (Q6); its inner track drawing stays inside the glass; medium, because `countdowns-modes` / `-chase` assert 44 px |
| `card.tsx` | "Tick −1" | confirm | the inline dark-red background at 0 is gone (the button is disabled there) |
| `card.tsx` | "Borrowed Time", "Pause" / "Resume" | neutral | |
| `card.tsx` | "Cancel countdown…" (opens the confirm) | danger, sm | was a text link; Q9 (a): the opener is red too |
| `card.tsx` | "Keep it" / "Cancel countdown" | cancel, sm / danger, sm | the two-tap stays a two-tap |
| `chase.tsx` | per side: "Tick −1" / "Borrowed Time" | confirm / neutral | |
| `chase.tsx` | Who-can-see badge | neutral, sm | as on the card |
| `chase.tsx` | "Caught!" / "Got away!" | neutral | the GM's call on a double zero; neither has a side |
| `chase.tsx` | "Pause chase" / "Resume chase" | neutral | |
| `chase.tsx` | "Armed" | neutral + `aria-pressed` | medium (44 px), as on the card |
| `chase.tsx` | "Cancel chase…" / "Keep it" / "Cancel chase" | danger / cancel, sm / danger, sm | the opener was 44 px (`min-h-11`), so it stays medium |
| `chase.tsx` | New chase dialog "Cancel" / "Start chase" | cancel / confirm | |
| `track.tsx` | "Automatic" / "Reminder" (On long rest) | neutral + `aria-pressed` | the pill wrapper (rounded border, overflow hidden) became a plain gap row; 44 px as before |
| `track.tsx` | "Edit steps" / "Done editing" | neutral | `aria-expanded` kept; was a 44 px text link |

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `card.tsx` | sand grains (`aria-pressed`, click to correct) | progress pips, like HP / Stress pips |
| `new-dialog.tsx` | Starting value 1-12 grid (`role="radio"`) | a radio group: glass has no `aria-checked` state, and `aria-pressed` is invalid on a radio |
| `chase.tsx` | Die d4-d20 grid (`role="radio"`) | same |
| `index.tsx` | Empty-state tile "No countdowns running. Start one…" | a dashed empty-state tile, not an action button |
| all dialogs | radio / checkbox cards (`<label>`) | form controls, not buttons |

## Classes and constants deleted

- `shared.ts` `BTN` (the hand-styled outline button), with every use.
- The inline danger button classes (`bg-danger-solid …`) on Cancel countdown / Cancel chase.
- The text-link classes on "Cancel countdown…", "Cancel chase…" and "Edit steps".
- The hand-styled pill on the badge and Armed buttons; the Rest-mode segment's colour classes.
- No CSS file in the folder; `dashboard.css` (`cd-hidden-strip`) is not a button.

## Shots

`tests/e2e/visual/GLASS-G3.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G3/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g3/`:

- `countdowns-{gm,player}-{1440,1024,390}`: the section with a standard countdown, a long-term track and a chase
  (private, so the player does not see it).
- `card-gm-hover-tick`, `card-gm-focus-borrowed`: a hovered confirm and a keyboard-focused button (axe clean).
- `card-gm-cancel-confirm-hover-danger`: the cancel confirm with the danger hovered (axe clean).
- `track-gm-editing`, `chase-gm`.
- `new-countdown-gm-hover-start` (axe clean), `new-chase-gm-focus-cancel` (axe clean), `visibility-gm`.

The spec also asserts the roles, the GM's Fear confirm, 44 px for every glass button at 1024 and 390, and that a
player has no glass button in the section. Axe runs on the section with the grain row excluded (with a reason): the
grains are pips, left alone, and axe's target-size flags their spacing.

## Checks

- `pnpm lint` (eslint on the folder and the spec), `pnpm typecheck`: clean.
  `pnpm tracer:guard .omc/plans/glass-buttons.yaml G3`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/countdown-advanced.test.ts`, `tests/unit/brand`,
  `tests/convex/countdowns.test.ts`: 3 files, 85 passed; the full suite: 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3865 / 3965, `E2E_REUSE_SERVERS=1`, `E2E_VISUAL=1`, `--workers=1`:
  countdowns-flow, countdowns-chase, countdowns-long-term, countdowns-modes, countdown-rolls, dashboard, visual CD-K2,
  CD-K3, CD-K4, CV1 and GLASS-G3: 19 tests, 18 passed; the one failure (dashboard "Witherwild campaign time") was a
  sign-in that never left /signin under load (load average ~13) and passed on rerun. The first run caught the Armed
  switch at 34 px (two specs assert 44 px); it is medium now.

## Questions (defaults taken)

- The goal lists "New chase" as confirm, but it sits next to "+ New countdown" and the briefs say only the main one of
  two side-by-side confirms is confirm. Default: New countdown = confirm (the empty tile also opens it), New chase =
  neutral.
