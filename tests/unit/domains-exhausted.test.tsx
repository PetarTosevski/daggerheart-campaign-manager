import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { featureUseKey } from "../../src/lib/domain/card-effects/availability";
import { expire } from "../../src/lib/domain/characters/expiry";
import type { FeatureUse } from "../../src/lib/validation/characters";

// CA7: a loadout card whose once-per limit is used on the map (featureUses `card:<id>`) is greyed and turned on the
// sheet's felt table with its reset label (Q3; CB p.101 "Usage Limits"); a rest clears it through `expire`.

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => async () => undefined }));

type Sheet = {
  level: number;
  classId: string;
  advancements: never[];
  domainCards: { owned: string[]; loadout: string[]; vault?: string[] };
  featureUses: FeatureUse[];
};

let current: Sheet;

vi.mock("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet-context", () => ({
  useSheet: () => ({
    sheet: current,
    canEdit: true,
    hopeAndFear: false,
    slot: { campaignId: "k1" },
    moveCard: async () => undefined,
    takeCard: async () => undefined,
  }),
}));

const { DomainCardsSection } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sections/domains");

// Guardian (Valor, Blade): Critical Inspiration is "Once per rest", Lean on Me "Once per long rest", Bare Bones has no limit.
const LOADOUT = ["critical-inspiration", "lean-on-me", "bare-bones"];

function sheet(featureUses: FeatureUse[]): Sheet {
  return { level: 3, classId: "guardian", advancements: [], domainCards: { owned: LOADOUT, loadout: LOADOUT }, featureUses };
}

function show(s: Sheet) {
  current = s;
  return render(<DomainCardsSection cls={undefined} />);
}

/** The loadout card article by its card name (its accessible name starts with it). */
function handCard(name: string) {
  const list = screen.getByRole("list", { name: "Loadout cards" });
  return within(list).getByRole("article", { name: new RegExp(`^${name}`) });
}

const USED: FeatureUse[] = [
  { key: featureUseKey("critical-inspiration"), until: "rest" },
  { key: featureUseKey("lean-on-me"), until: "longRest" },
];

describe("domain cards used on the map (CA7)", () => {
  it("greys and turns a card used until a rest, with 'Back after a rest' in text", () => {
    show(sheet(USED));
    const card = handCard("Critical Inspiration");
    expect(card).toHaveAccessibleName("Critical Inspiration, used: Back after a rest");
    expect(card).toHaveAttribute("data-exhausted", "true");
    expect(within(card).getByText("Used · Back after a rest")).toBeInTheDocument();
    expect(card.style.filter).toContain("grayscale");
    expect(card.parentElement?.style.getPropertyValue("--rot")).toBe(`${-7 + 16}deg`);
  });

  it("names 'Back after a long rest' for a once-per-long-rest card", () => {
    show(sheet(USED));
    const card = handCard("Lean on Me");
    expect(card).toHaveAccessibleName("Lean on Me, used: Back after a long rest");
    expect(within(card).getByText("Used · Back after a long rest")).toBeInTheDocument();
  });

  it("leaves a card without a featureUses entry ready", () => {
    show(sheet(USED));
    const card = handCard("Bare Bones");
    expect(card).toHaveAccessibleName("Bare Bones");
    expect(card).not.toHaveAttribute("data-exhausted");
    expect(within(card).queryByText(/^Used ·/)).toBeNull();
    expect(card.parentElement?.style.getPropertyValue("--rot")).toBe("7deg");
  });

  it("ignores another card's or a sub-use's entry", () => {
    show(sheet([{ key: "card:bare-bones:other", until: "rest" }, { key: "lunarPhasesBump", until: "rest" }]));
    expect(handCard("Bare Bones")).toHaveAccessibleName("Bare Bones");
  });

  it("is ready again after the rest that ends its limit, through expire alone", () => {
    const afterShort = expire(sheet(USED), "shortRest");
    const view = show(afterShort);
    expect(handCard("Critical Inspiration")).toHaveAccessibleName("Critical Inspiration");
    expect(handCard("Lean on Me")).toHaveAccessibleName("Lean on Me, used: Back after a long rest");
    view.unmount();

    show(expire(sheet(USED), "longRest"));
    expect(handCard("Critical Inspiration")).toHaveAccessibleName("Critical Inspiration");
    expect(handCard("Lean on Me")).toHaveAccessibleName("Lean on Me");
  });

  it("shows the same state on a used card resting in the vault", () => {
    current = { ...sheet(USED), domainCards: { owned: LOADOUT, loadout: ["bare-bones"] } };
    render(<DomainCardsSection cls={undefined} />);
    const vault = screen.getByRole("list", { name: "Vault cards" });
    expect(within(vault).getByRole("article", { name: /^Lean on Me/ })).toHaveAccessibleName("Lean on Me, used: Back after a long rest");
  });
});

describe("grimoire cards list their used spells (G3, dcm-bxp.99.20)", () => {
  // Book of Illiat (Codex grimoire): Slumber has no limit, Arcane Barrage is "Once per rest". A spell is used once its
  // featureUses key `card:book-of-illiat:<useId>` is spent; the card itself stays ready (CA7: only `card:<id>` greys it).
  const GRIMOIRE = ["book-of-illiat", "bare-bones"];
  const grimoireSheet = (featureUses: FeatureUse[]): Sheet => ({ ...sheet(featureUses), domainCards: { owned: GRIMOIRE, loadout: GRIMOIRE } });
  const spells = (card: HTMLElement) => {
    const list = within(card).queryByRole("list", { name: "Used spells" });
    return list ? within(list).getAllByRole("listitem").map((li) => li.textContent) : [];
  };

  it("keeps the grimoire ready and lists 'Used: <spell> - back after a rest' per used spell, in printed order", () => {
    show(
      grimoireSheet([
        { key: featureUseKey("book-of-illiat", "arcane-barrage"), until: "rest" },
        { key: featureUseKey("book-of-illiat", "slumber"), until: "longRest" },
      ]),
    );
    const card = handCard("Book of Illiat");
    expect(card).toHaveAccessibleName("Book of Illiat");
    expect(card).not.toHaveAttribute("data-exhausted");
    expect(card.style.filter).toBe("");
    expect(card.parentElement?.style.getPropertyValue("--rot")).toBe("-3.5deg");
    expect(spells(card)).toEqual(["Used: Slumber - back after a long rest", "Used: Arcane Barrage - back after a rest"]);
  });

  it("lists nothing on a grimoire with no used spell, and nothing on a non-grimoire card", () => {
    show(grimoireSheet([{ key: "card:bare-bones:other", until: "rest" }]));
    expect(spells(handCard("Book of Illiat"))).toEqual([]);
    expect(spells(handCard("Bare Bones"))).toEqual([]);
  });

  it("drops a spell from the list after the rest that ends its limit (expire)", () => {
    const used = grimoireSheet([{ key: featureUseKey("book-of-illiat", "arcane-barrage"), until: "rest" }]);
    show(expire(used, "shortRest"));
    expect(spells(handCard("Book of Illiat"))).toEqual([]);
  });

  it("lists the used spells on the grimoire in the vault and in its large card", () => {
    current = { ...grimoireSheet([{ key: featureUseKey("book-of-illiat", "arcane-barrage"), until: "rest" }]), domainCards: { owned: GRIMOIRE, loadout: ["bare-bones"] } };
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    render(<DomainCardsSection cls={undefined} />);
    const vault = screen.getByRole("list", { name: "Vault cards" });
    const card = within(vault).getByRole("article", { name: "Book of Illiat" });
    expect(spells(card)).toEqual(["Used: Arcane Barrage - back after a rest"]);
    fireEvent.click(within(card).getByRole("button", { name: "More about Book of Illiat" }));
    expect(spells(screen.getByRole("dialog", { name: "Book of Illiat" }))).toEqual(["Used: Arcane Barrage - back after a rest"]);
  });
});

describe("'More' on every sheet card (SC1)", () => {
  beforeAll(() => {
    // jsdom has no showModal/close; model the browser's: close() drops `open` and fires the close event.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  it("gives each hand and vault card 'More', in the footer after the text, before Move to vault", () => {
    current = { ...sheet([]), domainCards: { owned: LOADOUT, loadout: ["bare-bones", "lean-on-me"] } };
    render(<DomainCardsSection cls={undefined} />);
    for (const name of ["Bare Bones", "Lean on Me"]) {
      const card = handCard(name);
      const footer = card.querySelector("footer");
      expect(footer?.previousElementSibling).toHaveClass("dk-face-text");
      const buttons = within(footer as HTMLElement).getAllByRole("button");
      expect(buttons.map((b) => b.textContent)).toEqual(["More", "Move to vault"]);
      expect(buttons[0]).toHaveAccessibleName(`More about ${name}`);
    }
    const vault = screen.getByRole("list", { name: "Vault cards" });
    expect(within(vault).getByRole("button", { name: "More about Critical Inspiration" })).toBeInTheDocument();
  });

  it("opens the large card with the used state from a hand card and gives focus back on close", () => {
    show(sheet(USED));
    fireEvent.click(within(handCard("Lean on Me")).getByRole("button", { name: "More about Lean on Me" }));
    const dialog = screen.getByRole("dialog", { name: "Lean on Me" });
    expect(within(dialog).getByText("Used · Back after a long rest")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(handCard("Lean on Me")).getByRole("button", { name: "More about Lean on Me" })).toHaveFocus();
  });
});
