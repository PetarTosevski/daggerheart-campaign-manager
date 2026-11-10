/**
 * Plan rule-switches WR (docs/tasks/TASK-RULES-WR.md): the roll-cost rules. Manual rules post a GM-only `rule` note in
 * the roll's group (undo takes it back).
 *
 * - R2 `criticalSuccess` (CB p.90): Book +1 Hope and 1 Stress cleared in total; Manual applies neither, the GM gets
 *   "Ash rolled a critical: gain 1 Hope and clear 1 Stress?".
 * - R6 `experienceCost` (CB p.90): Manual adds the modifier, takes no Hope, never refuses at 0 Hope.
 * - R7 `helpAnAlly` (CB p.90): Book names the helpers (1 Hope each, refused without, a row each, undo refunds); Manual is
 *   the counter and a note.
 * - R8 `tagTeam` (CB p.97): Book once per session for 3 Hope; `noSessionLimit` 3 Hope, no limit; Manual neither, a note.
 * - R10 `criticalDamage` (CB p.98): Manual rolls a critical like a normal hit, the GM gets the maximum to add.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;

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
    primaryWeaponId: PRIMARY.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

type Modes = NonNullable<Doc<"campaigns">["ruleModes"]>;

/** A campaign with a GM and two players' characters (Ash, Bryn), in the given rule modes. */
async function setup(modes: Modes = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { ruleModes: modes }));
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const live = async () => (await rows()).filter((r) => r.undoneAt === undefined);
  const notes = async () => (await live()).filter((r) => r.kind === "rule");
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { t, gm, p1, p2, campaignId, a, b, sheetOf, edit, rows, live, notes, undo };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
const weapon = { source: { kind: "weapon" as const, slot: "primary" as const }, critical: false, modifier: 0, options: [] };
const side = { trait: "agility" as const, modifier: 0 };

describe("R2 criticalSuccess (CB p.90)", () => {
  useAllowlist(EMAILS);

  it("Book: a critical gives exactly +1 Hope and clears 1 Stress in total (never a second Hope), no note", async () => {
    const { p1, a, sheetOf, edit, notes } = await setup();
    await edit(a, { hope: 2, stress: 3 });
    const { roll } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, difficulty: 30 }, values: [5, 5], idempotencyKey: key() });
    expect(roll.outcome).toBe("critical");
    expect(await sheetOf(a)).toMatchObject({ hope: 3, stress: 2 });
    expect(await notes()).toEqual([]);
  });

  it("Manual: the critical still succeeds, but no Hope and no Stress; the GM gets a note, undone with the roll", async () => {
    const { p1, a, sheetOf, edit, notes, undo } = await setup({ criticalSuccess: "manual" });
    await edit(a, { hope: 2, stress: 3 });
    const { roll, entryId } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, difficulty: 30 }, values: [5, 5], idempotencyKey: key() });
    expect(roll.outcome).toBe("critical");
    expect(await sheetOf(a)).toMatchObject({ hope: 2, stress: 3 });
    const [note] = await notes();
    expect(note).toMatchObject({ ruleId: "criticalSuccess", visibility: "gm", summary: "Ash rolled a critical: gain 1 Hope and clear 1 Stress?" });
    await undo(entryId);
    expect(await notes()).toEqual([]);
  });

  it("Manual on a Tag Team's chosen critical: neither PC gains; one note for both", async () => {
    const { p1, a, b, sheetOf, edit, notes } = await setup({ criticalSuccess: "manual" });
    await edit(a, { hope: 5, stress: 2 });
    await edit(b, { hope: 1, stress: 2 });
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
      if (buf instanceof Uint32Array) buf.fill(6);
      return buf;
    });
    const { rolls } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    vi.restoreAllMocks();
    expect(rolls[0]!.roll.outcome).toBe("critical");
    await p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() });
    expect(await sheetOf(a)).toMatchObject({ hope: 2, stress: 2 });
    expect(await sheetOf(b)).toMatchObject({ hope: 1, stress: 2 });
    expect((await notes()).map((n) => n.summary)).toContain("Ash and Bryn rolled a critical: each gain 1 Hope and clear 1 Stress?");
  });
});

describe("R6 experienceCost (CB p.90)", () => {
  useAllowlist(EMAILS);

  it("Manual: the Experience adds its value, costs no Hope (none needed) and notes the GM", async () => {
    const { p1, a, sheetOf, edit, notes } = await setup({ experienceCost: "manual" });
    await edit(a, { hope: 0 });
    const exp = (await sheetOf(a)).experiences[0]!;
    const { roll } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, kind: "reaction", experienceIds: [exp.id] }, values: [3, 8], idempotencyKey: key() });
    expect(roll.total).toBe(3 + 8 + 2 + exp.value);
    expect((await sheetOf(a)).hope).toBe(0);
    expect((await notes()).map((n) => n.summary)).toEqual([`Ash used ${exp.name} (+${exp.value}): spend 1 Hope?`]);
  });

  it("Book still refuses an Experience without Hope", async () => {
    const { p1, a, sheetOf, edit } = await setup();
    await edit(a, { hope: 0 });
    const exp = (await sheetOf(a)).experiences[0]!;
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, experienceIds: [exp.id], idempotencyKey: key() }))).toBe("NOT_ENOUGH_HOPE");
  });
});

describe("R7 helpAnAlly (CB p.90)", () => {
  useAllowlist(EMAILS);

  it("Book: the helper pays 1 Hope, adds a d6, gets a feed row; undo refunds it", async () => {
    const { p1, a, b, sheetOf, edit, live, undo } = await setup();
    await edit(b, { hope: 2 });
    const { roll, entryId } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, helpers: [b] }, values: [3, 8, 5], idempotencyKey: key() });
    expect(roll.dice.filter((d) => d.role === "help").map((d) => d.value)).toEqual([5]);
    expect(roll.total).toBe(3 + 8 + 2 + 5);
    expect((await sheetOf(b)).hope).toBe(1);
    const row = (await live()).find((r) => r.characterId === b);
    expect(row).toMatchObject({ kind: "feature", visibility: "public", summary: "Bryn helped Ash (−1 Hope)" });
    expect(row!.groupId).toBeDefined();
    await undo(entryId);
    expect((await sheetOf(b)).hope).toBe(2);
  });

  it("Book refuses the bare counter, a helper without Hope, the roller, a dead helper and help on a reaction roll", async () => {
    const { t, p1, a, b, edit, sheetOf } = await setup();
    const roll = (extra: Record<string, unknown>) => p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, ...extra, idempotencyKey: key() });
    expect(await codeOf(roll({ help: 1 }))).toBe("DICE_RULE");
    await edit(b, { hope: 0 });
    expect(await codeOf(roll({ helpers: [b] }))).toBe("NOT_ENOUGH_HOPE");
    expect(await codeOf(roll({ helpers: [a] }))).toBe("DICE_RULE");
    expect(await codeOf(roll({ helpers: [b, b] }))).toBe("DICE_RULE");
    await edit(b, { hope: 3 });
    expect(await codeOf(roll({ kind: "reaction", helpers: [b] }))).toBe("DICE_RULE");
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "dead" }));
    expect(await codeOf(roll({ helpers: [b] }))).toBe("DICE_RULE");
    expect((await sheetOf(b)).hope).toBe(3);
  });

  it("Manual: the counter adds its dice, takes no Hope and notes the GM", async () => {
    const { p1, a, b, sheetOf, edit, notes } = await setup({ helpAnAlly: "manual" });
    await edit(b, { hope: 2 });
    const { roll } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, help: 2 }, values: [3, 8, 5, 2], idempotencyKey: key() });
    expect(roll.dice.filter((d) => d.role === "help")).toHaveLength(2);
    expect((await sheetOf(b)).hope).toBe(2);
    expect((await notes()).map((n) => n.summary)).toEqual(["2 PCs helped Ash: each spends 1 Hope?"]);
  });
});

describe("R8 tagTeam (CB p.97)", () => {
  useAllowlist(EMAILS);

  it("No session limit: 3 Hope each time, a second Tag Team allowed", async () => {
    const { p1, gm, a, b, sheetOf, edit, notes } = await setup({ tagTeam: "noSessionLimit" });
    await edit(a, { hope: 6 });
    const first = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    await gm.mutation(api.rolls.tagTeamApply, { entryId: first.rolls[0]!.entryId, pick: a, idempotencyKey: key() });
    const hope = (await sheetOf(a)).hope;
    await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    expect((await sheetOf(a)).hope).toBe(hope - 3);
    expect((await notes()).filter((n) => n.ruleId === "tagTeam")).toEqual([]);
  });

  it("Book refuses a second one; Manual takes no Hope, checks no limit and notes the GM", async () => {
    const book = await setup();
    await book.edit(book.a, { hope: 6 });
    await book.p1.mutation(api.rolls.tagTeam, { characterId: book.a, partnerId: book.b, initiator: side, partner: side, idempotencyKey: key() });
    expect(await codeOf(book.p1.mutation(api.rolls.tagTeam, { characterId: book.a, partnerId: book.b, initiator: side, partner: side, idempotencyKey: key() }))).toBe("DICE_RULE");

    const { p1, gm, a, b, sheetOf, edit, notes } = await setup({ tagTeam: "manual" });
    await edit(a, { hope: 0 });
    const first = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    await gm.mutation(api.rolls.tagTeamApply, { entryId: first.rolls[0]!.entryId, pick: b, idempotencyKey: key() });
    await edit(a, { hope: 0 });
    await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    expect((await sheetOf(a)).hope).toBe(0);
    expect((await notes()).filter((n) => n.ruleId === "tagTeam").map((n) => n.summary)).toEqual(["Ash started a Tag Team: spend 3 Hope?", "Ash started a Tag Team (again this session): spend 3 Hope?"]);
  });
});

describe("R10 criticalDamage (CB p.98)", () => {
  useAllowlist(EMAILS);

  it("Manual: a critical damage roll adds no maximum; the GM gets the maximum to add, undone with the roll", async () => {
    const sides = Number(/^d(\d+)/.exec(PRIMARY.damage)![1]);
    const book = await setup();
    const bookRoll = await book.p1.mutation(api.rolls.manualRoll, { characterId: book.a, roll: { kind: "damage", ...weapon, critical: true }, values: [2], idempotencyKey: key() });
    const { p1, a, notes, undo } = await setup({ criticalDamage: "manual" });
    const { roll, entryId } = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { kind: "damage", ...weapon, critical: true }, values: [2], idempotencyKey: key() });
    expect(bookRoll.roll.total - roll.total).toBe(sides);
    expect((await notes()).map((n) => n.summary)).toEqual([`Ash: critical, add ${sides} (the dice's maximum)?`]);
    await undo(entryId);
    expect(await notes()).toEqual([]);
  });
});

// ---------------------------------------------------------------- the attack panel (R7 helpers, R10 on an attack)

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn, then repeat. */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function arena(modes: Modes = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const tokenId = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 1, major: 100, severe: 200, hpMax: 9, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
  });
  const hopeOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet).hope);
  const setHope = (id: Id<"characters">, hope: number) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), hope }));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const attack = (extra: { help?: number; helpers?: Id<"characters">[] } = {}) =>
    player.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds: [tokenId], slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], ...extra, idempotencyKey: key() });
  return { w, gm, attack, hopeOf, setHope, rows };
}

describe("the attack panel", () => {
  it("R7 Book: a ticked helper pays 1 Hope in the attack's group; undo refunds it", async () => {
    const a = await arena();
    await a.setHope(a.w.characterB, 2);
    dice(10, 3, 4, 8);
    const r = await a.attack({ helpers: [a.w.characterB] });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.roll.dice.some((d) => d.role === "help")).toBe(true);
    expect(await a.hopeOf(a.w.characterB)).toBe(1);
    const row = (await a.rows()).find((x) => x.characterId === a.w.characterB && x.summary.includes("helped"));
    expect(row?.groupId).toBe((await a.rows()).find((x) => x._id === r.entryId)?.groupId);
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect(await a.hopeOf(a.w.characterB)).toBe(2);
    expect(errorCode(await a.attack({ help: 1 }).catch((e: unknown) => e))).toBe("DICE_RULE");
  });

  it("R7 Manual and R10 Manual on a critical attack: the counter's note and the damage maximum's note", async () => {
    const a = await arena({ helpAnAlly: "manual", criticalDamage: "manual" });
    dice(7, 7, 4, 8);
    const r = await a.attack({ help: 1 });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.roll.outcome).toBe("critical");
    const summaries = (await a.rows()).filter((x) => x.kind === "rule").map((x) => x.summary);
    expect(summaries).toContain("1 PC helped Ash: spend 1 Hope?");
    expect(summaries.some((s) => /^Ash: critical, add \d+ \(the dice's maximum\)\?$/.test(s))).toBe(true);
  });
});
