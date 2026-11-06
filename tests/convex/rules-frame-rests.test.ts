/**
 * Rule switches RF (plan rule-switches): the frame rest hooks follow the GM's mode. Book is today's behaviour (the full
 * Book suites live in rest-frame-hooks.test.ts); Manual applies nothing and posts a GM-only note (kind `rule`).
 * W2 HF p.176, W4 CB p.278, W5 CB p.327, W6 CB p.289, W7 HF p.153.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { FEAST_FORBIDDEN, lycanthropyOwnerKey } from "../../src/lib/domain/rest/frame-hooks/index";
import { feastForbiddenMoves } from "../../src/lib/domain/frames/beast-feast";
import { lurkingRestNote, restRollsLurking } from "../../src/lib/frames/trackers/age-of-umbra";
import { lycanthropyRestNote, restTicksLycanthropy } from "../../src/lib/frames/trackers/andaluria";
import { INITIAL_COLOSSUS, markRest, restSiphonMarks, siphonRestNote } from "../../src/lib/frames/trackers/colossus";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { hexToPixel } from "../../src/lib/world/hex";
import { initialHexCrawl, WORLD_MAPS } from "../../src/lib/world/map-state";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// RD2 (2026-11-06): the four frame rules start off for new campaigns; these fixtures play them as before.
const FRAME_RULE = { "castle-high": "lessLethal", "dark-heart-of-andaluria": "transformations", "journey-to-horizon": "enduranceCountdowns", motherboard: "remnantCorruption" } as const;

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

/** Every server die comes up `face`. */
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

type Mode = "book" | "manual";
type FrameRule = "horizonSanctuaryRest" | "beastFeastFeast" | "colossusSiphoning" | "umbraLurkingDarkness" | "andaluriaLycanthropy";

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
  const frameRule = (FRAME_RULE as Record<string, (typeof FRAME_RULE)[keyof typeof FRAME_RULE]>)[frameId];
  if (frameRule) await gm.mutation(api.campaigns.setOption, { campaignId: campaignId, option: frameRule, enabled: true });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const setMode = (rule: FrameRule, value: Mode) => gm.mutation(api.ruleSettings.set, { campaignId, change: { key: rule, value } });
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const rest = async (kind: "short" | "long") => finish((await start(kind)).restId);
  const choose = (who: typeof p1, restId: Id<"rests">, characterId: Id<"characters">, moves: { move: string }[]) =>
    who.mutation(api.rests.choose, { restId, characterId, moves: moves as { move: "prepare" }[], idempotencyKey: key() });
  const pickable = async (characterId: Id<"characters">) =>
    (await gm.query(api.restsReads.current, { campaignId })).open?.moves.find((m) => m.characterId === characterId)?.moves;
  const log = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await log()).filter((r) => r.kind === "rule");
  const campaignRow = async () => (await log()).filter((r) => r.kind === "rest" && r.characterId === undefined).at(-1);
  return { t, gm, p1, p2, campaignId, a, b, setMode, start, finish, rest, choose, pickable, notes, campaignRow };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rule switches: frame rest hooks (RF)", () => {
  useAllowlist(EMAILS);
  afterEach(() => vi.restoreAllMocks());

  describe("pure helpers default to Book", () => {
    it("W4 Make a Feast: Book forbids the core moves, Manual none", () => {
      expect(feastForbiddenMoves(FEAST_FORBIDDEN)).toBe(FEAST_FORBIDDEN);
      expect(feastForbiddenMoves(FEAST_FORBIDDEN, "manual")).toEqual([]);
    });

    it("W5 Siphoning: Book marks once / twice, Manual none", () => {
      expect([restSiphonMarks("short"), restSiphonMarks("long"), restSiphonMarks("long", "manual")]).toEqual([1, 2, 0]);
      const roll = () => [];
      expect(markRest(INITIAL_COLOSSUS, "long", roll, 0).state.siphonMarked).toBe(INITIAL_COLOSSUS.siphonMarked + 2);
      expect(markRest(INITIAL_COLOSSUS, "long", roll, 0, "manual").state).toEqual(INITIAL_COLOSSUS);
      expect(siphonRestNote("short")).toBe("Hunt phase rest: mark Siphoning once");
      expect(siphonRestNote("long")).toBe("Hunt phase rest: mark Siphoning twice");
    });

    it("W6 Lurking Darkness and W7 Lycanthropy: Book applies, Manual never", () => {
      expect([restRollsLurking(false), restRollsLurking(true), restRollsLurking(false, "manual")]).toEqual([true, false, false]);
      expect(lurkingRestNote([])).toBe("Rest away from a Sacred Pyre: roll on Lurking Darkness");
      expect(lurkingRestNote(["Ash"])).toBe("Rest away from a Sacred Pyre: roll on Lurking Darkness (Keep Watch: Ash)");
      expect([restTicksLycanthropy(false), restTicksLycanthropy(true), restTicksLycanthropy(false, "manual")]).toEqual([true, false, false]);
      expect(lycanthropyRestNote("Ash")).toBe("Rest: tick Lycanthropy for Ash unless they halted it");
    });
  });

  describe("W2 Journey to Horizon: long rest only in a sanctuary (HF p.176)", () => {
    async function placeParty(h: Awaited<ReturnType<typeof setup>>, withSanctuary: boolean) {
      await h.gm.mutation(api.maps.placePartyHex, { campaignId: h.campaignId, q: 10, r: 10 });
      if (!withSanctuary) return;
      const { width, height } = WORLD_MAPS["journey-to-horizon"];
      const p = hexToPixel({ q: 10, r: 10 }, initialHexCrawl().grid);
      await h.gm.mutation(api.maps.addToken, { campaignId: h.campaignId, type: "sanctuary", x: (p.x / width) * 100, y: (p.y / height) * 100, idempotencyKey: key() });
    }

    it("Book: a long rest outside a sanctuary is refused, and no note is posted", async () => {
      const h = await setup("journey-to-horizon");
      await placeParty(h, false);
      expect(await codeOf(h.start("long"))).toBe("REST_RULE");
      expect(await h.notes()).toEqual([]);
    });

    it("Manual: it goes through with a warning in the rest's row and a GM note", async () => {
      const h = await setup("journey-to-horizon");
      await h.setMode("horizonSanctuaryRest", "manual");
      await placeParty(h, false);
      expect(await codeOf(h.rest("long"))).toBe("ok");
      expect((await h.campaignRow())?.summary).toMatch(/Warning: Long rest outside a sanctuary/);
      expect(await h.notes()).toEqual([expect.objectContaining({ ruleId: "horizonSanctuaryRest", visibility: "gm", summary: "Long rest outside a sanctuary" })]);
      // The note is GM-only: the players' feed never carries it.
      const feed = await h.p1.query(api.feed.list, { campaignId: h.campaignId, paginationOpts: { numItems: 50, cursor: null } });
      expect(feed.page.some((r) => r.kind === "rule")).toBe(false);
    });

    it("Manual: inside a sanctuary, or on a short rest, nothing is said", async () => {
      const h = await setup("journey-to-horizon");
      await h.setMode("horizonSanctuaryRest", "manual");
      await placeParty(h, true);
      await h.rest("long");
      await h.rest("short");
      expect(await h.notes()).toEqual([]);
      expect((await h.campaignRow())?.summary).not.toMatch(/Warning/);
    });
  });

  describe("W4 Beast Feast: Make a Feast (CB p.278)", () => {
    it("Book: the core moves that clear Stress, HP or gain Hope are not offered", async () => {
      const h = await setup("beast-feast");
      const { restId } = await h.start("short");
      expect(await h.pickable(h.a)).toEqual(["repairArmor", "makeAFeast"]);
      expect(await codeOf(h.choose(h.p1, restId, h.a, [{ move: "clearStress" }, { move: "repairArmor" }]))).toBe("REST_RULE");
    });

    it("Manual: Clear Stress, Tend to Wounds and Prepare are offered next to Make a Feast", async () => {
      const h = await setup("beast-feast");
      await h.setMode("beastFeastFeast", "manual");
      const { restId } = await h.start("short");
      const moves = await h.pickable(h.a);
      expect(moves).toEqual(expect.arrayContaining(["tendToWounds", "clearStress", "prepare", "repairArmor", "makeAFeast"]));
      expect(await codeOf(h.choose(h.p1, restId, h.a, [{ move: "clearStress" }, { move: "makeAFeast" }]))).toBe("ok");
      await h.finish(restId);
      expect((await h.campaignRow())?.summary).toMatch(/Make a Feast: Ash cook/);
    });
  });

  describe("W5 Colossus of the Drylands: Siphoning on rests (CB p.327)", () => {
    const marked = async (h: Awaited<ReturnType<typeof setup>>) => (await h.gm.query(api.trackers.colossus.get, { campaignId: h.campaignId })).gm?.siphonMarked;

    it("Book: a hunt-phase rest marks the track; no note", async () => {
      const h = await setup("colossus-of-the-drylands");
      await h.rest("long");
      expect(await marked(h)).toBe(3);
      expect(await h.notes()).toEqual([]);
    });

    it("Manual: no mark; the GM gets 'mark Siphoning once / twice'", async () => {
      const h = await setup("colossus-of-the-drylands");
      await h.setMode("colossusSiphoning", "manual");
      await h.rest("short");
      await h.rest("long");
      expect(await marked(h)).toBe(1);
      expect((await h.notes()).map((n) => n.summary)).toEqual(["Hunt phase rest: mark Siphoning once", "Hunt phase rest: mark Siphoning twice"]);
    });

    it("Manual: an interlude rest posts nothing", async () => {
      const h = await setup("colossus-of-the-drylands");
      await h.setMode("colossusSiphoning", "manual");
      await h.gm.mutation(api.trackers.colossus.setPhase, { campaignId: h.campaignId, phase: "interlude", idempotencyKey: key() });
      await h.rest("short");
      expect(await h.notes()).toEqual([]);
    });
  });

  describe("W6 The Age of Umbra: Lurking Darkness (CB p.289)", () => {
    const log = async (h: Awaited<ReturnType<typeof setup>>) => (await h.gm.query(api.trackers.ageOfUmbra.get, { campaignId: h.campaignId })).gm?.log;

    it("Book: a rest away from a pyre rolls the d12; no note", async () => {
      const h = await setup("age-of-umbra");
      forceDice(7);
      await h.rest("short");
      expect(await log(h)).toHaveLength(1);
      expect(await h.notes()).toEqual([]);
    });

    it("Manual: no roll, no Fear, no Hope; the GM gets a note naming the watchers", async () => {
      const h = await setup("age-of-umbra");
      await h.setMode("umbraLurkingDarkness", "manual");
      const { restId } = await h.start("short");
      await h.choose(h.p1, restId, h.a, [{ move: "keepWatch" }, { move: "clearStress" }]);
      const hopeBefore = await h.t.run(async (ctx) => readSheet((await ctx.db.get("characters", h.b))!.sheet).hope);
      forceDice(12);
      await h.finish(restId);
      expect(await log(h)).toEqual([]);
      expect(await h.t.run(async (ctx) => readSheet((await ctx.db.get("characters", h.b))!.sheet).hope)).toBe(hopeBefore);
      expect((await h.notes()).map((n) => n.summary)).toEqual(["Rest away from a Sacred Pyre: roll on Lurking Darkness (Keep Watch: Ash)"]);
    });

    it("Manual: at a Sacred Pyre nothing is said", async () => {
      const h = await setup("age-of-umbra");
      await h.setMode("umbraLurkingDarkness", "manual");
      await h.gm.mutation(api.trackers.ageOfUmbra.setAtPyre, { campaignId: h.campaignId, atPyre: true, idempotencyKey: key() });
      await h.rest("long");
      expect(await h.notes()).toEqual([]);
    });
  });

  describe("W7 Dark Heart of Andaluria: Lycanthropy countdown (HF p.153)", () => {
    async function bite(h: Awaited<ReturnType<typeof setup>>, id: Id<"characters">, value: number) {
      return h.t.run((c) =>
        c.db.insert("countdowns", {
          campaignId: h.campaignId,
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
    const valueOf = (h: Awaited<ReturnType<typeof setup>>, id: Id<"countdowns">) => h.t.run(async (ctx) => (await ctx.db.get("countdowns", id))?.currentValue);

    it("Book: each rest ticks a bitten PC's countdown; no note", async () => {
      const h = await setup("dark-heart-of-andaluria");
      const id = await bite(h, h.a, 4);
      await h.rest("short");
      expect(await valueOf(h, id)).toBe(3);
      expect(await h.notes()).toEqual([]);
    });

    it("Manual: nothing ticks; one note per bitten PC who did not halt it", async () => {
      const h = await setup("dark-heart-of-andaluria");
      await h.setMode("andaluriaLycanthropy", "manual");
      const ash = await bite(h, h.a, 4);
      const bryn = await bite(h, h.b, 5);
      const { restId } = await h.start("short");
      await h.choose(h.p2, restId, h.b, [{ move: "haltLycanthropy" }, { move: "clearStress" }]);
      await h.finish(restId);
      expect([await valueOf(h, ash), await valueOf(h, bryn)]).toEqual([4, 5]);
      expect((await h.notes()).map((n) => n.summary)).toEqual(["Rest: tick Lycanthropy for Ash unless they halted it"]);
    });

    it("Manual: an unbitten party gets no note", async () => {
      const h = await setup("dark-heart-of-andaluria");
      await h.setMode("andaluriaLycanthropy", "manual");
      await h.rest("long");
      expect(await h.notes()).toEqual([]);
    });
  });

  it("a frame rule's mode is refused in another frame (SETTING_INVALID)", async () => {
    const h = await setup("witherwild");
    expect(await codeOf(h.setMode("colossusSiphoning", "manual"))).toBe("SETTING_INVALID");
  });
});
