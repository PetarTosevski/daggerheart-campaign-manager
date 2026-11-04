# TASK-CONFIG-U6a: Preferences rows and dice settings from the account

Plan `.omc/plans/config.yaml`, wave 3, tracer U6a; briefs `.omc/plans/config-briefs.md` (U6a block, "User answers
2026-11-04": Q12 a, Q13 a, Q14 a, Q15 b; "Questions 2026-11-05": defaults taken, N3 / IMP not built here); bead
dcm-jh6d.20. Design `reference/designs/config/Settings.dc.html` (`.pm-pop`). Mode: add. UI only: no server change, no
codegen.

## What landed

`src/components/config/prefs/index.tsx` fills S1's `PreferenceRows` slot for everyone (GM and player) with the board's
rows. It uses the shared `cfg-row` / `cfg-sw` / `cfg-seg` classes, plus `prefs.css` for the slider and the error line:

| Row (board text) | Hint | Control | Field |
|---|---|---|---|
| 3D dice | Rolls tumble across the screen. | switch | `dice3d` |
| Dice sound | - | switch | `diceSound` |
| Volume | - | `<input type="range">` 0-100, `aria-label="Dice volume"` | `diceVolume` |
| Reduce motion | Calmer sheet and card animations. | switch | `reduceMotion` |
| Text size | - | segmented Small / Medium / Large (glass neutral, `aria-pressed`) | `textSize` |
| Ping me when I get the spotlight | - | switch | `spotlightPing` |

- Every control reads `preferences.get` and writes `preferences.set({ change: { key, value } })`, one field per call
  (rule 12). `src/components/config/prefs/use-preferences.ts` (`usePreferences`, `useSetPreference`) holds the
  optimistic update on `preferences.get`. The rows and the dice share it, so a flip in one place shows in the other at
  once.
- The volume keeps a local value only while you drag. It saves on release: pointer up, key up or blur, and only when
  the value changed. It never saves on every move. Moving the slider does not copy props into state through an effect
  (rule 13).
- A refused save rolls back and shows its message in a polite live line. Clicking the current text size writes
  nothing. While the query loads, the slot shows 'Loading …' (`role="status"`).
- These rows only save Reduce motion, Text size and the ping. U6b applies reduce motion and text size (Q12 a zoom,
  Q13 a), and U6d applies the ping (Q14 a).

## Dice read the account

- `src/components/party/dice/settings.ts`: `useDiceSettings()` keeps its signature `[settings, update]`, so callers
  are unchanged. `settings` is now `{ threeD, sound, volume }` from `preferences.get`. While the account loads, and on
  the server render, today's defaults apply: 3D on unless the device asks for reduced motion
  (`useSyncExternalStore` on the media query, server snapshot false), sound off, volume 60. `update` sends one
  `preferences.set` per changed field, with the volume clamped. No localStorage read or write remains. The old
  `dcm.dice.settings` key is read only by `src/lib/config/legacy-prefs.ts`, for IMP. `canAnimate3d` still turns the
  animation off when the device asks for reduced motion.
- Signed out: `preferences.get` is a `userQuery`. Signed-out visitors never mount a dice box, because the proxy sends
  them to /signin. No `useConvexAuth` gate was added: that would break every unit test whose `convex/react` mock lacks
  it.
- `src/components/party/dice/sound.ts`: `playRollSound(volume = rollVolume())` sets `audio.volume` to volume / 100
  and stays silent at 0. `rollVolume()` is the volume the mounted dice settings last read. An effect writes this
  module value, because the 3D scene (`dice3d/scene.ts`, not owned) calls `playRollSound()` without arguments.

## Behaviour change to note

The account's unset `dice3d` resolves to `true` on the server (S0 / P1 defaults). So with the device's reduced motion
on, the 3D toggle now shows the account's value (on by default). No canvas plays, because `canAnimate3d` blocks it.
Before, the toggle showed off by default. `tests/e2e/dice-3d.spec.ts`'s first test now asserts only that no canvas
appears with reduced motion, even with 3D on. The orchestrator approved this edit outside U6a's owns.

The e2e specs share the `e2e-gm` and `e2e-player` accounts. To keep one spec's choices out of the next,
`tests/e2e/fixtures.ts` `signInAsTestGm` now sets every preference back to its default after sign-in, the same way it
resets `defaultMapStyle` (also approved outside owns). `config-prefs.spec.ts` uses a fresh random email as well.

## Tests

- `tests/unit/config/prefs.test.tsx`: the rows and hints, defaults, one-field optimistic saves, volume saved on
  release only, a refused save rolling back inline, the loading line, and the dice box's toggles staying in step with
  the rows.
- `tests/unit/dice-settings.test.ts`: loading defaults (with and without reduced motion), account values, per-field
  writes, the volume clamp, no localStorage access, and `playRollSound` volume (explicit, silent at 0, defaulting to
  the account's).
- `tests/e2e/config-prefs.spec.ts`: a fresh account in two browsers. A sets Dice sound (keyboard), 3D off and volume
  30 (keyboard, saved on release). B's popover shows them, and B's dice box reads them. Flipping 3D in B's dice box
  reaches A's open popover live. The spec also runs axe on the rows and checks touch targets. Shots go to
  `test-results/config-u6a/`.

## Follow-ups

- IMP: the one-time import of `dcm.dice.settings` and the removal of `dcm:combat-hud` (`DEAD_KEYS`).
