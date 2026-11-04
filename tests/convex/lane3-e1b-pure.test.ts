/**
 * Plan lanes-2 wave 9, E1.3b (docs/tasks/TASK-LN3-E1B.md): the pure pieces of the attack and roll paths.
 *
 * Book texts:
 * - Spirit Weapon (CB p.44): "When you have an equipped weapon with a range of Melee or Very Close, it can fly from your
 *   hand to attack an adversary within Close range ... You can mark a Stress to target an additional adversary." Sacred
 *   Resonance (CB p.44): "if any of the die results match, double the value of each matching die."
 * - Made of Straw (HF p.79): "double damage from fire". Hidden / Vulnerable (CB p.102).
 * - Poisoned (CB p.211) etc. reach the bearer's own rolls (sheetBearerMods).
 */
import { describe, expect, it } from "vitest";

import type { Doc } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import type { SourceLookup } from "../../convex/lib/cardRows";
import { conditionEdge, instanceAttackedRiders, partyEndsFromAttack, sacredResonance, spiritWeaponOn, targetsEdge, weaknessMatches, type TargetFacts } from "../../convex/lib/combatActions";
import { filterCoversRoll, grantEndsOnRoll } from "../../convex/lib/rolls";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import type { RollRecord } from "../../src/lib/domain/duality";
import { getWeapon } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";

allowWorldEmails();

async function baseSheet(): Promise<{ sheet: CharacterSheet; campaign: Doc<"campaigns"> }> {
  const w = await buildWorld();
  return w.t.run(async (ctx) => ({ sheet: readSheet((await ctx.db.get("characters", w.characterA))!.sheet), campaign: (await ctx.db.get("campaigns", w.campaignId))! }));
}

const host = { spec: { kind: "attack" } as never, trait: "agility" as const };
const facts = (conditions: string[], extra: Partial<TargetFacts> = {}): TargetFacts => ({ passives: null, conditions, riders: [], ...extra });

describe("target edges (CB p.102)", () => {
  it("Hidden / Cloaked give disadvantage, Vulnerable advantage", () => {
    expect(conditionEdge(["hidden"])).toEqual({ advantage: 0, disadvantage: 1 });
    expect(conditionEdge(["cloaked", "vulnerable"])).toEqual({ advantage: 1, disadvantage: 1 });
    expect(conditionEdge([])).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it("with several targets only what every target gives counts", () => {
    expect(targetsEdge([facts(["hidden"]), facts([])], host)).toEqual({ advantage: 0, disadvantage: 0 });
    expect(targetsEdge([facts(["hidden"]), facts(["hidden"])], host)).toEqual({ advantage: 0, disadvantage: 1 });
    expect(targetsEdge([], host)).toEqual({ advantage: 0, disadvantage: 0 });
  });
});

describe("weaknesses (Made of Straw, HF p.79)", () => {
  it("matches by keyword or type; an empty weakness matches nothing", () => {
    expect(weaknessMatches([{ keyword: "fire" }], ["physical"], ["fire"])).toBe(true);
    expect(weaknessMatches([{ keyword: "fire" }], ["physical"], [])).toBe(false);
    expect(weaknessMatches([{ type: "magic" }], ["magic"], [])).toBe(true);
    expect(weaknessMatches([{}], ["physical"], [])).toBe(false);
    expect(weaknessMatches(undefined, ["physical"], ["fire"])).toBe(false);
  });
});

describe("instance attackedRiders (dcm-yd5h, dcm-9gw)", () => {
  it("a Breaking Blow tag gives another PC's attack +2d12, not the caster's own", async () => {
    const { sheet } = await baseSheet();
    const instance = { effects: [], tags: ["Breaking Blow"], conditions: [] } as unknown as Pick<Doc<"encounterAdversaries">, "effects" | "tags" | "conditions">;
    const riders = instanceAttackedRiders(instance, sheet);
    expect(riders.map((r) => r.label)).toEqual(["Breaking Blow"]);
    expect(riders[0]!.rider.damage?.kind).toBe("add");
    const caster = { ...sheet, domainCards: { ...sheet.domainCards, loadout: [...sheet.domainCards.loadout, "breaking-blow"] } };
    expect(instanceAttackedRiders(instance, caster)).toEqual([]);
  });
});

describe("Spirit Weapon (CB p.44; user answer 2026-10-31)", () => {
  it("applies only when ticked, with a Melee / Very Close weapon and the feature held", async () => {
    const { sheet, campaign } = await baseSheet();
    const wielder = { ...sheet, classId: "seraph", subclassId: "divine-wielder", subclassRank: "foundation" } as CharacterSheet;
    const melee = getWeapon("broadsword")!;
    const far = getWeapon("longbow")!;
    expect(spiritWeaponOn(wielder, campaign, melee, { spiritWeapon: true })).toBe(true);
    expect(spiritWeaponOn(wielder, campaign, melee, {})).toBe(false);
    expect(spiritWeaponOn(wielder, campaign, far, { spiritWeapon: true })).toBe(false);
    expect(spiritWeaponOn({ ...sheet, subclassId: "winged-sentinel" } as CharacterSheet, campaign, melee, { spiritWeapon: true })).toBe(false);
  });

  it("Sacred Resonance doubles each matching die; no match changes nothing", () => {
    const rec = (values: number[]): RollRecord => ({ kind: "damage", dice: values.map((value) => ({ sides: 8, value, role: "damage" as const })), modifier: 2, total: values.reduce((a, b) => a + b, 0) + 2, outcome: "none", manual: false });
    const doubled = sacredResonance(rec([3, 3, 5]));
    expect(doubled.dice.map((d) => d.value)).toEqual([6, 6, 5]);
    expect(doubled.total).toBe(6 + 6 + 5 + 2);
    const plain = rec([1, 2, 5]);
    expect(sacredResonance(plain)).toBe(plain);
  });
});

describe("roll filters and granted benefits (dcm-6qrn, dcm-79v1)", () => {
  it("weaponAttack needs a named weapon; attack covers both", () => {
    const base = { kind: "action" as const, trait: "agility" as const, attack: true };
    expect(filterCoversRoll("weaponAttack", base)).toBe(false);
    expect(filterCoversRoll("weaponAttack", { ...base, weapon: "primary" })).toBe(true);
    expect(filterCoversRoll("attack", base)).toBe(true);
    expect(filterCoversRoll("weaponAttack", { ...base, attack: false, weapon: "primary" })).toBe(false);
  });

  it("a roll that used nothing ends nothing on the party", async () => {
    const { sheet } = await baseSheet();
    const out = grantEndsOnRoll(sheet, [], [], [{ key: "b", sheet }]);
    expect(out.sheet).toBe(sheet);
    expect(out.labels).toEqual([]);
    expect(out.party).toEqual([]);
  });
});

describe("party sheets an attack ends effects on (dcm-uwg1)", () => {
  // Marked for Death (HF p.8): "the current adversary Marked for Death is defeated" ends another PC's effect.
  const MARKED: readonly CardUse[] = [{ id: "main", name: "main", activation: { kind: "action" }, steps: [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Marked for Death" }, duration: "rest", endsOn: ["targetDefeated", "gmSpendsFear"] }] }];
  const lookup: SourceLookup = (id) => (id === "class:assassin:marked-for-death" ? MARKED : undefined);

  it("another PC's Marked for Death ends when this attack defeats the tagged instance; only changed sheets come back", async () => {
    const { sheet } = await baseSheet();
    const ally = { ...sheet, name: "Bryn", effects: [{ id: "marked-for-death", source: "Test", text: "Bear: +1d4 damage", until: "rest" as const }] };
    const other = { ...sheet, name: "Cass" };
    const party = [
      { key: "bryn", sheet: ally },
      { key: "cass", sheet: other },
    ];
    expect(partyEndsFromAttack(sheet, party, null, "none", [{ tags: ["Other"] }], lookup)).toEqual([]);
    const out = partyEndsFromAttack(sheet, party, null, "none", [{ tags: ["Marked for Death"] }], lookup);
    expect(out.map((o) => o.key)).toEqual(["bryn"]);
    expect(out[0]!.sheet.effects).toEqual([]);
    expect(out[0]!.lines.join(" ")).toMatch(/ends/);
  });
});
