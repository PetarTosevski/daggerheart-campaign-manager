/**
 * A Beastform ends on its end events after a resolved hit, and Evolution's +1 with it (plan drawer-answers DA10,
 * dcm-bxp.99.19.6 (1); docs/tasks/TASK-DA-DA10.md).
 *
 * CB p.30 Beastform: "If you mark your last Hit Point, you automatically drop out of this form." CB p.32 (Fragile, the
 * Agile Scout, Aquatic Scout, Household Friend and Nimble Grazer): "When you take Major or greater damage, you drop out of
 * Beastform." CB p.30 Evolution: "choose one trait to raise by +1 until you drop out of that Beastform." CB p.34 Legendary
 * Beast: "you retain all traits and features from the original form".
 *
 * Damage (CB p.91): Chainmail at level 1 gives thresholds 8 / 16: 3 is Minor (1 HP), 10 Major (2 HP).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { beastformEnds, bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const form = (text: string): Effect => ({ id: "beastform", source: "Beastform", text, until: "manual" });
const EVOLUTION: Effect = { id: "evolution", source: "Evolution", text: "Evolution: +1 Agility", until: "manual" };
const OTHER: Effect = { id: "other:1", source: "Something else", text: "Stays", until: "scene" };

describe("beastformEnds", () => {
  const sheet = (effects: Effect[]) => ({ effects }) as unknown as CharacterSheet;

  it("a Fragile form on Major or Severe damage, any form on the last Hit Point; Evolution goes with it", () => {
    const scout = sheet([form("Agile Scout"), EVOLUTION, OTHER]);
    expect(beastformEnds(scout, { lastHp: false, severity: "minor" })).toBeNull();
    expect(beastformEnds(scout, { lastHp: false, severity: "major" })!.sheet.effects).toEqual([OTHER]);
    expect(beastformEnds(scout, { lastHp: false, severity: "severe" })).not.toBeNull();
    const sentry = sheet([form("Armored Sentry"), EVOLUTION]);
    expect(beastformEnds(sentry, { lastHp: false, severity: "severe" })).toBeNull();
    expect(beastformEnds(sentry, { lastHp: true, severity: "minor" })!.sheet.effects).toEqual([]);
  });

  it("an Evolved form keeps its base form's Fragile; no form, nothing ends", () => {
    expect(beastformEnds(sheet([form("Legendary Beast (Agile Scout)")]), { lastHp: false, severity: "major" })).not.toBeNull();
    expect(beastformEnds(sheet([form("Legendary Beast (Armored Sentry)")]), { lastHp: false, severity: "major" })).toBeNull();
    expect(beastformEnds(sheet([EVOLUTION]), { lastHp: true, severity: "severe" })).toBeNull();
  });
});

async function arena(effects: Effect[], hp = 0) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bear = await ctx.db.insert("encounterAdversaries", { campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, label: "Bear", order: 0, summoned: false, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "druid", subclassId: "warden-of-the-elements", subclassRank: "foundation", armorId: "chainmail-armor", armorMarked: 0, hp, stress: 0, effects, domainCards: { owned: [], loadout: [] } });
    return { encounterId, bear };
  });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  /** A physical hit of `amount` on Ash, answered without armor; returns its group's rows. */
  const hit = async (amount: number) => {
    const groupId = `g-${key()}`;
    const { requestId } = await t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId,
        encounterId: ids.encounterId,
        createdBy: w.users.gm,
        groupId,
        attacker: { instanceId: ids.bear, label: "Bear" },
        targetCharacterId: w.characterA,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
      }),
    );
    await player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId: w.characterA, choice: { kind: "noArmor" } as never, idempotencyKey: key() });
    return (await rows()).filter((r) => r.groupId === groupId);
  };
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, sheet, hit, undo };
}

describe("after a resolved hit (convex)", () => {
  it("a Fragile form drops out on Major damage with Evolution; the row says so; the GM's undo restores both", async () => {
    const a = await arena([form("Agile Scout"), EVOLUTION]);
    const minor = await a.hit(3);
    expect((await a.sheet()).effects.map((e) => e.id)).toEqual(["beastform", "evolution"]);
    expect(minor.find((r) => r.before !== undefined)!.summary).not.toContain("Beastform");

    const major = await a.hit(10);
    expect((await a.sheet()).effects).toEqual([]);
    const row = major.find((r) => r.before !== undefined)!;
    expect(row.summary).toContain("drops out of Beastform");
    await a.undo(row._id);
    expect((await a.sheet()).effects.map((e) => e.id)).toEqual(["beastform", "evolution"]);
  });

  it("a form without Fragile stays on Major damage and drops out on the last Hit Point", async () => {
    const a = await arena([form("Armored Sentry"), EVOLUTION]);
    await a.hit(10);
    expect((await a.sheet()).effects.map((e) => e.id)).toEqual(["beastform", "evolution"]);
    const s = await a.sheet();
    expect(s.hp).toBe(2);
    // One Hit Point short of the last, a Minor hit (1 HP) marks the last one.
    const b = await arena([form("Armored Sentry"), EVOLUTION], s.hpMax - 1);
    await b.hit(3);
    const after = await b.sheet();
    expect(after.hp).toBe(after.hpMax);
    expect(after.effects).toEqual([]);
  });
});
