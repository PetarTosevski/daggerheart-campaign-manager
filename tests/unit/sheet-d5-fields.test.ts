import type { GenericValidator } from "convex/values";
import { describe, expect, it } from "vitest";

import { assertCanAct, readSheet, storedSheet } from "../../convex/lib/characterSheet";
import { characterViewValidator, sheetValidator } from "../../convex/lib/validators/characters";
import { applyResourceDelta, hopeMax } from "@/lib/domain/characters";

/** A version 2 sheet as D4 stored it: no D5 field. */
const STORED_V2 = {
  schemaVersion: 2,
  name: "Brannoc",
  pronouns: "",
  description: "",
  level: 1,
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single", id: "dwarf" },
  communityId: "ridgeborne",
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  traitMarks: {},
  evasion: 11,
  hpMax: 6,
  hp: 2,
  stressMax: 6,
  stress: 0,
  hope: 2,
  scars: 0,
  armorMarked: 0,
  proficiency: 1,
  primaryWeaponId: "broadsword",
  inventory: [{ id: "inv-0", name: "Torch" }],
  gold: { handfuls: 1, bags: 0, chest: false },
  experiences: [{ id: "exp-0", name: "Sellsword", value: 2 }],
  domainCards: { owned: [], loadout: [] },
  background: [],
  connections: [],
  notes: "",
};

const D5_DEFAULTS = {
  hopeSlotBonus: 0,
  subclassRank: "foundation",
  advancements: [],
  levelUpPending: false,
  conditions: [],
  effects: [],
  heldDice: [],
  featureUses: [],
  classState: {},
  wither: 0,
  journeyEnds: false,
};

/** A copy of `obj` without `keys`. */
function without(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/** Whether `value` matches a Convex validator (enough of the spec for these shapes). */
function conforms(validator: GenericValidator, value: unknown): boolean {
  switch (validator.kind) {
    case "string":
      return typeof value === "string";
    case "float64":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "id":
      return typeof value === "string";
    case "literal":
      return value === validator.value;
    case "array":
      return Array.isArray(value) && value.every((item) => conforms(validator.element, item));
    case "union":
      return validator.members.some((member) => conforms(member, value));
    case "record":
      return typeof value === "object" && value !== null && Object.values(value).every((item) => conforms(validator.value, item));
    case "object": {
      if (typeof value !== "object" || value === null) return false;
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some((k) => !(k in validator.fields))) return false;
      return Object.entries(validator.fields as Record<string, GenericValidator>).every(([k, field]) =>
        record[k] === undefined ? field.isOptional === "optional" : conforms(field, record[k]),
      );
    }
    default:
      return false;
  }
}

describe("D5 sheet fields", () => {
  it("a stored version 2 sheet without them parses with their defaults", () => {
    const sheet = readSheet(STORED_V2);
    expect(sheet).toMatchObject(D5_DEFAULTS);
    expect(sheet.multiclass).toBeUndefined();
    expect(sheet.name).toBe("Brannoc");
  });

  it("a version 1 sheet gets them too", () => {
    const rest = without(STORED_V2, "schemaVersion", "inventory", "experiences");
    const sheet = readSheet({ ...rest, inventory: ["Torch"], experiences: [{ name: "Sellsword", value: 2 }] });
    expect(sheet).toMatchObject(D5_DEFAULTS);
  });

  it("round-trips through storedSheet without a version bump", () => {
    const stored = storedSheet(readSheet(STORED_V2));
    expect(stored.schemaVersion).toBe(2);
    expect(readSheet(stored)).toEqual(readSheet(STORED_V2));
  });

  it("passes the view validator with and without the D5 fields", () => {
    const view = {
      _id: "c1",
      ownerId: "u1",
      status: "active",
      sheet: readSheet(STORED_V2),
      portraitUrl: null,
      canEdit: true,
      mine: true,
      updatedAt: 0,
    };
    const bare = without(STORED_V2, "schemaVersion");
    expect(conforms(characterViewValidator, view)).toBe(true);
    expect(conforms(sheetValidator, bare)).toBe(true);
    expect(conforms(characterViewValidator, { ...view, status: "away", away: { reason: "infirmary" } })).toBe(true);
    // The checker itself rejects a wrong shape.
    expect(conforms(sheetValidator, { ...bare, wither: "3" })).toBe(false);
  });

  it("keeps every D5 field it was given", () => {
    const full = {
      ...STORED_V2,
      hope: 7,
      hopeSlotBonus: 1,
      subclassRank: "specialization",
      multiclass: { classId: "rogue", domainId: "midnight", subclassId: "nightwalker" },
      advancements: [{ level: 2, picks: [{ option: "traits", tier: 2, slot: 0, targets: ["agility", "strength"] }], cardId: "card" }],
      levelUpPending: true,
      conditions: ["unconscious"],
      effects: [{ id: "e1", source: "Rogue's Dodge", text: "+2 Evasion", until: "hit", mods: { evasion: 2 } }],
      heldDice: [{ id: "d1", kind: "rally", sides: 6, until: "session", fromCharacterId: "c2" }],
      featureUses: [{ key: "tagTeam", until: "session" }],
      classState: { strangeNumber: 7, favor: 3 },
      wither: 4,
      journeyEnds: true,
    };
    const sheet = readSheet(full);
    expect(sheet).toEqual(without(full, "schemaVersion"));
    expect(conforms(sheetValidator, sheet)).toBe(true);
  });

  it("rejects out-of-range D5 values as corrupt", () => {
    for (const bad of [{ hope: 8 }, { wither: -1 }, { hopeSlotBonus: 2 }, { conditions: ["asleep"] }, { subclassRank: "grandmaster" }]) {
      expect(() => readSheet({ ...STORED_V2, ...bad })).toThrow();
    }
  });
});

describe("Hope max and resources", () => {
  it("hopeMax = 6 + hopeSlotBonus − scars (CB 18, 90; CB 40 Light in the Dark, dcm-bxp.14)", () => {
    expect(hopeMax(0)).toBe(6);
    expect(hopeMax(2)).toBe(4);
    expect(hopeMax(0, 1)).toBe(7);
    expect(hopeMax(1, 1)).toBe(6);
    expect(hopeMax(9, 1)).toBe(0);
  });

  it("applyResourceDelta caps Hope at hopeMax, including the seventh slot", () => {
    const tracks = { hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 6, scars: 0 };
    expect(applyResourceDelta(tracks, "hope", 1).hope).toBe(6);
    expect(applyResourceDelta({ ...tracks, hopeSlotBonus: 1 }, "hope", 1).hope).toBe(7);
    expect(applyResourceDelta({ ...tracks, hope: 7, hopeSlotBonus: 1 }, "scars", 1).hope).toBe(6);
  });

  it("clearing a Hit Point removes Unconscious (CB 106); marking one doesn't", () => {
    const down = { hp: 6, hpMax: 6, stress: 0, stressMax: 6, hope: 2, scars: 0, conditions: ["unconscious", "hidden"] as const };
    expect(applyResourceDelta(down, "hp", -1).conditions).toEqual(["hidden"]);
    expect(applyResourceDelta({ ...down, hp: 3 }, "hp", 1).conditions).toEqual(["unconscious", "hidden"]);
    expect(down.conditions).toEqual(["unconscious", "hidden"]);
  });
});

describe("assertCanAct", () => {
  const sheet = readSheet(STORED_V2);
  it("refuses dead, away and unconscious characters with CHARACTER_UNAVAILABLE", () => {
    const code = (run: () => void) => {
      try {
        run();
        return "ok";
      } catch (e) {
        return (e as { data?: { code?: string } }).data?.code;
      }
    };
    expect(code(() => assertCanAct({ status: "active" }, sheet))).toBe("ok");
    expect(code(() => assertCanAct({ status: "retired" }, sheet))).toBe("ok");
    expect(code(() => assertCanAct({ status: "dead" }, sheet))).toBe("CHARACTER_UNAVAILABLE");
    expect(code(() => assertCanAct({ status: "away" }, sheet))).toBe("CHARACTER_UNAVAILABLE");
    expect(code(() => assertCanAct({ status: "active" }, { conditions: ["unconscious"] }))).toBe("CHARACTER_UNAVAILABLE");
  });
});
