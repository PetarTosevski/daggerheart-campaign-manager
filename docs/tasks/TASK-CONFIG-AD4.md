# TASK-CONFIG-AD4: Sign-up mode enforced at account creation

Plan `.omc/plans/config.yaml`, tracer AD4 (bead dcm-jh6d.38), Part B. Server enforcement of the owner's sign-up mode
(`appConfig.signUpMode`, set by AD3's `adminAccounts.setSignUpMode`) and of read-only mode (AD10) for new accounts.
Answer: Q18 (a) invite only = a pending email invite or a join-link sign-up; Google only for invited emails; open stays
the default.

## The rule (`convex/lib/users.ts`, `signUpRefusal`)

| State | A new account |
|---|---|
| read-only mode on (`appStatus`) | `SIGN_UP_CLOSED`, whatever the mode |
| `closed` | `SIGN_UP_CLOSED` |
| `invite` | allowed for an email with a pending invite to a live (not deleted) campaign, or a password sign-up whose `joinCode` param is a live campaign's code (normalised like `members.joinByCode`); else `SIGN_UP_INVITE_ONLY` |
| `open` (default, no row) | allowed |

The answer depends only on the mode, the email's invites and the code, never on whether the email has an account.

## Where it is enforced

- `createOrUpdateUser` (Convex Auth callback): only before inserting a NEW user, for every provider (Google, password,
  e2e). Google carries no join code, so in invite mode Google creates only invited emails. Existing users are never
  refused: sign-in, entering a code, Google reusing an existing user, a password linked to a Google user, and the app
  owner (who always has an existing user).
- `auth.ts` `withAuthErrors`, password `signUp` flow: after the sign-up rate limits and before the email is looked up,
  the internal query `auth:signUpGate` asks the same rule. So a refused sign-up answers the same for a new email, an
  existing verified account (otherwise `EMAIL_TAKEN`) and a Google user (otherwise a pending password link): no
  account probing. Refused attempts still spend the per-email and global sign-up tokens, so join-code guesses count.
- The password profile carries `joinCode` to `createOrUpdateUser`; it is never stored on the user.

## Client (`src/app/signin/password-form.tsx`)

- A signed-out visitor of `/join/<code>` lands on `/signin?next=/join/<code>`; `joinCodeFromNext` reads the code and
  the sign-up (and its "Resend code") passes it as the `joinCode` param.
- `SIGN_UP_CLOSED` and `SIGN_UP_INVITE_ONLY` show their `adminMessages` text.

## Decisions taken (recommended defaults)

- While sign-ups are refused, a Google user cannot ADD a password login (the password sign-up is refused before the
  lookup, to avoid revealing that the email has a Google account). They keep signing in with Google. A pending
  (unverified) password account created earlier still verifies with its code.
- An invite or join code of a deleted campaign does not count; an archived campaign's does (archive is read-only, it
  does not stop joining).
- A refused Google sign-up fails in the OAuth callback and the visitor lands back signed out; the sign-in page shows
  no message for it yet (no Google error UI in this tracer; follow-up for the Accounts UI).

## Tests

- `tests/convex/create-or-update-user.test.ts`: the callback's sign-up mode cases (closed, read-only, existing users
  and the owner, invite with invite / deleted invite / join code / Google ignoring a code).
- `tests/convex/signup-mode.test.ts`: the real `signIn` action: open, closed, read-only, no account probing, existing
  accounts sign in and verify, invite with invite / join code, refused attempts spend the rate limit, `joinCodeFromNext`.
