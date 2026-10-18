import { describe, expect, it } from "vitest";

import { derivedDefense } from "../../src/lib/domain/characters/derived";
import { gatherScrap } from "../../src/lib/domain/frames/motherboard";
import {
  addRelic,
  applyGather,
  augmentDefense,
  ikonisMissing,
  startingMotherboard,
  AUGMENTS,
  augmentSlots,
  correctWallet,
  craft,
  ikonisDamage,
  INITIAL_MOTHERBOARD,
  install,
  salvage,
  sellRelic,
  trade,
} from "../../src/lib/frames/extras/motherboard";

describe("Motherboard extras (Core pp.301-303)", () => {
  it("starts with 5 quantum and transcribes 18 augments", () => {
    expect(INITIAL_MOTHERBOARD.quantum).toBe(5);
    expect(AUGMENTS).toHaveLength(18);
    expect(AUGMENTS.filter((a) => a.precompileTier === 1)).toHaveLength(10);
    expect(AUGMENTS.find((a) => a.id === "override")).toMatchObject({ precompileTier: 4, recipe: { Wire: 63, Gold: 71, Disc: 58, Relic: 5 } });
  });

  it("slots = tier + 1", () => {
    expect([1, 2, 3, 4].map(augmentSlots)).toEqual([2, 3, 4, 5]);
  });

  it("Ikonis damage adds Bonded (level)", () => {
    expect(ikonisDamage({ name: "", description: "", trait: "agility", range: "Melee", damageType: "physical" }, 3)).toBe("d12+4 phy");
    expect(ikonisDamage({ name: "", description: "", trait: "agility", range: "Close", damageType: "tech" }, 1)).toBe("d10+1 tech");
    expect(ikonisDamage({ ...INITIAL_MOTHERBOARD.ikonis }, 1)).toBeNull();
  });

  it("gathers scrap with the pure roller", () => {
    const rolls = [2, 4, 7];
    const gathered = gatherScrap({ shards: 2, metals: 1, components: 0 }, () => rolls.shift()!);
    const s = applyGather(INITIAL_MOTHERBOARD, gathered);
    expect(s.scrap).toEqual({ Coil: 1, Trigger: 1, Platinum: 1 });
  });

  it("buys and sells at value (book example)", () => {
    let s = correctWallet(INITIAL_MOTHERBOARD, { quantum: 0, scrap: { Circuit: 2, Battery: 1, Lens: 2, Coil: 6 } });
    s = trade(s, "Circuit", 2, "sell");
    s = trade(s, "Battery", 1, "sell");
    s = trade(s, "Lens", 2, "sell");
    s = trade(s, "Coil", 6, "sell");
    expect(s.quantum).toBe(38);
    s = trade(s, "Crystal", 1, "buy");
    s = trade(s, "Silver", 2, "buy");
    expect(s.quantum).toBe(20);
    expect(() => trade(s, "Battery", 3, "buy")).toThrow(/costs 30/);
    expect(() => trade(s, "Gold", 1, "sell")).toThrow(/Not enough Gold/);
  });

  it("relics are worth 20", () => {
    const s = sellRelic(addRelic(INITIAL_MOTHERBOARD, { id: "r1", name: "Steelhorn" }), "r1");
    expect(s.quantum).toBe(25);
    expect(s.relics).toEqual([]);
  });

  it("crafts with precompile, installs within slots, salvages for parts", () => {
    const rich = correctWallet(INITIAL_MOTHERBOARD, { scrap: { Gear: 3, Lens: 2, Aluminum: 4, Capacitor: 1, Wire: 3, Silver: 2, Platinum: 2, Fuse: 3 } });
    expect(() => craft(INITIAL_MOTHERBOARD, "force", 1)).toThrow(/Missing 3 Gear/);
    let s = craft(craft(rich, "force", 1), "guard", 1);
    expect(s.scrap.Gear).toBe(0);
    expect(s.built.map((b) => b.id)).toEqual(["force", "guard"]);
    expect(() => craft(s, "sear", 1)).toThrow(/Tier 2/);
    s = install(s, ["force", "guard"], 1);
    expect(() => install(s, ["force", "converge"], 1)).toThrow(/built/);
    s = salvage(s, "force");
    expect(s.installed).toEqual(["guard"]);
    expect(s.scrap).toMatchObject({ Gear: 3, Lens: 2, Aluminum: 4, Capacitor: 1 });
  });

  it("generic Relics are spent and returned on salvage", () => {
    let s = correctWallet(INITIAL_MOTHERBOARD, { scrap: { Trigger: 28, Circuit: 28, Relay: 28 } });
    s = addRelic(s, { id: "r1", name: "Jaw piston" });
    s = craft(s, "bury", 3);
    expect(s.relics).toEqual([]);
    s = salvage(s, "bury");
    expect(s.relics).toEqual([{ id: "r1", name: "Jaw piston" }]);
  });
});

describe("Ikonis at character creation and augment defense (T9)", () => {
  const ikonis = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };

  it("a Warrior starts with Force crafted and installed (CB 295); others with none (CB 301)", () => {
    expect(startingMotherboard(ikonis, "warrior")).toMatchObject({ ikonis, built: [{ id: "force", relics: [] }], installed: ["force"], quantum: 5 });
    expect(startingMotherboard(ikonis, "bard")).toMatchObject({ built: [], installed: [] });
  });

  it("the module's top section must be filled in", () => {
    expect(ikonisMissing(INITIAL_MOTHERBOARD.ikonis)).toEqual(["an Ikonis trait", "an Ikonis range", "an Ikonis damage type", "an Ikonis name"]);
    expect(ikonisMissing(ikonis)).toEqual([]);
  });

  it("Guard +1, Deny +2, Block +3 Armor Score and -1 Evasion (module sheet, CB 301-303)", () => {
    expect(augmentDefense(["force", "guard"])).toEqual({ armorScore: 1, evasion: 0 });
    expect(augmentDefense(["guard", "deny", "block"])).toEqual({ armorScore: 6, evasion: -1 });
  });

  it("derivedDefense adds installed augments", () => {
    const sheet = { evasion: 10, primaryWeaponId: "", armorId: "gambeson-armor" };
    const base = derivedDefense(sheet);
    expect(derivedDefense(sheet, ["guard", "block"])).toMatchObject({ armorScore: base.armorScore + 4, evasion: base.evasion - 1 });
    expect(derivedDefense(sheet, [])).toEqual(base);
  });
});
