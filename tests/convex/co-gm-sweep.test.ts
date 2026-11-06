import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { characterDraft } from "../fixtures/characters";
import { allowWorldEmails, buildWorld, type Role, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

/**
 * Config G2 (plan `.omc/plans/config.yaml`, docs/tasks/TASK-CONFIG-G2.md, bead dcm-jh6d.10): every role-style "is the
 * caller the GM" check treats a co-GM as the GM (Q6 a: Notes too), while identity uses (the GM journal is the
 * creator's) stay. The world's `coGm` is a promoted member with no character; `grantee` is a member player with an
 * edit grant; a fresh grant-only account and the outsider must never be treated as a GM. Asserts
 * `ConvexError.data.code` only.
 */

const fail = (p: Promise<unknown>) => p.then(() => "ok", errorCode);

/** The player writes on their first default page (visibility 'gm': the GM can read). */
async function gmOnlyPage(w: World): Promise<Id<"journalPages">> {
  const { pageId } = await w.as("player").mutation(api.notesEntries.add, { campaignId: w.campaignId, page: { template: 0 }, kind: "note", text: "for the GM" });
  return pageId;
}

/** A verified account with an edit grant on the campaign and no membership. */
async function grantOnly(w: World) {
  const id = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "grant-only@example.com", emailVerificationTime: 1 });
    await ctx.db.insert("grants", {
      resourceType: "campaign",
      resourceId: w.campaignId,
      principalKind: "user",
      principalId: userId,
      permission: "edit",
      createdBy: w.users.gm,
      createdAt: Date.now(),
    });
    return userId;
  });
  return w.t.withIdentity({ subject: `${id}|session` });
}

async function journalOf(w: World, userId: Id<"users">) {
  return w.t.run((ctx) =>
    ctx.db
      .query("journals")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", w.campaignId).eq("userId", userId))
      .first(),
  );
}

describe("co-GM sweep (config G2)", () => {
  allowWorldEmails();

  it("a co-GM reads a player's GM-only page like the GM; another player, a member grantee, a grant-only user and an outsider can't", async () => {
    const w = await buildWorld();
    const pageId = await gmOnlyPage(w);
    const entries = (c: { query: World["t"]["query"] }) => fail(c.query(api.notesEntries.entries, { campaignId: w.campaignId, page: pageId }));
    expect(await entries(w.as("gm"))).toBe("ok");
    expect(await entries(w.as("coGm"))).toBe("ok");
    expect(await entries(w.as("otherPlayer"))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await entries(w.as("grantee"))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await entries(await grantOnly(w))).toBe("NOTE_PAGE_NOT_FOUND"); // no role: journalPagePermission answers null
    expect(await entries(w.as("outsider"))).toBe("NOT_FOUND");
    expect(await entries(w.as("anon"))).toBe("UNAUTHENTICATED");
  });

  it("journalView, playerJournals and the Players tab: a co-GM gets the GM's view, a player doesn't", async () => {
    const w = await buildWorld();
    const pageId = await gmOnlyPage(w);
    const journal = (await journalOf(w, w.users.player))!;
    const view = (role: Role) => w.as(role).query(api.notesJournals.journalView, { campaignId: w.campaignId, journalId: journal._id });
    expect((await view("coGm")).pages.map((p) => p._id)).toContain(pageId);
    expect((await view("gm")).pages.map((p) => p._id)).toContain(pageId);
    expect(await fail(view("otherPlayer"))).toBe("NOT_FOUND");
    expect(await fail(view("grantee"))).toBe("NOT_FOUND");
    expect(await fail((await grantOnly(w)).query(api.notesJournals.journalView, { campaignId: w.campaignId, journalId: journal._id }))).toBe("NOT_FOUND");

    const listed = async (role: Role) => (await w.as(role).query(api.notesJournals.playerJournals, { campaignId: w.campaignId })).map((r) => r.journalId);
    expect(await listed("coGm")).toContain(journal._id);
    expect(await listed("player")).toEqual([]);
    expect(await listed("grantee")).toEqual([]);

    const tab = async (role: Role) => (await w.as(role).query(api.notesSharing.shared, { campaignId: w.campaignId, tab: "players" })).map((r) => r.pageId);
    expect(await tab("coGm")).toContain(pageId);
    expect(await tab("otherPlayer")).not.toContain(pageId);
  });

  it("a co-GM's own journal is a member journal: not the GM journal, not in their own Players' journals list", async () => {
    const w = await buildWorld();
    const { pageId } = await w.as("coGm").mutation(api.notesEntries.add, { campaignId: w.campaignId, page: { template: 0 }, kind: "note", text: "co-GM" });
    const page = await w.t.run((ctx) => ctx.db.get("journalPages", pageId));
    expect(page).toMatchObject({ ownerId: w.users.coGm, visibility: "gm" });
    const own = (await journalOf(w, w.users.coGm))!;
    const view = await w.as("gm").query(api.notesJournals.journalView, { campaignId: w.campaignId, journalId: own._id });
    expect(view.ownerIsGm).toBe(false);
    // The creator reads it (visibility 'gm'); a player does not.
    expect(await fail(w.as("gm").query(api.notesEntries.entries, { campaignId: w.campaignId, page: pageId }))).toBe("ok");
    expect(await fail(w.as("player").query(api.notesEntries.entries, { campaignId: w.campaignId, page: pageId }))).toBe("NOTE_PAGE_NOT_FOUND");
    const listed = (await w.as("coGm").query(api.notesJournals.playerJournals, { campaignId: w.campaignId })).map((r) => r.journalId);
    expect(listed).not.toContain(own._id);
    // GM-template-only values stay the creator's: 'players' is a member value and allowed on a co-GM page.
    await w.as("coGm").mutation(api.notesSharing.setVisibility, { campaignId: w.campaignId, page: pageId, visibility: "players" });
  });

  it("a co-GM tears out a departed player's page and restores it, like the GM", async () => {
    const w = await buildWorld();
    const { pageId } = await w.as("player").mutation(api.notesEntries.add, { campaignId: w.campaignId, page: { template: 0 }, kind: "note", text: "bye" });
    await w.as("player").mutation(api.notesSharing.setVisibility, { campaignId: w.campaignId, page: pageId, visibility: "everyone" });
    await w.as("gm").mutation(api.members.removePlayer, { campaignId: w.campaignId, userId: w.users.player });
    expect(await fail(w.as("otherPlayer").mutation(api.notesBin.binPage, { campaignId: w.campaignId, page: pageId }))).toBe("NOTE_FORBIDDEN_ACTION");
    await w.as("coGm").mutation(api.notesBin.binPage, { campaignId: w.campaignId, page: pageId });
    await w.as("coGm").mutation(api.notesBin.restorePage, { campaignId: w.campaignId, page: pageId });
    expect((await w.t.run((ctx) => ctx.db.get("journalPages", pageId)))?.binnedAt).toBeUndefined();
  });

  it("a co-GM edits any character sheet; another player can't", async () => {
    const w = await buildWorld();
    await w.as("coGm").mutation(api.characters.updateSheet, { characterId: w.characterA, patch: { notes: "by the co-GM" } });
    const sheet = readSheet((await w.t.run((ctx) => ctx.db.get("characters", w.characterA)))!.sheet);
    expect(sheet.notes).toBe("by the co-GM");
    expect(await fail(w.as("otherPlayer").mutation(api.characters.updateSheet, { characterId: w.characterA, patch: { notes: "no" } }))).toBe("FORBIDDEN");
  });

  it("a co-GM approves a combat request; a player can't", async () => {
    const w = await buildWorld();
    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: key() });
    const now = Date.now();
    const archerToken = await w.t.run(async (ctx) => {
      const campaignId = w.campaignId;
      const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
      await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
      const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const archer = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Archer",
        order: 0,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 1 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: archer }, side: "enemy", x: 8, y: 10, face: Math.PI });
    });
    const attack = () =>
      w.as("player").mutation(api.combatActions.attack, {
        campaignId: w.campaignId,
        characterId: w.characterA,
        mapId,
        targetTokenIds: [archerToken],
        slot: "primary" as const,
        modifier: 0,
        experienceIds: [],
        advantage: 0,
        disadvantage: 0,
        help: 0,
        options: [],
        idempotencyKey: key(),
      });
    const r = await attack();
    if (r.status !== "pending") throw new Error("expected a pending attack");
    const sanction = (role: Role) => w.as(role).mutation(api.combatRequests.sanction, { campaignId: w.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() });
    expect(await fail(sanction("player"))).toBe("FORBIDDEN");
    expect(await fail(sanction("grantee"))).toBe("FORBIDDEN");
    expect(await fail(sanction("coGm"))).toBe("ok");
    expect((await w.t.run((ctx) => ctx.db.get("combatRequests", r.requestId)))?.status).not.toBe("open");
  });

  it("one active character per player: a co-GM's own characters are exempt like the GM's, a player's aren't", async () => {
    const w = await buildWorld();
    const create = (role: Role, name: string) => w.as(role).mutation(api.characters.create, { campaignId: w.campaignId, draft: characterDraft(name), idempotencyKey: key() });
    await create("coGm", "Npc one");
    expect(await fail(create("coGm", "Npc two"))).toBe("ok");
    expect(await fail(create("player", "Second"))).toBe("INVALID");
  });
});
