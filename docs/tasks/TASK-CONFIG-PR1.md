# TASK-CONFIG-PR1: Presence with the @convex-dev/presence component

Plan `.omc/plans/config.yaml`, tracer PR1 (bead dcm-jh6d.9). Server only: an open campaign tab keeps its user present
in the campaign's room, and the GM reads who is online. Q11 (b) and N5 (a): the `@convex-dev/presence` component, no
`campaignPresence` table. The UI (the hook in `presence-beat.tsx`, Online / Away in the Players section) is U3p.

## Component

- `@convex-dev/presence` **0.4.0**, pinned (released 2026-07-21, well past pnpm's `minimumReleaseAge`). It brings
  `@convex-dev/batch-worker` ^0.2.0 as a nested component.
- `convex/convex.config.ts`: `app.use(presence)` next to `rateLimiter` and `migrations`.
- **Timeout.** A session ends 2.5 heartbeat intervals after its last beat; the component's own batch-worker loop sleeps
  until the next deadline and disconnects expired sessions (no scheduled function per session). Our server clamps the
  interval to 10-60 s (`HEARTBEAT_MIN_MS` / `HEARTBEAT_MAX_MS`), so a tab is Away at most 25-150 s after it stops
  beating. The hook's default interval is 10 s. Heartbeats only bump the session's deadline: the presence row (what the
  list reads) changes only when a user goes online or away, so beats never re-run the GM's list.
- No `Date.now()` in our queries (CF10): `list` reads only the component's `online` flag. The component uses time inside
  its own mutations and worker.

## API (`convex/presence.ts`)

The functions have the shapes the component's `usePresence(presence, roomId, userId, interval?)` hook calls, so U3p
passes `{ heartbeat: api.presence.heartbeat, disconnect: api.presence.disconnect, list: api.presence.roomList }` with
`roomId = campaignId`.

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `presence.heartbeat` | `userMutation` | `{ roomId, userId, sessionId, interval }` (hook shape) | `{ roomToken: "", sessionToken }` |
| `presence.disconnect` | `userMutation` | `{ sessionToken }` | `null` |
| `presence.list` | `gmQuery` | `{ campaignId }` | `{ userId: Id<"users">, online: boolean }[]` |
| `presence.roomList` | `userQuery` | `{ roomToken }` | `[]` (the hook's list slot) |

- **Identity (rule 3).** The user is always `ctx.user`. The hook's `userId` argument is only its label and is ignored
  (the acceptance allows "ignored or must equal the caller"; ignoring it means U3p needs no query for its own user id).
  The component session id is `JSON([ctx.user._id, campaignId, sessionId])`, so a call can only ever create or end the
  caller's own sessions, and the component's "session id must be unique" error can't be triggered by another user.
- **heartbeat** normalizes `roomId` to a campaign id and needs `view` through `campaignAccess` (`permissionFor`):
  members and invitees beat, anyone else gets `NOT_FOUND` (a removed member too). Archived campaigns beat (opening one
  must not fail). An empty or over-256-character `sessionId` is `INVALID`. It returns an **empty `roomToken`**: the
  hook then skips its list subscription, so a player's tab never reads the room.
- **disconnect** takes the handle `heartbeat` returned (`JSON([campaignId, sessionId])`, not a secret). It needs `view`
  on that campaign (`NOT_FOUND` otherwise; a malformed handle is `INVALID`). If the caller is not online in that room it
  does nothing. Otherwise it looks up the component's own session token for **the caller's** session with that tab id
  (a heartbeat returns it, creating the session if that tab's session already ended) and disconnects it, in one
  transaction. A handle copied from someone else names their tab id, but the session acted on is the caller's own, so
  it can never disconnect them ("the session token belongs to the caller" by construction).
- **list** (GM and co-GMs; `player` FORBIDDEN, stranger NOT_FOUND) reads the room through the component's `listRoom`
  and keeps only the campaign's creator and its member rows (`campaignMembers.by_campaign_user`, at most 200), so a
  removed member or an invitee never shows. Only user ids and the online flag; no timestamps.
- **roomList** is never subscribed (empty room token) and answers `[]`; it exists only so the hook gets a list
  function of the right type.

## Cleanup

`cleanup.purgeCampaign` calls `removeCampaignRoom` (the component's `removeRoom`: the room's presence rows, sessions,
their tokens and the room token) right before it deletes the campaign. A room holds a few rows per member, well within
one transaction. Removing a member does not touch the room (members.ts is not PR1's); `list` filters them out, and
their sessions time out because their beats now fail.

## Authz

`tests/convex/authz/config-presence.entries.ts`: `heartbeat` and `disconnect` are `scoped` (anon UNAUTHENTICATED,
outsider NOT_FOUND, every member, grantee and co-GM ok); `list` is `gm`; `roomList` is `user` with `empty` rows.
Behaviour is in `tests/convex/presence.test.ts` (forged `userId`, someone else's handle, removed member, archived
campaign, timeout with the interval cap) and the purge in `tests/convex/cleanup.test.ts`.

## Out of owns

- `package.json`, `pnpm-lock.yaml`: `@convex-dev/presence` 0.4.0 (approved, N5 a).
- `tests/convex/setup.ts`: `makeTest()` registers the presence component (`@convex-dev/presence/test`, which also
  registers its nested batch-worker), like the rate limiter and migrations. Every convex-test instance needs it,
  because every purge now calls the component.

## Notes for later tracers

- **The unload beacon.** On `beforeunload` the hook posts `presence:disconnect` with `navigator.sendBeacon`, which
  carries no sign-in, so the wrapper refuses it (`UNAUTHENTICATED`) and the tab goes Away when its session times out.
  Hiding the tab and unmounting the hook disconnect through the signed-in client and take effect at once.
- **Read-only mode.** The briefs say the heartbeat (and `disconnect`) must be exempt from the app-wide read-only guard
  when it lands; they are `userMutation`s.
- **Owner read-only view (AD13).** `campaignAccess` is called without `ownerView`, so the app owner never enters a room
  they are not a member of.

## Checks

`pnpm lint`, `pnpm typecheck` and the full vitest suite; see the hand-off report. `convex/_generated/api.d.ts` was
patched locally for the new module and component (no deployment in this worktree for `npx convex codegen`); it is not
committed, the orchestrator regenerates it.
