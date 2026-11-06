import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RetrievedChunk } from "../../convex/lib/lorekeeper/retrieve";
import { sseFixture, sseResponse } from "../fixtures/lorekeeper/sse";
import { buildWorld, type Role, type World } from "./authz/world";
import { errorCode } from "./helpers";

/**
 * Config L1 (plan `.omc/plans/config.yaml`, docs/tasks/TASK-CONFIG-L1.md): the campaign's Lorekeeper settings.
 * `tableSettings.lorekeeperAsk: "gm"` lets only the GM and co-GMs ask (players get LOREKEEPER_GM_ONLY before anything
 * is spent, rate-limit token included); `tableSettings.lorekeeperWeb: false` stores every conversation's internet
 * toggle as false, so the run never makes its internet pass. The world (authz/world.ts) has the creator `gm`, a
 * promoted `coGm` and the players. fetch is stubbed: no test reaches the API; retrieve finds nothing, so a toggle-on
 * question goes to the internet pass when the campaign allows it.
 */

const chunks = vi.hoisted(() => ({ value: [] as RetrievedChunk[] }));
vi.mock("../../convex/lib/lorekeeper/retrieve", () => ({ retrieve: async () => chunks.value }));

const API_KEY = "sk-ant-test-key-123";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));
const TERMINAL = new Set(["done", "error", "stopped"]);

type SseEvent = { type: string; [field: string]: unknown };

/** A plain text reply streamed as one delta. */
function textReply(text: string, model = "claude-sonnet-5-5"): string {
  const events: SseEvent[] = [
    { type: "message_start", message: { id: "msg_t", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 60 } },
    { type: "message_stop" },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > until) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function helpers(w: World) {
  const campaignId = w.campaignId;
  const set = (change: { key: "lorekeeperAsk"; value: "everyone" | "gm" } | { key: "lorekeeperWeb"; value: boolean }) =>
    w.as("gm").mutation(api.campaignSettings.set, { campaignId, change });
  const ask = (role: Role, webSearch = false, question = "What does a critical hit do?") =>
    w.as(role).mutation(api.lorekeeper.ask, { campaignId, question, webSearch });
  const access = (role: Role) => w.as(role).query(api.lorekeeper.access, { campaignId });
  const answer = (id: Id<"lorekeeperMessages">) => w.t.run((c) => c.db.get("lorekeeperMessages", id));
  const finished = (id: Id<"lorekeeperMessages">) => waitFor(() => answer(id), (r) => r !== null && TERMINAL.has(r.status));
  const conversation = (id: Id<"lorekeeperConversations">) => w.t.run((c) => c.db.get("lorekeeperConversations", id));
  /** Everything an ask writes or spends in this campaign: conversations, messages, cost counters. */
  const footprint = () =>
    w.t.run(async (c) => ({
      conversations: (await c.db.query("lorekeeperConversations").withIndex("by_campaign_user_last", (q) => q.eq("campaignId", campaignId)).take(50)).length,
      messages: (await c.db.query("lorekeeperMessages").order("desc").take(200)).filter((m) => m.campaignId === campaignId).length,
      usage: (await c.db.query("lorekeeperUsage").withIndex("by_campaign_period", (q) => q.eq("campaignId", campaignId)).take(50)).length,
    }));
  /** A finished question and answer of `role` in their own conversation (inserted: no run). */
  const seedConversation = (role: Role, webSearch: boolean) =>
    w.t.run(async (c) => {
      const userId = w.users[role as Exclude<Role, "anon">];
      const conversationId = await c.db.insert("lorekeeperConversations", {
        campaignId,
        userId,
        title: "Do two Hexes stack?",
        visibility: "campaign",
        webSearch,
        messageCount: 2,
        lastAt: 1,
        createdAt: 1,
      });
      const base = { conversationId, campaignId, userId, createdAt: 1, updatedAt: 1 };
      const questionId = await c.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Do two Hexes stack?" });
      await c.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "done", text: "Only the strongest applies." });
      return { conversationId, questionId };
    });
  return { campaignId, set, ask, access, answer, finished, conversation, footprint, seedConversation };
}

describe("Lorekeeper campaign settings (config L1)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  /** Each Messages API call's request body, in order. */
  const bodies: string[] = [];

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = API_KEY;
    delete process.env.LOREKEEPER_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    chunks.value = [];
    bodies.length = 0;
    fetchMock.mockReset();
    // The books never say: every pass answers 'unclear', so a toggle-on question goes on to the internet pass.
    fetchMock.mockImplementation((_url, init) => {
      const body = String(init?.body);
      bodies.push(body);
      if (body.includes("web_search")) return Promise.resolve(sseResponse(sseFixture("web-search")));
      return Promise.resolve(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.\nGM CALL: Your call.")));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("who can ask", () => {
    it("access reports canAsk for player, co-GM and GM under both choices", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      for (const role of ["player", "coGm", "gm"] as const) {
        expect(await s.access(role)).toEqual({ available: true, canAsk: true, webAllowed: true });
      }
      await s.set({ key: "lorekeeperAsk", value: "gm" });
      expect((await s.access("player")).canAsk).toBe(false);
      expect((await s.access("otherPlayer")).canAsk).toBe(false);
      // A campaign edit grant is not the GM's permission.
      expect((await s.access("grantee")).canAsk).toBe(false);
      expect((await s.access("coGm")).canAsk).toBe(true);
      expect((await s.access("gm")).canAsk).toBe(true);
      delete process.env.ANTHROPIC_API_KEY;
      expect(await s.access("gm")).toEqual({ available: false, canAsk: true, webAllowed: true });
    });

    it("GMs only: a player's ask is refused with LOREKEEPER_GM_ONLY and spends nothing, rate limit included", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      await s.set({ key: "lorekeeperAsk", value: "gm" });
      const before = await s.footprint();
      // The rate limit holds 10 asks in a burst: a consumed token would turn the 11th refusal into RATE_LIMITED.
      for (let i = 0; i < 12; i++) expect(await code(s.ask("player"))).toBe("LOREKEEPER_GM_ONLY");
      expect(await code(s.ask("grantee"))).toBe("LOREKEEPER_GM_ONLY");
      expect(await s.footprint()).toEqual(before);
      expect(fetchMock).not.toHaveBeenCalled();

      // Back to everyone: the player still has their whole burst, so the first ask goes through.
      await s.set({ key: "lorekeeperAsk", value: "everyone" });
      const { answerId } = await s.ask("player");
      expect((await s.finished(answerId))!.status).toBe("done");
    });

    it("GMs only: the GM and a co-GM still ask", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      await s.set({ key: "lorekeeperAsk", value: "gm" });
      const gm = await s.ask("gm");
      const coGm = await s.ask("coGm");
      expect((await s.finished(gm.answerId))!.status).toBe("done");
      expect((await s.finished(coGm.answerId))!.status).toBe("done");
    });

    it("GMs only: a player can't edit and re-ask an earlier question; the question stays as it was", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      const mine = await s.seedConversation("player", false);
      await s.set({ key: "lorekeeperAsk", value: "gm" });
      const before = await s.footprint();
      const edit = () => w.as("player").mutation(api.lorekeeper.editQuestion, { campaignId: s.campaignId, questionId: mine.questionId, question: "Edited?" });
      for (let i = 0; i < 11; i++) expect(await code(edit())).toBe("LOREKEEPER_GM_ONLY");
      expect((await s.answer(mine.questionId))!.text).toBe("Do two Hexes stack?");
      expect(await s.footprint()).toEqual(before);

      // A co-GM edits their own question.
      const theirs = await s.seedConversation("coGm", false);
      const { answerId } = await w.as("coGm").mutation(api.lorekeeper.editQuestion, { campaignId: s.campaignId, questionId: theirs.questionId, question: "Do Hexes stack?" });
      expect((await s.finished(answerId))!.status).toBe("done");
    });
  });

  describe("internet search", () => {
    it("access reports webAllowed for player, co-GM and GM", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      await s.set({ key: "lorekeeperWeb", value: false });
      for (const role of ["player", "coGm", "gm"] as const) {
        expect(await s.access(role)).toEqual({ available: true, canAsk: true, webAllowed: false });
      }
    });

    it("allowed (the default): a toggle-on question the books don't settle runs the internet pass", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      const { answerId, conversationId } = await s.ask("player", true);
      await s.finished(answerId);
      expect((await s.conversation(conversationId))!.webSearch).toBe(true);
      expect(bodies.some((b) => b.includes("web_search"))).toBe(true);
    });

    it("off: player, co-GM and GM questions store the toggle as false and never run the internet pass", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      await s.set({ key: "lorekeeperWeb", value: false });
      for (const role of ["player", "coGm", "gm"] as const) {
        const { answerId, conversationId } = await s.ask(role, true);
        const done = await s.finished(answerId);
        expect(done!.status).toBe("done");
        expect((await s.conversation(conversationId))!.webSearch).toBe(false);
        // Asking again in the same conversation keeps it off.
        const again = await w.as(role).mutation(api.lorekeeper.ask, { campaignId: s.campaignId, conversationId, question: "And with Hope?", webSearch: true });
        await s.finished(again.answerId);
        expect((await s.conversation(conversationId))!.webSearch).toBe(false);
      }
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.some((b) => b.includes("web_search"))).toBe(false);
    });

    it("off: setWebSearch stores false, and editQuestion turns a conversation's toggle off before it asks again", async () => {
      const w = await buildWorld();
      const s = helpers(w);
      const seeded = await s.seedConversation("player", true);
      await s.set({ key: "lorekeeperWeb", value: false });

      // The seeded conversation still has its toggle on: editing its question turns it off.
      expect((await s.conversation(seeded.conversationId))!.webSearch).toBe(true);
      const { answerId } = await w.as("player").mutation(api.lorekeeper.editQuestion, { campaignId: s.campaignId, questionId: seeded.questionId, question: "Do Hexes stack?" });
      expect((await s.conversation(seeded.conversationId))!.webSearch).toBe(false);
      await s.finished(answerId);
      expect(bodies.some((b) => b.includes("web_search"))).toBe(false);

      await w.as("player").mutation(api.lorekeeper.setWebSearch, { campaignId: s.campaignId, conversationId: seeded.conversationId, webSearch: true });
      expect((await s.conversation(seeded.conversationId))!.webSearch).toBe(false);

      // Back on: the toggle is the conversation's again.
      await s.set({ key: "lorekeeperWeb", value: true });
      await w.as("player").mutation(api.lorekeeper.setWebSearch, { campaignId: s.campaignId, conversationId: seeded.conversationId, webSearch: true });
      expect((await s.conversation(seeded.conversationId))!.webSearch).toBe(true);
    });
  });
});
