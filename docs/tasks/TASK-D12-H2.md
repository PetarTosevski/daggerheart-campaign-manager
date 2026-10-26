# TASK-D12-H2: Every server error is {code, message}; returns validators finish (dcm-bxp.29)

Plan `.omc/plans/d12-hardening.yaml`, tracer H2 (wave 1). Bead dcm-bxp.29. User answer: drop the plain-text error
format entirely and block new plain-text errors with a test.

## String throws converted (analysis section 8)

| File | Before | After |
|---|---|---|
| `convex/lib/operations.ts` (`withIdempotency`) | `new ConvexError("IDEMPOTENCY_MISMATCH")` | removed: the helper had no callers left; `runOnce` already throws `appError("IDEMPOTENCY_MISMATCH")` |
| `convex/maps.ts` (`attachMapImage`) | `new ConvexError("NOT_FOUND")` | `appError("NOT_FOUND")` |
| `convex/lib/permissions.ts` (`requirePermission`) | `new ConvexError("NOT_FOUND")` | `appError("NOT_FOUND")` |
| `convex/lib/permissions.ts` (`requirePermission`) | `new ConvexError("FORBIDDEN")` | `appError("FORBIDDEN")` |
| `convex/lib/permissions.ts` (`liveCampaign`) | `new ConvexError("NOT_FOUND")` | `appError("NOT_FOUND")` |
| `convex/lib/auth.ts` (`requireUser`) | `new ConvexError("UNAUTHENTICATED")` | `appError("UNAUTHENTICATED")` |
| `convex/lib/auth.ts` (`requireUser`) | `new ConvexError("FORBIDDEN")` | `appError("FORBIDDEN")` |
| `convex/lib/users.ts` (not allowlisted) | `new ConvexError("FORBIDDEN")` | `appError("FORBIDDEN")` |
| `convex/lib/users.ts` (password sign-up, email registered) | `new ConvexError("FORBIDDEN")` | `appError("FORBIDDEN")`, same code as "not allowlisted" (CF20) |
| `convex/lib/mechanics.ts` (`assertMechanicEnabled`) | `new ConvexError("MECHANIC_DISABLED")` | `appError("MECHANIC_DISABLED")` |

`grep -rn 'new ConvexError("' convex` now finds nothing. The one remaining raw `new ConvexError` in `convex/` is the
deprecated `ruleError` in `mechanics.ts`, which already sends `{ code, message }`.

## Guard

`tests/convex/error-payloads.test.ts` scans the raw source of `convex/**` (not `_generated`) and fails on any
`ConvexError(` or `ConvexError<T>(` whose payload does not start with an object literal (string, template or bare
identifier). Its first test pins the scan against string, template, identifier, multi-line and object payloads. Proven
by a temporary `throw new ConvexError("FORBIDDEN")` appended to `convex/lib/mechanics.ts`: the test failed with
`convex/lib/mechanics.ts:37`, then the line was removed.

## Client

`src/lib/convex-errors.ts` has no `typeof data === "string"` branch. An object payload shows its `message`, else the
code's text, else "Something went wrong." for an unknown code. `tests/unit/convex-errors.test.ts` builds object payloads
only. `src/app/signin/password-form.tsx` shows a fixed message on any sign-up failure and reads no payload, so it needs
no change (checked).

## Tests moved to errorCode

`tests/convex/maps.test.ts` and `tests/convex/permissions.test.ts` assert `errorCode(...)` (no `errorData` against a
string). `tests/convex/require-user.test.ts` and `tests/convex/create-or-update-user.test.ts` used a local helper that
returned the raw payload; they now import `errorCode` from `./helpers`.

## Returns validators

| Function | `returns` |
|---|---|
| `fear.adjust`, `fear.set` | `{ previousValue: number, newValue: number }` (`FearChange` is now `Infer` of it) |
| `members.access` | `{ joinCode: string \| null, invites: { _id, email, createdAt }[] }` |
| `members.invite` | `v.id("campaignInvites")` |
| `members.revokeInvite`, `removePlayer`, `leave` | `v.null()` (handlers return `null` explicitly) |
| `members.rotateJoinCode` | `v.string()` |

The values returned are unchanged, so callers need no change (the void mutations now resolve to `null`, which no caller
reads). `RETURNS_PENDING` is removed from `tests/convex/schema-guard.test.ts`: every public function must declare
`returns`, and the test also checks that the module scan found functions.
