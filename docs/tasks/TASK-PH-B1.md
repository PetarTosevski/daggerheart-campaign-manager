# TASK-PH-B1: brand tokens and shared controls

Tracer B1-design. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

The phone package now has the dark palette, type, spacing, motion, and the
shared controls. No screen was added. `app/_layout.tsx` was not edited: it is
outside this tracer's files, so nothing mounts `useBrandFonts` yet.

Colors are the hex custom properties on `:root` in `src/app/globals.css`.
The phone palette is dark only. `apps/mobile/test/theme/colors.test.ts` parses
that `:root` block and checks each phone value against it, including brand
`#e3b45a`, brand ink `#1a1408`, parchment `#ece6d6`, and the ink, panel, line,
text, Hope, Fear, danger, and ok colors.

Fonts are the faces `src/app/layout.tsx` loads: Cinzel 500/700/900, IBM Plex
Sans 400/500/600, and EB Garamond 400/500 upright and italic. They are loaded
with `useFonts` from `expo-font` and the `@expo-google-fonts` packages already
installed. Every face of a family is in one call. `expo-font` loads a family
once and ignores faces a later call tries to add.

Spacing is a 4-point scale (`0` through `64`). Button heights are 44 and 52.

Motion durations live in `apps/mobile/src/theme/motion.ts`. `useDuration`
calls Reanimated's `useReducedMotion`. That hook, in the installed package,
reports the system setting from app start and does not rerender when the
setting changes. While it is true, every duration is `0`. Button press, the
sheet, and a roll result animate with `withTiming` on transform and opacity.
`apps/mobile/test/theme/animated-style.test.ts` fails if a `useAnimatedStyle`
in `apps/mobile/src` sets width, height, top, left, margin, or padding.

Shared controls, under `apps/mobile/src/ui/`:

- `Button` — primary, solid, outline, pill, danger, and danger solid. At least 44 points tall.
- `Sheet` — closes on the backdrop, the close control, and Android back (`Modal` `onRequestClose`). The panel sets `accessibilityViewIsModal`.
- `Loading`, `Empty`, `ErrorState`, `StaleBanner`.
- `RollResult` — renders only the dice it is given. Nothing under `apps/mobile/src` calls `Math.random`.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 19 suites, 47 tests. Watchman printed a recrawl warning. |
| `pnpm lint` | Exit 0. |
| `pnpm typecheck` | Exit 0. |
| `pnpm test` | Exit 1. Vitest 4.1.10: 1 file failed, 324 passed (325). 1 test failed, 8388 passed, 1 expected fail (8390). Duration 37.43s. |

The failing test is `tests/convex/codex.test.ts`, "map pins also come from a map not split into rows yet": `view.entries[0]` had `tokenId: null` where the test expects `4`. This tracer did not edit that file. Root Vitest only includes `tests/unit` and `tests/convex`. The new phone modules are not in that run. `TASK-PH-B0.md` recorded the same suite green (8389 passed, 1 expected fail). Fixing the codex test would mean editing a file outside this tracer, so it was left as it failed.

## Not done

No screen, no commit, no push, no merge. `useBrandFonts` is not called from the root layout.
