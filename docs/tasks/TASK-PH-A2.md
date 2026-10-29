# TASK-PH-A2: email and password sign-in

Tracer A2-auth-email. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

Email and password sign-in on the phone uses the same Convex Auth `password` flows as
the website: `signIn`, `signUp` plus `email-verification`, and `reset` plus
`reset-verification`. Every call is `signIn("password", ...)` from `useAuthActions`.
There is no Google button and no Apple button.

`ConvexAuthProvider` stores tokens with `expo-secure-store`'s async
`getItemAsync`, `setItemAsync`, and `deleteItemAsync`. Keys stay within the
characters SecureStore allows (alphanumeric, `.`, `-`, `_`); Convex Auth strips
the rest from the namespace before it writes. Accessibility is the documented
default, `WHEN_UNLOCKED`. `requireAuthentication` is left off, so the Face ID
config plugin is not required. Nothing logs the token. AsyncStorage is not used.

`expo-crypto` 58.0.7 exports `getRandomValues` and `randomUUID`. It does not
install them on `globalThis`. `installExpoCrypto` fills those two methods only
when the runtime has no Web Crypto, and leaves an existing implementation in
place.

`@convex-dev/auth` stays `0.0.96` and `convex` stays `1.46.0`. The only new
dependencies are `expo-secure-store@58.0.2` (published 2026-10-01, the only
release in Expo SDK 58.0.20's `~58.0.2` range) and `expo-crypto@58.0.7`
(published 2026-10-16, the newest release in `~58.0.7`). Both are older than one
day. No `minimumReleaseAge` exclusion was added.

Signed out, the root layout sends the app to `/sign-in`. Signed in, it sends
the app to `/campaign`. That screen reads `campaigns.list`, takes the first
campaign the account belongs to, and shows the number from `campaigns.fear`.
`convex/` is unchanged.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory. Exit code 0 for each.
The focused Jest command was `pnpm --filter @dualityheart/mobile exec jest --ci --testPathPatterns` with a pattern of the five test names.

| Command | Result |
| --- | --- |
| `pnpm install` | Lockfile already up to date. Already up to date. Done in 750ms. The two new packages were added by an earlier install in this session (`Packages: +2`). |
| `pnpm --filter @dualityheart/mobile run check` | ESLint, `tsc --noEmit`, and Jest passed. 7 suites, 17 tests. Watchman printed a recrawl warning. |
| `jest --ci --testPathPatterns` for storage, sign-in, reset, no-social, and fear-proof | 5 suites, 15 tests passed. `fear-proof` renders 4, then 11, after the mocked `campaigns.fear` result changes. It does not render the `99` carried on the list row. |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | Vitest 4.1.10: 322 files passed, 8374 tests passed, 1 expected fail (8375). Exit 0. Duration 37.22s. |
| `git diff --exit-code master -- convex` | No difference. |

## Peer warnings left in place

The install that added the two packages printed the same two warnings as A1:
`@expo/router-server` wants `expo-constants@^58.0.14` and the app has `58.0.13`,
and `update-browserslist-db` wants `browserslist@4.28.7` and found `4.29.5`.
The later `pnpm install` did not reprint them.

## Not done

No device or simulator run. No Google button, no Apple button, no commit, no
push, no merge. `app.config.ts` was not changed, so the `expo-secure-store`
config plugin (Face ID usage text and Android backup) is not added. Basic
storage does not need it: the installed README says Android needs no extra
setup, and this tracer does not turn on `requireAuthentication`.
