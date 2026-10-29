# TASK-PH-A1: workspace and signed-out Expo app

Tracer A1-workspace. Branch `phone/A1-workspace` in worktree
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`, created from local
`rebuild` (`origin/rebuild` at `f34b1e4`). Not committed.

## What changed

`apps/mobile` (`@dualityheart/mobile`) is the first pnpm workspace package. The Next.js
app and `convex/` stay at the repository root. `pnpm-workspace.yaml` gained
`packages: ['apps/*']` and kept the existing `allowBuilds` and `overrides`. `nodeLinker`
is unset.

The phone app is Expo SDK 58, package `expo@58.0.20` (published 2026-10-27). `58.0.21`
(published 2026-10-28) is the newest SDK release and is younger than one day. pnpm 11,
which CI installs, defaults `minimumReleaseAge` to 1440 minutes. No exclusion was added.
Local pnpm is 10.8.0, which does not implement that setting. Direct Expo packages are
pinned to the newest release inside SDK 58.0.20's bundled ranges that is at least one
day old, so a later pnpm 11 resolve does not float onto a same-day patch. `convex` is
`1.46.0` and `@convex-dev/auth` is `0.0.96`, matching the root app.

`apps/mobile/src/convex.ts` is the only file that imports `convex/_generated`. It
re-exports `api`, `Id`, and `Doc`. `metro.config.js` starts from `expo/metro-config`'s
`getDefaultConfig` and resolves `convex`, `convex/*`, `react`, and `react-native` to the
copies in `apps/mobile/node_modules`. The Android and iOS export source maps contain one
`react@19.3.0` and no `src/lib/srd/index`. Nothing imports Convex yet, so the maps
contain no `convex` copy.

`app/_layout.tsx` renders an Expo Router `Slot`. `app/index.tsx` renders the text
"Signed out". There is no auth provider, tab bar, or campaign route.

Root `tsconfig.json` excludes `apps`. Root `eslint.config.mjs` ignores `apps/**`. The
mobile package has its own `tsconfig.json` (extends `expo/tsconfig.base`) and
`eslint.config.js` (`eslint-config-expo/flat`). CI's checks job runs
`pnpm --filter @dualityheart/mobile run check` after `pnpm test`. That script is
`eslint .`, then `tsc --noEmit`, then `jest --ci`. `export:check` bundles Android and
iOS with Metro (`--source-maps`) and runs `scripts/check-bundle.mjs`. It is not in CI.

`.env.example` lists `EXPO_PUBLIC_CONVEX_URL` with an empty value. The placeholder URL
was only in the `export:check` command environment.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the worktree, in order. Exit code 0 for each.

| Command | Result |
| --- | --- |
| `pnpm install` | Lockfile already up to date. Added the optional `@rolldown/binding-darwin-arm64` package that Node 20.16 had skipped. Peer warnings below. |
| `pnpm install --frozen-lockfile` | Lockfile up to date. |
| `pnpm build` | Next.js 16.4.1 compiled and generated the existing routes. |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | Vitest 4.1.10: 322 files passed, 8378 tests passed, 1 expected fail. Exit 0. Duration 39.93s. |
| `pnpm --filter @dualityheart/mobile run check` | ESLint, `tsc --noEmit`, and Jest passed. 2 tests, 2 suites. Watchman printed a recrawl warning. |
| `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud pnpm --filter @dualityheart/mobile run export:check` | Android bundle 1164 modules, iOS bundle 1149 modules. `check-bundle`: 2 source maps, 2273 sources, at most one `convex` and one `react`, no `src/lib/srd/index`. |
| `git diff --exit-code rebuild -- src convex vercel.json package.json` | No difference. |

An earlier run of the same sequence on Node v20.16.0 passed install, frozen install,
build, lint, and typecheck. `pnpm test` then failed at startup: Rolldown could not find
`@rolldown/binding-darwin-arm64`. That package's engines are `node: ^20.19.0 || >=22.12.0`,
so pnpm did not install it under Node 20.16. Expo, on that same Node, printed that it
wants Node `>=22.13.0`. The sequence above was re-run on Node 24.22.1, the CI Node 24
line, and those two messages were gone.

`node scripts/worktree-setup.mjs` ran before the edits. It skipped `.env.local` and
`.env.e2e.local` (the main checkout has neither) and completed `pnpm install --frozen-lockfile`.
It printed e2e ports `E2E_PORT=3113` and `E2E_CONVEX_PORT=3338`. This tracer did not run e2e.

## Peer warnings left in place

`pnpm install` warns that `@expo/router-server` wants `expo-constants@^58.0.14` and the
app has `58.0.13`. `58.0.14` was published 2026-10-28, under one day old, so it was not
pinned. Export and the mobile check still passed. It also warns that
`update-browserslist-db` wants `browserslist@4.28.7` and found `4.29.5`. The root
override only rewrites `browserslist` versions older than `4.28.7`.

## Not done

Sign-in, Google, Apple, navigation, and later tracers. No commit, no push, no
`eas integrations:convex:connect`, no `.omc/plans/phone-app.yaml`.
