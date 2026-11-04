import { api } from "../../../convex/_generated/api";
import type { Area, Outcome, Role, World } from "./harness";

/**
 * Authz matrix: the Lorekeeper chat (convex/lorekeeper.ts). Tracer L3 (.omc/plans/d13-lorekeeper.yaml),
 * docs/tasks/TASK-D13-L3.md.
 *
 * Every function is a campaign wrapper with `need: "view"` (anon UNAUTHENTICATED, outsider NOT_FOUND). Past it,
 * conversations follow Q3: public to the campaign by default, private on the asker's request; a private one exists
 * only for its asker, and only the asker asks in, edits a question, stops, toggles, makes private or deletes. Anything else answers
 * LOREKEEPER_NOT_FOUND, the GM included.
 *
 * Every world gets one PRIVATE conversation of playerA with a question and an answer (inserted: `ask` would
 * schedule a model run), so the per-conversation rows show the strict case: player ok, otherPlayer / grantee / GM
 * LOREKEEPER_NOT_FOUND. Reading another member's public conversation is covered in tests/convex/lorekeeper-chat.test.ts.
 *
 * `ask` runs without ANTHROPIC_API_KEY (lorekeeper-chat.test.ts clears it and stubs fetch), so a member past the access
 * check gets LOREKEEPER_UNAVAILABLE (an okCode) and no run is scheduled.
 */

const notFound = "LOREKEEPER_NOT_FOUND" as Outcome;

/** Members on their own rows: every member may call it. */
const MEMBERS: Partial<Record<Role, Outcome>> = { otherPlayer: "ok", grantee: "ok" };
/** playerA's private conversation or answer: only playerA. */
const ASKER_ONLY: Partial<Record<Role, Outcome>> = { otherPlayer: notFound, grantee: notFound, gm: notFound };

async function privateConversation(w: World) {
  const userId = w.users.player;
  const campaignId = w.campaignId;
  const { conversationId, answerId } = await w.t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("lorekeeperConversations", {
      campaignId,
      userId,
      title: "Do two Hexes stack?",
      visibility: "private",
      webSearch: true,
      messageCount: 2,
      lastAt: 1,
      createdAt: 1,
    });
    const base = { conversationId, campaignId, userId, createdAt: 1, updatedAt: 1 };
    await ctx.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Do two Hexes stack?" });
    const answerId = await ctx.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "done", text: "Only the strongest applies." });
    return { conversationId, answerId };
  });
  w.use("lorekeeperConversations", conversationId);
  w.use("lorekeeperMessages", answerId);
}

/** playerA's question in the private conversation (`w.use` holds the answer for the other rows). */
async function questionOf(w: World) {
  const campaignId = w.campaignId;
  const question = await w.t.run(async (ctx) =>
    (await ctx.db.query("lorekeeperMessages").order("desc").take(50)).find((m) => m.campaignId === campaignId && m.role === "question"),
  );
  if (question === undefined) throw new Error("the matrix world has no Lorekeeper question");
  return question._id;
}

const area: Area = {
  area: "lorekeeper-chat",
  setup: privateConversation,
  entries: [
    { fn: api.lorekeeper.available, access: "view", expect: MEMBERS },
    { fn: api.lorekeeper.listConversations, access: "view", expect: MEMBERS },
    { fn: api.lorekeeper.getConversation, access: "view", expect: ASKER_ONLY },
    { fn: api.lorekeeper.listMessages, access: "view", expect: ASKER_ONLY },
    {
      fn: api.lorekeeper.ask,
      access: "view",
      args: () => ({ question: "What does a critical hit do?", webSearch: false }),
      okCodes: ["LOREKEEPER_UNAVAILABLE"],
      expect: MEMBERS,
    },
    {
      // LK3: only the question's asker edits it; past the author check, no key answers LOREKEEPER_UNAVAILABLE.
      fn: api.lorekeeper.editQuestion,
      access: "view",
      args: async (w) => ({ questionId: await questionOf(w), question: "Do two Hexes stack on one target?" }),
      okCodes: ["LOREKEEPER_UNAVAILABLE"],
      expect: ASKER_ONLY,
    },
    { fn: api.lorekeeper.stop, access: "view", expect: ASKER_ONLY },
    { fn: api.lorekeeper.setWebSearch, access: "view", expect: ASKER_ONLY },
    { fn: api.lorekeeper.setVisibility, access: "view", expect: ASKER_ONLY },
    { fn: api.lorekeeper.removeConversation, access: "view", expect: ASKER_ONLY },
  ],
};
export default area;
