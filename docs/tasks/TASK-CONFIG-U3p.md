# TASK-CONFIG-U3p: Online / Away in Players, and the campaign tab's presence

Plan `.omc/plans/config.yaml`, tracer U3p (bead dcm-jh6d.30). Q11 (b), N5 (a): the `@convex-dev/presence` component's
React hook over the server functions PR1 added (`docs/tasks/TASK-CONFIG-PR1.md`).

## The beat (`src/components/config/presence-beat.tsx`)

- `PresenceBeat` calls `usePresence({ heartbeat, disconnect, list: roomList }, campaignId, "me")` from
  `@convex-dev/presence/react` and renders nothing. The room is the campaign id. The user label is a constant: the
  server ignores it and takes the user from the sign-in (rule 3).
- The shell already mounts it once per campaign page (`ConfigMounts` in `campaign-shell.tsx`, in its own
  `SlotBoundary`), so every campaign tab beats for players and GMs alike. No edit outside owns was needed.
- **Rule 13.** The library owns the heartbeat timer (default 10 s, which the server clamps to 10-60 s), stops beating
  and disconnects while the tab is hidden, beats again when it is shown, and disconnects on unmount. No mutation runs
  from an effect of ours, so Q11 (b) replaces the markOpened-style exception.
- `heartbeat` returns an empty room token, so the hook never subscribes to `roomList`: a player's tab never reads the
  room.
- Read-only mode (AD10): `heartbeat` and `disconnect` are `readOnly: "allow"` on the server, so beats keep working.

## The marks (`src/components/config/sections/players/presence.tsx`)

- `PresenceSlot` (one per roster row, name and props unchanged) reads `presence.list` (GM and co-GMs) and shows
  `Online` (design `.on`, #9ff0bd) or `Away` (`.on.off`, #7d8f96). A member with no presence row is Away. Nothing while
  the list loads. Every row passes the same args, so Convex keeps one subscription.
- The styles are inline because `players.css` belongs to U3.

## Known limits

- The creator's own row (rendered by `roster.tsx`, U3) has no slot, so a co-GM viewing the panel sees no mark for the
  creator.
- The hook's unload beacon carries no sign-in and is refused; a closed tab goes Away when its session times out
  (25 s at the default interval). Hiding or leaving the page goes Away at once.
- If a beat fails (a removed member's open tab: `NOT_FOUND`), the hook's promise rejects without a handler; the browser
  logs it and the tab keeps no presence.

## Checks

`tests/unit/config/presence.test.tsx`: the hook gets our three functions with the campaign as the room and no timer or
mutation of ours; the marks with a mocked list (loading, Online, Away, never seen). `pnpm lint`, `pnpm typecheck`,
`pnpm test`.
