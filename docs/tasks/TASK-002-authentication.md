# Task 002 — Authentication

## Status

Complete

## Verification status

Implemented 2026-07-18 using Supabase email-and-password authentication for one
private Game Master account. `OQ-PROD-001` is resolved.

Verified checks (all passed):

- `pnpm install --frozen-lockfile` — exit 0
- `pnpm lint` — exit 0
- `pnpm typecheck` — exit 0
- `pnpm test` — 26 passed (unit + integration, including DB integration)
- `pnpm build` — exit 0
- `pnpm test:e2e` — live sign-in/sign-out test passed against local Supabase

Verified acceptance criteria:

- Protected routes cannot be opened anonymously (middleware + server layout;
  proven by integration tests and a live e2e redirect test).
- The sign-in form shows an actionable error for invalid credentials (live e2e).
- Service-role credentials are not present in client bundles (bundle scan).
- Session validation and route protection logic (integration tests with a
  mocked Supabase client).
- Live "valid user signs in and reaches the shell" e2e (passed 2026-07-18
  against a local Supabase instance with a pre-confirmed GM test user).
- Session state survives a normal page refresh on the protected dashboard
  (live e2e, reverified 2026-07-19).
- Live "signed-in user signs out and loses access" e2e (same test).

Verification completed 2026-07-18: Docker + local Supabase were started, the GM
test user was created via the Auth admin API, and the live sign-in/sign-out e2e
test (`RUN_SUPABASE_E2E=1`) passed. Verification was strengthened on 2026-07-19
with an explicit authenticated-page reload assertion; it passed.

## Goal

Require the campaign manager to be accessed through one authenticated Supabase
user.

## User story

As the Game Master, I need private sign-in so that campaign notes and state are
not publicly accessible.

## Included behavior

- Configure Supabase browser and server clients.
- Add the selected authentication flow.
- Add sign-in and sign-out.
- Protect dashboard routes.
- Refresh or preserve sessions correctly.
- Show actionable authentication errors.
- Redirect authenticated users away from the sign-in page when appropriate.

## Excluded behavior

- Public registration unless explicitly approved
- Multiple roles
- Campaign sharing
- Player accounts
- Organization support
- Social login unless explicitly selected

## Dependencies

- Task 001
- Resolution of `OQ-PROD-001`

## Rules references

None.

## Data-model changes

No application tables are required unless a `profiles` table is deliberately
introduced.

## Authorization

- Unauthenticated users cannot access protected routes.
- Authentication alone does not replace later campaign-level RLS.

## Validation

Validate email and any password fields using Zod at the server boundary.

## Normal flow

1. User opens the application.
2. User is redirected to sign-in.
3. User authenticates successfully.
4. User reaches the protected application shell.
5. User can sign out.

## Empty state

Not applicable.

## Loading state

- Show a clear pending state during sign-in.
- Prevent duplicate submission.

## Failure state

- Invalid credentials or expired links show an actionable error.
- The form preserves the entered email where safe.
- Internal details are not exposed.

## History and audit behavior

Authentication events are not stored in campaign activity history.

## Undo or correction behavior

Not applicable.

## Acceptance criteria

- Protected routes cannot be opened anonymously.
- A valid user can sign in.
- A signed-in user can sign out.
- Session state survives a normal refresh.
- Service-role credentials are not present in browser bundles.
- Required checks pass.

## Unit tests

- Authentication input validation

## Integration tests

- Protected server route rejects missing session
- Server client reads the authenticated user correctly

## End-to-end tests

1. Anonymous user is redirected to sign-in.
2. Valid test user signs in and reaches the protected shell.
3. Signed-in user signs out and loses access.

## Documentation updates

- Record the selected authentication method in `architecture.md`.
- Resolve `OQ-PROD-001`.

## Open questions

None after the authentication method is confirmed.
