import { describe, expect, it } from "vitest";

import { importDraftSchema } from "@/lib/import/draft";
import { importProblem, sheetFromImport } from "@/lib/import/sheet";
import { bestMatch, draftFromReading, normalise, sheetReadingSchema, similarity, SHEET_READING_JSON_SCHEMA } from "@/lib/import/sheet-photo";
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

  it("describes every reading field in the JSON schema sent to the API", () => {
    expect(Object.keys(SHEET_READING_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(sheetReadingSchema.shape).sort());
    expect(SHEET_READING_JSON_SCHEMA.required).toEqual(Object.keys(SHEET_READING_JSON_SCHEMA.properties));
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
