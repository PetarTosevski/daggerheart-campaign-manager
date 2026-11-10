# TASK-PH-A4: Google and Apple sign-in

Tracer A4-social. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

Google sign-in uses the website's OAuth redirect. `signIn("google", { redirectTo })` returns a redirect, and the app opens it with `expo-web-browser`'s `openAuthSessionAsync` (`preferEphemeralSession: false`), which is the system browser session. On success the button calls `signIn("google", { code })`. The return URL is `dualityheart://auth` or `dualityheart-dev://auth`. `app/auth.tsx` only shows "Signing in…"; the code exchange stays in the button press.

`callbacks.redirect` allows a relative path, `SITE_URL`, `dualityheart://`, and `dualityheart-dev://`. It rejects `https://evil.test`, `dualityheart.evil://`, `javascript:`, and `//evil`. The `jwt.customClaims` `token_id` block in `convex/auth.ts` is unchanged.

Apple sign-in is the native `AppleAuthenticationButton`. It does not open a browser and does not call `signIn("apple")`. The app sends `signIn("apple-native", { identityToken, nonce, name })`. The server checks the Apple identity token: RS256 signature against `https://appleid.apple.com/auth/keys`, issuer `https://appleid.apple.com`, audience limited to `com.dualityheart.mobile` and `com.dualityheart.mobile.dev`, expiry, and nonce. The app sends Apple the SHA-256 hex of a raw nonce and sends the raw nonce to the server. A verified email that matches an existing verified user signs into that user. A private-relay email creates a new user. A token with no `email_verified` returns `FORBIDDEN`. A later sign-in with no email still works when that Apple user id already has an account. No Apple client secret is stored.

`apple-native` is a credentials provider on the existing `auth:signIn` action. No new public Convex function was added.

Both buttons render only when `EXPO_PUBLIC_SOCIAL_SIGN_IN` is `"true"`. With the flag on, iOS shows Apple and Google, and Android shows Google only. With the flag off, neither platform shows either button. `ios.usesAppleSignIn` and the `expo-apple-authentication` config plugin are on so the entitlement exists when the flag is later turned on. `eas.json` does not set the flag.

Convex lists a file in `convex/_generated/api.d.ts` when a line starts with `import` or `export`. `convex/lib/nativeRedirect.ts` and `convex/lib/appleIdentity.ts` are helpers, not Convex functions, so their import and export keywords stay off the start of a line. Codegen then leaves `convex/_generated` unchanged.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory. The mobile `check` script is ESLint, then `tsc --noEmit`, then `jest --ci`.

| Command | Result |
| --- | --- |
| `pnpm vitest run tests/unit/native-redirect.test.ts tests/unit/apple-identity.test.ts tests/convex/apple-native.test.ts tests/convex/create-or-update-user.test.ts tests/convex/auth-signup.test.ts tests/convex/auth-jti.test.ts tests/convex/authz-matrix.test.ts tests/convex/unauthenticated-sweep.test.ts` | Exit 0. 8 files, 877 tests. |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. 9 suites, 23 tests. Watchman printed a recrawl warning. |
| `npx convex codegen && git diff --exit-code convex/_generated` | Exit 0. No diff under `convex/_generated`. |

The worktree had no `CONVEX_DEPLOYMENT`, so codegen was run after `CONVEX_AGENT_MODE=anonymous npx convex init`. That configured a local anonymous backend at `http://127.0.0.1:3210` and wrote gitignored `.env.local` and `.convex/`. Codegen uploaded to that local backend only. Those two gitignored paths were removed after the diff check. `pnpm exec tsc --noEmit` on the repo also exited 0.

## Not done

No `eas build`, no `eas submit`, and no `eas integrations:convex:connect`. No commit, no push, no merge. The social flag stays off until it is set in the shell or an EAS environment.
