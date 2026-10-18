import { fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];
let current: CharacterView | null = null;
type OpenRest = { _id: string; kind: "short" | "long"; startedAt: number; gmOverride: boolean; choices: never[]; moves: never[] };
/** What `rests.current` returns: no open rest unless a test opens one (then with the validator's full shape). */
let restsCurrent: { open: OpenRest | null; shortRestsSinceLong: number; last: null } = { open: null, shortRestsSinceLong: 0, last: null };

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = functionName(ref);
    if (name === "rests:current") return restsCurrent;
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
  useCampaign: () => ({ _id: "k1", frameId: "witherwild", options: { hopeAndFear: false } }),
}));

const { CharacterSheetView } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet");

function character(overrides: Partial<CharacterView> = {}): CharacterView {
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
      hp: 1,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "rapier",
      armorId: "gambeson-armor",
      inventory: [{ id: "i1", name: "Torch" }],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [
        { id: "e1", name: "Wandering minstrel", value: 2 },
        { id: "e2", name: "Silver tongue", value: 2 },
        { id: "e3", name: "Old soldier", value: 10 },
      ],
      domainCards: { owned: ["deft-deceiver", "book-of-ava"], loadout: ["deft-deceiver"] },
      background: ["My aunt."],
      connections: [],
      notes: "Owes the innkeeper.",
    },
    ...overrides,
  };
}

const show = () => render(createElement(CharacterSheetView, { characterId: "c1" }));
const KEY = "dcm:level-up-draft:c1";
const pending = (level = 1) => character({ sheet: { ...character().sheet, level, levelUpPending: true } as CharacterView["sheet"] });
/** Seeds the stored draft the provider restores (the tier boxes that tick picks come with GL1). */
const storeDraft = (level: number, picks: unknown[]) =>
  window.sessionStorage.setItem(KEY, JSON.stringify({ v: 1, level, step: "experiences", draft: { picks, experienceName: "", cardId: "" } }));
const box = () => screen.getByRole("region", { name: "Experiences" });

// GL2: in the guided level-up the Experiences box takes the achievement Experience (levels 2/5/8) and the targets of
// the "+1 to two Experiences" advancement; outside the mode it is unchanged.
describe("Experiences in the guided level-up", () => {
  beforeEach(() => {
    calls.length = 0;
    window.sessionStorage.clear();
    current = character();
    restsCurrent = { open: null, shortRestsSinceLong: 0, last: null };
  });

  it("outside the mode: the box is the level-up target with the normal Add form and no draft inputs", () => {
    current = pending();
    show();
    expect(box()).toHaveAttribute("id", "lu-target-experiences");
    expect(within(box()).getByRole("textbox", { name: "New Experience" })).toBeInTheDocument();
    expect(within(box()).queryByRole("textbox", { name: /for level/ })).toBeNull();
    expect(within(box()).queryByRole("checkbox")).toBeNull();
  });

  it("at level 2: ▲ focuses the box, the highlighted input fills the draft's Experience, Cancel removes it", () => {
    current = pending();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Level up to 2" }));
    expect(within(box()).getByRole("heading", { name: "Experiences" })).toHaveFocus();
    const input = within(box()).getByRole("textbox", { name: "New Experience (+2) for level 2" });
    expect(input).toHaveAttribute("maxLength", "80");
    expect(within(box()).getByText("Level 2")).toBeInTheDocument();
    // The direct Add form steps aside so there is one way to add the level's Experience.
    expect(within(box()).queryByRole("textbox", { name: "New Experience" })).toBeNull();

    const ribbon = screen.getByRole("region", { name: "Level-up to 2" });
    const steps = within(ribbon).getByRole("list", { name: "Level-up steps" });
    expect(within(steps).getAllByRole("listitem")[0]).toHaveAttribute("data-done", "false");
    fireEvent.change(input, { target: { value: "Court musician" } });
    expect(input).toHaveValue("Court musician");
    expect(within(steps).getAllByRole("listitem")[0]).toHaveAttribute("data-done", "true");
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}").draft.experienceName).toBe("Court musician");
    expect(calls).toEqual([]);

    fireEvent.click(within(ribbon).getByRole("button", { name: "Cancel" }));
    expect(within(box()).queryByRole("textbox", { name: /for level/ })).toBeNull();
    expect(within(box()).getByRole("textbox", { name: "New Experience" })).toBeInTheDocument();
  });

  it("at a non-achievement level there is no new-Experience input", () => {
    current = pending(2);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Level up to 3" }));
    expect(screen.getByRole("region", { name: "Level-up to 3" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("tablist", { name: "Sheet pages" })).getByRole("tab", { name: "Character Sheet" }));
    expect(within(box()).queryByRole("textbox", { name: /New Experience \(\+2\)/ })).toBeNull();
    expect(within(box()).queryByRole("checkbox")).toBeNull();
  });

  it("with the Experiences advancement ticked: one checkbox per Experience, at most two, capped ones disabled", () => {
    current = pending(2);
    storeDraft(2, [{ option: "experiences", tier: 2, targets: [] }]);
    show();
    const group = within(box()).getByRole("group", { name: "+1 to two Experiences for level 3" });
    const minstrel = within(group).getByRole("checkbox", { name: "+1 to Wandering minstrel" });
    const tongue = within(group).getByRole("checkbox", { name: "+1 to Silver tongue" });
    const soldier = within(group).getByRole("checkbox", { name: /\+1 to Old soldier/ });
    expect(soldier).toBeDisabled();
    expect(within(group).getByText("Choose two (0/2).")).toBeInTheDocument();

    fireEvent.click(minstrel);
    fireEvent.click(tongue);
    expect(minstrel).toBeChecked();
    expect(tongue).toBeChecked();
    expect(within(group).getByText("Choose two (2/2).")).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}").draft.picks).toEqual([{ option: "experiences", tier: 2, targets: ["e1", "e2"] }]);

    fireEvent.click(minstrel);
    expect(minstrel).not.toBeChecked();
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}").draft.picks[0].targets).toEqual(["e2"]);
    expect(calls).toEqual([]);
  });

  it("the third Experience stays disabled once two are chosen", () => {
    current = character({
      sheet: {
        ...pending(2).sheet,
        experiences: [
          { id: "e1", name: "Wandering minstrel", value: 2 },
          { id: "e2", name: "Silver tongue", value: 2 },
          { id: "e3", name: "Old soldier", value: 3 },
        ],
      } as CharacterView["sheet"],
    });
    storeDraft(2, [{ option: "experiences", tier: 2, targets: ["e1", "e2"] }]);
    show();
    const group = within(box()).getByRole("group", { name: "+1 to two Experiences for level 3" });
    expect(within(group).getByRole("checkbox", { name: "+1 to Old soldier" })).toBeDisabled();
    expect(within(group).getByRole("checkbox", { name: "+1 to Silver tongue" })).toBeEnabled();
  });
});
