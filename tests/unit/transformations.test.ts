import { describe, expect, it } from "vitest";

import { transformationOfRule } from "@/components/tome/give-transformation";
import { addCard } from "@/lib/domain/level-up";
import { applyMoves } from "@/lib/domain/rest";
import { frameRestMoves } from "@/lib/domain/rest/frame-hooks";
import { canRaiseLoadout, changeTransformation, loadoutMax, raiseLoadout, transformationConfirm } from "@/lib/domain/transformations";
import { TOMES } from "@/lib/frames/tomes";
import { characterSheetSchema, type CharacterSheet } from "@/lib/validation/characters";

import { readSheet } from "../../convex/lib/characterSheet";

// Bead dcm-psg9: GM-given transformations (HF p.34) and Andaluria's Reanimated loadout (HF p.153).

const CARDS = ["a", "b", "c", "d"];
const sheet = (patch: Partial<CharacterSheet> = {}): CharacterSheet => ({
  ...readSheet({
    schemaVersion: 2,
    name: "Ash",
    pronouns: "",
    description: "",
    level: 1,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "human" },
    communityId: "highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 11,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 0,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "broadsword",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: CARDS, loadout: CARDS },
    background: [],
    connections: [],
    notes: "",
  }),
  ...patch,
});

describe("changeTransformation", () => {
  it("gives, replaces and removes; one per PC", () => {
    const given = changeTransformation(sheet(), "ghost", { andaluriaReanimated: true }).sheet;
    expect(given.transformationId).toBe("ghost");
    expect(changeTransformation(given, "vampire", { andaluriaReanimated: true }).sheet.transformationId).toBe("vampire");
    expect(changeTransformation(given, null, { andaluriaReanimated: true }).sheet.transformationId).toBeUndefined();
  });

  it("refuses an unknown id, and a Shapeshifter ancestry keeps Shapeshifter", () => {
    expect(() => changeTransformation(sheet(), "lich", { andaluriaReanimated: false })).toThrow();
    const form = sheet({ ancestry: { kind: "shapeshifter", form: "elf", feature: "Quick Reactions" }, transformationId: "shapeshifter" });
    expect(() => changeTransformation(form, "vampire", { andaluriaReanimated: false })).toThrow();
    expect(() => changeTransformation(form, null, { andaluriaReanimated: false })).toThrow();
  });

  it("Andaluria's Reanimated cuts the loadout to its first card; losing it restores five", () => {
    const { sheet: dead, vaulted } = changeTransformation(sheet(), "reanimated", { andaluriaReanimated: true });
    expect(dead.loadoutMax).toBe(1);
    expect(dead.domainCards).toEqual({ owned: CARDS, loadout: ["a"] });
    expect(vaulted).toEqual(["b", "c", "d"]);
    expect(characterSheetSchema.parse(dead).loadoutMax).toBe(1);
    expect(changeTransformation(dead, "ghost", { andaluriaReanimated: true }).sheet.loadoutMax).toBeUndefined();
    // Elsewhere (or with the option off) Reanimated keeps the normal loadout.
    const plain = changeTransformation(sheet(), "reanimated", { andaluriaReanimated: false });
    expect([plain.sheet.loadoutMax, plain.vaulted]).toEqual([undefined, []]);
  });
});

describe("loadout maximum", () => {
  it("Raise loadout goes up by one to five, then drops the stored maximum", () => {
    expect(raiseLoadout(sheet({ loadoutMax: 1 }))).toMatchObject({ from: 1, to: 2, sheet: { loadoutMax: 2 } });
    const top = raiseLoadout(sheet({ loadoutMax: 4 }));
    expect([top.to, top.sheet.loadoutMax, loadoutMax(top.sheet)]).toEqual([5, undefined, 5]);
    expect(canRaiseLoadout({ transformationId: "reanimated", loadoutMax: 2 })).toBe(true);
    expect(canRaiseLoadout({ transformationId: "reanimated" })).toBe(false);
    expect(canRaiseLoadout({ transformationId: "ghost", loadoutMax: 2 })).toBe(false);
  });

  it("a new card joins the loadout only below the maximum", () => {
    expect(addCard({ owned: ["a"], loadout: ["a"] }, "b", 1)).toEqual({ owned: ["a", "b"], loadout: ["a"] });
    expect(addCard({ owned: ["a"], loadout: ["a"] }, "b")).toEqual({ owned: ["a", "b"], loadout: ["a", "b"] });
  });

  it("the move is an Andaluria move with transformations on, and the rest applies it", () => {
    const rules = { frameId: "dark-heart-of-andaluria", warlock: false, raiseLoadout: true };
    expect(frameRestMoves({ ...rules, transformations: true }).extra).toContain("raiseLoadout");
    expect(frameRestMoves({ ...rules, transformations: false }).extra).not.toContain("raiseLoadout");
    expect(frameRestMoves({ ...rules, frameId: "witherwild", transformations: true }).extra).not.toContain("raiseLoadout");
    const out = applyMoves("short", { pc: sheet({ transformationId: "reanimated", loadoutMax: 1 }) }, [{ characterId: "pc", moves: [{ move: "raiseLoadout" }] }], () => 1);
    expect(out.sheets.pc!.loadoutMax).toBe(2);
    expect(out.lines.pc).toEqual(["Raise loadout: maximum loadout 1 to 2"]);
  });
});

describe("the GM's confirm and the tome's rules", () => {
  it("asks before replacing, removing or cutting the loadout; not for a first plain transformation", () => {
    expect(transformationConfirm("Ash", null, "ghost", true)).toBeNull();
    expect(transformationConfirm("Ash", "ghost", "ghost", true)).toBeNull();
    expect(transformationConfirm("Ash", "ghost", "vampire", false)).toMatch(/only one transformation/);
    expect(transformationConfirm("Ash", "ghost", null, false)).toBe("Remove Ash's Ghost transformation?");
    expect(transformationConfirm("Ash", null, "reanimated", true)).toMatch(/maximum loadout drops to 1/);
    expect(transformationConfirm("Ash", null, "reanimated", false)).toBeNull();
  });

  it("Andaluria's transformation rules name Reanimated, Vampire and Werewolf", () => {
    const ids = TOMES["dark-heart-of-andaluria"].mechanics.rules.map(transformationOfRule).filter((id) => id !== null);
    expect(ids).toEqual(["reanimated", "vampire", "werewolf"]);
  });
});
