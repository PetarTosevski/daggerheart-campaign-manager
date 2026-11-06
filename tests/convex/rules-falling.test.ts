/**
 * Optional rule "Falling and collision damage" (plan rule-switches OFA; CB p.168; user answer Q10 a): the GM's
 * `combatHazards.fall` on a PC's token rolls the book's damage and hits the PC through the normal incoming hit.
 *
 * CB p.168: "A fall from Very Close range deals 1d10+3 physical damage. A fall from Close range deals 1d20+5 physical
 * damage. A fall from Far or Very Far range deals 1d100+15 physical damage, or death at the GM's discretion. If a
 * character collides with an object or another character at a dangerous speed, they take 1d20+5 direct physical damage."
 *
 * Every assertion reads the rolled numbers back (the roll record on the GM row, the damage on the hit row), so it holds
 * for every roll.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { pcSeverity } from "../../src/lib/domain/adversary-actions/index";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { HAZARDS, hazardFormula, rollHazard, type HazardKind } from "../../src/lib/domain/hazards";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

type RuleChange = { key: "fallingDamage" | "armorSlots" | "massiveDamage"; value: string | boolean };

/** The authz world with a live map holding Ash's token (characterA: level 1, Chainmail, nothing marked). */
async function arena(opts: { rules?: RuleChange[]; on?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const rules: RuleChange[] = [...(opts.on === false ? [] : [{ key: "fallingDamage" as const, value: true }]), ...(opts.rules ?? [])];
  for (const change of rules) await gm.mutation(api.ruleSettings.set, { campaignId, change } as never);
  await t.run(async (ctx) => {
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, conditions: [], effects: [], domainCards: { owned: [], loadout: [] } });
  });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const { tokenId, objectToken } = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const npc = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "custom", name: "Guard", hp: 0, hpMax: 3, stress: 0, stressMax: 2, conditions: [] }, side: "neutral", x: 8, y: 10, face: 0 });
    return { tokenId, objectToken: npc };
  });
  const fall = (kind: HazardKind, idempotencyKey = key()) => gm.mutation(api.combatHazards.fall, { campaignId, tokenId, kind, idempotencyKey });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const group = async (groupId: string) => (await rows()).filter((r) => r.groupId === groupId);
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const request = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))! as Doc<"combatRequests"> & { payload: { damage: number; direct: boolean; attacker: { kind?: string; label: string } } });
  const answer = (requestId: Id<"combatRequests">, choice: { kind: "noArmor" } | { kind: "armor" }) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId: w.characterA, choice, idempotencyKey: key() });
  const pending = () => player.query(api.adversaryActionsReads.pending, { campaignId, characterId: w.characterA });
  const feed = (c: typeof gm) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  const resetSheet = () =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, armorMarked: 0, hp: 0, stress: 0 });
    });
  return { w, t, gm, player, campaignId, tokenId, objectToken, fall, rows, group, notes, sheet, request, answer, pending, feed, resetSheet };
}

const thresholdsOf = (s: CharacterSheet) => derivedThresholds(s);

/** The roll on the fall's GM row, checked against the book's dice for `kind`. */
async function checkedRoll(a: Awaited<ReturnType<typeof arena>>, groupId: string, kind: HazardKind) {
  const gmRow = (await a.group(groupId)).find((r) => r.visibility === "gm" && r.roll !== undefined)!;
  const roll = gmRow.roll!;
  const h = HAZARDS[kind];
  expect(roll.kind).toBe("damage");
  expect(roll.dice).toHaveLength(1);
  expect(roll.dice[0]).toMatchObject({ sides: h.sides, role: "damage" });
  expect(roll.dice[0]!.value).toBeGreaterThanOrEqual(1);
  expect(roll.dice[0]!.value).toBeLessThanOrEqual(h.sides);
  expect(roll.modifier).toBe(h.flat);
  expect(roll.total).toBe(roll.dice[0]!.value + h.flat);
  return { gmRow, roll };
}

describe("OFA: the pure hazard table (CB p.168)", () => {
  it("rolls the book's dice for each kind", () => {
    expect(hazardFormula("veryClose")).toBe("1d10+3");
    expect(hazardFormula("close")).toBe("1d20+5");
    expect(hazardFormula("far")).toBe("1d100+15");
    expect(hazardFormula("collision")).toBe("1d20+5");
    expect(HAZARDS.collision.direct).toBe(true);
    expect([HAZARDS.veryClose, HAZARDS.close, HAZARDS.far].every((h) => !h.direct)).toBe(true);
    for (const kind of ["veryClose", "close", "far", "collision"] as const) {
      const seen: number[] = [];
      const r = rollHazard(kind, (sides) => {
        seen.push(sides);
        return sides; // the highest face
      });
      expect(seen).toEqual([HAZARDS[kind].sides]);
      expect(r.total).toBe(HAZARDS[kind].sides + HAZARDS[kind].flat);
      expect(rollHazard(kind, () => 1).total).toBe(1 + HAZARDS[kind].flat);
    }
  });
});

describe("OFA: combatHazards.fall", () => {
  it("off (the default): MECHANIC_DISABLED, nothing written", async () => {
    const a = await arena({ on: false });
    expect(errorCode(await a.fall("close").catch((e: unknown) => e))).toBe("MECHANIC_DISABLED");
    expect((await a.rows()).filter((r) => r.kind === "combat")).toEqual([]);
  });

  it("a fall from Close range: 1d20+5 physical; the hit waits for Ash's Armor Slot answer; the slot steps it down", async () => {
    const a = await arena();
    const before = await a.sheet();
    const r = await a.fall("close");
    const { roll, gmRow } = await checkedRoll(a, r.groupId, "close");
    expect(r.damage).toBe(roll.total);
    expect(gmRow.summary).toBe(`Ash: Fall from Close: 1d20+5 = ${roll.total} physical`);
    const row = await a.request(r.requestId);
    expect(row.payload).toMatchObject({ damage: roll.total, direct: false, attacker: { kind: "hazard", label: "a fall from Close range" } });
    expect(r.resolved).toBe(false);
    const view = (await a.pending()).find((p) => p.requestId === r.requestId)!;
    expect(view).toMatchObject({ role: "target", awaiting: true, maxSlots: 1, damage: roll.total, attackerLabel: "a fall from Close range" });
    const withSlot = view.armorPreview!.find((p) => p.slots === 1)!;
    await a.answer(r.requestId, { kind: "armor" });
    const s = await a.sheet();
    expect(s.armorMarked).toBe(1);
    expect(s.hp).toBe(withSlot.hp);
    expect(withSlot.hp).toBeLessThanOrEqual(pcSeverity(roll.total, thresholdsOf(before)).hp);
    // The public rows name the fall, never the number (Q14).
    const publicRows = (await a.group(r.groupId)).filter((x) => x.visibility === "public").map((x) => x.summary);
    expect(publicRows).toContain("Ash falls from Close range");
    expect(publicRows).toContain("Ash took damage from a fall from Close range");
    expect(publicRows.some((x) => x.includes(String(roll.total)))).toBe(false);
  });

  it("a fall from Very Close range rolls 1d10+3", async () => {
    const a = await arena();
    const r = await a.fall("veryClose");
    const { roll } = await checkedRoll(a, r.groupId, "veryClose");
    expect((await a.request(r.requestId)).payload.damage).toBe(roll.total);
  });

  it("a fall from Far or Very Far: 1d100+15, and the GM row adds 'or death at the GM's discretion'", async () => {
    const a = await arena();
    const r = await a.fall("far");
    const { roll, gmRow } = await checkedRoll(a, r.groupId, "far");
    expect(gmRow.summary).toBe(`Ash: Fall from Far or Very Far: 1d100+15 = ${roll.total} physical, or death at the GM's discretion`);
    expect((await a.feed(a.player)).page.some((x) => x.summary.includes("death at the GM's discretion"))).toBe(false);
  });

  it("a collision: 1d20+5 direct physical; no Armor Slot offered, so it lands at once at full severity", async () => {
    const a = await arena();
    const before = await a.sheet();
    const r = await a.fall("collision");
    const { roll, gmRow } = await checkedRoll(a, r.groupId, "collision");
    expect(gmRow.summary).toBe(`Ash: Collision: 1d20+5 = ${roll.total} direct physical`);
    expect((await a.request(r.requestId)).payload.direct).toBe(true);
    expect(r.resolved).toBe(true);
    const s = await a.sheet();
    expect(s.hp).toBe(pcSeverity(roll.total, thresholdsOf(before)).hp);
    expect(s.armorMarked).toBe(0);
  });

  it("A1 Manual: no Armor Slot offered; the fall lands at full severity and the GM gets the note in its group", async () => {
    const a = await arena({ rules: [{ key: "armorSlots", value: "manual" }] });
    const before = await a.sheet();
    const r = await a.fall("close");
    expect(r.resolved).toBe(true);
    const expected = pcSeverity(r.damage, thresholdsOf(before));
    expect((await a.sheet()).hp).toBe(expected.hp);
    const word = { minor: "Minor", major: "Major", severe: "Severe", none: "no" }[expected.severity];
    expect(await a.notes()).toMatchObject([{ ruleId: "armorSlots", visibility: "gm", groupId: r.groupId, summary: `Ash took ${word} damage; Armor Slot not offered` }]);
  });

  it("Massive Damage on: a Far fall at twice the Severe threshold previews 4 HP, 3 with an Armor Slot (Severe)", async () => {
    const a = await arena({ rules: [{ key: "massiveDamage", value: true }] });
    const severe = thresholdsOf(await a.sheet()).severe;
    // 1d100+15 reaches twice the Severe threshold most of the time; roll until it does (a short fall is resolved and reset).
    for (let i = 0; i < 40; i++) {
      const r = await a.fall("far");
      if (r.damage < 2 * severe) {
        await a.gm.mutation(api.adversaryActions.resolve, { campaignId: a.campaignId, requestId: r.requestId, idempotencyKey: key() });
        await a.resetSheet();
        continue;
      }
      const view = (await a.pending()).find((p) => p.requestId === r.requestId)!;
      expect(view.armorPreview?.map((p) => [p.slots, p.severity, p.hp])).toEqual([
        [0, "severe", 4],
        [1, "severe", 3],
      ]);
      await a.answer(r.requestId, { kind: "armor" });
      expect((await a.sheet()).hp).toBe(3);
      return;
    }
    throw new Error("no Far fall reached twice the Severe threshold in 40 rolls");
  });

  it("one undo of the GM row reverts the fall and its hit", async () => {
    const a = await arena();
    const r = await a.fall("collision");
    expect((await a.sheet()).hp).toBeGreaterThan(0);
    const gmRow = (await a.group(r.groupId)).find((x) => x.visibility === "gm" && x.roll !== undefined)!;
    await a.gm.mutation(api.actionLog.undo, { entryId: gmRow._id, idempotencyKey: key() });
    expect((await a.sheet()).hp).toBe(0);
  });

  it("is keyed: a retry with the same key rolls nothing new", async () => {
    const a = await arena();
    const k = key();
    const first = await a.fall("close", k);
    const again = await a.fall("close", k);
    expect(again).toEqual(first);
    expect((await a.rows()).filter((x) => x.visibility === "gm" && x.roll !== undefined)).toHaveLength(1);
  });

  it("only a PC's token: another token is COMBAT_TARGET_INVALID", async () => {
    const a = await arena();
    const code = errorCode(await a.gm.mutation(api.combatHazards.fall, { campaignId: a.campaignId, tokenId: a.objectToken, kind: "close", idempotencyKey: key() }).catch((e: unknown) => e));
    expect(code).toBe("COMBAT_TARGET_INVALID");
  });
});
