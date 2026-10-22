# TASK-BUG-B5: A session that ends mid-use signs out and redirects to sign-in, then back to the page

Status: Review. Plan: `.omc/plans/d12-bugs.yaml`, tracer B5 (depends on B3, `docs/tasks/TASK-BUG-123.md`).

## Decision (user answer 2026-10-22, orchestrator defaults)

A session whose refresh is really revoked or expired mid-use goes to sign-in, not the "Your session has ended" error
screen: sign out locally, `router.replace("/signin?next=<path + search>")`, a short status meanwhile, and back to that
path after signing in. Other error codes keep the error screen. Nothing redirects from /signin itself.

## How an ended session reaches the page

Found with a revoked session in the e2e build. There are two paths, and they need two fixes:

1. **Convex Auth's refresh fails** (the usual case: the refresh token was deleted or expired). Convex Auth erases its
   tokens (the /api/auth route clears the cookies) and calls its `invalidateCache` server action, which posts to the
   current page. The proxy finds no session cookie and redirects that POST to `/signin?next=<pathname>`. Next renders
   the sign-in page **without changing the URL**, so the page shows the sign-in form under `/campaigns/...`. The forms
   read `next` from the URL, find none and go to "/" after sign-in, so the page the user was on is lost. No error
   boundary is involved.
2. **The Convex client gives up on the token** while Convex Auth still holds one (dcm-bxp.123, or a refreshed token
   the server rejects twice). The Convex client clears its auth, the page's queries throw
   `ConvexError({ code: "UNAUTHENTICATED" })` and the nearest route error boundary showed "Your session has ended".

## Fix

- `src/lib/auth/session-ended.ts`: the pure decision.
  - `isUnauthenticated(error)`: true only for a `ConvexError` whose data has code UNAUTHENTICATED.
  - `isSignInPath(pathname)`: `/signin` or `/signin/`.
  - `signInRedirectTarget(pathname, search)`: `/signin?next=<encoded path + search>`; plain `/signin` for "/" (as the
    proxy does) and for a path `safeNextPath` would refuse; null on /signin itself.
  - `sessionEndedRedirect(error, location)` combines them.
- `src/lib/auth/use-session-ended-redirect.ts` (path 2): `useSessionEndedRedirect(error)` returns true when the
  boundary should redirect. Once per mount (a ref covers StrictMode), it signs out locally, then calls
  `router.replace(target)`.
  - Sign-out inside the auth provider (every `error.tsx`): Convex Auth's `signOut`, which posts `auth:signOut` through
    /api/auth (clears the cookies the proxy reads) and erases the tokens from localStorage and client state.
  - Sign-out outside the provider (`global-error.tsx` replaces the root layout): the same POST, sent directly, then
    the `__convexAuth*` localStorage keys are removed.
  - A failed sign-out is ignored, and the redirect still happens.
  - It runs in an effect because the boundary mounting is the only event there is. It writes no app data, so CL6
    (no mutations in effects to initialise data) does not apply.
- `src/components/route-error.tsx`: `RouteError`, and with it `CampaignRouteError` and `global-error.tsx`, calls the
  hook. While it redirects, it renders `role="status"` "Your session ended – taking you to sign in…" in place of the
  alert and buttons. Every other error renders exactly as before.
- `src/lib/auth/sign-in-url.tsx` and `src/app/signin/page.tsx` (path 1): the sign-in page renders `<SignInUrl />`.
  When the router's pathname is not /signin, it replaces the URL with `/signin?next=<path + search>` from
  `window.location`. The failed refresh has already ended the session, so it signs nothing out. On /signin it does
  nothing.
- `src/app/global-error.tsx`: unchanged. It already renders `RouteError`.

Security: nothing here grants or keeps access. It only sends a browser that has no session to the sign-in page and
clears local tokens. `next` goes through the existing `safeNextPath` in the forms, and `signInRedirectTarget` drops
unsafe paths too. Every Convex function still checks the caller.

No loop:
- On /signin, neither the hook nor `SignInUrl` redirects.
- After a local sign-out the proxy lets /signin through, because the cookie is gone.
- The e2e checks that the URL and the number of /signin visits stay the same for 2 s.

## Tests

- `tests/unit/auth-session-ended.test.ts`: the decision.
  - Only UNAUTHENTICATED counts.
  - path + search go into `next`.
  - "/" goes to plain /signin.
  - Never from /signin.
  - Unsafe paths are dropped.
- `tests/unit/route-error.test.tsx`, new block "a session that ended (B5)":
  - It signs out, then replaces the URL with next, and shows the status, not the alert.
  - The campaign variant behaves the same.
  - On /signin it does not redirect or sign out.
  - FORBIDDEN keeps the screen.
  - Outside the provider it posts `auth:signOut` and erases only the `__convexAuth*` keys.
  - A failed sign-out still redirects.
- `tests/unit/auth-sign-in-url.test.ts`:
  - Nothing happens on /signin.
  - Any other URL becomes `/signin?next=`.
  - "/" becomes /signin.
- `tests/e2e/auth-session-ended.spec.ts`, at 1440 and 390:
  - The session is revoked server-side through Convex Auth's own `auth:signOut` action, called with the page's access
    token from a `ConvexHttpClient` (as a sign-out on another device would). This deletes the session and its refresh
    tokens. No test-only backend path exists for this, and none is needed.
  - The page's scheduled refresh (a timer of about an hour) is held by an init script and fired after the revocation.
  - "a session revoked mid-use goes to sign-in and back" (path 1): ends on `/signin?next=<path?from=b5>`, with no
    error screen and no loop. Signing in with email + password returns to the same path and search, and Fear shows.
  - "when Convex gives up on the token, the error boundary signs out and goes to sign-in and back" (path 2): every
    refresh answers with a token the server rejects, the boundary's status shows, and the URL ends on `/signin?next=`.
    Signing in returns there.
  - Sign-in uses the email + password form (the test-only form always goes to "/"), with the password-only account and
    the password `players.spec.ts` already uses. That account is never signed in through the test form, so the
    one-email-per-method rule holds.
- Before the fix, path 1 failed: the sign-in form rendered under `/campaigns/<id>?from=b5`.

Results:
- `auth-session-ended.spec.ts` and `auth-single-run.spec.ts` with `--repeat-each 3`: 24 of 24 passed.
- `auth.spec.ts`, `error-boundary.spec.ts`, `players.spec.ts` and `unauthenticated.spec.ts`: 13 of 13 passed.
- `pnpm lint`, `pnpm typecheck` and vitest (258 files) pass.

## Not covered (outside owns)

Six `error.tsx` files render their own body instead of `RouteError`, so a boundary there does not redirect yet:
`notes`, `combat-map`, `combat-map/packs`, `lorekeeper`, `sessions`, `adversaries`. In practice the campaign layout's
own queries fail as well, which bubbles to `campaigns/error.tsx`, and that one redirects. To make it certain, each of
those files can call `useSessionEndedRedirect(error)` and render the same status (a one-line change per file).
