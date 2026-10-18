import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (ref: unknown) => {
    const name = String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
    const fn = Object.assign(
      async (args: unknown) => {
        calls.push({ name, args });
      },
      { withOptimisticUpdate: () => fn },
    );
    return fn;
  },
}));

const { PartyCard } = await import("@/components/party/party-card");

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
      hope: 3,
      scars: 1,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "longsword",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
    },
    ...overrides,
  };
}

const campaignId = "k1" as Id<"campaigns">;

describe("PartyCard", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the tiles and marks a Hit Point through adjustResource", () => {
    render(createElement(PartyCard, { campaignId, character: character() }));
    expect(screen.getByRole("img", { name: "Brannoc HP 2 of 6" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Brannoc Hope 3 of 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark one Hit Point for Brannoc" }));
    expect(calls).toEqual([{ name: expect.stringContaining("adjustResource"), args: { characterId: "c1", resource: "hp", delta: 1 } }]);
  });

  it("disables every control for someone who can't edit", () => {
    render(createElement(PartyCard, { campaignId, character: character({ canEdit: false, mine: false }) }));
    for (const button of screen.getAllByRole("button", { name: /^(Mark|Clear|Gain|Spend) one/ })) expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Kill Brannoc" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Scars/ })).toBeNull();
  });

  it("veils a fallen hero and offers Revive to the GM only", () => {
    const { unmount } = render(createElement(PartyCard, { campaignId, character: character({ status: "dead" }) }));
    expect(screen.queryByRole("button", { name: "Revive Brannoc" })).toBeNull();
    unmount();
    render(createElement(PartyCard, { campaignId, character: character({ status: "dead" }), isGm: true }));
    expect(screen.getByRole("article", { name: "Brannoc (fallen)" })).toBeInTheDocument();
    expect(screen.getByText("Brannoc has fallen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revive Brannoc" }));
    expect(calls).toEqual([{ name: expect.stringContaining("setStatus"), args: { characterId: "c1", status: "active" } }]);
  });
});
