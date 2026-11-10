// Plan rule-switches wave 3, tracer WS: X3 Scars, W3 Doom Track (session-end side, Every N sessions, Tier 2 and 4) and
// L3 Domain card levels (docs/tasks/TASK-RULES-WS.md). Book behaviour is covered by death-moves, sessions, horizon and
// level-up tests, unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { RuleChange } from "../../convex/lib/validators/ruleModes";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: "human" },
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

/** Forces the server's next dice (`rollDie` reads one Uint32 per die). */
function forceDice(...faces: number[]) {
  const real = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1 && faces.length > 0) {
      array[0] = faces.shift()! - 1;
      return array;
    }
    return real(array as never) as T;
  });
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

async function setup(frameId: PublishedFrameId = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const setRule = (change: RuleChange) => gm.mutation(api.ruleSettings.set, { campaignId, change });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", a))!.sheet));
  const edit = (change: (s: CharacterSheet) => CharacterSheet) => t.run(async (ctx) => saveSheet(ctx, a, change(readSheet((await ctx.db.get("characters", a))!.sheet))));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const startEnd = async () => {
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    return gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  };
  /** The player chooses Avoid Death; the GM confirms (HD4). */
  const avoidDeath = async () => {
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    return gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() });
  };
  return { t, gm, p1, campaignId, a, setRule, sheet, edit, rows, notes, fear, startEnd, avoidDeath };
}

describe("rule switches wave 3: sessions, scars & level-up (WS)", () => {
  useAllowlist("gm@example.com,p1@example.com");
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("X3 Scars", () => {
    it("Book: the Hope Die's scar crosses out a slot; no note", async () => {
      const f = await setup();
      await f.edit((s) => ({ ...s, hp: s.hpMax }));
      forceDice(1);
      expect(await f.avoidDeath()).toMatchObject({ hopeDie: 1, scarred: true });
      expect((await f.sheet()).scars).toBe(1);
      expect(await f.notes()).toEqual([]);
    });

    it("Manual: no scar on the sheet; the GM's note joins the move's group and undo takes both back", async () => {
      const f = await setup();
      await f.setRule({ key: "scars", value: "manual" });
      await f.edit((s) => ({ ...s, hp: s.hpMax }));
      forceDice(1);
      const r = await f.avoidDeath();
      expect(r).toMatchObject({ hopeDie: 1, scarred: true, journeyEnds: false });
      const s = await f.sheet();
      expect(s.scars).toBe(0);
      expect(s.conditions).toContain("unconscious");
      const move = (await f.rows()).find((row) => row._id === r.entryId)!;
      expect(move.summary).toContain("a scar, for the GM to mark");
      const [note, ...more] = await f.notes();
      expect(more).toEqual([]);
      expect(note).toMatchObject({ ruleId: "scars", visibility: "gm", groupId: move.groupId, summary: "Ash gains a scar: cross out a Hope slot?", undoable: true });
      expect(note!.characterId).toBeUndefined();

      await f.gm.mutation(api.deathMoves.undo, { entryId: r.entryId, idempotencyKey: key() });
      expect((await f.notes())[0]!.undoneAt).toBeDefined();
    });

    it("Manual: no scar from the die, no note", async () => {
      const f = await setup();
      await f.setRule({ key: "scars", value: "manual" });
      await f.edit((s) => ({ ...s, hp: s.hpMax }));
      forceDice(12);
      expect(await f.avoidDeath()).toMatchObject({ hopeDie: 12, scarred: false });
      expect(await f.notes()).toEqual([]);
    });

    it("the End lists journeys that end in Book, never in Manual", async () => {
      const f = await setup();
      await f.edit((s) => ({ ...s, journeyEnds: true }));
      expect((await f.startEnd()).journeyEnds).toEqual([{ characterId: f.a, name: "Ash" }]);
      await f.setRule({ key: "scars", value: "manual" });
      expect((await f.startEnd()).journeyEnds).toEqual([]);
    });
  });

  describe("W3 Doom Track (Journey to Horizon)", () => {
    it("Book reminds every session; Every N sessions every N-th; Manual never", async () => {
      const book = await setup("journey-to-horizon");
      expect((await book.startEnd()).doomTier).toBe(1);
      expect((await book.startEnd()).doomTier).toBe(1);

      const every = await setup("journey-to-horizon");
      await every.setRule({ key: "doomTrack", value: "everyNSessions" });
      await every.setRule({ key: "doomTrackSessions", value: 3 });
      const tiers: (number | undefined)[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await every.startEnd();
        tiers.push(r.doomTier);
      }
      expect(tiers).toEqual([undefined, undefined, 1, undefined, undefined, 1]);

      const manual = await setup("journey-to-horizon");
      await manual.setRule({ key: "doomTrack", value: "manual" });
      expect((await manual.startEnd()).doomTier).toBeUndefined();
    });

    async function tierFour(mode: "book" | "everyNSessions" | "manual") {
      const f = await setup("journey-to-horizon");
      if (mode !== "book") await f.setRule({ key: "doomTrack", value: mode });
      await f.t.run(async (ctx) => {
        const campaign = (await ctx.db.get("campaigns", f.campaignId))!;
        await ctx.db.patch("campaigns", campaign._id, { tier: 4 });
      });
      const before = await f.fear();
      const r = await f.gm.mutation(api.trackers.horizon.markBox, { campaignId: f.campaignId, boxId: "4a", idempotencyKey: key() });
      return { f, r, gained: (await f.fear()) - before };
    }

    it("Tier 4: Book and Every N sessions gain the Fear; Manual gains none and notes it", async () => {
      for (const mode of ["book", "everyNSessions"] as const) {
        const { r, gained, f } = await tierFour(mode);
        expect(r.fear?.gained).toBe(1);
        expect(gained).toBe(1);
        expect(await f.notes()).toEqual([]);
      }
      const { r, gained, f } = await tierFour("manual");
      expect(r.fear).toBeNull();
      expect(gained).toBe(0);
      expect((await f.notes()).map((n) => [n.ruleId, n.summary])).toEqual([["doomTrack", "Doom Track Tier 4: gain 1 Fear?"]]);
    });

    async function tierTwo(mode: "book" | "manual") {
      const f = await setup("journey-to-horizon");
      if (mode !== "book") await f.setRule({ key: "doomTrack", value: mode });
      await f.t.run((ctx) => ctx.db.patch("campaigns", f.campaignId, { tier: 2 }));
      for (const boxId of ["2a", "2b", "2c", "2d", "2a1"]) await f.gm.mutation(api.trackers.horizon.markBox, { campaignId: f.campaignId, boxId, idempotencyKey: key() });
      forceDice(1, 5);
      const region = await f.gm.mutation(api.trackers.horizon.generateRegion, { campaignId: f.campaignId, idempotencyKey: key() });
      vi.restoreAllMocks();
      return { f, region };
    }

    it("Tier 2: Book counts a d20 of 1 as two 1s; Manual rolls again and notes it", async () => {
      const book = await tierTwo("book");
      expect(book.region).toMatchObject({ habitatRolls: [1], impassable: true });
      expect(await book.f.notes()).toEqual([]);
      const manual = await tierTwo("manual");
      expect(manual.region).toMatchObject({ habitatRolls: [1, 5], impassable: false });
      expect((await manual.f.notes()).map((n) => n.ruleId)).toEqual(["doomTrack"]);
    });

    it("Tier 1's long-rest Fear also applies in Every N sessions (user 2026-11-10)", async () => {
      const f = await setup("journey-to-horizon");
      for (const boxId of ["1a", "1b", "1c", "1d", "1a1"]) await f.gm.mutation(api.trackers.horizon.markBox, { campaignId: f.campaignId, boxId, idempotencyKey: key() });
      await f.setRule({ key: "doomTrack", value: "everyNSessions" });
      const { restId } = await f.gm.mutation(api.rests.start, { campaignId: f.campaignId, kind: "long", idempotencyKey: key() });
      await f.gm.mutation(api.rests.finish, { campaignId: f.campaignId, restId, idempotencyKey: key() });
      expect((await f.rows()).some((r) => r.summary.includes("Doom Track Tier 1: rolled"))).toBe(true);
    });
  });

  describe("L3 Domain card levels", () => {
    const blade = (level: number) => cardsForDomains(["blade"], level).find((c) => c.level === level)!;
    const choice = (cardId: string) => ({
      picks: [
        { option: "traits" as const, tier: 2, targets: ["agility", "instinct"] },
        { option: "hp" as const, tier: 2 },
      ],
      experienceName: "Always Land on My Feet",
      cardId,
    });

    it("Book: a card above the level is refused in the Domain Deck and at level-up", async () => {
      const f = await setup();
      await f.edit((s) => ({ ...s, level: 2 }));
      expect(await codeOf(f.p1.mutation(api.characters.takeCard, { characterId: f.a, cardId: blade(4).id }))).toBe("INVALID");
      await f.edit((s) => ({ ...s, level: 1 }));
      expect(await codeOf(f.gm.mutation(api.levelUp.apply, { characterId: f.a, choice: choice(blade(3).id), idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
      expect(await f.notes()).toEqual([]);
    });

    it("Manual: the Domain Deck takes a card above the level and tells the GM; other domains stay refused", async () => {
      const f = await setup();
      await f.setRule({ key: "domainCardLevels", value: "manual" });
      await f.edit((s) => ({ ...s, level: 2 }));
      const arcana = cardsForDomains(["arcana"], 1).find((c) => c.level === 1)!;
      expect(await codeOf(f.p1.mutation(api.characters.takeCard, { characterId: f.a, cardId: arcana.id }))).toBe("INVALID");
      expect(await codeOf(f.p1.mutation(api.characters.takeCard, { characterId: f.a, cardId: blade(4).id }))).toBe("ok");
      expect((await f.sheet()).domainCards.owned).toContain(blade(4).id);
      expect((await f.notes()).map((n) => [n.ruleId, n.visibility, n.summary])).toEqual([["domainCardLevels", "gm", `Ash took ${blade(4).name} (level 4) at level 2`]]);
    });

    it("Manual: a level-up takes a card above the new level and tells the GM; a card within reach adds no note", async () => {
      const f = await setup();
      await f.setRule({ key: "domainCardLevels", value: "manual" });
      expect(await f.gm.mutation(api.levelUp.apply, { characterId: f.a, choice: choice(blade(3).id), idempotencyKey: key() })).toEqual({ level: 2 });
      expect((await f.notes()).map((n) => n.summary)).toEqual([`Ash took ${blade(3).name} (level 3) at level 2`]);

      const g = await setup();
      await g.setRule({ key: "domainCardLevels", value: "manual" });
      await g.gm.mutation(api.levelUp.apply, { characterId: g.a, choice: choice(blade(2).id), idempotencyKey: key() });
      expect(await g.notes()).toEqual([]);
    });

    it("character creation keeps level-1 cards in Manual", async () => {
      const f = await setup();
      await f.setRule({ key: "domainCardLevels", value: "manual" });
      const bad = { ...draft("Bryn"), domainCards: [blade(1).id, blade(3).id] };
      expect(await codeOf(f.gm.mutation(api.characters.create, { campaignId: f.campaignId, draft: bad, idempotencyKey: key() }))).not.toBe("ok");
    });
  });
});

