// The Lunar Phases section and the session-feature chips on the sheet (plan session-features F3, U6, U7).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: unknown) => {
      calls.push({ name, args });
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { LunarPhasesSlot } = await import("@/components/party/lunar");
const { FeaturesPanel } = await import("@/components/party/features");

type Sheet = CharacterView["sheet"];

function character(sheet: Partial<Sheet> = {}, canEdit = true): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit,
    mine: true,
    updatedAt: 0,
    sheet: {
      name: "Mira",
      pronouns: "",
      description: "",
      level: 7,
      classId: "witch",
      subclassId: "moon",
      subclassRank: "mastery",
      ancestry: { kind: "single", id: "elf" },
      communityId: "loreborne",
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
      traitMarks: {},
      evasion: 10,
      hpMax: 6,
      hp: 0,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 3,
      primaryWeaponId: "dualstaff",
      armorId: "gambeson-armor",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
      ...sheet,
    } as Sheet,
  };
}

function lunar(sheet: Partial<Sheet> = {}, { hopeAndFear = true, canEdit = true } = {}) {
  const c = character(sheet, canEdit);
  return render(<LunarPhasesSlot campaignId={"k1" as Id<"campaigns">} character={c} canEdit={canEdit} isGm={false} hopeAndFear={hopeAndFear} />);
}

beforeEach(() => {
  calls.length = 0;
});

describe("Lunar Phases section", () => {
  it("is absent for a sheet without the Moon subclass", () => {
    lunar({ classId: "warrior", subclassId: "call-of-the-slayer", sessionFeatures: { moonDie: 1 } });
    expect(screen.queryByRole("region", { name: "Lunar Phases" })).toBeNull();
  });

  it("is absent for a Moon Witch below mastery", () => {
    lunar({ subclassRank: "specialization", sessionFeatures: { moonDie: 1 } });
    expect(screen.queryByRole("region", { name: "Lunar Phases" })).toBeNull();
    lunar({ subclassRank: "foundation" });
    expect(screen.queryByRole("region", { name: "Lunar Phases" })).toBeNull();
  });

  it("is absent with Hope & Fear off", () => {
    lunar({ sessionFeatures: { moonDie: 1 } }, { hopeAndFear: false });
    expect(screen.queryByRole("region", { name: "Lunar Phases" })).toBeNull();
  });

  it("shows the four drawn phases with ranges and effects, the current one highlighted with the die", () => {
    lunar({ sessionFeatures: { moonDie: 3 } });
    const box = screen.getByRole("region", { name: "Lunar Phases" });
    for (const name of ["New moon", "Waxing moon", "Full moon", "Waning moon"]) {
      const art = within(box).getByRole("img", { name });
      expect(art.tagName.toLowerCase()).toBe("svg");
    }
    expect(box.querySelector("img, image, [href^='http']")).toBeNull();
    const cards = within(box).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    const current = cards.filter((c) => c.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Waxing");
    expect(current[0]).toHaveTextContent("2–3");
    expect(within(box).getByLabelText("Moon die 3")).toBeInTheDocument();
    expect(box).toHaveTextContent("+2 to damage rolls, until the session ends.");
    expect(box).toHaveTextContent("Spend a Hope to negate Minor damage");
    expect(box).toHaveTextContent("+3 to damage thresholds");
    expect(box).toHaveTextContent("+1 to Evasion");
  });

  it("without a die: no phase highlighted, the 'rolled when the session starts' note and a disabled bump", () => {
    lunar({});
    const box = screen.getByRole("region", { name: "Lunar Phases" });
    expect(within(box).getAllByRole("listitem").some((c) => c.hasAttribute("aria-current"))).toBe(false);
    expect(box).toHaveTextContent("No moon die: rolled when the session starts.");
    expect(within(box).getByRole("button", { name: /Spend a Hope: \+1 to the moon die/ })).toBeDisabled();
  });

  it("the bump is disabled with its reason when used this rest or at 0 Hope, and hidden for viewers who can't edit", () => {
    const { unmount } = lunar({ sessionFeatures: { moonDie: 2 }, featureUses: [{ key: "lunarPhasesBump", until: "rest" }] });
    expect(screen.getByRole("button", { name: /moon die/ })).toBeDisabled();
    expect(screen.getByText("Used this rest; it refreshes after a rest.")).toBeInTheDocument();
    unmount();
    const zero = lunar({ sessionFeatures: { moonDie: 2 }, hope: 0 });
    expect(screen.getByRole("button", { name: /moon die/ })).toBeDisabled();
    expect(screen.getByText("Needs 1 Hope.")).toBeInTheDocument();
    zero.unmount();
    lunar({ sessionFeatures: { moonDie: 2 } }, { canEdit: false });
    expect(screen.getByRole("region", { name: "Lunar Phases" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /moon die/ })).toBeNull();
  });

  it("the bump sends only the character id (an intent)", () => {
    lunar({ sessionFeatures: { moonDie: 6 } });
    fireEvent.click(screen.getByRole("button", { name: /moon die/ }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("sessionFeatures:bumpMoonDie");
    expect(Object.keys(calls[0]!.args as object).sort()).toEqual(["characterId", "idempotencyKey"]);
  });
});

describe("Class Features chips (U7)", () => {
  function chips(sheet: Partial<Sheet>, hopeAndFear = true) {
    const c = character(sheet);
    render(<FeaturesPanel campaignId={"k1" as Id<"campaigns">} character={c} canEdit isGm={false} hopeAndFear={hopeAndFear} />);
    return screen.queryByRole("list", { name: "Session features" });
  }

  it("shows the Slayer pool, the Tide tokens and the moon die for their holders", () => {
    const list = chips({ subclassId: "moon", communityId: "seaborne", multiclass: undefined, sessionFeatures: { moonDie: 4, tideTokens: 2 } });
    expect(list).not.toBeNull();
    expect(within(list!).getByText("Tide tokens 2/7")).toBeInTheDocument();
    expect(within(list!).getByText("Moon die 4: Full")).toBeInTheDocument();
  });

  it("shows Slayer Dice n/Proficiency for a Call of the Slayer holder", () => {
    const list = chips({ classId: "warrior", subclassId: "call-of-the-slayer", subclassRank: "foundation", sessionFeatures: { slayerDice: 2 } });
    expect(within(list!).getByText("Slayer Dice 2/3")).toBeInTheDocument();
  });

  it("shows nothing for non-holders, empty pools, or a moon die with Hope & Fear off", () => {
    expect(chips({ classId: "warrior", subclassId: "call-of-the-slayer", sessionFeatures: {} })).toBeNull();
  });

  it("hides a non-holder's stray values", () => {
    expect(chips({ classId: "bard", subclassId: "troubadour", sessionFeatures: { slayerDice: 2, tideTokens: 1, moonDie: 1 } })).toBeNull();
  });

  it("hides the moon die with Hope & Fear off", () => {
    expect(chips({ sessionFeatures: { moonDie: 1 } }, false)).toBeNull();
  });
});
