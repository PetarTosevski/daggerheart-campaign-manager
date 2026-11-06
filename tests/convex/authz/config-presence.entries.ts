import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: config presence (plan `.omc/plans/config.yaml`, tracer PR1; docs/tasks/TASK-CONFIG-PR1.md). The
 * functions wrap the `@convex-dev/presence` component in the shapes its `usePresence` hook calls, so the campaign comes
 * as `roomId` (heartbeat) or inside the session handle (disconnect), and access is `campaignAccess` (`permissionFor`,
 * view): every member and invitee beats, a stranger gets NOT_FOUND. Only the GM and co-GMs read the room (`list`).
 * Behaviour (identity from ctx.user, someone else's handle, removed members, timeouts) is in tests/convex/presence.test.ts.
 */
const area: Area = {
  area: "config-presence",
  // heartbeat's `sessionId` is the hook's tab id, not a `sessions` row.
  nameHints: { sessionId: () => "matrix-tab" },
  entries: [
    {
      fn: api.presence.heartbeat,
      access: "scoped",
      // `userId` is the hook's label only: the session is always the caller's (rule 3).
      args: (w) => ({ roomId: w.campaignId, userId: w.users.gm, sessionId: "matrix-tab", interval: 10_000 }),
      expect: {
        anon: "UNAUTHENTICATED",
        outsider: "NOT_FOUND",
        otherPlayer: "ok",
        player: "ok",
        grantee: "ok",
        coGm: "ok",
        gm: "ok",
      },
    },
    {
      fn: api.presence.disconnect,
      access: "scoped",
      // A handle for a tab of the world's campaign; each caller can end only their own session behind it.
      args: (w) => ({ sessionToken: JSON.stringify([w.campaignId, "matrix-tab"]) }),
      expect: {
        anon: "UNAUTHENTICATED",
        outsider: "NOT_FOUND",
        otherPlayer: "ok",
        player: "ok",
        grantee: "ok",
        coGm: "ok",
        gm: "ok",
      },
    },
    // GM and co-GMs only (Q11 b): a player never reads the room.
    { fn: api.presence.list, access: "gm" },
    // The hook's list slot: never subscribed (heartbeat hands out no room token) and empty for anyone signed in.
    {
      fn: api.presence.roomList,
      access: "user",
      args: (w) => ({ roomToken: w.campaignId }),
      expect: { outsider: "empty", player: "empty", coGm: "empty", gm: "empty" },
    },
  ],
};

export default area;
