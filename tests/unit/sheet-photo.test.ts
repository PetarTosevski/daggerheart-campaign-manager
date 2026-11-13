import { describe, expect, it } from "vitest";

import { importDraftSchema } from "@/lib/import/draft";
import { importProblem, sheetFromImport } from "@/lib/import/sheet";
import {
  bestMatch,
  draftFromReading,
  normalise,
  readingFromWire,
  sheetReadingSchema,
  sheetWireSchema,
  similarity,
  SHEET_READING_JSON_SCHEMA,
  type SheetReading,
  type SheetWire,
} from "@/lib/import/sheet-photo";
import { CLASSES } from "@/lib/srd/classes";
import { RuleError } from "@/lib/errors/app-error";

import { validDraft, warriorReading } from "../fixtures/photo-import";

describe("fuzzy matching", () => {
  it("normalises case, accents and punctuation", () => {
    expect(normalise("Champion's  Édge!")).toBe("championsedge");
  });

  it("scores the same name 1 and a typo close to it", () => {
    expect(similarity("WARRIOR", "Warrior")).toBe(1);
    expect(similarity("Warior", "Warrior")).toBeGreaterThan(0.8);
    expect(similarity("Gambeson", "Gambeson Armor")).toBe(0.9);
    expect(similarity("Sword Dance", "Whirlwind")).toBeLessThan(0.5);
  });

  it("picks the closest candidate and nothing below the threshold", () => {
    expect(bestMatch("Gaurdian", CLASSES)?.id).toBe("guardian");
    expect(bestMatch("Sorcerrer", CLASSES)?.id).toBe("sorcerer");
    expect(bestMatch("Paladin", CLASSES)).toBeUndefined();
    expect(bestMatch("", CLASSES)).toBeUndefined();
  });
});

describe("draftFromReading", () => {
  it("matches names to SRD ids, including tiered equipment, and flags the rest", () => {
    const { draft, unreadable, unmatched } = draftFromReading(warriorReading, false);
    expect(draft.classId).toBe("warrior");
    expect(draft.subclassId).toBe("call-of-the-brave");
    expect(draft.ancestry).toEqual({ kind: "mixed", first: "dwarf", second: "elf", name: "" });
    expect(draft.communityId).toBe("ridgeborne");
    expect(draft.primaryWeaponId).toBe("advanced-broadsword");
    expect(draft.secondaryWeaponId).toBe("improved-round-shield");
    expect(draft.armorId).toBe("improved-gambeson-armor");
    expect(draft.domainCards).toEqual(["get-back-up", "whirlwind", "reckless", "vitality"]);
    expect(draft.level).toBe(5);
    expect(draft.hp).toBe(2);
    expect(draft.traits.instinct).toBe(0);
    expect(unreadable).toEqual(["traits.instinct", "experiences.1.value"]);
    expect(unmatched).toEqual([{ field: "domainCards.3", text: "Sword Dance" }]);
    // The draft is the reviewable shape the server accepts.
    expect(importDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("only matches Hope & Fear classes when the campaign uses them", () => {
    const reading = { ...warriorReading, className: "Assassin", subclassName: null };
    expect(draftFromReading(reading, false).draft.classId).toBe("");
    expect(draftFromReading(reading, false).unmatched).toContainEqual({ field: "classId", text: "Assassin" });
    expect(draftFromReading(reading, true).draft.classId).toBe("assassin");
  });

  it("fills unreadable fields with defaults and lists them", () => {
    const blank = sheetReadingSchema.parse({
      ...warriorReading,
      name: null,
      level: null,
      className: "Warrior",
      hpMax: null,
      evasion: null,
      primaryWeapon: null,
      secondaryWeapon: null,
      armor: null,
      gold: { handfuls: null, bags: null, chest: null },
    });
    const { draft, unreadable } = draftFromReading(blank, false);
    expect(draft).toMatchObject({ name: "", level: 1, hpMax: 6, evasion: 11, primaryWeaponId: "", gold: { handfuls: 0, bags: 0, chest: false } });
    expect(draft.secondaryWeaponId).toBeUndefined();
    expect(unreadable).toEqual(expect.arrayContaining(["name", "level", "hpMax", "evasion", "primaryWeaponId", "gold.handfuls", "gold.bags"]));
  });

  it("describes every wire field in the JSON schema sent to the API", () => {
    expect(Object.keys(SHEET_READING_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(sheetWireSchema.shape).sort());
    expect(Object.keys(sheetWireSchema.shape).sort()).toEqual([...Object.keys(sheetReadingSchema.shape), "unreadable"].sort());
    expect(SHEET_READING_JSON_SCHEMA.required).toEqual(Object.keys(SHEET_READING_JSON_SCHEMA.properties));
  });
});

type Node = Record<string, unknown>;

/** Every schema node under `node` (itself included), with its path. */
function nodes(node: unknown, path = "$"): { path: string; node: Node }[] {
  if (typeof node !== "object" || node === null) return [];
  const n = node as Node;
  const out = [{ path, node: n }];
  for (const [name, child] of Object.entries((n.properties as Record<string, unknown> | undefined) ?? {})) out.push(...nodes(child, `${path}.${name}`));
  if (n.items) out.push(...nodes(n.items, `${path}[]`));
  for (const key of ["anyOf", "oneOf", "allOf"]) for (const [i, child] of ((n[key] as unknown[] | undefined) ?? []).entries()) out.push(...nodes(child, `${path}.${key}${i}`));
  return out;
}

describe("SHEET_READING_JSON_SCHEMA (structured-output limits)", () => {
  it("has no union-typed parameters", () => {
    // The Messages API refuses a schema with more than 16 parameters "with type arrays or anyOf" (limit: 16 parameters
    // with unions); the nullable schema had 29 and every photo import failed (dcm-5378). Keep it at 0.
    const unions = nodes(SHEET_READING_JSON_SCHEMA)
      .filter(({ node }) => Array.isArray(node.type) || "anyOf" in node || "oneOf" in node)
      .map(({ path }) => path);
    expect(unions).toEqual([]);
  });

  it("closes every object: all properties required, no additional properties", () => {
    for (const { path, node } of nodes(SHEET_READING_JSON_SCHEMA)) {
      expect(typeof node.type, path).toBe("string");
      if (node.type !== "object") continue;
      expect(node.additionalProperties, path).toBe(false);
      expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as Node).sort());
    }
  });
});

/** The wire form of a nullable reading: "" for null text, 0 / false for null numbers and the chest, listed in `unreadable`. */
function wireFromReading(reading: SheetReading): SheetWire {
  const unreadable: string[] = [];
  const num = (path: string, value: number | null) => {
    if (value === null) unreadable.push(path);
    return value ?? 0;
  };
  const t = (value: string | null) => value ?? "";
  const traits = Object.fromEntries(Object.entries(reading.traits).map(([k, v]) => [k, num(`traits.${k}`, v)])) as SheetWire["traits"];
  const wire: SheetWire = {
    name: t(reading.name),
    pronouns: t(reading.pronouns),
    description: t(reading.description),
    level: num("level", reading.level),
    className: t(reading.className),
    subclassName: t(reading.subclassName),
    ancestry: t(reading.ancestry),
    community: t(reading.community),
    traits,
    evasion: num("evasion", reading.evasion),
    hpMax: num("hpMax", reading.hpMax),
    hpMarked: num("hpMarked", reading.hpMarked),
    stressMax: num("stressMax", reading.stressMax),
    stressMarked: num("stressMarked", reading.stressMarked),
    hope: num("hope", reading.hope),
    armorMarked: num("armorMarked", reading.armorMarked),
    proficiency: num("proficiency", reading.proficiency),
    primaryWeapon: t(reading.primaryWeapon),
    secondaryWeapon: t(reading.secondaryWeapon),
    armor: t(reading.armor),
    experiences: reading.experiences.map((e, i) => ({ name: e.name, value: num(`experiences.${i}.value`, e.value) })),
    domainCards: reading.domainCards,
    inventory: reading.inventory,
    gold: { handfuls: num("gold.handfuls", reading.gold.handfuls), bags: num("gold.bags", reading.gold.bags), chest: reading.gold.chest ?? false },
    unreadable,
  };
  if (reading.gold.chest === null) unreadable.push("gold.chest");
  return sheetWireSchema.parse(wire);
}

describe("readingFromWire", () => {
  const readable: SheetReading = {
    ...warriorReading,
    traits: { ...warriorReading.traits, instinct: 1 },
    experiences: [
      { name: "Sellsword", value: 2 },
      { name: "Mountain Guide", value: 3 },
    ],
  };

  it("passes a fully readable reading through unchanged", () => {
    const wire = wireFromReading(readable);
    expect(wire.unreadable).toEqual([]);
    expect(readingFromWire(wire)).toEqual(readable);
  });

  it('turns blank strings ("" or spaces) into null', () => {
    const wire = { ...wireFromReading(readable), name: "", pronouns: "  ", className: "", secondaryWeapon: "", armor: "" };
    expect(readingFromWire(wire)).toEqual({ ...readable, name: null, pronouns: null, className: null, secondaryWeapon: null, armor: null });
  });

  it("turns every field named in unreadable into null, whatever value came with it", () => {
    const wire: SheetWire = {
      ...wireFromReading(readable),
      unreadable: ["level", "hpMarked", "description", "traits.agility", "traits.knowledge", "gold.handfuls", "gold.chest", "experiences.1.value", "nonsense.path"],
    };
    const reading = readingFromWire(wire);
    expect(reading).toEqual({
      ...readable,
      level: null,
      hpMarked: null,
      description: null,
      traits: { ...readable.traits, agility: null, knowledge: null },
      gold: { handfuls: null, bags: 1, chest: null },
      experiences: [
        { name: "Sellsword", value: 2 },
        { name: "Mountain Guide", value: null },
      ],
    });
    expect(sheetReadingSchema.safeParse(reading).success).toBe(true);
  });

  it("gives the same reading and draft as the nullable reading did (round trip)", () => {
    const wire = wireFromReading(warriorReading);
    expect(wire.unreadable).toEqual(["traits.instinct", "experiences.1.value"]);
    expect(readingFromWire(wire)).toEqual(warriorReading);
    expect(draftFromReading(readingFromWire(wire), false)).toEqual(draftFromReading(warriorReading, false));
    const blank = sheetReadingSchema.parse({ ...warriorReading, name: null, level: null, hpMax: null, armor: null, gold: { handfuls: null, bags: null, chest: null } });
    expect(readingFromWire(wireFromReading(blank))).toEqual(blank);
    expect(draftFromReading(readingFromWire(wireFromReading(blank)), false)).toEqual(draftFromReading(blank, false));
  });

  it("refuses the old nullable shape and keeps the length limits", () => {
    expect(sheetWireSchema.safeParse(warriorReading).success).toBe(false);
    expect(sheetWireSchema.safeParse({ ...wireFromReading(readable), name: "x".repeat(2001) }).success).toBe(false);
    expect(sheetWireSchema.safeParse({ ...wireFromReading(readable), domainCards: Array.from({ length: 41 }, () => "Card") }).success).toBe(false);
    expect(sheetWireSchema.safeParse({ ...wireFromReading(readable), level: 2.5 }).success).toBe(false);
  });
});

describe("sheetFromImport", () => {
  it("builds a level 5 sheet with tier 3 equipment", () => {
    const sheet = sheetFromImport(validDraft(), false, () => "id");
    expect(sheet).toMatchObject({ level: 5, primaryWeaponId: "advanced-broadsword", scars: 0, hp: 2 });
    expect(sheet.domainCards).toEqual({ owned: ["get-back-up", "whirlwind", "reckless", "vitality"], loadout: ["get-back-up", "whirlwind", "reckless", "vitality"] });
    expect(sheet.inventory).toEqual([
      { id: "id", name: "Torch" },
      { id: "id", name: "Minor Health Potion" },
    ]);
  });

  it("refuses equipment above the character's tier and cards above the level", () => {
    expect(() => sheetFromImport(validDraft({ level: 4 }), false)).toThrow(RuleError);
    expect(importProblem(validDraft({ level: 4 }), false)).toMatch(/Tier 3/);
    expect(importProblem(validDraft({ level: 5, domainCards: ["know-thy-enemy", "signature-move"] }), false)).toBeNull();
    expect(importProblem(validDraft({ domainCards: ["get-back-up", "get-back-up"] }), false)).toMatch(/once/);
    expect(importProblem(validDraft({ domainCards: ["book-of-ava"] }), false)).toMatch(/domains/);
  });

  it("refuses an incomplete draft, marked HP over the maximum and Hope & Fear content in a core campaign", () => {
    expect(importProblem(validDraft({ name: "" }), false)).toMatch(/^name/);
    expect(importProblem(validDraft({ hp: 8 }), false)).not.toBeNull();
    expect(importProblem(validDraft({ hp: 7, hpMax: 6 }), false)).toMatch(/Hit Points/);
    expect(importProblem(validDraft({ classId: "assassin", subclassId: "executioners-guild" }), false)).toMatch(/Hope & Fear|subclass/);
  });
});
