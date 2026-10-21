import { api } from "../../../convex/_generated/api";
import type { Area, World } from "./harness";

/**
 * Authz matrix: Lorekeeper table rulings and 'Ask the GM' (D13 L4, Q8, Q14). docs/tasks/TASK-D13-L4.md.
 *
 * Every world gets one pinned ruling (the `lorekeeperRulings` id), and player A's finished answer with an open ask
 * (the `lorekeeperMessages` and `lorekeeperAsks` ids). Reads of rulings and the caller's own asks are for every
 * member; pinning, editing, unpinning and resolving are the GM's (an edit grant does not reach them); `send` acts on
 * the caller's own answer, so player B (and the GM) get LOREKEEPER_NOT_FOUND on player A's.
 */

async function seed(w: World) {
  const rulingId = await w.as("gm").mutation(api.lorekeeperRulings.pin, { campaignId: w.campaignId, title: "Flanking", text: "Advantage." });
  w.use("lorekeeperRulings", rulingId);
  const ids = await w.t.run(async (ctx) => {
    const userId = w.users.player;
    const conversationId = await ctx.db.insert("lorekeeperConversations", {
      campaignId: w.campaignId,
      userId,
      title: "q",
      visibility: "campaign",
      webSearch: true,
      messageCount: 4,
      lastAt: 1,
      createdAt: 1,
    });
    const base = { conversationId, campaignId: w.campaignId, userId, createdAt: 1, updatedAt: 1 };
    await ctx.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Hex?" });
    const asked = await ctx.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "done", text: "a", parts: { verdict: "unclear", quotes: [] } });
    // A second finished answer with no ask yet, for `send`.
    const fresh = await ctx.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "done", text: "b", parts: { verdict: "rules", quotes: [] } });
    const askId = await ctx.db.insert("lorekeeperAsks", { campaignId: w.campaignId, messageId: asked, askedBy: userId, askedAt: 1 });
    return { fresh, askId };
  });
  w.use("lorekeeperMessages", ids.fresh);
  w.use("lorekeeperAsks", ids.askId);
}

/** GM only, and a campaign edit grant does not reach it. */
const GM_ONLY = { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" } as const;

const area: Area = {
  area: "lorekeeper-rulings",
  setup: seed,
  entries: [
    { fn: api.lorekeeperRulings.list, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.lorekeeperRulings.pin, access: "gm", expect: GM_ONLY, args: () => ({ title: "Falling", text: "1d10 per 10 ft." }) },
    { fn: api.lorekeeperRulings.update, access: "gm", expect: GM_ONLY, args: () => ({ title: "Flank" }) },
    { fn: api.lorekeeperRulings.unpin, access: "gm", expect: GM_ONLY },
    {
      fn: api.lorekeeperAsks.send,
      access: "view",
      // Player A's own answer; anyone else's is LOREKEEPER_NOT_FOUND (a domain code: access to the campaign was granted).
      okCodes: ["LOREKEEPER_NOT_FOUND"],
      expect: { otherPlayer: "ok", grantee: "ok" },
      note: "Player A sends their own answer; player B, the grantee and the GM get LOREKEEPER_NOT_FOUND (see lorekeeper-rulings.test.ts).",
    },
    { fn: api.lorekeeperAsks.mine, access: "view", expect: { otherPlayer: "empty", gm: "empty" } },
    { fn: api.lorekeeperAsks.listOpen, access: "gm", expect: GM_ONLY },
    { fn: api.lorekeeperAsks.resolve, access: "gm", expect: GM_ONLY },
  ],
  pending: [],
};
export default area;
