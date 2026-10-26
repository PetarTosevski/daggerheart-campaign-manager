// Dice follow-ups (plan followups-5 F8): the GM roll form folds away and remembers it per device (dcm-bxp.34), the
// damage result names the automatic Waxing Moon +2 (dcm-bxp.66), and the Tag Team partner who picks the roll sees
// the confirmation (dcm-bxp.67).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import type { RollRecord } from "@/lib/domain/duality";

const calls: { name: string; args: unknown }[] = [];
const results: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const queries: Record<string, unknown> = {
  "campaigns:fear": 2,
  "characterExtras:get": null,
  "rolls:pendingChoices": { slayer: null, tagTeam: null },
};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => undefined }),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: unknown) => {
      calls.push({ name, args });
      return results[name] ?? null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
vi.mock("@/components/party/dice/dice3d", () => ({ play3d: async () => false }));
vi.mock("@/components/party/dice/sound", () => ({ playRollSound: () => undefined }));

const { DiceBox } = await import("@/components/party/dice/dice-box");
const { TagTeam } = await import("@/components/party/dice/tag-team");
const { RollFeedPanel } = await import("@/components/party/dice/roll-feed");

type Sheet = CharacterView["sheet"];

function character(sheet: Partial<Sheet> = {}): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit: true,
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
      hope: 4,
      scars: 0,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "dagger",
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

const damage = (values: number[], modifier: number): RollRecord => ({
  kind: "damage",
  dice: values.map((value) => ({ role: "damage" as const, sides: 8, value })),
  modifier,
  total: values.reduce((a, b) => a + b, modifier),
  outcome: "none",
  manual: false,
});

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  try {
    window.localStorage.clear();
  } catch {
    // jsdom storage is always there; nothing to clear otherwise.
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("damage result under a Waxing moon (dcm-bxp.66)", () => {
  async function rollDamage(sheet: Partial<Sheet>) {
    results["rolls:damageRoll"] = { entryId: "e1", roll: damage([5], 3) };
    render(<DiceBox campaignId={"k1" as Id<"campaigns">} character={character(sheet)} hopeAndFear />);
    const box = screen.getByRole("region", { name: "Dice" });
    fireEvent.click(within(box).getByText("Damage", { exact: true }));
    await act(async () => {
      fireEvent.click(within(box).getByRole("button", { name: "Roll" }));
    });
    return box;
  }

  it("names the automatic +2 in the result line and lists it under Roll options", async () => {
    const box = await rollDamage({ sessionFeatures: { moonDie: 2 } });
    expect(within(box).getByText("Waxing Moon +2 (always)")).toBeInTheDocument();
    const last = within(box).getByTestId("last-roll");
    expect(last).toHaveTextContent("Primary: Dagger (1d8+1) · Waxing Moon +2 (5 + 3)");
    expect(calls.find((c) => c.name === "rolls:damageRoll")?.args).toMatchObject({ options: [] });
  });

  it("says nothing about the moon in any other phase", async () => {
    const box = await rollDamage({ sessionFeatures: { moonDie: 4 } });
    expect(within(box).getByTestId("last-roll")).toHaveTextContent("Primary: Dagger (1d8+1)");
    expect(within(box).getByTestId("last-roll")).not.toHaveTextContent("Waxing");
  });
});

describe("Tag Team partner confirmation (dcm-bxp.67)", () => {
  const roll: RollRecord = {
    kind: "action",
    dice: [
      { role: "hope", sides: 12, value: 4 },
      { role: "fear", sides: 12, value: 9 },
    ],
    modifier: 1,
    total: 14,
    outcome: "successFear",
    manual: false,
  };
  const pending = {
    entryId: "e1" as Id<"actionLog">,
    rolls: [
      { characterId: "c0" as Id<"characters">, entryId: "e1" as Id<"actionLog">, roll, name: "Bryn" },
      { characterId: "c1" as Id<"characters">, entryId: "e2" as Id<"actionLog">, roll, name: "Kai" },
    ],
  };

  it("keeps the 'counts for both' line after the pick in a box whose panel was never opened, until closed", async () => {
    results["rolls:tagTeamApply"] = { fearGained: 1 };
    const kai = character({ name: "Kai" });
    const view = render(<TagTeam campaignId={"k1" as Id<"campaigns">} character={kai} disabled={false} pending={pending} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Kai’s roll" }));
    });
    expect(calls.find((c) => c.name === "rolls:tagTeamApply")?.args).toMatchObject({ entryId: "e1", pick: "c1" });
    // The pick lands: rolls.pendingChoices empties.
    view.rerender(<TagTeam campaignId={"k1" as Id<"campaigns">} character={kai} disabled={false} pending={null} />);
    const panel = screen.getByRole("region", { name: "Tag Team Roll" });
    expect(within(panel).getByRole("status")).toHaveTextContent("Kai’s roll counts for both; the GM gains 1 Fear.");
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Tag Team Roll" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tag Team Roll…" })).toBeInTheDocument();
  });
});

describe("GM roll form collapse (dcm-bxp.34)", () => {
  const panel = () => render(<RollFeedPanel campaignId={"k1" as Id<"campaigns">} isGm />);

  it("is open by default; folding it hides only the form and is remembered on this device", () => {
    const first = panel();
    const toggle = screen.getByRole("button", { name: "Secret GM roll" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "gm-roll-form");
    expect(screen.getByRole("form", { name: "GM roll" })).toHaveAttribute("id", "gm-roll-form");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "GM roll" })).toBeNull();
    // The feed below stays.
    expect(screen.getByText(/No rolls yet/)).toBeInTheDocument();
    expect(window.localStorage.getItem("dcm:gm-roll-form-collapsed")).toBe("1");
    first.unmount();

    panel();
    expect(screen.getByRole("button", { name: "Secret GM roll" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "GM roll" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Secret GM roll" }));
    expect(screen.getByRole("form", { name: "GM roll" })).toBeInTheDocument();
    expect(window.localStorage.getItem("dcm:gm-roll-form-collapsed")).toBe("0");
  });

  it("still folds when browser storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    panel();
    const toggle = screen.getByRole("button", { name: "Secret GM roll" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "GM roll" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("form", { name: "GM roll" })).toBeInTheDocument();
  });

  it("players never see the form or its toggle", () => {
    render(<RollFeedPanel campaignId={"k1" as Id<"campaigns">} isGm={false} />);
    expect(screen.queryByRole("button", { name: "Secret GM roll" })).toBeNull();
    expect(screen.queryByRole("form", { name: "GM roll" })).toBeNull();
  });
});
