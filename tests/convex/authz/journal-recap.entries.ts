import { api } from "../../../convex/_generated/api";
import type { Area, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: Journal JD5 (recap, 'After the session', 'Campaign so far'). Every world gets one session (the row the
 * `sessionId` hint picks).
 *
 * - `sessionWrap.setRecap` (Journal Q4: everyone writes the recap, always visible): `need: "view"` plus membership.
 *   It runs on the live session, so every member writes it: both players, the grantee (who also joined by code) and
 *   the GM. A planned session refuses players with SESSION_NOT_FOUND, and a grant-only caller (not a member) gets
 *   FORBIDDEN; both are checked in tests/convex/journal-recap.test.ts.
 * - `sessionWrap.after`: GM only (Q5: players do not see 'After the session'); the edit grant does not reach it.
 * - `sessionRecords.summary`: every member reads 'Campaign so far'.
 */

async function liveSession(w: World) {
  await w.as("gm").mutation(api.sessions.start, { campaignId: w.campaignId, idempotencyKey: freshKey() });
}

const area: Area = {
  area: "journal-recap",
  setup: async (w) => {
    await w.as("gm").mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
  },
  entries: [
    {
      fn: api.sessionWrap.setRecap,
      access: "view",
      setup: liveSession,
      args: () => ({ recap: "They crossed the river." }),
      expect: { otherPlayer: "ok", grantee: "ok" },
    },
    { fn: api.sessionWrap.after, access: "gm", expect: { grantee: "FORBIDDEN" } },
    { fn: api.sessionRecords.summary, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
  ],
};

export default area;
