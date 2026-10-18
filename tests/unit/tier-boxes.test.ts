import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { CLASSES } from "../../src/lib/srd/classes";
import { SUBCLASSES } from "../../src/lib/srd/subclasses";

// Tier boxes in the guided level-up (plan guided-level-up, GL1): the open tiers' boxes are tickable for the new
// level, blocked ones stay disabled with their reason, earlier marks stay read-only, and ticked options with targets
// show their chooser (traits, multiclass, subclass) or a button to Experiences / the Domain Deck.

vi.mock("convex/react", () => ({ useMutation: () => async () => null }));

const { LevelUpDraftProvider, useLevelUpDraft } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up-draft");
const { TierBoxes } = await import("@/components/party/level-up/history");
const { fullSheet } = await import("@/components/party/level-up/shared");

type Draft = ReturnType<typeof useLevelUpDraft>;

function character(sheet: Partial<CharacterView["sheet"]> = {}): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit: true,
    mine: true,
    updatedAt: 0,
    sheet: {
      name: "Liriel",
      pronouns: "she/her",
      description: "",
      level: 1,
      classId: "bard",
      subclassId: "troubadour",
      ancestry: { kind: "single", id: "elf" },
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
      armorId: "gambeson-armor",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [
        { id: "e1", name: "Wandering minstrel", value: 2 },
        { id: "e2", name: "Silver tongue", value: 2 },
      ],
      domainCards: { owned: ["deft-deceiver", "book-of-ava"], loadout: ["deft-deceiver", "book-of-ava"] },
      background: [],
      connections: [],
      notes: "",
      levelUpPending: true,
      ...sheet,
    } as CharacterView["sheet"],
  };
}

/** A level-4 Bard: HP twice, Stress, Evasion and two traits (agility, strength) taken in tier 2. */
const LEVEL_4: Partial<CharacterView["sheet"]> = {
  level: 4,
  traitMarks: { agility: 1, strength: 1 },
  advancements: [
    { level: 2, cardId: "x2", picks: [{ option: "hp", tier: 2, slot: 0 }, { option: "stress", tier: 2, slot: 0 }] },
    { level: 3, cardId: "x3", picks: [{ option: "hp", tier: 2, slot: 1 }, { option: "evasion", tier: 2, slot: 0 }] },
    { level: 4, cardId: "x4", picks: [{ option: "traits", tier: 2, slot: 0, targets: ["agility", "strength"] }, { option: "stress", tier: 2, slot: 1 }] },
  ],
} as Partial<CharacterView["sheet"]>;

function setup(view: CharacterView = character(), { start = true, hopeAndFear = false } = {}) {
  const navigate = vi.fn();
  const slot = { campaignId: "k1" as Id<"campaigns">, character: view, canEdit: true, isGm: false, hopeAndFear };
  const ref: { current: Draft | null } = { current: null };
  function Probe() {
    ref.current = useLevelUpDraft();
    return null;
  }
  const sheet = fullSheet(view)!;
  render(createElement(LevelUpDraftProvider, { slot, navigate }, createElement(Probe), createElement(TierBoxes, { sheet, hopeAndFear })));
  if (start) act(() => ref.current!.start());
  return { navigate, draft: () => ref.current! };
}

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("TierBoxes in the guided level-up", () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("is the advancements target and stays read-only outside the mode", () => {
    setup(character(), { start: false });
    const region = screen.getByRole("region", { name: "Level Up" });
    expect(region.id).toBe("lu-target-advancements");
    expect(within(region).getAllByRole("checkbox").every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(screen.queryByText(/picks$/)).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /for level 2/ })).toBeNull();
  });

  it("makes the open tier's options tickable for the new level; a ticked box is a green draft mark", () => {
    const { draft } = setup();
    expect(screen.getByText("Level 2: 0 / 2 picks")).toBeTruthy();
    const hp = box("Tier 2: +1 Hit Point slot for level 2");
    expect((hp as HTMLInputElement).disabled).toBe(false);
    // Tier 3 is still locked at level 2.
    expect(screen.queryByRole("checkbox", { name: /^Tier 3: .* for level 2/ })).toBeNull();

    fireEvent.click(hp);
    expect(draft().draft.picks).toEqual([{ option: "hp", tier: 2 }]);
    const ticked = box("Tier 2: +1 Hit Point slot for level 2");
    expect((ticked as HTMLInputElement).checked).toBe(true);
    expect(ticked.classList.contains("draft")).toBe(true);
    expect(within(ticked.closest("li")!).getByText("level 2")).toBeTruthy();
    // The option's second slot can take the other pick.
    expect((box("Tier 2: +1 Hit Point slot for level 2 (second pick)") as HTMLInputElement).disabled).toBe(false);

    fireEvent.click(box("Tier 2: +1 Stress slot for level 2"));
    expect(screen.getByText("Level 2: 2 / 2 picks")).toBeTruthy();
    const evasion = box("Tier 2: +1 Evasion for level 2") as HTMLInputElement;
    expect(evasion.disabled).toBe(true);
    expect(document.getElementById(evasion.getAttribute("aria-describedby")!)?.textContent).toBe("Both picks for level 2 are used.");

    // Unticking a draft mark removes the pick.
    fireEvent.click(box("Tier 2: +1 Hit Point slot for level 2"));
    expect(draft().draft.picks).toEqual([{ option: "stress", tier: 2 }]);
    expect((box("Tier 2: +1 Evasion for level 2") as HTMLInputElement).disabled).toBe(false);
  });

  it("shows two unmarked traits to raise under a ticked traits option", () => {
    const { draft } = setup(character({ traitMarks: { agility: 1 } }));
    fireEvent.click(box("Tier 2: +1 to two unmarked traits for level 2"));
    const group = screen.getByRole("group", { name: "Traits to raise for level 2" });
    const agility = within(group).getByRole("button", { name: /Agility/ }) as HTMLButtonElement;
    expect(agility.disabled).toBe(true);
    expect(agility.textContent).toContain("(marked)");

    fireEvent.click(within(group).getByRole("button", { name: /Presence/ }));
    fireEvent.click(within(group).getByRole("button", { name: /Knowledge/ }));
    expect(draft().draft.picks[0]).toEqual({ option: "traits", tier: 2, targets: ["presence", "knowledge"] });
    expect(within(group).getByRole("button", { name: /Presence/ }).getAttribute("aria-pressed")).toBe("true");
    // Two chosen: the rest wait until one is unpressed.
    expect((within(group).getByRole("button", { name: /Finesse/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: /Presence/ }));
    expect(draft().draft.picks[0]!.targets).toEqual(["knowledge"]);
    // GL5: the traits option can take the level's other pick too.
    expect((box("Tier 2: +1 to two unmarked traits for level 2 (second pick)") as HTMLInputElement).disabled).toBe(false);
  });

  it("takes the traits option twice in one level: four different unmarked traits, one chooser per pick (GL5)", () => {
    const { draft } = setup(character({ traitMarks: { agility: 1 } }));
    fireEvent.click(box("Tier 2: +1 to two unmarked traits for level 2"));
    fireEvent.click(box("Tier 2: +1 to two unmarked traits for level 2 (second pick)"));
    expect(screen.getByText("Level 2: 2 / 2 picks")).toBeTruthy();
    const first = screen.getByRole("group", { name: "Traits to raise for level 2" });
    const second = screen.getByRole("group", { name: "Traits to raise for level 2 (second pick)" });

    fireEvent.click(within(first).getByRole("button", { name: /Presence/ }));
    fireEvent.click(within(first).getByRole("button", { name: /Knowledge/ }));
    // Traits the first pick raises, and traits marked this tier, are disabled in the second.
    for (const name of [/Presence/, /Knowledge/, /Agility/]) expect((within(second).getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(second).getByRole("button", { name: /Finesse/ }));
    fireEvent.click(within(second).getByRole("button", { name: /Instinct/ }));
    expect((within(first).getByRole("button", { name: /Finesse/ }) as HTMLButtonElement).disabled).toBe(true);

    expect(draft().draft.picks).toEqual([
      { option: "traits", tier: 2, targets: ["presence", "knowledge"] },
      { option: "traits", tier: 2, targets: ["finesse", "instinct"] },
    ]);
    expect(draft().problems.filter((p) => /trait/i.test(p))).toEqual([]);

    // A trait the other pick raises says so.
    expect(within(first).getByRole("button", { name: /Finesse/ })).toHaveTextContent("(other pick)");

    // Unticking the FIRST box removes the first pick; the second pick keeps its traits.
    fireEvent.click(box("Tier 2: +1 to two unmarked traits for level 2"));
    expect(draft().draft.picks).toEqual([{ option: "traits", tier: 2, targets: ["finesse", "instinct"] }]);
    expect(screen.queryByRole("group", { name: "Traits to raise for level 2 (second pick)" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Traits to raise for level 2" })).getByRole("button", { name: /Finesse/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends the Experiences option to the Experiences box and the extra card to the Domain Deck", () => {
    const { navigate } = setup(character({ level: 2 }));
    fireEvent.click(box("Tier 2: +1 to two Experiences for level 3"));
    fireEvent.click(screen.getByRole("button", { name: "Choose them in Experiences" }));
    expect(navigate).toHaveBeenLastCalledWith("sheet", undefined);

    fireEvent.click(box("Tier 2: Extra domain card for level 3"));
    fireEvent.click(screen.getByRole("button", { name: "Choose it in the Domain Deck" }));
    expect(navigate).toHaveBeenLastCalledWith("domains", "cards");
  });

  it("keeps earlier levels' marks read-only and opens tier 3 at level 5 with its two-pick and subclass options", () => {
    const { draft } = setup(character(LEVEL_4));
    const earlier = box("Tier 2: +1 Hit Point slot (2), taken at level 3") as HTMLInputElement;
    expect(earlier.checked && earlier.disabled).toBe(true);
    expect(earlier.classList.contains("draft")).toBe(false);
    // Every HP slot of tier 2 is marked: nothing to tick there.
    expect(screen.queryByRole("checkbox", { name: "Tier 2: +1 Hit Point slot for level 5" })).toBeNull();

    fireEvent.click(box("Tier 3: +1 Hit Point slot for level 5"));
    const proficiency = box("Tier 3: +1 Proficiency (both picks) for level 5") as HTMLInputElement;
    expect(proficiency.disabled).toBe(true);
    expect(document.getElementById(proficiency.getAttribute("aria-describedby")!)?.textContent).toBe("It takes both picks for level 5; untick your other pick first.");
    fireEvent.click(box("Tier 3: +1 Hit Point slot for level 5"));
    fireEvent.click(box("Tier 3: +1 Proficiency (both picks) for level 5"));
    expect(draft().picksUsed).toBe(2);
    fireEvent.click(box("Tier 3: +1 Proficiency (both picks) for level 5"));

    fireEvent.click(box("Tier 3: Upgraded subclass card for level 5"));
    // GL5: the upgraded subclass card itself, as the Heritage & Subclass tab's hero card.
    expect(screen.getByText("At level 5 you take your specialization card.")).toBeTruthy();
    const card = screen.getByRole("article", { name: "Subclass: Troubadour Specialization" });
    const troubadour = SUBCLASSES.find((s) => s.id === "troubadour")!;
    expect(within(card).getByRole("heading", { name: "Troubadour" })).toBeTruthy();
    expect(within(card).getByText("Subclass")).toBeTruthy();
    expect(within(card).getByText("Specialization")).toBeTruthy();
    expect(card.textContent).toContain(troubadour.specialization[0]!.name);
  });

  it("shows the mastery card when the subclass is already specialized (GL5)", () => {
    setup(character({ ...LEVEL_4, subclassRank: "specialization" } as Partial<CharacterView["sheet"]>));
    fireEvent.click(box("Tier 3: Upgraded subclass card for level 5"));
    expect(screen.getByRole("article", { name: "Subclass: Troubadour Mastery" })).toBeTruthy();
  });

  it("shows the multiclass class, domain and foundation selects under a ticked multiclass", () => {
    const { draft } = setup(character(LEVEL_4));
    fireEvent.click(box("Tier 3: Multiclass (both picks) for level 5"));
    const panel = screen.getByRole("group", { name: "Multiclass for level 5" });
    const cls = within(panel).getByRole("combobox", { name: "Class" }) as HTMLSelectElement;
    expect(within(cls).queryByRole("option", { name: "Bard" })).toBeNull();
    const other = CLASSES.find((c) => c.source === "core" && c.id !== "bard" && c.domains.some((d) => d === "grace" || d === "codex"))!;
    fireEvent.change(cls, { target: { value: other.id } });
    expect(draft().draft.multiclass).toEqual({ classId: other.id, domainId: "", subclassId: "" });

    const domain = within(panel).getByRole("combobox", { name: "Domain" }) as HTMLSelectElement;
    const values = Array.from(domain.options).map((o) => o.value).filter(Boolean);
    const fresh = other.domains.filter((d) => d !== "grace" && d !== "codex");
    expect(values).toEqual(fresh);
    fireEvent.change(domain, { target: { value: fresh[0] } });
    const foundation = within(panel).getByRole("combobox", { name: "Foundation card" }) as HTMLSelectElement;
    fireEvent.change(foundation, { target: { value: foundation.options[1]!.value } });
    expect(draft().draft.multiclass).toMatchObject({ classId: other.id, domainId: fresh[0] });
    expect(draft().problems.some((p) => /class|domain|foundation/i.test(p) && !/domain card/i.test(p))).toBe(false);
    // Multiclass crosses out this tier's upgraded subclass for the level (both picks used).
    expect((box("Tier 3: Upgraded subclass card for level 5") as HTMLInputElement).disabled).toBe(true);
  });

  it("asks for the Spellcast trait only when both foundation cards have a different one (SS2, CB 111)", () => {
    const { draft } = setup(character(LEVEL_4));
    fireEvent.click(box("Tier 3: Multiclass (both picks) for level 5"));
    const panel = screen.getByRole("group", { name: "Multiclass for level 5" });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Class" }), { target: { value: "wizard" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Domain" }), { target: { value: "splendor" } });
    expect(screen.queryByRole("group", { name: "Spellcast trait for Spellcast Rolls" })).toBeNull();
    fireEvent.change(within(panel).getByRole("combobox", { name: "Foundation card" }), { target: { value: "school-of-knowledge" } });

    const choice = screen.getByRole("group", { name: "Spellcast trait for Spellcast Rolls" });
    const options = within(choice).getAllByRole("button");
    expect(options.map((b) => b.textContent)).toEqual(["Presence (Troubadour)", "Knowledge (School of Knowledge)"]);
    expect(draft().problems).toContain("Choose the Spellcast trait for Spellcast Rolls.");
    fireEvent.click(options[1]!);
    expect(draft().draft.multiclass).toEqual({ classId: "wizard", domainId: "splendor", subclassId: "school-of-knowledge", spellcastTrait: "knowledge" });
    expect(options[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(draft().problems.some((p) => /Spellcast/.test(p))).toBe(false);

    // Another foundation card drops the choice; Warrior subclasses have no Spellcast trait, so nothing is asked.
    fireEvent.change(within(panel).getByRole("combobox", { name: "Class" }), { target: { value: "warrior" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Domain" }), { target: { value: "blade" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Foundation card" }), { target: { value: "call-of-the-brave" } });
    expect(draft().draft.multiclass?.spellcastTrait).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Spellcast trait for Spellcast Rolls" })).toBeNull();
  });

  it("notes the forced Spellcast trait when the original subclass has none (SS2)", () => {
    setup(character({ ...LEVEL_4, classId: "guardian", subclassId: "stalwart" } as Partial<CharacterView["sheet"]>));
    fireEvent.click(box("Tier 3: Multiclass (both picks) for level 5"));
    const panel = screen.getByRole("group", { name: "Multiclass for level 5" });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Class" }), { target: { value: "wizard" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Domain" }), { target: { value: "codex" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Foundation card" }), { target: { value: "school-of-knowledge" } });
    expect(screen.queryByRole("group", { name: "Spellcast trait for Spellcast Rolls" })).toBeNull();
    expect(within(panel).getByText(/You had no Spellcast trait, so your Spellcast Rolls use School of Knowledge's: Knowledge\./)).toBeTruthy();
  });

  it("keeps crossed-out options disabled with their reason", () => {
    setup(character({ ...LEVEL_4, multiclass: { classId: "warrior", domainId: "blade", subclassId: "call-of-the-brave" } } as Partial<CharacterView["sheet"]>));
    const mc = box("Tier 3: Multiclass (both picks) for level 5") as HTMLInputElement;
    expect(mc.disabled).toBe(true);
    const why = document.getElementById(mc.getAttribute("aria-describedby")!)!;
    expect(why.textContent).toBe("Crossed out: You can multiclass only once.");
    expect(why.classList.contains("sr-only")).toBe(false);
  });
});
