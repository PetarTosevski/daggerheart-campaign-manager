import { describe, expect, test } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MessageStatus } from "../../convex/lib/validators/lorekeeper";
import { errorCode, key } from "./helpers";
import { allowWorldEmails, buildWorld, type Role, type World } from "./authz/world";

/**
 * D13 L4: table rulings (Q14, GM only) and 'Ask the GM' (Q8). Role tables live in
 * tests/convex/authz/lorekeeper-rulings.entries.ts; this file covers behaviour and codes.
 */

allowWorldEmails();

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** A conversation of `who` with one question and its answer. */
async function answerOf(
  w: World,
  who: Exclude<Role, "anon">,
  opts: { question?: string; status?: MessageStatus; verdict?: "rules" | "unclear" | "none"; call?: string } = {},
): Promise<{ conversationId: Id<"lorekeeperConversations">; questionId: Id<"lorekeeperMessages">; answerId: Id<"lorekeeperMessages"> }> {
  return w.t.run(async (ctx) => {
    const userId = w.users[who];
    const conversationId = await ctx.db.insert("lorekeeperConversations", {
      campaignId: w.campaignId,
      userId,
      title: "q",
      visibility: "campaign",
      webSearch: true,
      messageCount: 2,
      lastAt: 1,
      createdAt: 1,
    });
    const base = { conversationId, campaignId: w.campaignId, userId, createdAt: 1, updatedAt: 1 };
    const questionId = await ctx.db.insert("lorekeeperMessages", {
      ...base,
      role: "question",
      status: "done",
      text: opts.question ?? "Can I flank with a Hex?",
    });
    const answerId = await ctx.db.insert("lorekeeperMessages", {
      ...base,
      role: "answer",
      status: opts.status ?? "done",
      text: "The books don't say.",
      parts: { verdict: opts.verdict ?? "unclear", quotes: [], ...(opts.call ? { call: opts.call } : {}) },
    });
    return { conversationId, questionId, answerId };
  });
}

async function otherCampaign(w: World) {
  return (await w.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() })).campaignId;
}

describe("rulings", () => {
  test("the GM pins, members list newest first with the session line, the GM edits and unpins", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    const { sessionId, n } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
    const first = await gm.mutation(api.lorekeeperRulings.pin, { campaignId, title: "  Flanking ", text: " Advantage on both sides. " });
    const second = await gm.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Falling", text: "1d10 per 10 ft.", sessionId });

    for (const who of ["player", "otherPlayer", "gm"] as const) {
      const list = await w.as(who).query(api.lorekeeperRulings.list, { campaignId });
      expect(list.map((r) => [r._id, r.title, r.text, r.meta])).toEqual([
        [second, "Falling", "1d10 per 10 ft.", `Pinned by the GM · Session ${n}`],
        [first, "Flanking", "Advantage on both sides.", "Pinned by the GM"],
      ]);
    }

    await gm.mutation(api.lorekeeperRulings.update, { campaignId, rulingId: first, text: "Advantage when allies flank." });
    await gm.mutation(api.lorekeeperRulings.update, { campaignId, rulingId: first, title: "Flank" });
    const updated = (await gm.query(api.lorekeeperRulings.list, { campaignId })).find((r) => r._id === first)!;
    expect([updated.title, updated.text]).toEqual(["Flank", "Advantage when allies flank."]);

    await gm.mutation(api.lorekeeperRulings.unpin, { campaignId, rulingId: first });
    expect((await gm.query(api.lorekeeperRulings.list, { campaignId })).map((r) => r._id)).toEqual([second]);
    expect(await code(gm.mutation(api.lorekeeperRulings.unpin, { campaignId, rulingId: first }))).toBe("LOREKEEPER_RULING_NOT_FOUND");
    expect(await code(gm.mutation(api.lorekeeperRulings.update, { campaignId, rulingId: first, title: "x" }))).toBe("LOREKEEPER_RULING_NOT_FOUND");
  });

  test("title 1-80 and text 1-600 characters, else INVALID", async () => {
    const w = await buildWorld();
    const pin = (title: string, text: string) => w.as("gm").mutation(api.lorekeeperRulings.pin, { campaignId: w.campaignId, title, text });
    expect(await code(pin("   ", "x"))).toBe("INVALID");
    expect(await code(pin("t", " "))).toBe("INVALID");
    expect(await code(pin("t".repeat(81), "x"))).toBe("INVALID");
    expect(await code(pin("t", "x".repeat(601)))).toBe("INVALID");
    expect(await code(pin("t".repeat(80), "x".repeat(600)))).toBe("ok");
    const rulingId = (await w.as("gm").query(api.lorekeeperRulings.list, { campaignId: w.campaignId }))[0]!._id;
    expect(await code(w.as("gm").mutation(api.lorekeeperRulings.update, { campaignId: w.campaignId, rulingId, text: "" }))).toBe("INVALID");
  });

  test("50 rulings per campaign: the 51st is LOREKEEPER_RULING_LIMIT", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 49; i++) {
        await ctx.db.insert("lorekeeperRulings", { campaignId: w.campaignId, title: `R${i}`, text: "t", pinnedBy: w.users.gm, pinnedAt: i, updatedAt: i });
      }
    });
    const pin = () => w.as("gm").mutation(api.lorekeeperRulings.pin, { campaignId: w.campaignId, title: "t", text: "x" });
    expect(await code(pin())).toBe("ok");
    expect(await code(pin())).toBe("LOREKEEPER_RULING_LIMIT");
  });

  test("another campaign's ruling or session is not found", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const other = await otherCampaign(w);
    const foreign = await gm.mutation(api.lorekeeperRulings.pin, { campaignId: other, title: "t", text: "x" });
    const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId: other, idempotencyKey: key() });
    expect(await code(gm.mutation(api.lorekeeperRulings.unpin, { campaignId: w.campaignId, rulingId: foreign }))).toBe("LOREKEEPER_RULING_NOT_FOUND");
    expect(await code(gm.mutation(api.lorekeeperRulings.pin, { campaignId: w.campaignId, title: "t", text: "x", sessionId }))).toBe("NOT_FOUND");
  });

  test("pinned from the GM's own answer or an answer sent to the GM; any other message is LOREKEEPER_NOT_FOUND", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    const pin = (fromMessageId: Id<"lorekeeperMessages">) => gm.mutation(api.lorekeeperRulings.pin, { campaignId, title: "t", text: "x", fromMessageId });
    const own = await answerOf(w, "gm");
    const players = await answerOf(w, "player");
    expect(await code(pin(own.answerId))).toBe("ok");
    expect(await code(pin(own.questionId))).toBe("LOREKEEPER_NOT_FOUND");
    expect(await code(pin(players.answerId))).toBe("LOREKEEPER_NOT_FOUND");
    await w.as("player").mutation(api.lorekeeperAsks.send, { campaignId, messageId: players.answerId });
    expect(await code(pin(players.answerId))).toBe("ok");
    const list = await gm.query(api.lorekeeperRulings.list, { campaignId });
    expect(list.map((r) => r.fromMessageId).sort()).toEqual([own.answerId, players.answerId].sort());
  });
});

describe("Ask the GM", () => {
  test("a player sends their own finished answer; the GM sees who asked, the question and the verdict", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const { answerId, conversationId } = await answerOf(w, "player", { question: "Does a Hex stack?", call: "Let them stack once." });
    const askId = await w.as("player").mutation(api.lorekeeperAsks.send, { campaignId, messageId: answerId });

    expect(await w.as("gm").query(api.lorekeeperAsks.listOpen, { campaignId })).toEqual([
      {
        _id: askId,
        messageId: answerId,
        conversationId,
        askedAt: expect.any(Number),
        askerName: "player-a",
        characterName: "Ash",
        question: "Does a Hex stack?",
        verdict: "unclear",
        call: "Let them stack once.",
      },
    ]);
    expect(await w.as("player").query(api.lorekeeperAsks.mine, { campaignId })).toEqual([{ _id: askId, messageId: answerId, askedAt: expect.any(Number) }]);
    // A player never reads other players' asks.
    expect(await w.as("otherPlayer").query(api.lorekeeperAsks.mine, { campaignId })).toEqual([]);
    expect(await code(w.as("otherPlayer").query(api.lorekeeperAsks.listOpen, { campaignId }))).toBe("FORBIDDEN");
  });

  test("only the caller's own finished answer, once while open", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const send = (who: "player" | "otherPlayer", messageId: Id<"lorekeeperMessages">) =>
      w.as(who).mutation(api.lorekeeperAsks.send, { campaignId, messageId });
    const mine = await answerOf(w, "player");
    const streaming = await answerOf(w, "player", { status: "streaming" });
    expect(await code(send("otherPlayer", mine.answerId))).toBe("LOREKEEPER_NOT_FOUND");
    expect(await code(send("player", mine.questionId))).toBe("LOREKEEPER_NOT_FOUND");
    expect(await code(send("player", streaming.answerId))).toBe("INVALID");
    expect(await code(send("player", mine.answerId))).toBe("ok");
    expect(await code(send("player", mine.answerId))).toBe("LOREKEEPER_ASK_EXISTS");

    // Another campaign's answer is not found from this one.
    const other = await otherCampaign(w);
    expect(await code(w.as("gm").mutation(api.lorekeeperAsks.send, { campaignId: other, messageId: mine.answerId }))).toBe("LOREKEEPER_NOT_FOUND");
  });

  test("the GM resolves with a ruling or dismisses; a resolved ask is gone and the answer can be sent again", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    const a = await answerOf(w, "player");
    const b = await answerOf(w, "otherPlayer");
    const askA = await w.as("player").mutation(api.lorekeeperAsks.send, { campaignId, messageId: a.answerId });
    const askB = await w.as("otherPlayer").mutation(api.lorekeeperAsks.send, { campaignId, messageId: b.answerId });

    const rulingId = await gm.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Hex", text: "Once.", fromMessageId: a.answerId });
    const foreign = await gm.mutation(api.lorekeeperRulings.pin, { campaignId: await otherCampaign(w), title: "t", text: "x" });
    expect(await code(gm.mutation(api.lorekeeperAsks.resolve, { campaignId, askId: askA, rulingId: foreign }))).toBe("LOREKEEPER_RULING_NOT_FOUND");
    await gm.mutation(api.lorekeeperAsks.resolve, { campaignId, askId: askA, rulingId });
    await gm.mutation(api.lorekeeperAsks.resolve, { campaignId, askId: askB });

    const rows = await w.t.run(async (ctx) => [await ctx.db.get("lorekeeperAsks", askA), await ctx.db.get("lorekeeperAsks", askB)]);
    expect(rows.map((r) => [r!.resolution, r!.rulingId, typeof r!.resolvedAt])).toEqual([
      ["pinned", rulingId, "number"],
      ["dismissed", undefined, "number"],
    ]);
    expect(await gm.query(api.lorekeeperAsks.listOpen, { campaignId })).toEqual([]);
    expect(await w.as("player").query(api.lorekeeperAsks.mine, { campaignId })).toEqual([]);
    expect(await code(gm.mutation(api.lorekeeperAsks.resolve, { campaignId, askId: askB }))).toBe("LOREKEEPER_ASK_NOT_FOUND");
    expect(await code(w.as("otherPlayer").mutation(api.lorekeeperAsks.send, { campaignId, messageId: b.answerId }))).toBe("ok");
  });

  test("an ask whose answer was deleted leaves the GM's list", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const a = await answerOf(w, "player");
    await w.as("player").mutation(api.lorekeeperAsks.send, { campaignId, messageId: a.answerId });
    await w.t.run((ctx) => ctx.db.delete("lorekeeperMessages", a.answerId));
    expect(await w.as("gm").query(api.lorekeeperAsks.listOpen, { campaignId })).toEqual([]);
  });
});
