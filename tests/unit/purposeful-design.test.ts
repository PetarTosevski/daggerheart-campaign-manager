import { fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { experienceBonus, experienceValue, holdsPurposefulDesign, PURPOSEFUL_DESIGN_ID } from "@/lib/domain/dice";
import { applyLevelUp, cardsWithin, validateLevelUp, type LevelUpChoice } from "@/lib/domain/level-up";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { ANCESTRY_CORE_EFFECTS } from "@/lib/srd/feature-effects/ancestry-core";
import { characterSheetSchema, experienceSchema, type CharacterSheet } from "@/lib/validation/characters";

// DA11 (dcm-bxp.99.19.18). Purposeful Design, CB p.53 Clank: "At character creation, choose one of your Experiences that
// best aligns with this purpose and gain a permanent +1 bonus to it." User 2026-10-29: the sheet records the chosen
// Experience and adds +1 automatically; the stored value is never bumped.

const experiences = [
  { id: "a", name: "Sellsword", value: 2 },
  { id: "b", name: "Tinker", value: 2, purposefulDesign: true as const },
];

describe("Purposeful Design: the +1", () => {
  it("experienceValue adds +1 only to the recorded Experience", () => {
    expect(experienceValue(experiences[0]!)).toBe(2);
    expect(experienceValue(experiences[1]!)).toBe(3);
  });

  it("experienceBonus (every roll) adds it; the Hope cost is unchanged", () => {
    expect(experienceBonus(experiences, ["b"])).toEqual({ value: 3, hope: 1, names: ["Tinker"] });
    expect(experienceBonus(experiences, ["a", "b"])).toEqual({ value: 5, hope: 2, names: ["Sellsword", "Tinker"] });
    expect(experienceBonus(experiences, ["a"]).value).toBe(2);
  });

  it("the field is optional: Experiences stored before it parse unchanged, and only `true` is accepted", () => {
    expect(experienceSchema.parse({ id: "a", name: "Sellsword", value: 2 })).toEqual({ id: "a", name: "Sellsword", value: 2 });
    expect(experienceSchema.parse(experiences[1])).toEqual(experiences[1]);
    expect(experienceSchema.safeParse({ ...experiences[0], purposefulDesign: false }).success).toBe(false);
    expect(characterSheetSchema.shape.experiences.parse(experiences)).toEqual(experiences);
  });
});

describe("Purposeful Design: who holds it", () => {
  it("a Clank, and a mixed ancestry whose first feature is the Clank's (CB p.71)", () => {
    expect(holdsPurposefulDesign({ kind: "single", id: "clank" })).toBe(true);
    expect(holdsPurposefulDesign({ kind: "single", id: "dwarf" })).toBe(false);
    expect(holdsPurposefulDesign({ kind: "mixed", first: "clank", second: "elf", name: "" })).toBe(true);
    expect(holdsPurposefulDesign({ kind: "mixed", first: "elf", second: "clank", name: "" })).toBe(false);
  });

  it("a Shapeshifter whose chosen form feature is Purposeful Design, with Hope & Fear on", () => {
    const shape = { kind: "shapeshifter" as const, form: "clank", feature: "Purposeful Design" };
    expect(holdsPurposefulDesign(shape)).toBe(true);
    expect(holdsPurposefulDesign({ ...shape, feature: "Efficient" })).toBe(false);
  });

  it("the ancestry-core entry is no longer a reminder: no manual step", () => {
    const entry = ANCESTRY_CORE_EFFECTS.find((e) => e.featureId === PURPOSEFUL_DESIGN_ID)!;
    expect(entry.uses).toHaveLength(1);
    expect(entry.uses[0]!.activation).toEqual({ kind: "passive" });
    expect(entry.uses[0]!.steps ?? []).toEqual([]);
  });
});

// DA16 (dcm-bxp.99.19.54), user 2026-10-30: the shown value may reach +11, because the level-up cap of +10 counts the
// stored value, not the +1.
describe("Purposeful Design: the level-up cap counts the stored value (DA16)", () => {
  const card = (domain: string) => DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === 1).sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
  const sheet = (value: number): CharacterSheet =>
    readSheet({
      schemaVersion: 2,
      name: "Cog",
      pronouns: "",
      description: "",
      level: 1,
      classId: "warrior",
      subclassId: "call-of-the-brave",
      ancestry: { kind: "single", id: "clank" },
      communityId: "ridgeborne",
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
      experiences: [
        { id: "exp-a", name: "Sellsword", value, purposefulDesign: true },
        { id: "exp-b", name: "Lockpick", value: 2 },
      ],
      domainCards: { owned: [card("blade"), card("bone")], loadout: [card("blade"), card("bone")] },
      background: [],
      connections: [],
      notes: "",
      levelUpPending: true,
    });
  const choice = (s: CharacterSheet): LevelUpChoice => ({
    picks: [
      { option: "experiences", tier: 2, targets: ["exp-a", "exp-b"] },
      { option: "hp", tier: 2 },
    ],
    cardId: cardsWithin(s, 2, 2, ["core"]).find((c) => !s.domainCards.owned.includes(c.id))!.id,
    experienceName: "Tinkerer",
  });
  const capped = (problems: string[]) => problems.filter((p) => p.includes("already at"));

  it("a stored +9 (shown +10) may still take +1: stored +10, shown +11", () => {
    const s = sheet(9);
    expect(experienceValue(s.experiences[0]!)).toBe(10);
    expect(capped(validateLevelUp(s, choice(s), { allowExpansion: false }))).toEqual([]);
    const next = applyLevelUp(s, choice(s), { allowExpansion: false, newId: () => "new" });
    const chosen = next.experiences.find((e) => e.id === "exp-a")!;
    expect(chosen).toMatchObject({ value: 10, purposefulDesign: true });
    expect(experienceValue(chosen)).toBe(11);
  });

  it("a stored +10 (shown +11) is at the cap", () => {
    const s = sheet(10);
    expect(capped(validateLevelUp(s, choice(s), { allowExpansion: false }))).toEqual(["Sellsword is already at +10."]);
  });
});

// ---------------------------------------------------------------- the sheet (DA16)

const calls: { name: string; args: unknown }[] = [];
let current: CharacterView | null = null;
let role: "gm" | "player" = "player";
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = functionName(ref);
    if (name === "rests:current") return { open: null, shortRestsSinceLong: 0, last: null };
    if (name === "characters:listByCampaign") return current ? [current] : [];
    return current;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    return async (args: unknown) => {
      calls.push({ name, args });
    };
  },
}));

vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({
  useCampaign: () => ({ _id: "k1", frameId: "witherwild", role, options: { hopeAndFear: false } }),
}));

const { CharacterSheetView } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet");

function clank(list: CharacterView["sheet"]["experiences"]): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit: true,
    mine: true,
    updatedAt: 0,
    sheet: {
      name: "Cog",
      pronouns: "",
      description: "",
      level: 1,
      classId: "bard",
      subclassId: "troubadour",
      ancestry: { kind: "single", id: "clank" },
      communityId: "loreborne",
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
      traitMarks: {},
      evasion: 10,
      hpMax: 5,
      hp: 0,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "rapier",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: list,
      domainCards: { owned: ["deft-deceiver"], loadout: ["deft-deceiver"] },
      background: [],
      connections: [],
      notes: "",
    } as CharacterView["sheet"],
  };
}

describe("Purposeful Design on the sheet (DA16)", () => {
  const box = () => screen.getByRole("region", { name: "Experiences" });
  const show = () => render(createElement(CharacterSheetView, { characterId: "c1" }));
  const chosen = [
    { id: "e1", name: "Sellsword", value: 10, purposefulDesign: true as const },
    { id: "e2", name: "Lockpick", value: 2 },
  ];

  beforeEach(() => {
    calls.length = 0;
    role = "player";
  });

  it("the owner sees no pick once an Experience is chosen; the chosen one shows +11 from a stored +10", () => {
    current = clank(chosen);
    show();
    expect(within(box()).queryByRole("combobox", { name: "Purposeful Design Experience" })).toBeNull();
    expect(within(box()).getByRole("textbox", { name: "Experience 1 modifier" })).toHaveValue("+11");
  });

  it("after the chosen Experience is removed, the sheet offers the pick again", () => {
    current = clank([{ id: "e2", name: "Lockpick", value: 2 }]);
    show();
    fireEvent.click(within(box()).getByRole("button", { name: "Choose" }));
    expect(calls).toContainEqual({ name: "characters:choosePurposefulDesign", args: expect.objectContaining({ characterId: "c1", experienceId: "e2" }) });
  });

  it("the GM can move the +1 to another Experience", () => {
    role = "gm";
    current = clank(chosen);
    show();
    const select = within(box()).getByRole("combobox", { name: "Purposeful Design Experience" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Lockpick"]);
    fireEvent.click(within(box()).getByRole("button", { name: "Move" }));
    expect(calls).toContainEqual({ name: "characters:choosePurposefulDesign", args: expect.objectContaining({ experienceId: "e2" }) });
  });

  it("typing +11 into the chosen Experience saves a stored +10", () => {
    current = clank([
      { id: "e1", name: "Sellsword", value: 2, purposefulDesign: true },
      { id: "e2", name: "Lockpick", value: 2 },
    ]);
    show();
    const input = within(box()).getByRole("textbox", { name: "Experience 1 modifier" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "+11" } });
    fireEvent.blur(input);
    const saved = calls.find((c) => c.name === "characters:updateSheet")?.args as { patch: { experiences: { value: number }[] } } | undefined;
    expect(saved?.patch.experiences[0]!.value).toBe(10);
  });
});
