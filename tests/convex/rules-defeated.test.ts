/**
 * Plan rule-switches, tracer DEF (docs/tasks/TASK-RULES-DEF.md):
 * - D8 Manual (bead dcm-jh6d.68; CB p.208 "When an adversary marks their last Hit Point, they are defeated"): the GM's
 *   Defeated button (`encounterTracking.markDefeated`), and every reader of "defeated" goes by the flag under Manual.
 * - `characters.adjustResource` follows D4 / D5 (bead dcm-jh6d.71; CB p.92).
 * - jh6d.69: X1 Manual notes on the sheet's last-HP paths, the GM records a death move in X1 Manual, the feed's undo
 *   makes a death move due again (CB p.106).
 * Refusals assert error codes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { loadActor } from "../../convex/lib/adversaryFeatures";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { adversaryDown } from "../../convex/lib/combatTokenViews";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { StoredRuleModes } from "../../src/lib/rules/registry";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // HP 7, Stress 2
const LACKEYS = { kind: "srd" as const, adversaryId: "jagged-knife-lackey" }; // Minion

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function running(modes: StoredRuleModes = {}) {
  const ctx = await setupWithCampaign();
  const { t, campaignId, gm } = ctx;
  await t.run((c) => c.db.patch("campaigns", campaignId, { ruleModes: modes }));
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: key() });
  const add = async (source: typeof BEAR | typeof LACKEYS = BEAR, count = 1) =>
    (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() })).instanceIds[0]!;
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  const instance = async (id: string) => (await gm.query(api.encounters.get, { campaignId, encounterId }))!.instances.find((i) => i._id === id)!;
  const rows = () => t.run((c) => c.db.query("actionLog").collect());
  const markHp = (instanceId: string, delta: number) => gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId, delta, idempotencyKey: key() });
  const markDefeated = (instanceId: string) => gm.mutation(api.encounterTracking.markDefeated, { campaignId, instanceId, idempotencyKey: key() });
  const spotlight = (instanceId: string) => gm.mutation(api.encounterTracking.spotlight, { campaignId, instanceId, idempotencyKey: key() });
  /** The adversary's own actions (`loadActor`: attack and features). */
  const act = (instanceId: string) =>
    t.run(async (c) => {
      const campaign = (await c.db.get("campaigns", campaignId))!;
      await loadActor(c, campaign, instanceId);
      return "ok";
    });
  return { ...ctx, encounterId, add, instance, rows, markHp, markDefeated, spotlight, act };
}

describe("D8 Manual: the GM's Defeated button", () => {
  useAllowlist();

  it("at its last HP the adversary stays up (spotlight, actions) until the GM marks it defeated; the GM's undo stands it back up", async () => {
    const a = await running({ adversaryDefeated: "manual" });
    const id = await a.add();
    expect(await a.markHp(id, 7)).toEqual({ hp: 7, stress: 0, defeated: false });
    expect(await code(a.act(id))).toBe("ok");
    expect(await code(a.spotlight(id))).toBe("ok");

    expect(await a.markDefeated(id)).toEqual({ hp: 7, stress: 0, defeated: true });
    expect((await a.instance(id)).defeated).toBe(true);
    expect(await code(a.spotlight(id))).toBe("ADVERSARY_DEFEATED");
    expect(await code(a.act(id))).toBe("ADVERSARY_DEFEATED");
    const row = (await a.rows()).find((r) => r.kind === "adversary")!;
    expect(row).toMatchObject({ visibility: "gm", undoable: true, summary: "Bear marked defeated" });
    expect((await a.rows()).filter((r) => r.visibility === "public")).toEqual([]);

    await a.gm.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    expect(await a.instance(id)).toMatchObject({ hp: 7, defeated: false });
    expect(await code(a.act(id))).toBe("ok");
  });

  it("revive works on an adversary the GM marked defeated, not on one merely at its last HP", async () => {
    const a = await running({ adversaryDefeated: "manual" });
    const id = await a.add();
    await a.markHp(id, 7);
    const revive = () => a.gm.mutation(api.encounterTracking.reviveInstance, { campaignId: a.campaignId, instanceId: id, hp: 0, stress: 0, idempotencyKey: key() });
    expect(await code(revive())).toBe("ENCOUNTER_RULE");
    await a.markDefeated(id);
    expect(await revive()).toEqual({ hp: 0, stress: 0, defeated: false });
  });

  it("refuses in Book, before the last HP, twice, and for a Minion group (ENCOUNTER_RULE)", async () => {
    const book = await running();
    const bear = await book.add();
    await book.markHp(bear, 6);
    expect(await code(book.markDefeated(bear))).toBe("ENCOUNTER_RULE");

    const a = await running({ adversaryDefeated: "manual" });
    const id = await a.add();
    await a.markHp(id, 6);
    expect(await code(a.markDefeated(id))).toBe("ENCOUNTER_RULE");
    await a.markHp(id, 1);
    await a.markDefeated(id);
    expect(await code(a.markDefeated(id))).toBe("ENCOUNTER_RULE");

    const group = await a.add(LACKEYS, 3);
    expect(await code(a.markDefeated(group))).toBe("ENCOUNTER_RULE");
  });

  it("a Minion group still falls with its last Minion in Manual (D6, not D8)", async () => {
    const a = await running({ adversaryDefeated: "manual" });
    const group = await a.add(LACKEYS, 3);
    const max = (await a.instance(group)).stats.hpMax;
    expect((await a.markHp(group, max)).defeated).toBe(true);
    expect(await code(a.spotlight(group))).toBe("ADVERSARY_DEFEATED");
    expect((await a.rows()).filter((r) => r.kind === "rule")).toEqual([]);
  });

  it("Book is unchanged: the last HP defeats it", async () => {
    const a = await running();
    const id = await a.add();
    expect(await a.markHp(id, 7)).toEqual({ hp: 7, stress: 0, defeated: true });
    expect(await code(a.act(id))).toBe("ADVERSARY_DEFEATED");
  });

  it("adversaryDown (the token's grey): Book, the flag or every HP; Manual, the flag only; a Minion group by its last Minion", () => {
    const stats = { hpMax: 7 } as never;
    const at = (hp: number, defeated = false, minionCount?: number) => ({ hp, defeated, stats, ...(minionCount === undefined ? {} : { minionCount }) });
    expect(adversaryDown(at(7))).toBe(true);
    expect(adversaryDown(at(6))).toBe(false);
    expect(adversaryDown(at(6, true))).toBe(true);
    expect(adversaryDown(at(7), { adversaryDefeated: "manual" })).toBe(false);
    expect(adversaryDown(at(7, true), { adversaryDefeated: "manual" })).toBe(true);
    expect(adversaryDown(at(7, false, 7), { adversaryDefeated: "manual" })).toBe(true);
  });
});

// ---------------------------------------------------------------- characters and death moves

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

/** A GM and a player whose warrior Ash has the rule modes asked. */
async function party(modes: StoredRuleModes = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  await t.run((c) => c.db.patch("campaigns", campaignId, { ruleModes: modes }));
  const code_ = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code: code_ });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const edit = (change: (s: CharacterSheet) => CharacterSheet) => t.run(async (ctx) => saveSheet(ctx, a, change(readSheet((await ctx.db.get("characters", a))!.sheet))));
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", a))!.sheet));
  const character = () => t.run(async (ctx) => (await ctx.db.get("characters", a))!);
  const notes = () => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.kind === "rule"));
  const adjust = (resource: "hp" | "stress", delta: number) => p1.mutation(api.characters.adjustResource, { characterId: a, resource, delta });
  return { t, gm, p1, campaignId, a, edit, sheet, character, notes, adjust };
}

describe("characters.adjustResource follows D4 / D5 (jh6d.71)", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it("Book: Stress past a full track marks 1 HP, no note", async () => {
    const f = await party();
    await f.edit((s) => ({ ...s, stress: s.stressMax, hp: 0 }));
    expect(await f.adjust("stress", 1)).toMatchObject({ hp: 1 });
    expect(await f.notes()).toEqual([]);
  });

  it("Manual: the extra Stress is dropped, no HP, and the GM gets the D4 note", async () => {
    const f = await party({ stressOverflow: "manual" });
    await f.edit((s) => ({ ...s, stress: s.stressMax, hp: 0 }));
    const max = (await f.sheet()).stressMax;
    expect(await f.adjust("stress", 1)).toMatchObject({ hp: 0, stress: max });
    expect(await f.notes()).toMatchObject([{ ruleId: "stressOverflow", visibility: "gm", undoable: false, summary: "Ash: Stress full, mark 1 HP?" }]);
  });
});

describe("X1 Manual on the sheet's last-HP paths (jh6d.69)", () => {
  useAllowlist("gm@example.com,p1@example.com");
  const NOTE = "Ash marked their last HP: their death move is made at the table.";

  it("adjustResource and applyDamage note the last HP once, in Manual only", async () => {
    const book = await party();
    await book.edit((s) => ({ ...s, hp: s.hpMax - 1 }));
    await book.adjust("hp", 1);
    expect(await book.notes()).toEqual([]);

    const f = await party({ deathMovePrompt: "manual" });
    await f.edit((s) => ({ ...s, hp: s.hpMax - 2 }));
    await f.adjust("hp", 1);
    expect(await f.notes()).toEqual([]);
    await f.adjust("hp", 1);
    expect(await f.notes()).toMatchObject([{ ruleId: "deathMovePrompt", visibility: "gm", summary: NOTE }]);
    expect((await f.notes())[0]!.characterId).toBeUndefined();
    // Already at the last HP: nothing new.
    await f.adjust("hp", 1);
    expect(await f.notes()).toHaveLength(1);

    await f.edit((s) => ({ ...s, hp: s.hpMax - 1 }));
    await f.p1.mutation(api.characters.applyDamage, { characterId: f.a, damage: 99, useArmorSlot: false, idempotencyKey: key() });
    expect((await f.notes()).map((n) => n.summary)).toEqual([NOTE, NOTE]);
  });
});

describe("X1 Manual: the GM records a death move; the feed's undo makes it due again (jh6d.69)", () => {
  useAllowlist("gm@example.com,p1@example.com");
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the player is refused; the GM's Risk It All rolls nothing (X2 Manual) and its undo from the feed clears deathMoveSpent", async () => {
    const f = await party({ deathMovePrompt: "manual" });
    await f.edit((s) => ({ ...s, hp: s.hpMax }));
    expect(await code(f.p1.mutation(api.deathMoves.choose, { characterId: f.a, move: "riskItAll", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    expect((await f.p1.query(api.deathMoves.state, { characterId: f.a })).gmRecord).toBeUndefined();
    expect(await f.gm.query(api.deathMoves.state, { characterId: f.a })).toMatchObject({ awaitingMove: false, gmRecord: true });

    const r = await f.gm.mutation(api.deathMoves.choose, { characterId: f.a, move: "riskItAll", idempotencyKey: key() });
    expect(r).toMatchObject({ hopeDie: null, fearDie: null, awaitingGm: false });
    expect((await f.character()).deathMoveSpent).toBe(true);
    expect((await f.gm.query(api.deathMoves.state, { characterId: f.a })).gmRecord).toBeUndefined();

    await f.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await f.character()).deathMoveSpent).toBeUndefined();
    expect((await f.gm.query(api.deathMoves.state, { characterId: f.a })).gmRecord).toBe(true);
  });
});
