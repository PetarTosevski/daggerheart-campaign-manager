import { describe, expect, it } from "vitest";

import { ARMOR, WEAPONS } from "@/lib/srd/equipment";
import { COMBAT_WHEELCHAIR_IDS, TIERED_ARMOR, TIERED_WEAPONS } from "@/lib/srd/equipment-tiers";
import { ARMOR as ALL_ARMOR, getArmor, getWeapon, WEAPONS as ALL_WEAPONS } from "@/lib/srd/index";

const count = <T>(items: readonly T[], pred: (item: T) => boolean) => items.filter(pred).length;

describe("Tier 2–4 weapons", () => {
  it("has the expected counts per tier, slot, category and source", () => {
    const key = (w: (typeof TIERED_WEAPONS)[number]) =>
      `${w.tier}/${w.slot}/${w.category}/${w.source}`;
    const counts: Record<string, number> = {};
    for (const w of TIERED_WEAPONS) counts[key(w)] = (counts[key(w)] ?? 0) + 1;
    expect(counts).toEqual({
      // Core primary (physical counts include 2 combat wheelchairs, magic 1 per tier)
      "2/primary/physical/core": 26,
      "3/primary/physical/core": 27,
      "4/primary/physical/core": 26,
      "2/primary/magic/core": 20,
      "3/primary/magic/core": 20,
      "4/primary/magic/core": 20,
      "2/secondary/physical/core": 10,
      "3/secondary/physical/core": 10,
      "4/secondary/physical/core": 10,
      "2/primary/physical/hope-and-fear": 12,
      "3/primary/physical/hope-and-fear": 12,
      "4/primary/physical/hope-and-fear": 12,
      "2/primary/magic/hope-and-fear": 12,
      "3/primary/magic/hope-and-fear": 12,
      "4/primary/magic/hope-and-fear": 12,
      "2/secondary/physical/hope-and-fear": 7,
      "3/secondary/physical/hope-and-fear": 6,
      "4/secondary/physical/hope-and-fear": 5,
      "2/secondary/magic/hope-and-fear": 3,
      "3/secondary/magic/hope-and-fear": 4,
      "4/secondary/magic/hope-and-fear": 5,
    });
    expect(TIERED_WEAPONS).toHaveLength(271);
  });

  it("contains only tiers 2–4", () => {
    expect(count(TIERED_WEAPONS, (w) => w.tier < 2)).toBe(0);
  });

  it("damage strings parse and match damageType", () => {
    for (const w of TIERED_WEAPONS) {
      expect(w.damage, w.id).toMatch(/^\d*d\d+(\+\d+)? (phy|mag|phy\/mag)$/);
      const suffix = w.damage.split(" ")[1];
      const expected = suffix === "phy" ? "physical" : suffix === "mag" ? "magic" : "either";
      expect(w.damageType, w.id).toBe(expected);
    }
  });

  it("only the multi-type weapons (Ghostblade, Shadowblade) deal either damage", () => {
    const either = TIERED_WEAPONS.filter((w) => w.damageType === "either").map((w) => w.id);
    expect(either.sort()).toEqual(
      [
        "advanced-shadowblade",
        "ghostblade",
        "improved-shadowblade",
        "legendary-shadowblade",
      ].sort(),
    );
  });

  it("flags combat wheelchairs (3 models x 3 tiers) and they all exist", () => {
    expect(COMBAT_WHEELCHAIR_IDS.size).toBe(9);
    const ids = new Set(TIERED_WEAPONS.map((w) => w.id));
    for (const id of COMBAT_WHEELCHAIR_IDS) expect(ids.has(id), id).toBe(true);
  });

  it("features are null or have a name and text", () => {
    for (const w of TIERED_WEAPONS) {
      if (w.feature) {
        expect(w.feature.name.length, w.id).toBeGreaterThan(0);
        expect(w.feature.text.length, w.id).toBeGreaterThan(0);
        expect(w.feature.name, w.id).not.toContain(":");
      }
    }
  });

  it("upgraded weapons keep the Tier 1 trait, range and burden and gain damage", () => {
    const prefixes = { 2: "improved-", 3: "advanced-", 4: "legendary-" } as const;
    const bonus = (d: string) => Number(/\+(\d+)/.exec(d)?.[1] ?? 0);
    let checked = 0;
    for (const w of TIERED_WEAPONS) {
      const prefix = prefixes[w.tier as 2 | 3 | 4];
      if (!w.id.startsWith(prefix)) continue;
      const base = WEAPONS.find((b) => b.id === w.id.slice(prefix.length));
      if (!base) continue;
      checked++;
      expect(w.trait, w.id).toBe(base.trait);
      expect(w.range, w.id).toBe(base.range);
      expect(w.burden, w.id).toBe(base.burden);
      expect(bonus(w.damage), w.id).toBeGreaterThan(bonus(base.damage));
    }
    expect(checked).toBeGreaterThan(80);
  });
});

describe("Tier 2–4 armor", () => {
  it("has the expected counts per tier and source", () => {
    const counts: Record<string, number> = {};
    for (const a of TIERED_ARMOR) {
      const k = `${a.tier}/${a.source}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({
      "2/core": 10,
      "3/core": 10,
      "4/core": 10,
      "2/hope-and-fear": 11,
      "3/hope-and-fear": 10,
      "4/hope-and-fear": 10,
    });
  });

  it("every armor has a base score of at least 1 and major < severe", () => {
    for (const a of TIERED_ARMOR) {
      expect(a.baseScore, a.id).toBeGreaterThanOrEqual(1);
      expect(a.baseThresholds.major, a.id).toBeLessThan(a.baseThresholds.severe);
    }
  });

  it("thresholds increase with tier for each upgraded armor line", () => {
    const lines = [
      "gambeson-armor",
      "leather-armor",
      "chainmail-armor",
      "full-plate-armor",
      "mage-robes",
      "brigandine-armor",
      "scale-mail-armor",
      "banded-armor",
    ];
    const all = [...ARMOR, ...TIERED_ARMOR];
    for (const line of lines) {
      const chain = [line, `improved-${line}`, `advanced-${line}`, `legendary-${line}`].map(
        (id) => all.find((a) => a.id === id),
      );
      chain.forEach((a, i) => {
        expect(a, `${line} tier ${i + 1}`).toBeDefined();
        expect(a?.tier).toBe(i + 1);
      });
      for (let i = 1; i < chain.length; i++) {
        const prev = chain[i - 1]!;
        const cur = chain[i]!;
        expect(cur.baseThresholds.major, cur.id).toBeGreaterThan(prev.baseThresholds.major);
        expect(cur.baseThresholds.severe, cur.id).toBeGreaterThan(prev.baseThresholds.severe);
        expect(cur.baseScore, cur.id).toBeGreaterThan(prev.baseScore);
      }
    }
  });

  it("average thresholds increase with tier", () => {
    const avg = (tier: number, k: "major" | "severe") => {
      const xs = [...ARMOR, ...TIERED_ARMOR].filter((a) => a.tier === tier);
      return xs.reduce((s, a) => s + a.baseThresholds[k], 0) / xs.length;
    };
    for (const k of ["major", "severe"] as const) {
      for (let t = 2; t <= 4; t++) expect(avg(t, k)).toBeGreaterThan(avg(t - 1, k));
    }
  });
});

describe("ids", () => {
  it("are unique kebab-case and do not collide with Tier 1", () => {
    const ids = [
      ...WEAPONS.map((w) => w.id),
      ...ARMOR.map((a) => a.id),
      ...TIERED_WEAPONS.map((w) => w.id),
      ...TIERED_ARMOR.map((a) => a.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...TIERED_WEAPONS, ...TIERED_ARMOR].map((x) => x.id)) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("merged lookups in src/lib/srd/index.ts (CB 109, 115-127)", () => {
  it("WEAPONS and ARMOR hold every tier, with unique ids", () => {
    expect(ALL_WEAPONS).toHaveLength(WEAPONS.length + TIERED_WEAPONS.length);
    expect(ALL_ARMOR).toHaveLength(ARMOR.length + TIERED_ARMOR.length);
    for (const list of [ALL_WEAPONS, ALL_ARMOR]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(new Set(ALL_WEAPONS.map((w) => w.tier))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(ALL_ARMOR.map((a) => a.tier))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("getWeapon and getArmor resolve every tier", () => {
    for (const w of [...WEAPONS, ...TIERED_WEAPONS]) expect(getWeapon(w.id), w.id).toBe(w);
    for (const a of [...ARMOR, ...TIERED_ARMOR]) expect(getArmor(a.id), a.id).toBe(a);
    expect(getWeapon("legendary-broadsword")).toMatchObject({ tier: 4, slot: "primary" });
    expect(getArmor("advanced-chainmail-armor")).toMatchObject({ tier: 3 });
  });
});
