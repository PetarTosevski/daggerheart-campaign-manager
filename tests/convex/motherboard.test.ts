import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { readTracker, TRACKER_SCHEMA_VERSION, writeTracker } from "../../convex/lib/trackers";
import { NETWORK_TETHER } from "../../src/lib/domain/motherboard/index";
import { CORRUPTION_TRACKER_KEY, corruptionStateSchema, INITIAL_CORRUPTION } from "../../src/lib/domain/rest/frame-hooks/index";
import { INITIAL_COMPANION } from "../../src/lib/frames/extras/companion";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// RF4: Motherboard rules from the book (CB 295, 301-302).

const ARMOR_ID = ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id;
const IKONIS = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id;

function draft(classId: string, motherboard: boolean) {
  const cls = getClass(classId)!;
  return {
    classId,
    subclassId: classId === "ranger" ? "beastbound" : subclassesForClass(classId)[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name: "Vex",
    pronouns: "",
    description: "",
    primaryWeaponId: motherboard ? "" : PRIMARY,
    armorId: ARMOR_ID,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Scavenger", "Tinker"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

const fail = async (p: Promise<unknown>) => errorCode(await p.then(() => null, (e: unknown) => e));

function forceDice(face: number) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);
}

async function setup(frameId: "motherboard" | "witherwild", classId = "ranger") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    outsider: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, outsider] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.outsider)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const motherboard = frameId === "motherboard";
  const { characterId } = await p1.mutation(api.characters.create, {
    campaignId,
    draft: draft(classId, motherboard),
    ...(motherboard ? { ikonis: IKONIS } : {}),
    idempotencyKey: key(),
  });
  const sheetOf = async (id: Id<"characters">) => (await p1.query(api.characters.get, { characterId: id }))!.sheet;
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const corruption = () => t.run((ctx) => readTracker(ctx, campaignId, CORRUPTION_TRACKER_KEY, corruptionStateSchema));
  const setMarks = (marks: number) =>
    t.run(async (ctx) => {
      const state = (await readTracker(ctx, campaignId, CORRUPTION_TRACKER_KEY, corruptionStateSchema)) ?? INITIAL_CORRUPTION;
      await writeTracker(ctx, campaignId, CORRUPTION_TRACKER_KEY, { ...state, marks: { [characterId]: marks } }, TRACKER_SCHEMA_VERSION);
    });
  return { t, gm, p1, p2, outsider, campaignId, characterId, sheetOf, edit, corruption, setMarks };
}

describe("Motherboard rules from the book (RF4)", () => {
  useAllowlist("gm@example.com,p1@example.com,p2@example.com,out@example.com");
  afterEach(() => vi.restoreAllMocks());

  describe("tether and quantum (CB 301-302)", () => {
    it("a new Motherboard character carries a Network tether, no gold and 5 quantum; other frames keep the handful of gold", async () => {
      const mb = await setup("motherboard");
      const sheet = await mb.sheetOf(mb.characterId);
      expect(sheet.inventory.map((i) => i.name)).toContain(NETWORK_TETHER);
      expect(sheet.gold).toEqual({ handfuls: 0, bags: 0, chest: false });
      expect((await mb.p1.query(api.characterExtras.get, { characterId: mb.characterId })).motherboard?.quantum).toBe(5);

      const core = await setup("witherwild");
      const coreSheet = await core.sheetOf(core.characterId);
      expect(coreSheet.inventory.map((i) => i.name)).not.toContain(NETWORK_TETHER);
      expect(coreSheet.gold).toEqual({ handfuls: 1, bags: 0, chest: false });
    });

    it("the migration gives older Motherboard characters the tether and 5 quantum once, and leaves other frames alone", async () => {
      const mb = await setup("motherboard");
      const core = await setup("witherwild");
      // A character made before RF4: no tether, a handful of gold, no Ikonis module row.
      await mb.edit(mb.characterId, (s) => ({ ...s, inventory: s.inventory.filter((i) => i.name !== NETWORK_TETHER), gold: { handfuls: 1, bags: 0, chest: false } }));
      await mb.t.run(async (ctx) => {
        const rows = await ctx.db
          .query("characterExtras")
          .withIndex("by_character_extra", (q) => q.eq("characterId", mb.characterId))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      });
      vi.useFakeTimers();
      try {
        for (const reset of [false, true]) {
          await mb.t.mutation(internal.migrations.run.run, { fn: "migrations/motherboardEconomy:addTetherAndQuantum", reset });
          await mb.t.finishAllScheduledFunctions(vi.runAllTimers);
          await core.t.mutation(internal.migrations.run.run, { fn: "migrations/motherboardEconomy:addTetherAndQuantum", reset });
          await core.t.finishAllScheduledFunctions(vi.runAllTimers);
        }
      } finally {
        vi.useRealTimers();
      }
      const sheet = await mb.sheetOf(mb.characterId);
      expect(sheet.inventory.filter((i) => i.name === NETWORK_TETHER)).toHaveLength(1);
      const rows = await mb.t.run((ctx) =>
        ctx.db
          .query("characterExtras")
          .withIndex("by_character_extra", (q) => q.eq("characterId", mb.characterId).eq("extra", "motherboard"))
          .collect(),
      );
      expect(rows).toHaveLength(1);
      expect((await mb.p1.query(api.characterExtras.get, { characterId: mb.characterId })).motherboard?.quantum).toBe(5);
      expect((await core.sheetOf(core.characterId)).inventory.map((i) => i.name)).not.toContain(NETWORK_TETHER);
    });

    it("the migration keeps the quantum of a module that already exists", async () => {
      const mb = await setup("motherboard");
      await mb.p1.mutation(api.characterExtras.correctWallet, { characterId: mb.characterId, correction: { quantum: 42 }, idempotencyKey: key() });
      vi.useFakeTimers();
      try {
        await mb.t.mutation(internal.migrations.run.run, { fn: "migrations/motherboardEconomy:addTetherAndQuantum" });
        await mb.t.finishAllScheduledFunctions(vi.runAllTimers);
      } finally {
        vi.useRealTimers();
      }
      expect((await mb.p1.query(api.characterExtras.get, { characterId: mb.characterId })).motherboard?.quantum).toBe(42);
    });
  });

  describe("augment swaps during downtime (CB 301)", () => {
    it("installAugments is refused without an open rest and allowed while the party rests", async () => {
      const { gm, p1, campaignId, characterId } = await setup("motherboard", "warrior");
      const install = () => p1.mutation(api.characterExtras.installAugments, { characterId, augmentIds: [], idempotencyKey: key() });
      expect(await p1.query(api.characterExtras.augmentSwapOpen, { characterId })).toBe(false);
      expect(await fail(install())).toBe("EXTRA_RULE");
      expect((await p1.query(api.characterExtras.get, { characterId })).motherboard?.installed).toEqual(["force"]);

      await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
      expect(await p1.query(api.characterExtras.augmentSwapOpen, { characterId })).toBe(true);
      await install();
      expect((await p1.query(api.characterExtras.get, { characterId })).motherboard?.installed).toEqual([]);
    });

    it("crafting and salvage stay open outside downtime", async () => {
      const { p1, characterId } = await setup("motherboard", "warrior");
      await p1.mutation(api.characterExtras.correctWallet, { characterId, correction: { scrap: { Wire: 3, Silver: 2, Platinum: 2, Fuse: 3 } }, idempotencyKey: key() });
      await p1.mutation(api.characterExtras.craftAugment, { characterId, augmentId: "guard", idempotencyKey: key() });
      await p1.mutation(api.characterExtras.salvageAugment, { characterId, augmentId: "guard", idempotencyKey: key() });
    });

    it("augmentSwapOpen: anonymous UNAUTHENTICATED, outsider NOT_FOUND", async () => {
      const { t, outsider, characterId } = await setup("motherboard", "warrior");
      expect(await fail(t.query(api.characterExtras.augmentSwapOpen, { characterId }))).toBe("UNAUTHENTICATED");
      expect(await fail(outsider.query(api.characterExtras.augmentSwapOpen, { characterId }))).toBe("NOT_FOUND");
    });
  });

  describe("remnant Corruption Track (CB 295)", () => {
    it("shows the six-box track only for a Beastbound ranger in Motherboard with the rule on", async () => {
      const mb = await setup("motherboard");
      expect(await mb.p2.query(api.characterExtras.corruption, { characterId: mb.characterId })).toMatchObject({
        trackSize: 6,
        marks: 0,
        remnant: false,
        lost: false,
        canEdit: false,
        canRepair: false,
      });
      expect(await mb.gm.query(api.characterExtras.corruption, { characterId: mb.characterId })).toMatchObject({ canEdit: true, canRepair: true });
      await mb.gm.mutation(api.campaigns.setOption, { campaignId: mb.campaignId, option: "remnantCorruption", enabled: false });
      expect(await mb.p1.query(api.characterExtras.corruption, { characterId: mb.characterId })).toBeNull();
      expect(await fail(mb.p1.mutation(api.characterExtras.setCompanionRemnant, { characterId: mb.characterId, remnant: true, idempotencyKey: key() }))).toBe(
        "MECHANIC_DISABLED",
      );

      const warrior = await setup("motherboard", "warrior");
      expect(await warrior.p1.query(api.characterExtras.corruption, { characterId: warrior.characterId })).toBeNull();
      const core = await setup("witherwild");
      expect(await core.p1.query(api.characterExtras.corruption, { characterId: core.characterId })).toBeNull();
    });

    it("the owner or the GM marks a remnant; another player FORBIDDEN, outsiders NOT_FOUND, anonymous UNAUTHENTICATED", async () => {
      const { t, gm, p1, p2, outsider, characterId } = await setup("motherboard");
      const mark = (who: typeof p1, remnant: boolean) => who.mutation(api.characterExtras.setCompanionRemnant, { characterId, remnant, idempotencyKey: key() });
      await mark(p1, true);
      expect((await p1.query(api.characterExtras.corruption, { characterId }))?.remnant).toBe(true);
      await mark(gm, false);
      expect((await p1.query(api.characterExtras.corruption, { characterId }))?.remnant).toBe(false);
      expect(await fail(mark(p2, true))).toBe("FORBIDDEN");
      expect(await fail(mark(outsider, true))).toBe("NOT_FOUND");
      expect(await fail(mark(t as unknown as typeof p1, true))).toBe("UNAUTHENTICATED");
      expect(await fail(outsider.query(api.characterExtras.corruption, { characterId }))).toBe("NOT_FOUND");
      expect(await fail(t.query(api.characterExtras.corruption, { characterId }))).toBe("UNAUTHENTICATED");
    });

    it("the GM's repair clears 1d4 Corruption; players can't repair", async () => {
      const { gm, p1, p2, outsider, characterId, setMarks, corruption } = await setup("motherboard");
      const repair = (who: typeof p1) => who.mutation(api.characterExtras.repairCompanion, { characterId, idempotencyKey: key() });
      await p1.mutation(api.characterExtras.setCompanionRemnant, { characterId, remnant: true, idempotencyKey: key() });
      expect(await fail(repair(gm))).toBe("EXTRA_RULE");
      await setMarks(3);
      expect(await fail(repair(p1))).toBe("FORBIDDEN");
      expect(await fail(repair(p2))).toBe("FORBIDDEN");
      expect(await fail(repair(outsider))).toBe("NOT_FOUND");
      forceDice(2);
      expect(await repair(gm)).toEqual({ die: 2, cleared: 2, marks: 1 });
      expect((await corruption())?.marks[characterId]).toBe(1);
    });

    it("the sixth mark makes the remnant violent: no repair or remnant change; the ranger takes a new companion keeping the training", async () => {
      const { gm, p1, p2, characterId, setMarks, corruption } = await setup("motherboard");
      await p1.mutation(api.characterExtras.saveCompanion, {
        characterId,
        state: { ...INITIAL_COMPANION, name: "Bolt", kind: "Scrap hound", experiences: [{ name: "Tracker", value: 2 }], training: { aware: 1 }, bonusTraining: 1 },
        idempotencyKey: key(),
      });
      await p1.mutation(api.characterExtras.setCompanionRemnant, { characterId, remnant: true, idempotencyKey: key() });
      const replace = (who: typeof p1) => who.mutation(api.characterExtras.replaceCompanion, { characterId, idempotencyKey: key() });
      expect(await fail(replace(p1))).toBe("EXTRA_RULE");
      await setMarks(6);
      expect(await p1.query(api.characterExtras.corruption, { characterId })).toMatchObject({ marks: 6, lost: true });
      expect(await fail(gm.mutation(api.characterExtras.repairCompanion, { characterId, idempotencyKey: key() }))).toBe("EXTRA_RULE");
      expect(await fail(p1.mutation(api.characterExtras.setCompanionRemnant, { characterId, remnant: false, idempotencyKey: key() }))).toBe("EXTRA_RULE");
      expect(await fail(replace(p2))).toBe("FORBIDDEN");

      await replace(p1);
      expect(await p1.query(api.characterExtras.corruption, { characterId })).toMatchObject({ marks: 0, remnant: false, lost: false });
      expect((await corruption())?.marks).toEqual({});
      const companion = (await p1.query(api.characterExtras.get, { characterId })).companion;
      expect(companion).toMatchObject({ name: "", kind: "", experiences: [], training: { aware: 1 }, bonusTraining: 1 });
    });
  });
});
