# TASK-OS-OS4: Sign-in page with account creation by code, forgot password and clear errors

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS4. Bead: `dcm-bxp.128`.

## What changed

- `src/app/signin/password-form.tsx` is one form with five steps: `signIn`, `signUp`, `code`, `resetEmail`, `resetCode`.
  - Create account: details (name, email, password with `minLength` 8 and a hint), then `signIn('password', { flow: 'signUp' })`,
    then the code step ("Enter the 6-digit code we emailed to <email>.": one input, `inputMode` numeric, `autocomplete`
    one-time-code), then `signIn('password', { flow: 'email-verification', email, code })` and the redirect to `next`.
    A sign-in that does not sign in (an account whose code was never entered) also lands on the code step.
  - Resend code: a button disabled for 30 seconds after each send (`RESEND_COOLDOWN_SECONDS`), repeating the sign-up (or sign-in)
    call kept in memory; "We sent a new code." in a `role=status`. "Use a different email" returns to the details step.
  - Forgot password (link under the sign-in form): email (`flow: 'reset'`), then code plus new password
    (`flow: 'reset-verification'`), then signed in. The code step says "If <email> has an account, we emailed it a code", so the
    reset step never reveals whether the address has an account.
  - Errors (`authErrorText`): EMAIL_TAKEN, PASSWORD_TOO_SHORT and CODE_INVALID show their own text from `src/lib/errors/auth.ts`
    (CODE_INVALID says to request a new code); RATE_LIMITED says to wait a few minutes; the library's opaque errors get the
    step's fallback ("Wrong email or password." on sign-in). All in a `role=alert`. The old combined message is gone.
  - Focus: the first input of each step, and the alert when an error appears. The Google button and the e2e form are untouched.
- `tests/unit/signin-password-form.test.tsx`: 11 tests (steps, each error text, cooldown with fake timers, the code step cannot be
  skipped, reset flow, unverified sign-in).
- `tests/e2e/a11y-signin.spec.ts`: axe, fit and touch targets on every step (create account, code, wrong code, reset email, reset
  code) at phone and both tablet sizes, using the fixed e2e code 123456.

## Not done / notes

- The e2e spec was not run here (the sandbox cannot start the e2e build: `next/font` fetch). It type-checks and lints.
- The password is held in React state during the code step only so "Resend code" can repeat the call; it never leaves the page
  except in that call.
- A sign-up that hits EMAIL_TAKEN keeps the user on the details step with the message; no link to sign in is added beyond the
  existing "Have an account? Sign in" button.
