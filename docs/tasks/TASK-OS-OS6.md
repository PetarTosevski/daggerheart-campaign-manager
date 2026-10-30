# TASK-OS-OS6: e2e sign-up flows, authz coverage, docs and launch checklist

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS6. Bead: `dcm-bxp.128`.

Written against today's code, not the plan's older wording: e2e codes are random and read through `readEmailedCode`
(J4), not a fixed `123456`; a Google-only (or test sign-in) user adds a password through Create account and the code
(J5); invites send a Resend email (OS7, none on the e2e backend).

## What changed

- `tests/e2e/signup.spec.ts` (new). Every test signs up a fresh, unique email.
  - Create account, then the code, then signed in. Before the code: no Convex Auth token in the page, and a second tab
    of the same browser opening `/campaigns` lands on `/signin?next=%2Fcampaigns` (no session).
  - A wrong code (the real one plus one) shows the `CODE_INVALID` text and leaves the page signed out. The right code
    then works.
  - A short password: the browser blocks the submit (`validity.tooShort`, no code step). With `noValidate` set on the
    form, the server answers with the `PASSWORD_TOO_SHORT` text.
  - An email that already has a verified password account shows the `EMAIL_TAKEN` text and no code step.
  - Forgot password: send a code, enter it with a new password, signed in. In fresh browsers the old password is
    refused and the new one signs in.
  - The expected texts come from `authMessages` in `src/lib/errors/auth.ts`, so the spec follows the codes, not
    copied strings.
- `tests/e2e/players.spec.ts`: the fixed `e2e-password-only@` account is gone, along with the "create or sign in"
  race and the wrong-password test (now in `signup.spec.ts`). Two new tests use a fresh password account:
  - "an email invite reaches a brand-new password account only after its code": the GM invites an email that has a
    pending sign-up. Before the code, `/campaigns` redirects to sign-in, and signing in with the password stops at
    the code step again. After the code the campaign shows in Load Campaign as Player.
  - "a brand-new password account joins with the GM's code": sign up, enter the code, then `/join/<code>`. The GM sees
    the player's email at the table.
  - The assertion on the players dialog hint "Email invites work for accounts that sign in with Google..." was removed,
    because that text is now wrong (see follow-ups).
- `tests/e2e/auth-session-ended.spec.ts`: each test signs up its own fresh password account with the code
  (`signUpWithCode`) and signs back in with `signInWithPassword`. The fixed `e2e-session-ended@` account and the
  "sign in, else sign up" race are gone.
- `tests/e2e/unauthenticated.spec.ts`: unchanged. It still passes, and sign-up adds no page route.
- Authz: OS3, OS5, OS7, J4 and J5 added no public Convex function. Sign-up, verification and reset all go through
  Convex Auth's own `auth:signIn`, which is already exempt in `tests/convex/authz/core.entries.ts`. J4's `/e2e/code` is
  an HTTP action, gated and tested in `auth-signup.test.ts`. So `tests/convex/authz/auth.entries.ts` / `auth.test.ts`
  were not created: an `auth` area would duplicate the `core` exemptions and fail the "no name listed twice" guard.
  The inventory guard and the Convex sweep pass unchanged.
- Docs:
  - `docs/testing.md`: the `ALLOWED_EMAILS` setup line and the "one email per sign-in method" table are replaced. The
    three fixed test sign-in accounts stay; password sign-ups use a fresh unique email per test and enter the code;
    the open sign-up specs are listed.
  - `docs/best-practices.md`: CF15 now names the sign-up, code and invite limits. CF20 is amended to "separate and
    clear errors; the reset step never reveals an account; an account works only after its code" (bead decision), with
    the tests that enforce it.
  - `docs/data-model.md`: `requireUser` no longer mentions the allowlist. The invite row counts only for a verified
    email, and the invite email is noted. The unverified sign-up cleanup cron and `e2eCodes` are added to the
    retention section.
  - `README.md`: the stack line is updated. In the env table `ALLOWED_EMAILS` is dropped and `AUTH_RESEND_KEY` (Convex
    only) and `MAIL_FROM` are added; the server-secret note covers the Resend key.
  - `AGENTS.md`: product principle 7, the stack line, the Convex layout (`convex/auth.ts`, `convex/lib/allowlist.ts`),
    the production Convex env list (drops `ALLOWED_EMAILS` / `GM_EMAILS`, adds `AUTH_RESEND_KEY` and `MAIL_FROM`, key
    only in the Convex env) and the change boundary ("Close or restrict open sign-up, or skip the emailed code for
    password accounts, without the user's go-ahead").
  - None of these edits is in the binding-rules section. `CLAUDE.md` holds no allowlist text, so it needed no edit,
    and the binding-rules sections of the two files are still identical.

## Checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm tracer:guard open-signup OS6`: see the handoff.
- e2e on this worktree's backend (`E2E_PORT=3118 E2E_CONVEX_PORT=3348`): `signup.spec.ts` (5), `players.spec.ts` (5),
  `auth-session-ended.spec.ts` (4), `unauthenticated.spec.ts` (2) and `auth.spec.ts` (5, read-only regression) all
  pass.
- **Not run here: the full e2e suite.** About eight agents share this machine, so the orchestrator runs it on
  `rebuild` after merging (plan acceptance "Full e2e suite ... pass").

## Follow-ups (not in OS6's `owns`)

- `src/app/(gm)/campaigns/[campaignId]/players-dialog.tsx`: the hint "Email invites work for accounts that sign in
  with Google. Players who use a password should join with the code above." is now wrong. A verified password account
  reaches an invite (proved by the new players test). Suggested: "The invite works once they sign in with this email."
- `convex/convex.config.ts` still declares `ALLOWED_EMAILS` / `GM_EMAILS` and says the sign-in policy "fails closed"
  without them. Drop both and fix the comment. Add `SITE_URL: v.optional(v.string())` there too (OS7 follow-up).
- `scripts/e2e-setup.mjs`: the comment still names `e2e-password-only@` and `e2e-session-ended@`, which no spec uses
  now. Point it to docs/testing.md ("password sign-ups use fresh unique emails").
- `docs/deploy.md` (around line 107) and the historical docs (`docs/decisions-d3-d11.md`, `docs/design-port-roadmap.md`)
  still mention the allowlist; `docs/deploy.md` should get the Resend env vars.
- `tests/convex/authz/core.entries.ts`: the `auth:signIn` exemption reason could also name `tests/e2e/signup.spec.ts`
  and `tests/convex/auth-signup.test.ts`.
- Comments in `tests/e2e/lorekeeper-shell.spec.ts` and `tests/e2e/notes-shell.spec.ts` still say "An allowlisted account".

## Launch checklist (for the user, not agents)

Agents do not touch production, Convex or Vercel env. Do these yourself, in order:

1. **Resend domain.** In Resend, add and verify `dualityheart.com`. Add the SPF (TXT) and DKIM (TXT/CNAME) records
   Resend shows at GoDaddy DNS, plus the MX/return-path record if Resend lists one. Optionally add a DMARC TXT record
   (`_dmarc`, `v=DMARC1; p=none; rua=...`) to start with. Wait until Resend shows the domain as Verified.
2. **API key.** Create a Resend API key with "Sending access" restricted to `dualityheart.com`.
3. **Convex prod env** (dashboard, or `npx convex env set --prod <NAME> <value>`):
   - `AUTH_RESEND_KEY` = the key. It goes in the Convex env only: never Vercel, `.env.local` or `NEXT_PUBLIC_`.
   - `MAIL_FROM` = a sender on the verified domain, for example `Dualityheart <no-reply@dualityheart.com>`.
   - Check that `SITE_URL` is the production URL (sign-in redirects and invite links use it).
4. **Remove the old allowlist** from Convex prod: `npx convex env remove --prod ALLOWED_EMAILS` and
   `npx convex env remove --prod GM_EMAILS`. Nothing reads them any more. Also make sure no `SEED_ACCOUNTS`,
   `ALLOW_SEED_ACCOUNTS`, `E2E_AUTH_ENABLED`, `E2E_AUTH_SECRET` or `LOREKEEPER_FAKE_MODEL` is set on prod.
5. **Smoke test before announcing.** On production, create an account with an address that is **not** your Resend
   account's address (Resend may deliver to the owner's address even when the domain is not verified). Check:
   - the code arrives (also look in spam);
   - the code signs you in;
   - Forgot password sends a code and the new password works;
   - an email invite from a test campaign arrives and its link opens sign-in.
   Look at the Resend dashboard logs for bounces. The verified test account stays: no cron removes verified users.
6. Announce.
