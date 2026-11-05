/**
 * Rule switches OH (plan rule-switches, Q15 a): Horizon encounter bonuses, an optional rule (HF p.171), off by default
 * and only in Journey to Horizon. With it on, running a region's Encounter-table entry 4 gives the GM 1 Fear per PC and
 * entry 12 gives each PC 1 Hope; off (or another frame) the mutation is refused with MECHANIC_DISABLED.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { hopeMax } from "../../src/lib/domain/characters/index";
import { MAX_FEAR } from "../../src/lib/domain/fear/index";
import { encounterBonus, GOOD_FORTUNE_ENTRY, SETBACK_ENTRY } from "../../src/lib/domain/frames/horizon";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { regionKey, regionSchema } from "../../src/lib/world/hex-crawl";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

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

/** Encounters the test region lists: 4, 12 and 7, unused. */
const ENTRIES = [
  { dice: [2, 2], total: SETBACK_ENTRY, used: false },
  { dice: [6, 6], total: GOOD_FORTUNE_ENTRY, used: false },
  { dice: [3, 4], total: 7, used: false },
];
const [SETBACK, FORTUNE, OTHER] = [0, 1, 2];

/** A campaign of `frameId` with a GM, two players with a character each and (in Horizon) one region listing ENTRIES. */
async function setup(frameId: PublishedFrameId = "journey-to-horizon") {
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
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  let regionId = 1;
  if (frameId === "journey-to-horizon") {
    regionId = (await gm.mutation(api.trackers.horizon.generateRegion, { campaignId, idempotencyKey: key() })).id;
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("frameTrackers")
        .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", regionKey(regionId)))
        .unique())!;
      await ctx.db.patch("frameTrackers", row._id, { data: { ...(row.data as object), encounters: ENTRIES } });
    });
  }

  const turnOn = () => gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "horizonEncounterBonuses", value: true } });
  const activate = (index: number, idempotencyKey = key()) => gm.mutation(api.horizonEncounters.activate, { campaignId, regionId, index, idempotencyKey });
  const fear = () => t.run(async (ctx) => (await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).unique())!.fear);
  const setFear = (value: number) =>
    t.run(async (ctx) => {
      const state = (await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).unique())!;
      await ctx.db.patch("campaignState", state._id, { fear: value });
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const setHope = (id: Id<"characters">, hope: number) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), hope }));
  const encounters = () =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("frameTrackers")
        .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", regionKey(regionId)))
        .unique();
      return regionSchema.parse(row!.data).encounters;
    });
  const log = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  return { t, gm, p1, campaignId, a, b, turnOn, activate, fear, setFear, sheet, setHope, encounters, log };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rule switches: Horizon encounter bonuses (OH, HF p.171)", () => {
  useAllowlist(EMAILS);

  describe("encounterBonus (pure)", () => {
    it("is off by default: no bonus for any entry", () => {
      for (let total = 2; total <= 14; total++) expect(encounterBonus(total, 3)).toBeNull();
    });

    it("on: 4 gives 1 Fear per PC, 12 gives each PC a Hope, every other entry nothing", () => {
      expect(encounterBonus(SETBACK_ENTRY, 3, true)).toEqual({ kind: "fear", amount: 3 });
      expect(encounterBonus(SETBACK_ENTRY, 0, true)).toEqual({ kind: "fear", amount: 0 });
      expect(encounterBonus(GOOD_FORTUNE_ENTRY, 3, true)).toEqual({ kind: "hope" });
      for (let total = 2; total <= 14; total++) {
        if (total !== SETBACK_ENTRY && total !== GOOD_FORTUNE_ENTRY) expect(encounterBonus(total, 3, true)).toBeNull();
      }
    });
  });

  describe("horizonEncounters.activate", () => {
    it("is refused with MECHANIC_DISABLED while the switch is off (the default), changing nothing", async () => {
      const h = await setup();
      const fearBefore = await h.fear();
      expect(await codeOf(h.activate(SETBACK))).toBe("MECHANIC_DISABLED");
      expect(await codeOf(h.activate(FORTUNE))).toBe("MECHANIC_DISABLED");
      expect(await h.fear()).toBe(fearBefore);
      expect((await h.encounters()).map((e) => e.used)).toEqual([false, false, false]);
    });

    it("is refused with MECHANIC_DISABLED outside Journey to Horizon, where the switch can't be turned on", async () => {
      const h = await setup("witherwild");
      expect(await codeOf(h.turnOn())).toBe("SETTING_INVALID");
      expect(await codeOf(h.activate(SETBACK))).toBe("MECHANIC_DISABLED");
    });

    it("on, entry 4: the GM gains 1 Fear per PC, capped at 12, for every starting Fear; one public feed row; the encounter is marked used", async () => {
      for (let start = 0; start <= MAX_FEAR; start++) {
        const h = await setup();
        await h.turnOn();
        await h.setFear(start);
        const result = await h.activate(SETBACK);
        const expected = Math.min(MAX_FEAR, start + 2);
        expect(await h.fear()).toBe(expected);
        expect(result).toEqual({ entry: SETBACK_ENTRY, fearGained: expected - start, hopeGained: 0 });
        expect((await h.encounters()).map((e) => e.used)).toEqual([true, false, false]);
        const rows = (await h.log()).filter((r) => r.kind === "roll");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ visibility: "public", fearDelta: expected - start, undoable: true });
        expect(rows[0].summary).toContain("temporary setback");
      }
    });

    it("on, entry 12: each PC gains a Hope up to their maximum; a PC already at max gains none", async () => {
      const h = await setup();
      await h.turnOn();
      const max = hopeMax((await h.sheet(h.b)).scars, (await h.sheet(h.b)).hopeSlotBonus);
      await h.setHope(h.a, 0);
      await h.setHope(h.b, max);
      const fearBefore = await h.fear();
      const result = await h.activate(FORTUNE);
      expect(result).toEqual({ entry: GOOD_FORTUNE_ENTRY, fearGained: 0, hopeGained: 1 });
      expect((await h.sheet(h.a)).hope).toBe(1);
      expect((await h.sheet(h.b)).hope).toBe(max);
      expect(await h.fear()).toBe(fearBefore);
      expect((await h.encounters()).map((e) => e.used)).toEqual([false, true, false]);
      const rows = (await h.log()).filter((r) => r.kind === "roll");
      expect(rows.map((r) => r.characterId ?? null)).toEqual([h.a, null]);
      expect(rows[1].summary).toContain("Bryn already at max");
    });

    it("on, entry 12: every PC's Hope ends at min(before + 1, max) for any starting Hope", async () => {
      for (let hope = 0; hope <= 6; hope++) {
        const h = await setup();
        await h.turnOn();
        const s = await h.sheet(h.a);
        const max = hopeMax(s.scars, s.hopeSlotBonus);
        await h.setHope(h.a, Math.min(hope, max));
        await h.setHope(h.b, Math.min(hope, max));
        await h.activate(FORTUNE);
        for (const id of [h.a, h.b]) expect((await h.sheet(id)).hope).toBe(Math.min(Math.min(hope, max) + 1, max));
      }
    });

    it("undo from the feed takes the bonus back", async () => {
      const h = await setup();
      await h.turnOn();
      await h.setFear(3);
      await h.setHope(h.a, 1);
      await h.activate(SETBACK);
      const fearRow = (await h.log()).find((r) => r.kind === "roll")!;
      await h.gm.mutation(api.actionLog.undo, { entryId: fearRow._id, idempotencyKey: key() });
      expect(await h.fear()).toBe(3);

      await h.activate(FORTUNE);
      const hopeRow = (await h.log()).find((r) => r.kind === "roll" && r.characterId === h.a && r.undoneAt === undefined)!;
      expect((await h.sheet(h.a)).hope).toBe(2);
      await h.gm.mutation(api.actionLog.undo, { entryId: hopeRow._id, idempotencyKey: key() });
      expect((await h.sheet(h.a)).hope).toBe(1);
    });

    it("applies once per idempotency key, and an encounter that already ran is refused", async () => {
      const h = await setup();
      await h.turnOn();
      await h.setFear(0);
      const k = key();
      await h.activate(SETBACK, k);
      await h.activate(SETBACK, k);
      expect(await h.fear()).toBe(2);
      expect(await codeOf(h.activate(SETBACK))).toBe("TRACKER_RULE");
      expect(await h.fear()).toBe(2);
    });

    it("refuses entries without a bonus (INVALID) and missing encounters or regions (TRACKER_RULE)", async () => {
      const h = await setup();
      await h.turnOn();
      expect(await codeOf(h.activate(OTHER))).toBe("INVALID");
      expect(await codeOf(h.activate(9))).toBe("TRACKER_RULE");
      expect(await codeOf(h.gm.mutation(api.horizonEncounters.activate, { campaignId: h.campaignId, regionId: 999, index: 0, idempotencyKey: key() }))).toBe(
        "TRACKER_RULE",
      );
      expect((await h.encounters()).map((e) => e.used)).toEqual([false, false, false]);
    });

    it("players can't run it", async () => {
      const h = await setup();
      await h.turnOn();
      expect(await codeOf(h.p1.mutation(api.horizonEncounters.activate, { campaignId: h.campaignId, regionId: 1, index: SETBACK, idempotencyKey: key() }))).toBe("FORBIDDEN");
    });
  });
});
