/**
 * The party banners (plan combat-hud H1.1; docs/tasks/TASK-HUD-H1.1.md; CmpTokens 'Banners', Main): one button per
 * `combatHud.party` row, yours first with the gold trim, HP pips showing HP left while every text says HP marked
 * (answer 2), conditions, the Last Hit Point state, the Hope seal, the empty spotlight slot until H1.S, and the sheet
 * opening through HudProvider (H2.1's panel reads it: tests/unit/hud/sheet-panel.test.tsx). Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudBanners } from "@/components/combat-map/hud/banners";
import { bannerSummary, type HudPartyMember } from "@/components/combat-map/hud/banners/banner";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const asked: { name: string; args: unknown }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    asked.push({ name: functionName(ref), args });
    return queries[functionName(ref)];
  },
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  asked.length = 0;
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];

function pageState(over: Partial<CombatPageState> = {}): CombatPageState {
  return {
    campaignId: CAMPAIGN,
    role: "player",
    mode: "play",
    map: MAP,
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
    ...over,
  };
}

function member(name: string, over: Partial<HudPartyMember> = {}): HudPartyMember {
  return {
    characterId: `ch-${name}` as Id<"characters">,
    tokenId: `tk-${name}` as Id<"combatTokens">,
    name,
    className: "Warrior",
    level: 3,
    portrait: null,
    mine: false,
    hp: { marked: 2, max: 6 },
    stress: { marked: 1, max: 6 },
    armor: { marked: 2, max: 5 },
    hope: { value: 3, max: 6 },
    conditions: [],
    down: false,
    deathMoveDue: false,
    ...over,
  };
}

/** The boards' party (Main / CmpTokens), in map order: the player's Moss is not first on the map. */
const PARTY: HudPartyMember[] = [
  member("Brannoc"),
  member("Vex", { className: "Rogue", hp: { marked: 0, max: 5 }, stress: { marked: 2, max: 6 }, armor: { marked: 0, max: 3 }, hope: { value: 2, max: 6 }, conditions: [{ id: "hidden", label: "Hidden" }] }),
  member("Moss", { className: "Druid", mine: true, hp: { marked: 2, max: 6 }, stress: { marked: 3, max: 6 }, armor: { marked: 1, max: 3 }, hope: { value: 1, max: 6 } }),
  member("Oriel", { className: "Seraph", hp: { marked: 7, max: 7 }, stress: { marked: 0, max: 6 }, hope: { value: 4, max: 6 }, down: true, deathMoveDue: true }),
];

/** What HudProvider has open, and a close button (the sheet panel's ✕ stands in). */
function OpenSheet() {
  const hud = useHud();
  return (
    <>
      <span data-testid="open-sheet">{hud.sheet?.kind === "pc" ? hud.sheet.characterId : "none"}</span>
      <button type="button" onClick={hud.closeSheet}>
        Close the sheet
      </button>
    </>
  );
}

function renderBanners(state = pageState(), probe = false) {
  return render(
    <HudProvider>
      <HudBanners state={state} />
      {probe ? <OpenSheet /> : null}
    </HudProvider>,
  );
}

const banner = (name: string) => screen.getByRole("button", { name: `Open ${name}'s sheet` });
const onPips = (el: HTMLElement, label: string) => within(el).getByRole("img", { name: label }).querySelectorAll("i.on").length;

describe("HudBanners", () => {
  it("shows a loading line while the party loads, and nothing without a map or a party", () => {
    const { unmount } = renderBanners();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the party");
    expect(asked).toEqual([{ name: "combatHud:party", args: { campaignId: CAMPAIGN, mapId: "m1" } }]);
    unmount();

    const noMap = renderBanners(pageState({ map: null }));
    expect(noMap.container).toBeEmptyDOMElement();
    noMap.unmount();

    queries["combatHud:party"] = [];
    const empty = renderBanners();
    expect(empty.container).toBeEmptyDOMElement();
  });

  it("hangs one button per PC, yours first with the gold trim, every 158 px from the rod", () => {
    queries["combatHud:party"] = PARTY;
    renderBanners();
    const list = screen.getByRole("list", { name: "The party" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Moss's sheet",
      "Open Brannoc's sheet",
      "Open Vex's sheet",
      "Open Oriel's sheet",
    ]);
    expect(buttons.map((b) => b.style.getPropertyValue("--hbn-i"))).toEqual(["0", "1", "2", "3"]);
    expect(banner("Moss")).toHaveClass("hbn-you");
    expect(banner("Brannoc")).not.toHaveClass("hbn-you");
    expect(document.querySelector(".hbn-rod")).toHaveStyle({ "--hbn-n": "4" });
  });

  it("shows HP left in the pips while the name, pips and description say HP marked (answer 2)", () => {
    queries["combatHud:party"] = PARTY;
    renderBanners();
    const moss = banner("Moss");
    expect(within(moss).getByText("Moss")).toBeInTheDocument();
    expect(within(moss).getByText("Druid")).toBeInTheDocument();
    // 2 of 6 marked: four HP pips lit (HP left); Stress 3 marked: three lit; Armor 1 of 3 marked: two slots left.
    expect(onPips(moss, "2 of 6 Hit Points marked")).toBe(4);
    expect(onPips(moss, "3 of 6 Stress marked")).toBe(3);
    expect(onPips(moss, "1 of 3 Armor Slots marked")).toBe(2);
    expect(moss).toHaveAccessibleDescription(
      "Moss, 2 of 6 Hit Points marked, 3 of 6 Stress marked, 1 of 3 Armor Slots marked, Hope 1 of 6",
    );
    // The Hope seal at the tip: the number with the star.
    expect(within(moss).getByRole("img", { name: "Hope 1 of 6" })).toHaveTextContent("1");
    expect(within(banner("Brannoc")).getByRole("img", { name: "Hope 3 of 6" })).toHaveTextContent("3");
  });

  it("lists conditions under the pips and greys the Last Hit Point banner", () => {
    queries["combatHud:party"] = PARTY;
    renderBanners();
    const vex = banner("Vex");
    expect(within(vex).getByText("Hidden")).toBeInTheDocument();
    expect(vex).toHaveAccessibleDescription(expect.stringContaining("Hidden"));
    expect(onPips(vex, "0 of 5 Hit Points marked")).toBe(5);

    const oriel = banner("Oriel");
    expect(oriel).toHaveClass("hbn-down");
    expect(onPips(oriel, "7 of 7 Hit Points marked")).toBe(0);
    expect(oriel).toHaveAccessibleDescription(expect.stringContaining("death move due"));
    expect(banner("Moss")).not.toHaveClass("hbn-down");
  });

  it("greys the Hope seal at 0 and leaves the spotlight slot empty until H1.S", () => {
    queries["combatHud:party"] = [member("Moss", { className: "Druid", mine: true, hope: { value: 0, max: 6 } })];
    renderBanners();
    const moss = banner("Moss");
    expect(within(moss).getByRole("img", { name: "Hope 0 of 6" })).toHaveClass("hud-seal-empty");
    expect(moss.querySelector(".hbn-c")?.textContent).toBe("Druid");
  });

  it("opens the character's sheet through HudProvider (no classic drawer): swap, same again closes", () => {
    queries["combatHud:party"] = PARTY;
    renderBanners(pageState(), true);
    expect(screen.getByTestId("open-sheet")).toHaveTextContent("none");

    fireEvent.click(banner("Brannoc"));
    expect(screen.getByTestId("open-sheet")).toHaveTextContent("ch-Brannoc");
    expect(banner("Brannoc")).toHaveClass("hbn-open");
    expect(banner("Moss")).not.toHaveClass("hbn-open");
    // A banner opens only the HUD panel: nothing modal, no classic drawer.
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.queryByTestId("sheet-drawer")).toBeNull();

    fireEvent.click(banner("Moss"));
    expect(screen.getByTestId("open-sheet")).toHaveTextContent("ch-Moss");
    expect(banner("Moss")).toHaveClass("hbn-open");
    expect(banner("Brannoc")).not.toHaveClass("hbn-open");

    fireEvent.click(banner("Moss"));
    expect(screen.getByTestId("open-sheet")).toHaveTextContent("none");
    expect(banner("Moss")).not.toHaveClass("hbn-open");

    fireEvent.click(banner("Vex"));
    act(() => screen.getByRole("button", { name: "Close the sheet" }).click());
    expect(screen.getByTestId("open-sheet")).toHaveTextContent("none");
    expect(banner("Vex")).not.toHaveClass("hbn-open");
  });

  it("works for the GM too (no banner is theirs)", () => {
    queries["combatHud:party"] = PARTY.map((m) => ({ ...m, mine: false }));
    renderBanners(pageState({ role: "gm" }));
    expect(within(screen.getByRole("list", { name: "The party" })).getAllByRole("button")[0]).toHaveAttribute("aria-label", "Open Brannoc's sheet");
    expect(document.querySelectorAll(".hbn-you")).toHaveLength(0);
  });
});

describe("bannerSummary", () => {
  it("reads marked numbers, conditions and a death move", () => {
    expect(bannerSummary(member("Moss", { conditions: [{ id: "vulnerable", label: "Vulnerable" }] }))).toBe(
      "Moss, 2 of 6 Hit Points marked, 1 of 6 Stress marked, 2 of 5 Armor Slots marked, Hope 3 of 6, Vulnerable",
    );
    expect(bannerSummary(member("Oriel", { hp: { marked: 6, max: 6 }, down: true }))).toContain("every Hit Point marked");
  });
});
