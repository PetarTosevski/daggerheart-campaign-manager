import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,out@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Feed", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  return { t, ids, gm, p1, out, campaignId, a };
}

const page = { numItems: 20, cursor: null };
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

type Caller = Pick<ReturnType<typeof makeTest>, "mutation" | "query">;

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("feed.list", () => {
  useAllowlist(EMAILS);

  it("anonymous, outsider, player and GM", async () => {
    const { t, gm, p1, out, campaignId } = await setup();
    const list = (who: Caller) => who.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(await codeOf(list(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(list(out))).toBe("NOT_FOUND");
    expect(await codeOf(list(p1))).toBe("ok");
    expect(await codeOf(list(gm))).toBe("ok");
  });

  it("player rolls are public; a GM free roll reaches a player only once revealed", async () => {
    const { gm, p1, campaignId, a } = await setup();
    await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    const secret = await gm.mutation(api.rolls.gmRoll, { campaignId, dice: [{ count: 1, sides: 20 }], modifier: 3, label: "Ambush", idempotencyKey: key() });

    const playerView = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(playerView.page.map((r) => r.kind)).toEqual(["roll"]);
    expect(playerView.page.every((r) => r.visibility === "public")).toBe(true);
    expect(playerView.page[0]).not.toHaveProperty("before");
    expect(playerView.page[0]?.canUndo).toBe(true);

    const gmView = await gm.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(gmView.page.map((r) => r.kind)).toEqual(["gmRoll", "roll"]);
    expect(gmView.page[0]).toMatchObject({ visibility: "gm", revealable: true, canUndo: true });

    await gm.mutation(api.rolls.reveal, { campaignId, entryId: secret.entryId });
    const after = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(after.page.map((r) => r.kind)).toEqual(["gmRoll", "roll"]);
    expect(after.page[0]?.canUndo).toBe(false); // the player isn't its actor
  });

  it("a player's direct API call never returns a hidden row, page after page", async () => {
    const { gm, p1, campaignId } = await setup();
    for (let i = 0; i < 5; i++) await gm.mutation(api.rolls.gmRoll, { campaignId, dice: [{ count: 1, sides: 6 }], modifier: 0, idempotencyKey: key() });
    let cursor: string | null = null;
    const seen: string[] = [];
    for (;;) {
      const result: { page: { visibility: string }[]; isDone: boolean; continueCursor: string } = await p1.query(api.feed.list, {
        campaignId,
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((r) => r.visibility));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual([]);
  });

  it("marks undone rows and drops their undo button", async () => {
    const { p1, campaignId, a } = await setup();
    const { entryId } = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    await p1.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
    const { page: rows } = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(rows[0]).toMatchObject({ undone: true, canUndo: false });
  });

  it("passes an adversary row's target token ids: the GM gets every one, a player only the PC tokens (H3)", async () => {
    const { t, ids, gm, p1, campaignId, a } = await setup();
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    const { pcToken, advToken } = await t.run(async (ctx) => {
      const now = Date.now();
      const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 1, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const instance = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [], face: 0 };
      const pcToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: a }, side: "pc", x: 1, y: 1 });
      const advToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: instance }, side: "enemy", x: 2, y: 1 });
      await ctx.db.insert("actionLog", {
        campaignId,
        actorId: ids.gm,
        kind: "adversary",
        visibility: "public",
        summary: "Bear used Roar on Ash, Bear",
        targets: [
          { tokenId: pcToken, side: "pc", tone: "effect" },
          { tokenId: advToken, side: "adversary", tone: "effect" },
        ],
        undoable: true,
        at: now,
      });
      return { pcToken, advToken };
    });
    const gmRow = (await gm.query(api.feed.list, { campaignId, paginationOpts: page })).page[0]!;
    expect(gmRow.targets).toEqual([
      { tokenId: pcToken, side: "pc", tone: "effect" },
      { tokenId: advToken, side: "adversary", tone: "effect" },
    ]);
    const playerRow = (await p1.query(api.feed.list, { campaignId, paginationOpts: page })).page[0]!;
    expect(playerRow.targets).toEqual([{ tokenId: pcToken, side: "pc", tone: "effect" }]);
  });

  it("rows without targets read back without the field", async () => {
    const { p1, campaignId, a } = await setup();
    await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    const { page: rows } = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(rows[0]).not.toHaveProperty("targets");
  });
});

describe("feed.remove and feed.clear", () => {
  useAllowlist(EMAILS);

  it("anonymous, outsider, player and GM", async () => {
    const { t, gm, p1, out, campaignId, a } = await setup();
    const { entryId } = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    for (const [who, code] of [[t, "UNAUTHENTICATED"], [out, "NOT_FOUND"], [p1, "FORBIDDEN"]] as const) {
      expect(await codeOf(who.mutation(api.feed.remove, { campaignId, entryId }))).toBe(code);
      expect(await codeOf(who.mutation(api.feed.clear, { campaignId }))).toBe(code);
    }
    expect(await codeOf(gm.mutation(api.feed.remove, { campaignId, entryId }))).toBe("ok");
    expect(await codeOf(gm.mutation(api.feed.clear, { campaignId }))).toBe("ok");
  });

  it("the GM deletes one row for everyone; the action itself stays (its undo still works)", async () => {
    const { gm, p1, campaignId, a } = await setup();
    const first = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    await gm.mutation(api.feed.remove, { campaignId, entryId: first.entryId });
    for (const who of [gm, p1]) {
      const { page: rows } = await who.query(api.feed.list, { campaignId, paginationOpts: page });
      expect(rows.map((r) => r._id)).not.toContain(first.entryId);
      expect(rows).toHaveLength(1);
    }
  });

  it("a row of another campaign is NOT_FOUND", async () => {
    const one = await setup();
    const { entryId } = await one.p1.mutation(api.rolls.actionRoll, { characterId: one.a, ...agility, idempotencyKey: key() });
    const { campaignId: other } = await one.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await codeOf(one.gm.mutation(api.feed.remove, { campaignId: other, entryId }))).toBe("NOT_FOUND");
  });

  it("clearing hides every earlier row for everyone; later rows show", async () => {
    const { gm, p1, campaignId, a } = await setup();
    await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    await gm.mutation(api.feed.clear, { campaignId });
    expect((await p1.query(api.feed.list, { campaignId, paginationOpts: page })).page).toEqual([]);
    expect((await gm.query(api.feed.list, { campaignId, paginationOpts: page })).page).toEqual([]);
    await new Promise((r) => setTimeout(r, 2));
    await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    expect((await p1.query(api.feed.list, { campaignId, paginationOpts: page })).page).toHaveLength(1);
  });
});
