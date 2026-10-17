import { describe, expect, it } from "vitest";

import {
  gatherScrap,
  rollShackStock,
  SCRAP_REWARD_TABLE,
  scrapForRoll,
  scrapValue,
} from "@/lib/domain/frames/motherboard";

function script(...faces: number[]) {
  const queue = [...faces];
  return (sides: number) => {
    const face = queue.shift();
    if (face === undefined || face < 1 || face > sides) throw new Error(`bad scripted roll on d${sides}`);
    return face;
  };
}

describe("Motherboard scrap", () => {
  it("takes the lower option when a roll falls between two values", () => {
    expect(scrapForRoll("metals", 2).name).toBe("Aluminum");
    expect(scrapForRoll("metals", 4).name).toBe("Copper");
    expect(scrapForRoll("components", 5).name).toBe("Circuit");
    expect(scrapForRoll("components", 7).name).toBe("Disc");
    expect(scrapForRoll("shards", 6).name).toBe("Crystal");
    expect(() => scrapForRoll("shards", 7)).toThrow(RangeError);
  });

  it("reproduces the book's gathering example", () => {
    const counts = { shards: 2, metals: 2, components: 1 };
    expect(gatherScrap(counts, script(2, 4, 5, 7, 9)).map((g) => g.item.name)).toEqual([
      "Coil", "Trigger", "Cobalt", "Platinum", "Capacitor",
    ]);
    expect(gatherScrap(counts, script(1, 6, 3, 6, 5)).map((g) => g.item.name)).toEqual([
      "Gear", "Crystal", "Copper", "Silver", "Circuit",
    ]);
  });

  it("rolls each category on its own die", () => {
    const sides: number[] = [];
    gatherScrap({ shards: 1, metals: 1, components: 1 }, (s) => (sides.push(s), 1));
    expect(sides).toEqual([6, 8, 10]);
  });

  it("values scrap at its table number (the book's selling example)", () => {
    const sold = 2 * scrapValue("Circuit")! + scrapValue("Battery")! + 2 * scrapValue("Lens")! + 6 * scrapValue("Coil")!;
    expect(sold).toBe(38);
    expect(scrapValue("Crystal")! + 2 * scrapValue("Silver")!).toBe(18);
    expect(scrapValue("Relic")).toBe(20);
    expect(scrapValue("Nope")).toBeUndefined();
  });

  it("has the Scrap Reward Table presets", () => {
    expect(SCRAP_REWARD_TABLE.few.easy).toEqual({ shards: 2, metals: 0, components: 0 });
    expect(SCRAP_REWARD_TABLE.mostly.standard).toEqual({ shards: 2, metals: 2, components: 1 });
    expect(SCRAP_REWARD_TABLE.all.veryDifficult).toEqual({ shards: 4, metals: 3, components: 3 });
  });

  it("rolls a shack's daily stock: d10 per Shard, d8 per Metal, d6 per Component", () => {
    const seen: Record<number, number> = {};
    const stock = rollShackStock((s) => ((seen[s] = (seen[s] ?? 0) + 1), s));
    expect(seen).toEqual({ 10: 6, 8: 6, 6: 6 });
    expect(stock.Gear).toBe(10);
    expect(stock.Gold).toBe(8);
    expect(stock.Battery).toBe(6);
  });
});
