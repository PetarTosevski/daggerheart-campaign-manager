/**
 * Plan next-batch-1110, tracer NB1 (dcm-12kx, docs/tasks/TASK-NB1.md): `pcMods` reads the mods an adversary's
 * condition or effect leaves on a PC sheet (`card:<adversaryId>/<feature>:<n>`, the card runner's id for an adversary
 * feature), so `pcDamageMods`, `pcFlags` and `pcResistance` see them.
 *
 * - Reality Quake's Unstuck (CB p.237): "they must double the amount spent or marked" → marksMultiplier x2.
 * - Burrowing Leechpoles (HF p.90): "+1 bonus for each leechpole under their skin" → damageTaken add of the tokens.
 * - Hunger Pangs' Ravenous (HF p.94): "can't spend Hope" → the cannotSpendHope flag.
 * - Nightmare Stare's Afflicted (HF p.94): "can't clear HP or Stress" → cannotClearHp / cannotClearStress flags.
 *
 * Pure reads over a real sheet: no error paths here (the refusals these flags drive are covered with their mutations).
 */
import { describe, expect, it } from "vitest";

import { pcDamageMods, pcFlags, pcMods, pcResistance } from "../../convex/lib/adversaryHits";
import { readSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";

allowWorldEmails();

const UNSTUCK: Effect = { id: "card:outer-realms-abomination/Reality Quake:1", source: "Reality Quake", text: "Unstuck", until: "manual" };
const LEECHPOLES: Effect = { id: "card:cephilith-abomination/Burrowing Leechpoles:1", source: "Burrowing Leechpoles", text: "Leechpoles", until: "manual" };
const RAVENOUS: Effect = { id: "card:harbinger-of-famine/Hunger Pangs:1", source: "Hunger Pangs", text: "Ravenous", until: "manual" };
const AFFLICTED: Effect = { id: "card:owl-witch/Nightmare Stare:1", source: "Nightmare Stare", text: "Afflicted", until: "manual" };

async function baseSheet(): Promise<CharacterSheet> {
  const w = await buildWorld();
  const s = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  return { ...s, effects: [], domainCards: { owned: [], loadout: [] } };
}

describe("NB1 dcm-12kx: pcMods reads adversary sheet effects", () => {
  it("each adversary effect gives its entry's mods, sourced to <adversaryId>/<feature>", async () => {
    const s = await baseSheet();
    expect(pcMods({ ...s, effects: [UNSTUCK] }, true)).toEqual([
      { mod: { kind: "marksMultiplier", factor: 2, of: ["hope", "armor", "hp", "stress"] }, sourceId: "outer-realms-abomination/Reality Quake" },
    ]);
    expect(pcMods({ ...s, effects: [AFFLICTED] }, true)).toEqual([
      { mod: { kind: "flag", flag: "cannotClearHp" }, sourceId: "owl-witch/Nightmare Stare" },
      { mod: { kind: "flag", flag: "cannotClearStress" }, sourceId: "owl-witch/Nightmare Stare" },
    ]);
  });

  it("pcDamageMods: Unstuck doubles the marks; Leechpoles add one per leechpole token", async () => {
    const s = await baseSheet();
    expect(pcDamageMods(s, true)).toEqual({});
    expect(pcDamageMods({ ...s, effects: [UNSTUCK] }, true)).toEqual({ marksMultiplier: { factor: 2, of: expect.arrayContaining(["hope", "armor", "hp", "stress"]) } });
    expect(pcDamageMods({ ...s, effects: [LEECHPOLES], creatureTokens: [{ name: "leechpole", count: 5 }] }, true)).toEqual({ damageTakenBonus: 5 });
    // No tokens under the skin, no bonus.
    expect(pcDamageMods({ ...s, effects: [LEECHPOLES], creatureTokens: [] }, true)).toEqual({});
  });

  it("pcFlags: Ravenous and Afflicted reach the payer flags", async () => {
    const s = await baseSheet();
    expect(pcFlags(s, true)).toEqual({});
    expect(pcFlags({ ...s, effects: [RAVENOUS] }, true)).toEqual({ flags: ["cannotSpendHope"] });
    expect(pcFlags({ ...s, effects: [RAVENOUS, AFFLICTED] }, true)).toEqual({ flags: ["cannotSpendHope", "cannotClearHp", "cannotClearStress"] });
  });

  it("reads nothing for a label the entry doesn't give, or an adversary / feature without data", async () => {
    const s = await baseSheet();
    expect(pcMods({ ...s, effects: [{ ...UNSTUCK, text: "Rattled" }] }, true)).toEqual([]);
    expect(pcMods({ ...s, effects: [{ ...UNSTUCK, id: "card:outer-realms-abomination/No Such Feature:1" }] }, true)).toEqual([]);
    expect(pcMods({ ...s, effects: [{ ...UNSTUCK, id: "card:no-such-adversary/Reality Quake:1" }] }, true)).toEqual([]);
  });

  it("an adversary effect without a resistance mod leaves pcResistance alone", async () => {
    const s = await baseSheet();
    expect(pcResistance({ ...s, effects: [UNSTUCK, LEECHPOLES, RAVENOUS, AFFLICTED] }, { hopeAndFear: true })).toBeUndefined();
  });
});
