// The optional `sessionFeatures` sheet field (session-features F0): widened without a SHEET_VERSION bump.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, WEAPONS } from "../../src/lib/srd/index";
import { SHEET_VERSION, type CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: "call-of-the-slayer",
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
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com" }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const id = (await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const raw = () => t.run(async (ctx) => (await ctx.db.get("characters", id))!.sheet as Record<string, unknown>);
  const save = (f: (s: CharacterSheet) => CharacterSheet) => t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  return { t, gm, id: id as Id<"characters">, raw, save };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e) ?? (e as Error).name;
  }
}

describe("sheet.sessionFeatures (widened, optional)", () => {
  useAllowlist("gm@example.com");

  it("a stored sheet without it still reads, as version 2, through readSheet and characters.get", async () => {
    const { gm, id, raw } = await setup();
    const stored = await raw();
    expect(stored.schemaVersion).toBe(SHEET_VERSION);
    expect(SHEET_VERSION).toBe(2);
    expect("sessionFeatures" in stored).toBe(false);
    expect(readSheet(stored).sessionFeatures).toBeUndefined();
    const view = await gm.query(api.characters.get, { characterId: id });
    expect(view?.sheet.sessionFeatures).toBeUndefined();
  });

  it("a sheet with it round-trips through saveSheet / readSheet and the view validator", async () => {
    const { gm, id, raw, save } = await setup();
    const features = { slayerDice: 2, slayerClaim: "k57abc", tideTokens: 3, moonDie: 6 };
    await save((s) => ({ ...s, sessionFeatures: features }));
    const stored = await raw();
    expect(stored.schemaVersion).toBe(2);
    expect(stored.sessionFeatures).toEqual(features);
    expect(readSheet(stored).sessionFeatures).toEqual(features);
    const view = await gm.query(api.characters.get, { characterId: id });
    expect(view?.sheet.sessionFeatures).toEqual(features);

    await save((s) => ({ ...s, sessionFeatures: { moonDie: 1 } }));
    expect(readSheet(await raw()).sessionFeatures).toEqual({ moonDie: 1 });
    await save((s) => ({ ...s, sessionFeatures: {} }));
    expect(readSheet(await raw()).sessionFeatures).toEqual({});
  });

  it("refuses out-of-range values (the zod schema runs on save)", async () => {
    const { save, raw } = await setup();
    const bad: CharacterSheet["sessionFeatures"][] = [
      { slayerDice: 11 },
      { slayerDice: -1 },
      { slayerDice: 1.5 },
      { tideTokens: 11 },
      { moonDie: 0 },
      { moonDie: 7 },
      { slayerClaim: "" },
      { slayerClaim: "x".repeat(41) },
    ];
    for (const sessionFeatures of bad) {
      expect(await codeOf(save((s) => ({ ...s, sessionFeatures })))).toBe("ZodError");
    }
    expect((await raw()).sessionFeatures).toBeUndefined();
  });
});
