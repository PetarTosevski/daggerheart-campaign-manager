# TASK-F9-J1: Auth errors keep their code in production (dcm-bxp.128.1)

## Root cause

Sign-in, sign-up and reset all run through `signIn` of Convex Auth, which POSTs to `/api/auth`. The Next.js proxy
(`convexAuthNextjsMiddleware`, which calls `proxyAuthActionToConvex` in `@convex-dev/auth/nextjs/server/proxy.js`) runs
`fetchAction("auth:signIn")`. On a throw it answers `jsonResponse({ error: error.message }, 400)` and nothing else.

A `ConvexError` from the action reaches `fetchAction` (ConvexHttpClient) as
`{ status: "error", errorMessage, errorData }`; the client throws a `ConvexError` whose `message` is `errorMessage` and
whose `data` is `errorData`.

- Dev: `errorMessage` is `Uncaught ConvexError: {"code":"EMAIL_TAKEN"}`, so `password-form.tsx` could regex the code out.
- Production: Convex redacts `errorMessage` to `[Request ID: ...] Server Error` and keeps only `errorData`. The proxy
  drops `data`, so the browser saw a generic error and the form's fallback text.

## Fix

`src/lib/auth-errors.ts` exports `withAuthErrorCode(fetch, convexUrl)`. `src/proxy.ts` wraps the global `fetch` with it
(the proxy and `ConvexHttpClient` both use the global). For a response to `<convexUrl>/api/action` with
`status: "error"` and `errorData.code` matching `^[A-Z][A-Z0-9_]*$`, `errorMessage` becomes
`ConvexError: {"code":"<CODE>"}`. Only the code is copied: no stack, request id or other `errorData` field.
`authErrorText` in `password-form.tsx` already reads that shape; only its comment changed.

Why not a route handler: the middleware answers `/api/auth` before any `src/app/api/auth/**` route could run, and the
library offers no error hook.

## Tests

`tests/unit/auth-proxy-errors.test.ts` (redacted message in, code out, nothing else leaked, other URLs untouched);
`tests/unit/signin-password-form.test.tsx` (proxy-style and redacted messages through `authErrorText`).

## To verify after deploy

Create an account with an existing email on production: the form must say the address already has an account.
