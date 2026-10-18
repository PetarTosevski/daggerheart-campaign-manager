import { fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

// GL3: the Domain Deck in guided level-up mode chooses the new level's card (and the "additional domain card"
// pick's card) into the draft, and the hand and vault offer the optional exchange (CB 110-111).

const calls: { name: string; args: unknown }[] = [];
let current: CharacterView | null = null;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = functionName(ref);
    if (name === "rests:current") return { open: null, shortRestsSinceLong: 0, last: null };
    if (name === "characters:listByCampaign") return current ? [current] : [];
    return current;
  },
  useMutation: (ref: unknown) => async (args: unknown) => {
    calls.push({ name: functionName(ref), args });
  },
}));

vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({
  useCampaign: () => ({ _id: "k1", frameId: "witherwild", options: { hopeAndFear: false } }),
}));

const { CharacterSheetView } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet");

const core = (domain: string, level: number, not: string[] = []) => DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === level && c.source === "core" && !not.includes(c.id));
/** Codex level 2: out of reach at level 1, within reach at the new level 2. */
const LEVEL2 = core("codex", 2)[0]!;
const LEVEL3 = core("codex", 3)[0]!;
/** A level-1 Grace card the Bard doesn't own. */
const GRACE1 = core("grace", 1, ["deft-deceiver"])[0]!;

function character(canEdit = true): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit,
    mine: canEdit,
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
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [{ id: "e1", name: "Wandering minstrel", value: 2 }],
      domainCards: { owned: ["deft-deceiver", "book-of-ava"], loadout: ["deft-deceiver"] },
      background: [],
      connections: [],
      notes: "",
      levelUpPending: true,
    } as CharacterView["sheet"],
  };
}

/** Renders the sheet, starts the level-up and goes to the Domain Deck step. */
function startAtDeck() {
  render(createElement(CharacterSheetView, { characterId: "c1" }));
  fireEvent.click(screen.getByRole("button", { name: "Level up to 2" }));
  const ribbon = screen.getByRole("region", { name: "Level-up to 2" });
  fireEvent.click(within(ribbon).getByRole("button", { name: /Domain card/ }));
  const deck = screen.getByRole("region", { name: "Domain Deck" });
  return { ribbon, deck, grid: within(deck).getByRole("list", { name: "Domain Deck cards" }) };
}

const summary = (ribbon: HTMLElement) => {
  fireEvent.click(within(ribbon).getByRole("button", { name: /Finish/ }));
  return within(ribbon).getByRole("list", { name: "Your choices" });
};

describe("Domain Deck in level-up mode", () => {
  beforeEach(() => {
    calls.length = 0;
    current = character();
    window.sessionStorage.clear();
  });

  it("chooses the level's card: Choose for level 2 replaces Take, cards new at level 2 face up, Undo choice", () => {
    const { ribbon, deck, grid } = startAtDeck();
    expect(deck).toHaveAttribute("id", "lu-target-deck");
    expect(within(deck).getByText("Level 2: choose 1 domain card below.")).toBeInTheDocument();
    expect(within(grid).queryAllByRole("button", { name: /^Take |^No picks left/ })).toHaveLength(0);
    // A level-2 card is face up now; a level-3 card stays face down and can't be chosen.
    const level2 = within(grid).getByRole("article", { name: LEVEL2.name });
    expect(within(grid).queryByRole("article", { name: LEVEL3.name })).toBeNull();
    expect(within(grid).queryByRole("button", { name: `Choose ${LEVEL3.name} for level 2` })).toBeNull();
    // Owned cards can't be chosen again.
    expect(within(within(grid).getByRole("article", { name: "Deft Deceiver" })).queryByRole("button", { name: /^Choose/ })).toBeNull();

    fireEvent.click(within(level2).getByRole("button", { name: `Choose ${LEVEL2.name} for level 2` }));
    expect(within(level2).getByText("Chosen for level 2")).toBeInTheDocument();
    expect(level2).toHaveClass("lu-chosen");
    expect(within(deck).getByText(/every new domain card is chosen/)).toBeInTheDocument();
    // With the one slot filled, the other cards' Choose buttons are disabled.
    expect(within(grid).getByRole("button", { name: `Choose ${GRACE1.name} for level 2` })).toBeDisabled();
    expect(calls).toEqual([]);

    fireEvent.click(within(level2).getByRole("button", { name: `Undo choice of ${LEVEL2.name}` }));
    expect(within(level2).queryByText("Chosen for level 2")).toBeNull();
    fireEvent.click(within(grid).getByRole("button", { name: `Choose ${GRACE1.name} for level 2` }));
    expect(summary(ribbon)).toHaveTextContent(`Domain card: ${GRACE1.name}`);
  });

  it("fills the additional domain card pick after the level's card", () => {
    window.sessionStorage.setItem(
      "dcm:level-up-draft:c1",
      JSON.stringify({ v: 1, level: 1, step: "deck", draft: { picks: [{ option: "domainCard", tier: 2, targets: [] }, { option: "hp", tier: 2 }], experienceName: "Bard", cardId: GRACE1.id } }),
    );
    render(createElement(CharacterSheetView, { characterId: "c1" }));
    fireEvent.click(screen.getByRole("tab", { name: "Domains" }));
    const deck = screen.getByRole("region", { name: "Domain Deck" });
    const grid = within(deck).getByRole("list", { name: "Domain Deck cards" });
    expect(within(deck).getByText("Level 2: choose 1 domain card below.")).toBeInTheDocument();
    fireEvent.click(within(grid).getByRole("button", { name: `Choose ${LEVEL2.name} for level 2` }));
    expect(within(grid).getAllByText("Chosen for level 2")).toHaveLength(2);
    const ribbon = screen.getByRole("region", { name: "Level-up to 2" });
    expect(summary(ribbon)).toHaveTextContent(LEVEL2.name);
    expect(within(ribbon).getByRole("button", { name: "Finish level-up" })).toBeEnabled();

    // Undo empties the pick again.
    fireEvent.click(within(grid).getByRole("button", { name: `Undo choice of ${LEVEL2.name}` }));
    expect(within(grid).getAllByText("Chosen for level 2")).toHaveLength(1);
    expect(within(ribbon).getByRole("button", { name: "Finish level-up" })).toBeDisabled();
  });

  it("exchanges an owned card from the hand for a deck card of the same level or lower", () => {
    const { ribbon, deck, grid } = startAtDeck();
    const hand = screen.getByRole("list", { name: "Loadout cards" });
    const vault = screen.getByRole("list", { name: "Vault cards" });
    expect(within(vault).getByRole("button", { name: "Exchange Book of Ava at level-up" })).toBeInTheDocument();
    fireEvent.click(within(hand).getByRole("button", { name: "Exchange Deft Deceiver at level-up" }));
    expect(within(hand).getByText("Exchanging at level 2")).toBeInTheDocument();
    expect(within(deck).getByText(/Exchanging Deft Deceiver: take a card of level 1 or lower/)).toBeInTheDocument();
    // Deft Deceiver is level 1: a level-2 card can't come in for it.
    expect(within(grid).queryByRole("button", { name: `Take ${LEVEL2.name} in exchange for Deft Deceiver` })).toBeNull();
    fireEvent.click(within(grid).getByRole("button", { name: `Take ${GRACE1.name} in exchange for Deft Deceiver` }));
    const incoming = within(grid).getByRole("article", { name: GRACE1.name });
    expect(within(incoming).getByText("Exchange for Deft Deceiver at level 2")).toBeInTheDocument();
    expect(within(grid).queryAllByRole("button", { name: /in exchange for/ })).toHaveLength(0);
    expect(summary(ribbon)).toHaveTextContent(`Exchange Deft Deceiver for ${GRACE1.name}`);

    // Cancel exchange on the hand card drops it.
    fireEvent.click(within(hand).getByRole("button", { name: "Cancel exchange of Deft Deceiver" }));
    expect(within(ribbon).getByRole("list", { name: "Your choices" })).not.toHaveTextContent("Exchange Deft Deceiver");
    expect(within(grid).queryByText(/Exchange for Deft Deceiver/)).toBeNull();
  });

  it("outside the mode the deck takes cards and the hand offers no exchange", () => {
    render(createElement(CharacterSheetView, { characterId: "c1" }));
    fireEvent.click(screen.getByRole("tab", { name: "Domains" }));
    const deck = screen.getByRole("region", { name: "Domain Deck" });
    expect(within(deck).queryAllByRole("button", { name: /for level 2$/ })).toHaveLength(0);
    expect(within(deck).getByRole("button", { name: `No picks left for ${GRACE1.name}` })).toBeDisabled();
    expect(screen.queryAllByRole("button", { name: /Exchange .* at level-up/ })).toHaveLength(0);
  });
});
