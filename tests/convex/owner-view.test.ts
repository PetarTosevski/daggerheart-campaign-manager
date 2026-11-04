import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { campaignAccess } from "../../convex/lib/permissions";
import { errorCode, key } from "./helpers";
import { buildWorld, type World } from "./authz/world";

/**
 * Config AD13 (plan `.omc/plans/config.yaml`, docs/tasks/TASK-CONFIG-AD13.md): the app owner's read-only view of any
 * campaign (Q27 b; N1 changed 2026-11-04: everything, players' private notes and private Lorekeeper chats included).
 * The world's `appOwner` is in no campaign. Every refusal asserts `ConvexError.data.code`.
 */

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", errorCode);

/** The player's private page (with an entry) and private Lorekeeper conversation (with a question and an answer). */
async function secrets(w: World) {
  const player = w.as("player");
  const { pageId } = await player.mutation(api.notesEntries.add, {
    campaignId: w.campaignId,
    page: { template: 1 },
    kind: "note",
    text: "the duke is my father",
  });
  await player.mutation(api.notes.renamePage, { campaignId: w.campaignId, page: pageId, title: "Secret page" });
  await player.mutation(api.notesSharing.setVisibility, { campaignId: w.campaignId, page: pageId, visibility: "private" });
  const journalId = await w.t.run(async (ctx) => (await ctx.db.get("journalPages", pageId))!.journalId);
  const conversationId = await w.t.run(async (ctx) => {
    const base = { campaignId: w.campaignId, userId: w.users.player, createdAt: 1 };
    const id = await ctx.db.insert("lorekeeperConversations", {
      ...base,
      title: "Can I betray the party?",
      visibility: "private",
      webSearch: false,
      messageCount: 2,
      lastAt: 1,
    });
    const message = { ...base, conversationId: id, updatedAt: 1 };
    await ctx.db.insert("lorekeeperMessages", { ...message, role: "question", status: "done", text: "Can I betray the party?" });
    await ctx.db.insert("lorekeeperMessages", { ...message, role: "answer", status: "done", text: "Talk to your GM." });
    return id;
  });
  return { pageId, journalId, conversationId };
}

describe("the owner's read-only view (config AD13)", { timeout: 60_000 }, () => {
  it("campaigns.get: the GM's view, never the creator, marked ownerView; members are not marked", async () => {
    const w = await buildWorld();
    const get = (role: "appOwner" | "gm" | "coGm" | "player" | "outsider") => w.as(role).query(api.campaigns.get, { campaignId: w.campaignId });
    expect(await get("appOwner")).toMatchObject({ role: "gm", isCreator: false, ownerView: true });
    expect(await get("gm")).toMatchObject({ role: "gm", isCreator: true, ownerView: false });
    expect(await get("coGm")).toMatchObject({ role: "gm", isCreator: false, ownerView: false });
    expect(await get("player")).toMatchObject({ role: "player", ownerView: false });
    expect(await get("outsider")).toBeNull();
  });

  it("reads what the GM reads: Fear, GM queries", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.fear.adjust, { campaignId: w.campaignId, direction: "increase", idempotencyKey: key() });
    const owner = w.as("appOwner");
    expect(await owner.query(api.campaigns.fear, { campaignId: w.campaignId })).toBe(1);
    // The outsider, the same stranger without the owner role, still gets nothing.
    expect(await codeOf(w.as("outsider").query(api.campaigns.fear, { campaignId: w.campaignId }))).toBe("NOT_FOUND");
  });

  it("reads players' private notes, which the GM does not", async () => {
    const w = await buildWorld();
    const { pageId, journalId } = await secrets(w);
    const view = (role: "appOwner" | "gm") => w.as(role).query(api.notesJournals.journalView, { campaignId: w.campaignId, journalId });
    expect((await view("appOwner")).pages.map((p) => p.title)).toContain("Secret page");
    expect((await view("gm")).pages.map((p) => p.title)).not.toContain("Secret page");

    const entries = await w.as("appOwner").query(api.notesEntries.entries, { campaignId: w.campaignId, page: pageId });
    expect(entries.entries.map((e) => e.text)).toEqual(["the duke is my father"]);
    expect(await codeOf(w.as("gm").query(api.notesEntries.entries, { campaignId: w.campaignId, page: pageId }))).toBe("NOTE_PAGE_NOT_FOUND");
    expect((await w.as("appOwner").query(api.notesJournals.playerJournals, { campaignId: w.campaignId })).length).toBeGreaterThan(0);
  });

  it("reads players' private Lorekeeper conversations, which the GM does not", async () => {
    const w = await buildWorld();
    const { conversationId } = await secrets(w);
    const owner = w.as("appOwner");
    expect(await owner.query(api.lorekeeper.getConversation, { campaignId: w.campaignId, conversationId })).toMatchObject({
      visibility: "private",
      mine: false,
    });
    const messages = await owner.query(api.lorekeeper.listMessages, {
      campaignId: w.campaignId,
      conversationId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(messages.page.map((m) => m.text).sort()).toEqual(["Can I betray the party?", "Talk to your GM."]);
    const listed = await owner.query(api.lorekeeper.listConversations, { campaignId: w.campaignId });
    expect(listed.shared.map((c) => c._id)).toContain(conversationId);

    const gm = w.as("gm");
    expect(await codeOf(gm.query(api.lorekeeper.getConversation, { campaignId: w.campaignId, conversationId }))).toBe("LOREKEEPER_NOT_FOUND");
    expect((await gm.query(api.lorekeeper.listConversations, { campaignId: w.campaignId })).shared.map((c) => c._id)).not.toContain(conversationId);
  });

  it("changes nothing: Fear, notes, a Lorekeeper question, character edits and opening are refused as an outsider's", async () => {
    const w = await buildWorld();
    const { pageId, conversationId } = await secrets(w);
    const owner = w.as("appOwner");
    const campaignId = w.campaignId;
    const refused = [
      owner.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }),
      owner.mutation(api.notesEntries.add, { campaignId, page: pageId, kind: "note", text: "owner was here" }),
      owner.mutation(api.notesSharing.setVisibility, { campaignId, page: pageId, visibility: "everyone" }),
      owner.mutation(api.lorekeeper.ask, { campaignId, question: "Hello?", webSearch: false }),
      owner.mutation(api.lorekeeper.removeConversation, { campaignId, conversationId }),
      owner.mutation(api.characters.adjustGold, { characterId: w.characterA, coin: "handfuls", delta: 1 }),
      owner.mutation(api.characters.setStatus, { characterId: w.characterA, status: "away" }),
      owner.mutation(api.campaigns.markOpened, { campaignId }),
    ];
    for (const call of refused) expect(await codeOf(call)).toBe("NOT_FOUND");
    // Nothing changed, and the owner never became a member (Last seen and member lists stay clean).
    expect(await w.as("gm").query(api.campaigns.fear, { campaignId })).toBe(0);
    const member = await w.t.run((ctx) =>
      ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", w.users.appOwner))
        .unique(),
    );
    expect(member).toBeNull();
  });

  it("a write that asks for the owner view anyway is refused (OWNER_VIEW_READ_ONLY); a query gets it only for the owner", async () => {
    const w = await buildWorld();
    const ask = (userId: Id<"users">) =>
      w.t.run(async (ctx) => {
        const user = (await ctx.db.get("users", userId))!;
        return campaignAccess(ctx, user, w.campaignId, "view", { ownerView: true });
      });
    expect(await codeOf(ask(w.users.appOwner))).toBe("OWNER_VIEW_READ_ONLY");
    // A stranger asking for the option gets the outsider's answer (null), even in a write.
    expect(await ask(w.users.outsider)).toBeNull();
    // Without the option the owner is an outsider.
    expect(
      await w.t.run(async (ctx) => campaignAccess(ctx, (await ctx.db.get("users", w.users.appOwner))!, w.campaignId, "view")),
    ).toBeNull();
  });

  it("a member owner reads as their role, not the owner view", async () => {
    const w = await buildWorld();
    await w.as("appOwner").mutation(api.members.joinByCode, { code: w.joinCode });
    expect(await w.as("appOwner").query(api.campaigns.get, { campaignId: w.campaignId })).toMatchObject({ role: "player", ownerView: false });
    const { conversationId } = await secrets(w);
    expect(await codeOf(w.as("appOwner").query(api.lorekeeper.getConversation, { campaignId: w.campaignId, conversationId }))).toBe(
      "LOREKEEPER_NOT_FOUND",
    );
  });
});

describe("appAdmin.openCampaign logs each visit once a day (config AD13)", { timeout: 60_000 }, () => {
  const views = (w: World) =>
    w.t.run(async (ctx) =>
      (await ctx.db.query("adminAudit").withIndex("by_at").take(100)).filter((row) => row.action === "campaign.view"),
    );

  it("writes one campaign.view row per campaign per day, by the owner, naming the campaign", async () => {
    const w = await buildWorld();
    const owner = w.as("appOwner");
    expect(await owner.mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId })).toEqual({ logged: true });
    expect(await owner.mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId })).toEqual({ logged: false });
    const rows = await views(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: w.users.appOwner, target: w.campaignId });

    const { campaignId: other } = await w.as("outsider").mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await owner.mutation(api.appAdmin.openCampaign, { campaignId: other })).toEqual({ logged: true });
    expect(await views(w)).toHaveLength(2);
  });

  it("logs again the next day", async () => {
    const w = await buildWorld();
    await w.as("appOwner").mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId });
    // Move yesterday's row back a day.
    await w.t.run(async (ctx) => {
      for (const row of await ctx.db.query("adminAudit").withIndex("by_at").take(100)) {
        if (row.action === "campaign.view") await ctx.db.patch("adminAudit", row._id, { at: row.at - 24 * 60 * 60 * 1000 });
      }
    });
    expect(await w.as("appOwner").mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId })).toEqual({ logged: true });
  });

  it("refuses everyone but the owner, and a deleted campaign", async () => {
    const w = await buildWorld();
    for (const role of ["gm", "coGm", "player", "outsider"] as const) {
      expect(await codeOf(w.as(role).mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId }))).toBe("FORBIDDEN");
    }
    expect(await codeOf(w.as("anon").mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId }))).toBe("UNAUTHENTICATED");
    await w.as("gm").mutation(api.campaigns.remove, { campaignId: w.campaignId });
    expect(await codeOf(w.as("appOwner").mutation(api.appAdmin.openCampaign, { campaignId: w.campaignId }))).toBe("NOT_FOUND");
    expect(await views(w)).toHaveLength(0);
  });
});
