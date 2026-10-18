import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];
let current: CharacterView | null = null;
type OpenRest = { _id: string; kind: "short" | "long"; startedAt: number; gmOverride: boolean; choices: never[]; moves: never[] };
/** What `rests.current` returns: no open rest unless a test opens one (then with the validator's full shape). */
let restsCurrent: { open: OpenRest | null; shortRestsSinceLong: number; last: null } = { open: null, shortRestsSinceLong: 0, last: null };
const openShortRest = (): OpenRest => ({ _id: "r1", kind: "short", startedAt: 0, gmOverride: false, choices: [], moves: [] });

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
      experiences: [{ id: "e1", name: "Wandering minstrel", value: 2 }],
      domainCards: { owned: ["deft-deceiver", "book-of-ava"], loadout: ["deft-deceiver"] },
      background: ["My aunt."],
      connections: [],
      notes: "Owes the innkeeper.",
    },
    ...overrides,
  };
}

const show = () => render(createElement(CharacterSheetView, { characterId: "c1" }));

describe("character sheet", () => {
  beforeEach(() => {
    calls.length = 0;
    current = character();
    restsCurrent = { open: null, shortRestsSinceLong: 0, last: null };
  });

  it("renders the board shell: page tabs, Domains sub-tabs with counts, close link to the roster", () => {
    show();
    const pages = screen.getByRole("tablist", { name: "Sheet pages" });
    expect(within(pages).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Character Sheet", "Story & Advancement", "Domains"]);
    expect(within(pages).getByRole("tab", { name: "Character Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "Close character sheet" })).toHaveAttribute("href", "/campaigns/k1/party");
    expect(screen.getByRole("img", { name: "Level 1" })).toBeInTheDocument();
    expect(screen.getByText("All changes save automatically.")).toBeInTheDocument();
    // The status row sits under the footer, on every page.
    const status = screen.getByRole("region", { name: "Status" });
    expect(status.previousElementSibling?.tagName).toBe("FOOTER");
    expect(within(status).getByRole("group", { name: "Character status" })).toBeInTheDocument();

    // Arrow keys move between pages (roving tabIndex).
    fireEvent.keyDown(within(pages).getByRole("tab", { name: "Character Sheet" }), { key: "ArrowLeft" });
    const domains = within(pages).getByRole("tab", { name: "Domains" });
    expect(domains).toHaveAttribute("aria-selected", "true");
    expect(domains).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel", { name: "Domains" })).toBeInTheDocument();

    const collections = screen.getByRole("tablist", { name: "Card collections" });
    const cards = within(collections).getByRole("tab", { name: "Domain Cards" });
    expect(cards).toHaveAttribute("aria-selected", "true");
    expect(cards).toHaveTextContent("Domain Cards2");
    fireEvent.keyDown(cards, { key: "ArrowRight" });
    expect(within(collections).getByRole("tab", { name: "Heritage & Subclass" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Heritage and subclass cards" })).toBeInTheDocument();
  });

  it("shows page one with computed thresholds and proficiency dice", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Liriel" })).toBeInTheDocument();
    // Gambeson 5/11 + level 1.
    expect(screen.getByTestId("threshold-major")).toHaveTextContent("Major 6");
    expect(screen.getByTestId("threshold-severe")).toHaveTextContent("Severe 12");
    expect(screen.getByTestId("primary-damage")).toHaveTextContent("1d8 phy");
    expect(screen.getByText("Make a Scene:")).toBeInTheDocument();
  });

  it("marks HP, Stress and Hope by tapping slots", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Hit Point 3 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Stress 1 of 6" }));
    fireEvent.click(screen.getByRole("button", { name: "Hope 2 of 6" }));
    expect(calls.map((c) => c.args)).toEqual([
      { characterId: "c1", resource: "hp", delta: 2 },
      { characterId: "c1", resource: "stress", delta: 1 },
      { characterId: "c1", resource: "hope", delta: -1 },
    ]);
  });

  it("the damage calculator applies damage with an Armor Slot in one step", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Damage roll"), { target: { value: "13" } });
    expect(screen.getByText(/Severe damage: mark 3 Hit Points/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Use an Armor Slot/));
    expect(screen.getByText(/Major damage after marking an Armor Slot: mark 2 Hit Points/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    // Keyed (review L2): each click sends its own idempotency key.
    expect(calls.map((c) => c.args)).toEqual([{ characterId: "c1", damage: 13, useArmorSlot: true, idempotencyKey: expect.any(String) }]);
  });

  it("polish 31: with no rest open the vault button shows the real Recall Cost, even with the rest box ticked", () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: "Domains" }));
    fireEvent.click(screen.getByRole("tab", { name: "Domain Cards" }));
    const vault = screen.getByRole("list", { name: "Vault cards" });
    expect(within(vault).getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Swapping during a rest/));
    expect(within(vault).getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeInTheDocument();
    expect(screen.getByTestId("no-open-rest")).toBeInTheDocument();
  });

  it("moves domain cards between loadout and vault", async () => {
    restsCurrent = { open: openShortRest(), shortRestsSinceLong: 0, last: null };
    show();
    fireEvent.click(screen.getByRole("tab", { name: "Domains" }));
    const loadout = screen.getByRole("list", { name: "Loadout cards" });
    await act(async () => {
      fireEvent.click(within(loadout).getByRole("button", { name: "Move to vault" }));
    });
    const vault = screen.getByRole("list", { name: "Vault cards" });
    fireEvent.click(screen.getByLabelText(/Swapping during a rest/));
    await act(async () => {
      fireEvent.click(within(vault).getByRole("button", { name: "Move to loadout (free)" }));
    });
    expect(calls.map((c) => c.args)).toEqual([
      { characterId: "c1", cardId: "deft-deceiver", to: "vault", duringRest: false },
      { characterId: "c1", cardId: "book-of-ava", to: "loadout", duringRest: true },
    ]);
  });

  it("saves notes on blur and shows subclass tiers", () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: "Domains" }));
    fireEvent.click(screen.getByRole("tab", { name: "Heritage & Subclass" }));
    expect(screen.getByRole("article", { name: "Subclass: Troubadour Foundation" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Subclass: Troubadour Mastery (locked)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Story & Advancement" }));
    const notes = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.blur(notes, { target: { value: "Paid the innkeeper." } });
    expect(calls.map((c) => c.args)).toEqual([{ characterId: "c1", patch: { notes: "Paid the innkeeper." } }]);
  });

  it("renders read-only with no edit controls for another player", () => {
    current = character({ canEdit: false, mine: false });
    show();
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    const paper = screen.getByRole("article", { name: "Liriel" });
    const nonTab = within(paper)
      .queryAllByRole("button")
      .filter((b) => b.getAttribute("role") !== "tab");
    expect(nonTab).toHaveLength(0);
    expect(within(paper).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(paper).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(paper).queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Hit Point: 1 of 5 marked" })).toBeInTheDocument();
    for (const tab of ["Story & Advancement", "Domains", "Heritage & Subclass"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(within(paper).queryAllByRole("button").filter((b) => b.getAttribute("role") !== "tab")).toHaveLength(0);
      expect(within(paper).queryAllByRole("textbox")).toHaveLength(0);
    }
  });
});
