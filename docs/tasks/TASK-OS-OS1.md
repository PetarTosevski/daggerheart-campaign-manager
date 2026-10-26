# TASK-OS-OS1: Email sender for sign-up codes

Plan: `.omc/plans/open-signup.yaml`, bead dcm-bxp.128.

`convex/lib/authEmail.ts` exports `resendCodeProvider(id)`, a Convex Auth email provider (15 minute `maxAge`, 6-digit code from `crypto`). It sends through `POST https://api.resend.com/emails` with `fetch`. A provider id containing `reset` sends the password-reset template; any other id sends the sign-up verification template. Both templates show the code once and carry no link.

## Environment (Convex only)

- `AUTH_RESEND_KEY`: Resend API key. `MAIL_FROM`: sender on the verified dualityheart.com domain, for example `Duality Heart <noreply@dualityheart.com>`.
- Set with `npx convex env set AUTH_RESEND_KEY ...` (add `--prod` only with the user). Never in Vercel, `.env.local` or a `NEXT_PUBLIC_` variable. Both are optional strings in `convex/convex.config.ts`; after merge, regenerate `convex/_generated` so the typed `env` knows them.
- A missing key or sender on a non-e2e deployment throws a clear error. A non-2xx Resend answer throws with the status only; the key and the code are never logged or put into an error.

## Local e2e backend

When `isE2EDeployment(env)` and `E2E_AUTH_ENABLED=true`, nothing is sent and the code is always `123456`. The generator and the sender both check, so a cloud deployment can never use the fixed code.

## Tests

`tests/unit/auth-email.test.ts` (fetch mocked): request shape and headers, fake mode makes no request, fixed code only in e2e mode, missing key or sender throws, non-2xx throws without leaks, tokens are 6 digits, templates.

OS3 wires the provider into `convex/auth.ts` (`verify: resendCodeProvider('resend-otp')`, `reset: resendCodeProvider('resend-reset')`).
