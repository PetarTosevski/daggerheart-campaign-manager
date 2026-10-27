# TASK-OS-OS3: Verified password sign-up, forgot password, distinct errors, rate limits

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS3. Bead: `dcm-bxp.128`.

## Spike: what reaches the browser (Convex Auth 0.0.96, read from `node_modules/@convex-dev/auth/dist`, exercised in `tests/convex/auth-signup.test.ts`)

Not testable against a cloud deployment from this sandbox. The findings come from the library source, the Convex rule that
`ConvexError.data` survives `ctx.runMutation` and the action boundary while a plain `Error` is redacted to "Server Error" in
production, and convex-test runs of the real `signIn` action.

- (a) Errors thrown by our own steps. `validatePasswordRequirements` and `profile` run inside the action, so a `ConvexError`
  thrown there reaches the client with its data. `createOrUpdateUser` runs in the `auth:store` mutation, called from the action by
  `ctx.runMutation`; a `ConvexError` thrown there propagates unchanged through the action. A plain `Error` (the library's own
  "Invalid password", "Account x already exists") would reach the browser as an opaque "Server Error".
- (b) Wrong or expired code. `email-verification` and `reset-verification` end in `throw new Error("Could not verify code")` (or
  "Invalid code"): a plain `Error`, so production shows no message. Expired, unknown and wrong codes are indistinguishable
  (the code row is simply not found, or deleted when expired). Verification is also rate limited by the library (10 failed
  attempts per hour per email; the 11th looks like a wrong code).
- (c) Existing email. Sign-up on an existing password account with the same password silently signs in; with another
  password throws a plain "Account x already exists". `createOrUpdateUser` is not called at all for an existing account, so the
  old `FORBIDDEN` for an existing email was only reached for a user without a password account.

Decision: no new public Convex function was needed. The Password provider's `authorize` is wrapped in `convex/auth.ts`
(`withAuthErrors`), so the three failures reach the client as `ConvexError<AppError>` with their own code, and the sign-up
branch is handled before the library creates anything.

## Other findings

- Convex Auth replaces its default user logic when `createOrUpdateUser` is configured, so the verification step (the code
  entered) calls our callback with `existingUserId` and `emailVerified: true`; nothing else would set `emailVerificationTime`.
  The callback now does (this is what makes "an account works only after its code").
- Creating a verification code also calls the callback, with the email provider id and an existing account; that path returns the
  existing user before any email check (a first version refused it with FORBIDDEN).
- Convex Auth compares the raw `params.email` with the stored (lower-cased) account id, so a code typed with `Ana@X.com` would
  never verify. `withAuthErrors` lower-cases `params.email` for every flow.
- Email providers need `SITE_URL` in the Convex env (set on the e2e backend by `scripts/e2e-setup.mjs`, and documented for prod).

## What changed

- `convex/auth.ts`: `Password({ id: 'password', verify: resendCodeProvider('resend-otp'), reset: resendCodeProvider('resend-reset'),
  profile, validatePasswordRequirements })`, wrapped by `withAuthErrors`. Google and the e2e provider are unchanged. The two code
  providers are wrapped so every send first spends a `authCodeSend` token for that address (covers sign-up, sign-in resend for an
  unverified account, and reset).
  - Sign-up: password check, per-email and global limits, then an existing account is `EMAIL_TAKEN` when verified; an abandoned
    unverified one is replaced (its password is changed to the new one, then the library sends a fresh code, the old code is
    overwritten). Known gap: the abandoned account keeps the first attempt's display name.
  - Wrong, expired or unknown-account code is `CODE_INVALID` (one answer, no account probing). A reset for an unknown email returns
    quietly like a known one and sends nothing (no enumeration at the reset step, as OS4 requires). Too many wrong passwords is
    `RATE_LIMITED`.
  - Reset by code signs out every other session (library behaviour, covered by a test) and, because the code proves the address,
    verifies the email.
- `convex/lib/users.ts`: no allowlist and no shims. Existing account: returned, and marked verified when the profile says so.
  Google / e2e need `emailVerified === true`; an existing user is reused when verified; one held by an UNVERIFIED password account
  loses that account, its codes and sessions and becomes verified. Password sign-up for an email with a user is `EMAIL_TAKEN`.
  Email lower-cased. Signature is now `(ctx, args)`; the `env` argument is gone.
- `convex/lib/authRateLimit.ts`: second `RateLimiter` on `components.rateLimiter`, keyed by normalised email. `authCodeSend` 5 per
  hour (fixed window), `authSignUp` 10 per hour per email, `authSignUpGlobal` 300 per hour with bursts of 60. Skipped when
  `fakeCodeMode(env)` (local e2e backend). Over a limit: `RATE_LIMITED`.
- `src/lib/errors/auth.ts`: `EMAIL_TAKEN`, `PASSWORD_TOO_SHORT`, `CODE_INVALID`, joined into `AppErrorCode`, `appError` (standard text)
  and `convex-errors.ts`. Each is asserted by `ConvexError.data.code` in tests.
- Tests: `auth-signup.test.ts` (21 tests through the real `signIn` action with a stubbed Resend `fetch`: unverified user and no session,
  correct code, wrong code, expired code and the 15 minute edge, short password, existing email, Google-held email, replacing an
  abandoned account, Google removing an unverified password login, invite unreachable until the code, reset flow and its error
  cases, unknown-email reset, per-email send and sign-up limits, refill, global flood cap), `create-or-update-user.test.ts` rewritten,
  `tests/unit/auth-errors.test.ts`; `authz-synth` and `unauthenticated-sweep` lose the dead `allowWorldEmails` calls.

## Not done / for the orchestrator

- `isAllowedEmail` / `isAllowedProfile` in `convex/lib/allowlist.ts` are now unused but still exported: that file is not in OS3's
  `owns` (the plan lists it under `reads`), so deleting them is left for a tracer that owns it (OS6, or a one-line follow-up).
- No public Convex function was added, so no authz matrix entry is needed. The sign-in flows are the library's own public action.
- e2e did not run here. OS4 (UI) needs `flow: 'email-verification'` calls with the lower-cased email and shows the three codes;
  `CODE_INVALID` is also what a rate-limited verification looks like.
- The CF20 note in `docs/best-practices.md` still says the old enumeration-safe wording; OS6 amends it to "show 'this email
  already has an account'" (bead answer 2026-10-26).
