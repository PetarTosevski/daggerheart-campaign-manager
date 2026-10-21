import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

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

// Elements named by aria-label or aria-labelledby are found with getByLabelText: getByRole computes the accessible
// name, and so getComputedStyle up the tree, of every candidate on the sheet for each lookup, which is slow in jsdom
// under the full parallel run (dcm-t30). Role queries stay where visibility is under test (face-down cards).
const BUTTON = { selector: "button" };
const ARTICLE = { selector: "article" };
const LIST = { selector: "[role=list], ul, ol" };
const REGION = { selector: "section" };
const TABLIST = { selector: "[role=tablist]" };

/** A tab of the sheet pages or the card collections, looked up inside the two tablists only. */
function tab(name: string) {
  const found = screen.getAllByLabelText(/^(Sheet pages|Card collections)$/, TABLIST).flatMap((list) => within(list).queryAllByRole("tab", { name }));
  expect(found).toHaveLength(1);
  return found[0]!;
}

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
    const pages = screen.getByLabelText("Sheet pages", TABLIST);
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

    const collections = screen.getByLabelText("Card collections", TABLIST);
    const cards = within(collections).getByRole("tab", { name: "Domain Cards" });
    expect(cards).toHaveAttribute("aria-selected", "true");
    expect(cards).toHaveTextContent("Domain Cards2");
    fireEvent.keyDown(cards, { key: "ArrowRight" });
    expect(within(collections).getByRole("tab", { name: "Heritage & Subclass" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Heritage and subclass cards", LIST)).toBeInTheDocument();
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
    fireEvent.click(screen.getByLabelText("Hit Point 3 of 5", BUTTON));
    fireEvent.click(screen.getByLabelText("Stress 1 of 6", BUTTON));
    fireEvent.click(screen.getByLabelText("Hope 2 of 6", BUTTON));
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
    fireEvent.click(tab("Domains"));
    fireEvent.click(tab("Domain Cards"));
    const vault = screen.getByLabelText("Vault cards", LIST);
    expect(within(vault).getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Swapping during a rest/));
    expect(within(vault).getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeInTheDocument();
    expect(screen.getByTestId("no-open-rest")).toBeInTheDocument();
  });

  it("moves domain cards between loadout and vault", async () => {
    restsCurrent = { open: openShortRest(), shortRestsSinceLong: 0, last: null };
    show();
    fireEvent.click(tab("Domains"));
    const loadout = screen.getByLabelText("Loadout cards", LIST);
    await act(async () => {
      fireEvent.click(within(loadout).getByRole("button", { name: "Move to vault" }));
    });
    const vault = screen.getByLabelText("Vault cards", LIST);
    fireEvent.click(screen.getByLabelText(/Swapping during a rest/));
    await act(async () => {
      fireEvent.click(within(vault).getByRole("button", { name: "Move to loadout (free)" }));
    });
    expect(calls.map((c) => c.args)).toEqual([
      { characterId: "c1", cardId: "deft-deceiver", to: "vault", duringRest: false },
      { characterId: "c1", cardId: "book-of-ava", to: "loadout", duringRest: true },
    ]);
  });

  it("Domain Deck: no picks left at level 1, owned badges, face-down cards above the level, filters and hide toggle", () => {
    show();
    fireEvent.click(tab("Domains"));
    expect(screen.getByText("2 of 2 cards chosen")).toBeInTheDocument();
    const deck = screen.getByLabelText("Domain Deck", REGION);
    const grid = within(deck).getByLabelText("Domain Deck cards", LIST);
    const takeable = DOMAIN_CARDS.find((c) => c.domain === "grace" && c.level === 1 && c.id !== "deft-deceiver" && c.source === "core")!;
    expect(within(grid).getByLabelText(`No picks left for ${takeable.name}`, BUTTON)).toBeDisabled();
    expect(within(grid).queryAllByLabelText(/^Take /, BUTTON)).toHaveLength(0);
    expect(within(within(grid).getByLabelText("Book of Ava", ARTICLE)).getByText("In vault")).toBeInTheDocument();
    expect(within(within(grid).getByLabelText("Deft Deceiver", ARTICLE)).getByText("In loadout")).toBeInTheDocument();
    // A level-2 card is face down: its back is the button, its face is hidden until turned over.
    const level2 = DOMAIN_CARDS.find((c) => c.domain === "codex" && c.level === 2 && c.source === "core")!;
    const item = within(grid).getByText(level2.name).closest<HTMLElement>("[role=listitem]")!;
    const back = within(item).getByLabelText("Face-down level 2 Codex card. Turn it over to read it.", BUTTON);
    expect(within(grid).queryByRole("article", { name: level2.name })).toBeNull();
    fireEvent.click(back);
    const face = within(grid).getByRole("article", { name: level2.name });
    expect(within(face).getByText("Unlocks at level 2")).toBeInTheDocument();
    expect(within(face).getByLabelText(`Turn over ${level2.name}`, BUTTON)).toHaveFocus();
    // Filters and the hide toggle.
    const filters = within(deck).getByRole("group", { name: "Filter by domain" });
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Grace", "Codex"]);
    fireEvent.click(within(filters).getByRole("button", { name: "Codex" }));
    expect(within(filters).getByRole("button", { name: "Codex" })).toHaveAttribute("aria-pressed", "true");
    expect(within(grid).queryByRole("article", { name: "Deft Deceiver" })).toBeNull();
    fireEvent.click(within(deck).getByLabelText("Hide cards above my level"));
    expect(within(grid).queryAllByLabelText(/^Face-down/, BUTTON)).toHaveLength(0);
    expect(within(grid).getByRole("article", { name: "Book of Ava" })).toBeInTheDocument();
  });

  it("Domain Deck: takes a card while picks are left", async () => {
    current = character({ sheet: { ...character().sheet, level: 2 } });
    show();
    fireEvent.click(tab("Domains"));
    const grid = screen.getByLabelText("Domain Deck cards", LIST);
    const takeable = DOMAIN_CARDS.find((c) => c.domain === "codex" && c.level === 2 && c.source === "core")!;
    await act(async () => {
      fireEvent.click(within(grid).getByLabelText(`Take ${takeable.name}`, BUTTON));
    });
    expect(calls).toEqual([{ name: "characters:takeCard", args: { characterId: "c1", cardId: takeable.id } }]);
  });

  it("saves notes on blur and shows subclass tiers", () => {
    show();
    fireEvent.click(tab("Domains"));
    fireEvent.click(tab("Heritage & Subclass"));
    expect(screen.getByLabelText("Subclass: Troubadour Foundation", ARTICLE)).toBeInTheDocument();
    expect(screen.getByLabelText("Subclass: Troubadour Mastery (locked)", ARTICLE)).toBeInTheDocument();
    fireEvent.click(tab("Story & Advancement"));
    const notes = screen.getByLabelText("Notes", { selector: "textarea, input" });
    fireEvent.blur(notes, { target: { value: "Paid the innkeeper." } });
    expect(calls.map((c) => c.args)).toEqual([{ characterId: "c1", patch: { notes: "Paid the innkeeper." } }]);
  });

  it("▲ starts the guided level-up: the ribbon's steps switch pages, the summary lists problems, Cancel ends it", () => {
    current = character({ sheet: { ...character().sheet, levelUpPending: true } as CharacterView["sheet"] });
    show();
    const pages = screen.getByLabelText("Sheet pages", TABLIST);
    fireEvent.click(within(pages).getByRole("tab", { name: "Domains" }));
    fireEvent.click(tab("Heritage & Subclass"));
    fireEvent.click(screen.getByLabelText("Level up to 2", BUTTON));

    const ribbon = screen.getByLabelText("Level-up to 2", REGION);
    expect(screen.queryByLabelText("Level up to 2", BUTTON)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(ribbon).getByText(/Level 2 achievements: a new Experience at \+2 and \+1 Proficiency\./)).toBeInTheDocument();
    const steps = within(ribbon).getByLabelText("Level-up steps", LIST);
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1New Experience", "2Advancements (0/2)", "3Domain card", "4Finish"]);
    expect(within(steps).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    // The Experience step opens the Character Sheet page and focuses the Experiences heading.
    expect(within(pages).getByRole("tab", { name: "Character Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByLabelText("Experiences", REGION)).getByRole("heading", { name: "Experiences" })).toHaveFocus();
    expect(within(ribbon).getByRole("button", { name: "Back" })).toBeDisabled();

    fireEvent.click(within(ribbon).getByRole("button", { name: "Next" }));
    expect(within(pages).getByRole("tab", { name: "Story & Advancement" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(ribbon).getByRole("button", { name: "Next" }));
    expect(within(pages).getByRole("tab", { name: "Domains" })).toHaveAttribute("aria-selected", "true");
    expect(tab("Domain Cards")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(ribbon).getByRole("button", { name: "Next" }));

    expect(within(steps).getAllByRole("listitem")[3]).toHaveAttribute("aria-current", "step");
    expect(within(ribbon).getByRole("heading", { name: "Summary" })).toHaveFocus();
    expect(within(ribbon).getByLabelText("Your choices", LIST)).toHaveTextContent("Domain card: not chosen yet.");
    expect(within(ribbon).getByRole("button", { name: "Finish level-up" })).toBeDisabled();
    const todo = within(ribbon).getByLabelText("Still to do", LIST);
    fireEvent.click(within(todo).getByRole("button", { name: "Name the new Experience (up to 80 characters)." }));
    expect(within(pages).getByRole("tab", { name: "Character Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(within(steps).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");

    fireEvent.click(within(ribbon).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Level-up to 2", REGION)).toBeNull();
    expect(screen.getByLabelText("Level up to 2", BUTTON)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("renders read-only with no edit controls for another player", () => {
    current = character({ canEdit: false, mine: false });
    show();
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    const paper = screen.getByLabelText("Liriel", ARTICLE);
    const nonTab = within(paper)
      .queryAllByRole("button", { hidden: true })
      .filter((b) => b.getAttribute("role") !== "tab");
    expect(nonTab).toHaveLength(0);
    expect(within(paper).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(paper).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(paper).queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Hit Point: 1 of 5 marked" })).toBeInTheDocument();
    for (const name of ["Story & Advancement", "Domains", "Heritage & Subclass"]) {
      fireEvent.click(tab(name));
      // The Domain Deck keeps its viewing controls (filters, More, card backs, hide toggle) but has no Take buttons.
      const deck = screen.queryByLabelText("Domain Deck", REGION);
      const outsideDeck = (els: HTMLElement[]) => els.filter((b) => !deck?.contains(b));
      expect(outsideDeck(within(paper).queryAllByRole("button", { hidden: true })).filter((b) => b.getAttribute("role") !== "tab")).toHaveLength(0);
      expect(within(paper).queryAllByRole("textbox")).toHaveLength(0);
      if (deck) expect(within(deck).queryAllByLabelText(/^(Take|No picks left)/, BUTTON)).toHaveLength(0);
    }
  });
});
