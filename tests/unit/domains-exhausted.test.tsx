import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
