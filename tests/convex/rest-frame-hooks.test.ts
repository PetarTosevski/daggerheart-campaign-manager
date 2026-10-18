import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { readMap } from "../../convex/lib/maps";
import { readTracker } from "../../convex/lib/trackers";
import { CORRUPTION_TRACKER_KEY, corruptionStateSchema, enduranceOwnerKey, lycanthropyOwnerKey } from "../../src/lib/domain/rest/frame-hooks/index";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { hexToPixel } from "../../src/lib/world/hex";
import { initialHexCrawl, WORLD_MAPS } from "../../src/lib/world/map-state";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

/** Every server die comes up `face` (a d4 shows ((face - 1) mod 4) + 1). */
function forceDice(face: number) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);
}

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

/** A campaign of `frameId` with a GM and two players who each own a character. */
async function setup(frameId: PublishedFrameId) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  // Motherboard characters carry an Ikonis instead of weapons (CB 295).
  const withIkonis = (d: ReturnType<typeof draft>) =>
    frameId === "motherboard"
      ? { draft: { ...d, primaryWeaponId: "", secondaryWeaponId: undefined }, ikonis: { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const } }
      : { draft: d };
  const a = (await p1.mutation(api.characters.create, { campaignId, ...withIkonis(draft("Ash")), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, ...withIkonis(draft("Bryn")), idempotencyKey: key() })).characterId;

  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const start = (kind: "short" | "long", override?: boolean) => gm.mutation(api.rests.start, { campaignId, kind, override, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const interrupt = (restId: Id<"rests">) => gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() });
  const undo = (restId: Id<"rests">) => gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
  const rest = async (kind: "short" | "long") => finish((await start(kind)).restId);
  const setOption = (option: string, enabled: boolean) => gm.mutation(api.campaigns.setOption, { campaignId, option, enabled });
  const campaignRow = async () => {
    const rows = await t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
    return rows.filter((r) => r.characterId === undefined).at(-1);
  };
  return { t, gm, p1, p2, campaignId, a, b, sheetOf, edit, fear, start, finish, interrupt, undo, rest, setOption, campaignRow };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("frame rest hooks", () => {
  useAllowlist(EMAILS);
  afterEach(() => vi.restoreAllMocks());

  describe("Colossus of the Drylands (CB 327)", () => {
    it("a hunt-phase rest marks the Siphoning Track: short +1, long +2, an interrupted long rest +1", async () => {
      const { gm, campaignId, rest, start, interrupt } = await setup("colossus-of-the-drylands");
      const marked = async () => (await gm.query(api.trackers.colossus.get, { campaignId })).gm?.siphonMarked;
      await rest("short");
      expect(await marked()).toBe(2);
      await rest("long");
      expect(await marked()).toBe(4);
      await interrupt((await start("long")).restId);
      expect(await marked()).toBe(5);
    });

    it("an interlude rest marks nothing; the track stays out of the public feed and rest undo leaves it", async () => {
      const { gm, campaignId, rest, start, finish, undo, campaignRow } = await setup("colossus-of-the-drylands");
      const { restId } = await start("long");
      await finish(restId);
      expect((await campaignRow())?.summary).not.toMatch(/Siphon/);
      await undo(restId);
      expect((await gm.query(api.trackers.colossus.get, { campaignId })).gm?.siphonMarked).toBe(3);
      await gm.mutation(api.trackers.colossus.setPhase, { campaignId, phase: "interlude", idempotencyKey: key() });
      await finish(restId);
      await rest("short");
      expect((await gm.query(api.trackers.colossus.get, { campaignId })).gm?.siphonMarked).toBe(3);
    });

    it("is off outside the frame", async () => {
      const { t, campaignId, rest } = await setup("witherwild");
      await rest("long");
      expect(await t.run((ctx) => ctx.db.query("frameTrackers").withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId)).collect())).toEqual([]);
    });
  });

  describe("The Age of Umbra (CB 289)", () => {
    it("away from a pyre the Lurking Darkness is rolled: a 12 gives each PC a Hope, undone with the rest", async () => {
      const { gm, campaignId, a, b, sheetOf, edit, start, finish, undo, campaignRow } = await setup("age-of-umbra");
      await edit(a, (s) => ({ ...s, hope: 0 }));
      await edit(b, (s) => ({ ...s, hope: 0 }));
      const { restId } = await start("short");
      forceDice(12);
      await finish(restId);
      const view = await gm.query(api.trackers.ageOfUmbra.get, { campaignId });
      expect(view.gm?.log).toEqual([expect.objectContaining({ gmRoll: 12, watchRoll: null, result: 12, outcome: "hope", fearGained: 0 })]);
      expect((await sheetOf(a)).hope).toBe(1);
      expect((await sheetOf(b)).hope).toBe(1);
      expect((await campaignRow())?.summary).toMatch(/hopeful omen/);
      vi.restoreAllMocks();
      await undo(restId);
      expect((await sheetOf(a)).hope).toBe(0);
      // The tracker log keeps its roll (plan note 11).
      expect((await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).gm?.log).toHaveLength(1);
    });

    it("a 3–5 gives the GM 2 Fear on top of the rest's Fear", async () => {
      const { gm, campaignId, start, finish, fear } = await setup("age-of-umbra");
      const { restId } = await start("short");
      // d12 shows 3 → "You gain 2 Fear"; the rest's 1d4 shows 3.
      forceDice(3);
      const { fearGained } = await finish(restId);
      expect(fearGained).toBe(3);
      expect(await fear()).toBe(5);
      expect((await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).gm?.log[0]).toMatchObject({ outcome: "fear2", fearGained: 2 });
    });

    it("at a Sacred Pyre nothing is rolled; outside the frame neither", async () => {
      const umbra = await setup("age-of-umbra");
      await umbra.gm.mutation(api.trackers.ageOfUmbra.setAtPyre, { campaignId: umbra.campaignId, atPyre: true, idempotencyKey: key() });
      await umbra.rest("long");
      expect((await umbra.gm.query(api.trackers.ageOfUmbra.get, { campaignId: umbra.campaignId })).gm?.log).toEqual([]);

      const core = await setup("witherwild");
      await core.edit(core.a, (s) => ({ ...s, hope: 0 }));
      const { restId } = await core.start("short");
      forceDice(12);
      await core.finish(restId);
      expect((await core.sheetOf(core.a)).hope).toBe(0);
    });
  });

  describe("Journey to Horizon (HF 176)", () => {
    /** Puts the party on hex (10, 10) and, optionally, a sanctuary marker in the same hex. */
    async function placeParty(ctx: Awaited<ReturnType<typeof setup>>, withSanctuary: boolean) {
      const { gm, campaignId } = ctx;
      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 10, r: 10 });
      if (!withSanctuary) return;
      const { width, height } = WORLD_MAPS["journey-to-horizon"];
      const p = hexToPixel({ q: 10, r: 10 }, initialHexCrawl().grid);
      await gm.mutation(api.maps.addToken, { campaignId, type: "sanctuary", x: (p.x / width) * 100, y: (p.y / height) * 100, idempotencyKey: key() });
    }
    const crawlDay = (ctx: Awaited<ReturnType<typeof setup>>) =>
      ctx.t.run(async (c) => (await readMap(c, (await c.db.get("campaigns", ctx.campaignId))!)).hexCrawl?.day);

    it("a short rest passes a day; a short rest the GM forces past three passes none", async () => {
      const h = await setup("journey-to-horizon");
      await h.rest("short");
      expect(await crawlDay(h)).toBe(2);
      await h.rest("short");
      await h.rest("short");
      expect(await crawlDay(h)).toBe(4);
      await h.finish((await h.start("short", true)).restId);
      expect(await crawlDay(h)).toBe(4);
      expect((await h.campaignRow())?.summary).not.toMatch(/A day passes/);
    });

    it("a long rest only in a sanctuary: refused elsewhere, an interrupted one gives short-rest benefits", async () => {
      const h = await setup("journey-to-horizon");
      await placeParty(h, false);
      const { restId } = await h.start("long");
      expect(await codeOf(h.finish(restId))).toBe("REST_RULE");
      expect(await codeOf(h.interrupt(restId))).toBe("ok");

      const s = await setup("journey-to-horizon");
      await placeParty(s, true);
      expect(await codeOf(s.rest("long"))).toBe("ok");
    });

    it("Endurance Countdowns (option on) restart at 6 for each resting PC; a triggered one ends Vulnerable", async () => {
      const h = await setup("journey-to-horizon");
      const countdownOf = (id: Id<"characters">) =>
        h.t.run((ctx) => ctx.db.query("countdowns").withIndex("by_campaign_owner", (q) => q.eq("campaignId", h.campaignId).eq("ownerKey", enduranceOwnerKey(id))).unique());
      await h.rest("short");
      expect(await countdownOf(h.a)).toMatchObject({ currentValue: 6, status: "active", kind: "endurance" });
      expect(await countdownOf(h.b)).toMatchObject({ currentValue: 6, status: "active" });

      const row = (await countdownOf(h.a))!;
      await h.t.run((ctx) => ctx.db.patch("countdowns", row._id, { currentValue: 0, status: "completed" }));
      await h.edit(h.a, (s) => ({ ...s, conditions: ["vulnerable"] }));
      await h.edit(h.b, (s) => ({ ...s, conditions: ["vulnerable"] }));
      await h.rest("short");
      expect(await countdownOf(h.a)).toMatchObject({ currentValue: 6, status: "active" });
      expect((await h.sheetOf(h.a)).conditions).not.toContain("vulnerable");
      // Bryn's countdown never triggered: Vulnerable came from elsewhere.
      expect((await h.sheetOf(h.b)).conditions).toContain("vulnerable");
    });

    it("Endurance Countdowns are off with the option off, and nothing runs outside the frame", async () => {
      const h = await setup("journey-to-horizon");
      await h.setOption("enduranceCountdowns", false);
      await h.rest("short");
      expect(await h.t.run((ctx) => ctx.db.query("countdowns").withIndex("by_campaign_owner", (q) => q.eq("campaignId", h.campaignId).eq("ownerKey", enduranceOwnerKey(h.a))).unique())).toBeNull();

      const core = await setup("witherwild");
      await core.rest("short");
      expect(await core.t.run((ctx) => ctx.db.query("countdowns").withIndex("by_campaign_owner", (q) => q.eq("campaignId", core.campaignId).eq("ownerKey", enduranceOwnerKey(core.a))).unique())).toBeNull();
    });
  });

  describe("Beast Feast (CB 278)", () => {
    it("Make a Feast is a downtime move on either rest; the cooks are named in the feed", async () => {
      const { p1, a, start, finish, campaignRow } = await setup("beast-feast");
      const { restId } = await start("short");
      await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "makeAFeast" }, { move: "repairArmor" }], idempotencyKey: key() });
      await finish(restId);
      expect((await campaignRow())?.summary).toMatch(/Make a Feast: Ash cook/);
    });

    it("is refused outside the frame", async () => {
      const { p1, a, start } = await setup("witherwild");
      const { restId } = await start("long");
      expect(await codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "makeAFeast" }, { move: "prepare" }], idempotencyKey: key() }))).toBe("REST_RULE");
    });
  });

  describe("Dark Heart of Andaluria (HF 153)", () => {
    async function bite(ctx: Awaited<ReturnType<typeof setup>>, id: Id<"characters">, value: number) {
      return ctx.t.run((c) =>
        c.db.insert("countdowns", {
          campaignId: ctx.campaignId,
          name: "Lycanthropy",
          description: "",
          category: "consequence",
          startingValue: 6,
          currentValue: value,
          status: "active",
          consequence: "Werewolf",
          createdAt: Date.now(),
          ownerKey: lycanthropyOwnerKey(id),
          kind: "lycanthropy",
        }),
      );
    }

    it("each rest ticks a bitten PC's Lycanthropy Countdown (transformations on); the trigger is announced", async () => {
      const h = await setup("dark-heart-of-andaluria");
      const id = await bite(h, h.a, 2);
      await h.rest("short");
      expect((await h.t.run((ctx) => ctx.db.get("countdowns", id)))?.currentValue).toBe(1);
      await h.rest("long");
      expect(await h.t.run((ctx) => ctx.db.get("countdowns", id))).toMatchObject({ currentValue: 0, status: "completed" });
      expect((await h.campaignRow())?.summary).toMatch(/Ash's Lycanthropy Countdown triggers/);
    });

    it("does not tick with transformations off, or outside the frame", async () => {
      const h = await setup("dark-heart-of-andaluria");
      await h.setOption("transformations", false);
      const id = await bite(h, h.a, 6);
      await h.rest("short");
      expect((await h.t.run((ctx) => ctx.db.get("countdowns", id)))?.currentValue).toBe(6);

      const core = await setup("witherwild");
      const coreId = await bite(core, core.a, 6);
      await core.rest("short");
      expect((await core.t.run((ctx) => ctx.db.get("countdowns", coreId)))?.currentValue).toBe(6);
    });
  });

  describe("Motherboard (CB 295)", () => {
    const corruption = (ctx: Awaited<ReturnType<typeof setup>>) => ctx.t.run((c) => readTracker(c, ctx.campaignId, CORRUPTION_TRACKER_KEY, corruptionStateSchema));

    it("a Beastbound ranger's Fear Die is rolled each rest; a 1 marks a Corruption", async () => {
      const h = await setup("motherboard");
      await h.edit(h.a, (s) => ({ ...s, classId: "ranger", subclassId: "beastbound" }));
      const { restId } = await h.start("short");
      forceDice(1);
      await h.finish(restId);
      const state = await corruption(h);
      expect(state?.marks).toEqual({ [h.a]: 1 });
      expect(state?.log).toEqual([expect.objectContaining({ characterId: h.a, fearDie: 1, marked: true })]);
      expect((await h.campaignRow())?.summary).toMatch(/Ash's remnant companion glitches: Corruption 1/);
      vi.restoreAllMocks();

      forceDice(2);
      await h.rest("short");
      expect((await corruption(h))?.marks).toEqual({ [h.a]: 1 });
      expect((await corruption(h))?.log).toHaveLength(2);
    });

    it("rolls nothing with remnantCorruption off, without a Beastbound ranger, or outside the frame", async () => {
      const h = await setup("motherboard");
      await h.rest("short");
      expect(await corruption(h)).toBeNull();
      await h.edit(h.a, (s) => ({ ...s, classId: "ranger", subclassId: "beastbound" }));
      await h.setOption("remnantCorruption", false);
      await h.rest("short");
      expect(await corruption(h)).toBeNull();

      const core = await setup("witherwild");
      await core.edit(core.a, (s) => ({ ...s, classId: "ranger", subclassId: "beastbound" }));
      await core.rest("short");
      expect(await corruption(core)).toBeNull();
    });
  });
});
