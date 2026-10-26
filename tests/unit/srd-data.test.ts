import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANCESTRIES,
  ARMOR,
  BEASTFORMS,
  CLASSES,
  COMMUNITIES,
  DOMAIN_CARD_ART,
  DOMAIN_CARDS,
  DOMAINS,
  PORTRAITS,
  STARTING_SUGGESTIONS,
  SUBCLASSES,
  TRANSFORMATION_ART,
  TRANSFORMATIONS,
  WEAPONS,
  cardsForDomains,
  getArmor,
  getClass,
  getSubclass,
  getWeapon,
} from "@/lib/srd";

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

describe("SRD data", () => {
  it("has 13 classes, with the Hope & Fear four flagged", () => {
    expect(CLASSES).toHaveLength(13);
    const hf = CLASSES.filter((c) => c.source === "hope-and-fear").map((c) => c.id);
    expect(hf.sort()).toEqual(["assassin", "brawler", "warlock", "witch"]);
    expect(CLASSES.filter((c) => c.source === "core")).toHaveLength(9);
  });

  it("matches the books' starting Evasion and Hit Points", () => {
    expect(getClass("guardian")).toMatchObject({ startingEvasion: 9, startingHp: 7 });
    expect(getClass("wizard")).toMatchObject({ startingEvasion: 11, startingHp: 5 });
    expect(getClass("assassin")).toMatchObject({ startingEvasion: 12, startingHp: 5 });
  });

  it("every class's subclasses exist and point back to it", () => {
    for (const c of CLASSES) {
      expect(c.subclasses).toHaveLength(2);
      for (const id of c.subclasses) {
        const sub = getSubclass(id);
        expect(sub, id).toBeDefined();
        expect(sub?.classId).toBe(c.id);
        expect(sub?.source).toBe(c.source);
        expect(sub?.foundation.length).toBeGreaterThan(0);
        expect(sub?.specialization.length).toBeGreaterThan(0);
        expect(sub?.mastery.length).toBeGreaterThan(0);
      }
    }
    expect(SUBCLASSES).toHaveLength(26);
  });

  it("every class domain has cards from level 1 to 10", () => {
    for (const c of CLASSES) {
      expect(c.domains).toHaveLength(2);
      for (const d of c.domains) {
        const levels = new Set(cardsForDomains([d]).map((card) => card.level));
        expect(levels.size, d).toBe(10);
      }
    }
  });

  it("has unique ids in every collection", () => {
    for (const list of [
      CLASSES,
      SUBCLASSES,
      DOMAINS,
      DOMAIN_CARDS,
      ANCESTRIES,
      COMMUNITIES,
      TRANSFORMATIONS,
      WEAPONS,
      ARMOR,
      BEASTFORMS,
    ]) {
      expect(unique(list.map((x) => x.id))).toBe(true);
    }
  });

  it("domain cards have levels 1-10 and known domains", () => {
    const domainIds = new Set(DOMAINS.map((d) => d.id));
    for (const card of DOMAIN_CARDS) {
      expect(card.level).toBeGreaterThanOrEqual(1);
      expect(card.level).toBeLessThanOrEqual(10);
      expect(domainIds.has(card.domain)).toBe(true);
      expect(card.text.trim()).not.toBe("");
      expect(card.source).toBe(card.domain === "dread" ? "hope-and-fear" : "core");
    }
  });

  it("weapons, armor and beastforms have tiers 1-4", () => {
    for (const item of [...WEAPONS, ...ARMOR, ...BEASTFORMS]) {
      expect(item.tier).toBeGreaterThanOrEqual(1);
      expect(item.tier).toBeLessThanOrEqual(4);
    }
    expect(getArmor("chainmail-armor")).toMatchObject({
      baseThresholds: { major: 7, severe: 15 },
      baseScore: 4,
    });
  });

  it("starting suggestions reference real equipment", () => {
    for (const c of CLASSES) {
      const s = STARTING_SUGGESTIONS[c.id];
      expect(s, c.id).toBeDefined();
      expect(getArmor(s.armor)).toBeDefined();
      if (s.primaryWeapon) expect(getWeapon(s.primaryWeapon)?.slot).toBe("primary");
      if (s.secondaryWeapon) expect(getWeapon(s.secondaryWeapon)?.slot).toBe("secondary");
      expect(Object.values(s.traits).sort()).toEqual([-1, 0, 0, 1, 1, 2]);
    }
  });

  it("separates core and Hope & Fear heritage", () => {
    expect(ANCESTRIES.filter((a) => a.source === "core")).toHaveLength(18);
    expect(COMMUNITIES.filter((c) => c.source === "core")).toHaveLength(9);
    expect(TRANSFORMATIONS).toHaveLength(6);
  });

  it("art references existing design assets", () => {
    const dir = join(process.cwd(), "public", "design-assets");
    const files = new Set(readdirSync(dir).map((f) => f.replace(/\.[^.]+$/, "")));
    const assets = [
      ...Object.values(PORTRAITS).map((p) => p.asset),
      ...Object.values(DOMAIN_CARD_ART),
      ...Object.values(TRANSFORMATION_ART),
    ];
    expect(existsSync(dir)).toBe(true);
    expect(assets.filter((a) => !files.has(a))).toEqual([]);
  });

  it("every ancestry, community and subclass has a portrait", () => {
    for (const a of ANCESTRIES) expect(PORTRAITS[`anc-${a.id}`], a.id).toBeDefined();
    for (const s of SUBCLASSES) expect(PORTRAITS[`sub-${s.id}`], s.id).toBeDefined();
  });
});
