# TASK-RF1: The GM ends a scene; scene-length effects end

Status: Review. Plan: `.omc/plans/rules-fixes.yaml`, tracer RF1 (wave 1). Rule: CB 107, "At the GM's discretion, a
scene continues until the current narrative situation has played out." (decision 2, settled by the book).

## What changed

- **Expiry** (`src/lib/domain/characters/expiry.ts`): new event `scene` that ends only `scene` effects. Held dice and
  feature uses have no `scene` value, so they stay. Session end still ends `scene` effects.
- **Mutation** (`convex/scenes.ts`, `scenes.end`): `keyedGmMutation` (need owner, idempotent via `ctx.once("scene_end")`).
  It reads the campaign's characters by `by_campaign` (`take(50)`, over 49 is `INVALID`, as in `sessions.ts`), runs
  `expire(sheet, "scene")` on every active PC and saves the changed sheets. It writes one undoable `actionLog` group, as
  session end does: a row per changed PC (`<name>: scene end`) plus a campaign row `Scene ended; N scene effects ended`.
  It returns `{ ended, entryId }`. With no scene effects it writes nothing and returns `{ ended: 0, entryId: null }`.
- **Dashboard** (`src/app/(gm)/campaigns/[campaignId]/end-scene.tsx`, `page.tsx`): a GM-only "Scene" panel under the
  Session panel, in the same card style, with an "End scene" button, a confirmation dialog and a status line saying what
  ended. Players don't see it. The Session buttons live in `src/components/party/session/index.tsx`, which this tracer
  doesn't own, so the panel sits next to them in `page.tsx`.

## Deliberate choices

- The log rows use `kind: "session"`: the `actionLog` kind validator (`convex/lib/validators/actionLog.ts`, not owned)
  has no `scene`. Adding one means widening that validator.
- There is no "scene in progress" state: the book gives a scene no start event, so End scene just ends the effects.

## Tests

- `tests/unit/expiry-effects.test.ts`: the `scene` trigger.
- `tests/convex/scenes.test.ts`: the GM ends a scene (scene effects gone, session and manual kept, undo restores them),
  no-op and idempotent replay, session end still clears scene effects, authz (anonymous UNAUTHENTICATED, outsider
  NOT_FOUND, player FORBIDDEN, GM ok). There is no `tests/convex/authz-matrix.test.ts` yet, so authz is in this file.
