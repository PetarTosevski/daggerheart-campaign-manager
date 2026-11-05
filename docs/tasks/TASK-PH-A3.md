# TASK-PH-A3: EAS production profile

Tracer A3-eas. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

`apps/mobile/eas.json` is the store configuration for an email-and-password build.

- `cli.appVersionSource` is `remote`, so the iOS build number and the Android version code come from EAS.
- `development`, `preview`, and `production` build profiles exist. `development` and `preview` use `distribution: "internal"`. `production` uses `distribution: "store"` and `autoIncrement: true`.
- The production Android build sets `buildType` to `app-bundle`, which produces an `.aab`.
- The production submit profile sends Android to the Play `internal` track with `releaseStatus: "draft"` and `changesNotSentForReview: true`. The iOS submit profile is `{}`, which uploads to TestFlight and leaves App Store review for a later explicit submit.
- `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_SOCIAL_SIGN_IN` are absent from `eas.json`. The Convex URL is set in the shell or in an EAS environment. The social flag stays off.

`app.config.ts` throws `EXPO_PUBLIC_CONVEX_URL is not set` when that variable is missing or blank. With `APP_VARIANT=development` the bundle id is `com.dualityheart.mobile.dev` and the scheme is `dualityheart-dev`. Preview and production use `com.dualityheart.mobile` and `dualityheart`. The icon and adaptive icon are 1024 px PNGs made from `public/brand/daggerheart-emblem.webp`, on `#1a1408`.

`test/eas-config.test.ts` reads `eas.json`. It fails when the version source is not `remote`, when any Android submit track is not `internal`, when a review field requests review (`changesNotSentForReview` must be `true`; any other review field must be `false`), or when the production Android artifact is not an app bundle.

No Google button and no Apple button were added. `ios.usesAppleSignIn` is unset.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory. The `check` script is ESLint, then `tsc --noEmit`, then `jest --ci`.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. 8 suites, 18 tests. Watchman printed a recrawl warning. |
| `pnpm --filter @dualityheart/mobile exec jest --ci --testPathPatterns eas-config` | Exit 0. 1 suite, 1 test. Watchman printed the same recrawl warning. |
| `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud pnpm --filter @dualityheart/mobile exec expo config --type public` | Exit 0. Public config name `Duality Heart`, scheme `dualityheart`, iOS bundle identifier and Android package `com.dualityheart.mobile`, icon `./assets/icon.png`. The public config does not contain the Convex URL or a social-sign-in flag. |
| `pnpm --filter @dualityheart/mobile exec expo config --type public` with `EXPO_PUBLIC_CONVEX_URL` unset | Exit 1. `EXPO_PUBLIC_CONVEX_URL is not set`. |

The same public config command with the placeholder URL and `APP_VARIANT=development` prints scheme `dualityheart-dev` and bundle id `com.dualityheart.mobile.dev`. With `APP_VARIANT=preview` it prints the production bundle id and scheme.

## Not done

No `eas build`, no `eas submit`, and no `eas integrations:convex:connect`. The signing check (production build, Play internal draft, TestFlight internal) waits until the Apple and Google credentials are in EAS. `extra.eas.projectId` is unset. The development profile sets `developmentClient: true`; `expo-dev-client` is not installed, and `package.json` is outside this tracer. No commit, no push, no merge.
