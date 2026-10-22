# TASK-F6-G1: Session-ended redirect on the six remaining pages

Status: Review. Plan: `.omc/plans/followups-6.yaml`, tracer G1. Bead: dcm-bxp.131.

## Decision (user answer 2026-10-22)

The `notes`, `combat-map`, `combat-map/packs`, `lorekeeper`, `sessions` and `adversaries` error.tsx files call
`useSessionEndedRedirect(error)` and render its status. This finishes the "Not covered" item in
`docs/tasks/TASK-BUG-B5.md`.

## Change

These six boundaries render their own body instead of `RouteError`. Each one now:

- calls `useSessionEndedRedirect(error)` from `src/lib/auth/use-session-ended-redirect.ts`. For a
  `ConvexError({ code: "UNAUTHENTICATED" })` outside /signin, the hook signs out locally once and then calls
  `router.replace("/signin?next=<path + search>")`.
- while that runs, replaces its alert and 'Try again' with `<p role="status">` "Your session ended – taking you to
  sign in…", the same text `RouteError` shows. The page wrapper and title stay.
- renders every other error exactly as before.

So every route segment's error boundary now sends an ended session to sign-in and back.

## Tests

`tests/unit/error-boundaries-redirect.test.tsx` runs two cases for each of the six pages:

- UNAUTHENTICATED:
  - The status shows, and neither the alert nor 'Try again' does.
  - `signOut` runs once, before `router.replace`.
  - The target is `/signin?next=<encoded path?from=g1>`.
- FORBIDDEN:
  - The page's own alert text and 'Try again' stay, and 'Try again' calls `retry`.
  - Nothing signs out or redirects.
