# TASK-PH-B0: screen dependencies

Tracer B0-deps. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

The phone package now has the native and JavaScript dependencies later screens
use. No screen was added.

These were already direct dependencies, at the versions Expo SDK 58.0.20 pins
in `bundledNativeModules.json`, so they were left in place:

- `react-native-reanimated@4.7.1`
- `react-native-gesture-handler@3.3.0`
- `react-native-safe-area-context@5.10.1`
- `react-native-screens@4.30.0`
- `jest-expo@58.0.12` and `@testing-library/react-native@14.1.0` (dev)

New direct dependencies, pinned to an exact version inside the SDK 58.0.20
range (or the SDK's exact pin) that was at least one day old. `convex` stays
`1.46.0` and `@convex-dev/auth` stays `0.0.96`. Local pnpm is 10.8.0, which
does not implement `minimumReleaseAge`. CI's pnpm 11 defaults that setting to
1440 minutes. No exclusion was added. `lucide-react-native@1.64.0` (published
2026-10-29) was under one day old, so `1.63.0` is pinned instead.

| Package | Version | Published |
| --- | --- | --- |
| `expo-dev-client` | 58.0.17 | 2026-10-28 |
| `expo-font` | 58.0.11 | 2026-10-28 |
| `expo-image` | 58.0.18 | 2026-10-28 |
| `expo-image-picker` | 58.0.10 | 2026-10-01 |
| `react-native-svg` | 15.16.0 | 2026-10-15 |
| `@shopify/react-native-skia` | 2.14.0 | 2026-10-01 |
| `lucide-react-native` | 1.63.0 | 2026-10-28 |
| `@expo-google-fonts/cinzel` | 0.4.2 | 2025-09-11 |
| `@expo-google-fonts/eb-garamond` | 0.4.3 | 2026-07-16 |
| `@expo-google-fonts/ibm-plex-sans` | 0.4.1 | 2025-09-09 |

`expo-font@58.0.11` was already installed transitively through `expo-symbols`.
It is now a direct dependency. The youngest package this install added is
`expo-image@58.0.18`, published 2026-10-28T15:35:50Z, about 25 hours old at
install time. Every other new lockfile entry was older.

`pnpm install` did not report an ignored build script. `pnpm-workspace.yaml`
was not changed: no package was added to `allowBuilds`, and `nodeLinker` stays
unset. `react-native-svg` ships a `prepare` script (`bob` and `husky`) and a
prebuilt `lib/`. pnpm did not run that script. The published package does not
need it.

`app.config.ts` was not changed. `@expo/prebuild-config` applies the
`expo-dev-client` and `expo-image-picker` config plugins on prebuild when those
packages are installed (`legacyExpoPlugins`). The image picker README says the
same: add the plugin yourself only to pass extra properties. `expo-font`'s
plugin embeds font files and does nothing without a font list; the Google font
packages load through `expo-font` at runtime. `expo-image`'s plugin only writes
a Podfile flag. Skia and `react-native-svg` do not ship a config plugin.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory. Exit code 0 for each.

| Command | Result |
| --- | --- |
| `pnpm install` | Lockfile already up to date. Already up to date. Done in 759ms. The ten packages were added by an earlier install in this session (35 packages added). |
| `pnpm --filter @dualityheart/mobile run check` | ESLint, `tsc --noEmit`, and Jest passed. 9 suites, 23 tests. Watchman printed a recrawl warning. |
| `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud pnpm --filter @dualityheart/mobile run export:check` | Android bundle 1275 modules, iOS bundle 1260 modules. `check-bundle`: 2 source maps, 2495 sources, at most one `convex` and one `react`, no `src/lib/srd/index`. |
| `pnpm why --depth=10 react-native` | No tree. The root package does not depend on `react-native`. |
| `pnpm why -r --depth=10 react-native` | Every listed `react-native` is 0.88.0. The lockfile has one `react-native@0.88.0` entry. |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | Vitest 4.1.10: 325 files passed, 8389 tests passed, 1 expected fail (8390). Exit 0. Duration 36.72s. |

## Peer warnings left in place

The install that added the packages printed the same two warnings as A1:
`@expo/router-server` wants `expo-constants@^58.0.14` and the app has `58.0.13`,
and `update-browserslist-db` wants `browserslist@4.28.7` and found `4.29.5`.
`58.0.14` was published 2026-10-28 and was still under one day old when A1
pinned `58.0.13`. The later `pnpm install` did not reprint the warnings.

## Not done

No screen, no commit, no push, no merge. No `eas build` and no `eas submit`.
