// Plan combat-hud H1.2 (docs/tasks/TASK-HUD-H1.2.md): the Fear banner (− / + on the GM view only, no confirm,
// optimistic), the day / time disc (GM button to the time arc with campaign time, read only otherwise) and the title
// with Dice / Sheet and the GM toolbar. convex/react is replaced by the query results held here; mutations are recorded
// and their optimistic updates captured. The reused heavy parts (time arc, area tools, vision card, dice box) are stubs.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CombatPageState } from "../../../src/components/combat-map/slots";

let results: Record<string, unknown> = {};
let calls: { name: string; args: Record<string, unknown> }[] = [];
let optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};

type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const fn = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return null;
    };
    return Object.assign(fn, {
      withOptimisticUpdate: (update: (store: FakeStore, args: Record<string, unknown>) => void) => {
        optimistic[name] = update;
        return fn;
      },
    });
  },
}));
vi.mock("@/app/(gm)/campaigns/[campaignId]/time-arc", () => ({
  TimeArc: () => createElement("button", { type: "button", "data-testid": "time-arc-stub" }, "End day"),
  CampaignDay: () => createElement("button", { type: "button", "data-testid": "campaign-day-stub" }, "End day"),
}));
vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({ useCampaign: () => ({ options: { hopeAndFear: true } }) }));
vi.mock("@/components/combat-map/map-view/area-overlay", () => ({ AreaTools: () => createElement("p", { "data-testid": "area-tools-stub" }, "area tools") }));
vi.mock("@/components/combat-map/vision", () => ({
  PreviewPicker: () => createElement("button", { type: "button" }, "Player view"),
  VisionPanel: () => createElement("p", { "data-testid": "vision-stub" }, "fog brush"),
}));
vi.mock("next/dynamic", () => ({ default: () => () => createElement("p", { "data-testid": "dice-box-stub" }, "dice box") }));

const { HudFear } = await import("../../../src/components/combat-map/hud/fear");
const { fearAfterStep } = await import("../../../src/components/combat-map/hud/fear/banner");
const { HudScene, sceneLine } = await import("../../../src/components/combat-map/hud/scene");
const { discLabel, discLines } = await import("../../../src/components/combat-map/hud/scene/disc");
const { HudProvider, useHud } = await import("../../../src/components/combat-map/hud/state");

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];
const MOSS = "ch-moss" as Id<"characters">;
const BRANNOC = "ch-brannoc" as Id<"characters">;

const WITHERWILD = {
  fear: 5,
  light: "day",
  phase: "Afternoon",
  day: { week: 1, day: 3, cycle: "DAY" },
  canSetLight: false,
  canOpenTimeArc: true,
  canEndDay: true,
};
// TASK-CORE-CALENDAR: a core campaign counts weeks and days too; the GM's disc opens End day.
const CORE = { fear: 5, light: "dim", phase: null, day: { week: 2, day: 4, cycle: "DAY" }, canSetLight: true, canOpenTimeArc: false, canEndDay: true };

function member(characterId: Id<"characters">, tokenId: string, mine: boolean) {
  return { characterId, tokenId, mine, name: characterId };
}

function state(role: "gm" | "player", over: Partial<CombatPageState> = {}): CombatPageState {
  return {
    campaignId: CAMPAIGN,
    role,
    mode: "play",
    map: MAP,
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
    ...over,
  };
}

/** Shows the HUD's open sheet so a test can see what Sheet did. */
function SheetProbe() {
  const { sheet } = useHud();
  return createElement("span", { "data-testid": "sheet-probe" }, sheet?.kind === "pc" ? sheet.characterId : "none");
}

function renderHud(children: ReactNode) {
  return render(createElement(HudProvider, null, children, createElement(SheetProbe)));
}

const toolbar = createElement("button", { type: "button" }, "Map tools");

beforeEach(() => {
  calls = [];
  optimistic = {};
  results = {
    "combatHud:scene": WITHERWILD,
    "combatHud:party": [member(MOSS, "t-moss", true), member(BRANNOC, "t-brannoc", false)],
    "sessionWrap:dashboard": { live: { sessionId: "s6", n: 6 } },
    "characters:get": { _id: MOSS, canEdit: true, corrupt: false },
  };
});

describe("helpers", () => {
  it("keeps a Fear step inside 0..12", () => {
    expect(fearAfterStep(5, "increase")).toBe(6);
    expect(fearAfterStep(5, "decrease")).toBe(4);
    expect(fearAfterStep(0, "decrease")).toBe(0);
    expect(fearAfterStep(12, "increase")).toBe(12);
  });

  it("reads the disc: day and phase with campaign time, the light alone without", () => {
    expect(discLines(WITHERWILD as never)).toEqual(["Day 3", "Afternoon"]);
    expect(discLabel(WITHERWILD as never)).toBe("Week 1, Day 3, Afternoon, Day light");
    expect(discLines(CORE as never)).toEqual(["Week 2 · Day 4", "Dim"]);
    expect(discLabel(CORE as never)).toBe("Week 2, Day 4, Dim light");
  });

  it("writes the title's line for the GM and for players", () => {
    expect(sceneLine({ live: true }, true, 6)).toBe("Live · GM view · Session 6");
    expect(sceneLine({ live: true }, true, null)).toBe("Live · GM view");
    expect(sceneLine({ live: false }, true, null)).toBe("Not live · GM view");
    expect(sceneLine({ live: true }, false, 6)).toBe("Live");
    expect(sceneLine(null, false, null)).toBe("No live map yet");
  });
});

describe("Fear banner", () => {
  it("shows a loading line until the scene loads", () => {
    results["combatHud:scene"] = undefined;
    renderHud(createElement(HudFear, { state: state("player") }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading Fear");
  });

  it("players see the Fear and 12 pips, without − / +", () => {
    renderHud(createElement(HudFear, { state: state("player") }));
    const banner = screen.getByRole("group", { name: "GM Fear" });
    expect(within(banner).getByRole("img", { name: "5 of 12 Fear" }).querySelectorAll("i")).toHaveLength(12);
    expect(within(banner).getByRole("img", { name: "5 of 12 Fear" }).querySelectorAll("i.on")).toHaveLength(5);
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("the GM's − and + call fear.adjust once per click with a fresh key, and never ask (answer 6a)", async () => {
    renderHud(createElement(HudFear, { state: state("gm") }));
    const banner = screen.getByRole("group", { name: "GM Fear" });
    await act(async () => fireEvent.click(within(banner).getByRole("button", { name: "Spend a Fear" })));
    await act(async () => fireEvent.click(within(banner).getByRole("button", { name: "Gain a Fear" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.map((c) => [c.name, c.args.direction, c.args.campaignId])).toEqual([
      ["fear:adjust", "decrease", CAMPAIGN],
      ["fear:adjust", "increase", CAMPAIGN],
    ]);
    const keys = calls.map((c) => c.args.idempotencyKey);
    expect(typeof keys[0]).toBe("string");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("disables − at 0 and + at 12", () => {
    results["combatHud:scene"] = { ...WITHERWILD, fear: 0 };
    const { unmount } = renderHud(createElement(HudFear, { state: state("gm") }));
    expect(screen.getByRole("button", { name: "Spend a Fear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gain a Fear" })).toBeEnabled();
    unmount();
    results["combatHud:scene"] = { ...WITHERWILD, fear: 12 };
    renderHud(createElement(HudFear, { state: state("gm") }));
    expect(screen.getByRole("button", { name: "Gain a Fear" })).toBeDisabled();
  });

  it("updates both Fear reads at once (optimistic) and never past the bounds", () => {
    renderHud(createElement(HudFear, { state: state("gm") }));
    const store = new Map<string, unknown>([
      ["combatHud:scene", { ...WITHERWILD }],
      ["campaigns:fear", 5],
    ]);
    const fake: FakeStore = {
      getQuery: (ref) => store.get(getFunctionName(ref as never)),
      setQuery: (ref, _args, value) => store.set(getFunctionName(ref as never), value),
    };
    optimistic["fear:adjust"](fake, { campaignId: CAMPAIGN, direction: "decrease" });
    expect((store.get("combatHud:scene") as { fear: number }).fear).toBe(4);
    expect(store.get("campaigns:fear")).toBe(4);
    store.set("campaigns:fear", 12);
    optimistic["fear:adjust"](fake, { campaignId: CAMPAIGN, direction: "increase" });
    expect(store.get("campaigns:fear")).toBe(12);
  });
});

describe("day / time disc", () => {
  it("players read it only: day, phase and the week in its name", () => {
    results["combatHud:scene"] = { ...WITHERWILD, canOpenTimeArc: false, canEndDay: false };
    renderHud(createElement(HudFear, { state: state("player") }));
    const disc = screen.getByTestId("hud-disc");
    expect(within(disc).queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "Week 1, Day 3, Afternoon, Day light" })).toBeInTheDocument();
    expect(disc).toHaveTextContent("Day 3Afternoon");
  });

  it("the GM's disc opens the time arc with End day (answer 9b); Escape closes it and focus returns", () => {
    renderHud(createElement(HudFear, { state: state("gm") }));
    const button = screen.getByRole("button", { name: /^Week 1, Day 3, Afternoon, Day light: open the time arc$/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const pop = screen.getByRole("dialog", { name: "Time of the long cycle" });
    expect(pop).toHaveFocus();
    expect(within(pop).getByTestId("time-arc-stub")).toHaveTextContent("End day");
    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("in a core campaign the GM's disc shows 'Week n · Day n' and the light, and opens End day", () => {
    results["combatHud:scene"] = CORE;
    renderHud(createElement(HudFear, { state: state("gm") }));
    const disc = screen.getByTestId("hud-disc");
    expect(disc).toHaveTextContent("Week 2 · Day 4Dim");
    expect(disc.querySelector(".hud-sun-dim")).not.toBeNull();
    const button = within(disc).getByRole("button", { name: "Week 2, Day 4, Dim light: open End day" });
    fireEvent.click(button);
    const pop = screen.getByRole("dialog", { name: "Campaign day" });
    expect(within(pop).getByTestId("campaign-day-stub")).toHaveTextContent("End day");
    expect(within(pop).queryByTestId("time-arc-stub")).toBeNull();
    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("in a core campaign players read the day and the light only", () => {
    results["combatHud:scene"] = { ...CORE, canSetLight: false, canEndDay: false };
    renderHud(createElement(HudFear, { state: state("player") }));
    const disc = screen.getByTestId("hud-disc");
    expect(within(disc).queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "Week 2, Day 4, Dim light" })).toBeInTheDocument();
    expect(disc).toHaveTextContent("Week 2 · Day 4Dim");
  });
});

describe("title and toolbar", () => {
  it("the GM sees the map name, 'Live · GM view · Session 6' and the GM toolbar ending with the shell's", () => {
    renderHud(createElement(HudScene, { state: state("gm"), toolbar }));
    expect(screen.getByRole("heading", { level: 2, name: "Forest Camp" })).toBeInTheDocument();
    expect(screen.getByTestId("hud-title")).toHaveTextContent("Live · GM view · Session 6");
    const tools = screen.getByRole("group", { name: "GM tools" });
    const names = within(tools)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Areas", "Fog", "Dice", "Player view", "End scene", "Map tools"]);
    // Witherwild: campaign time sets the light, so no Day / Dim / Night.
    expect(within(tools).queryByRole("group", { name: "Time of day" })).toBeNull();
    expect(within(tools).queryByRole("button", { name: "Sheet" })).toBeNull();
  });

  it("Day / Dim / Night sets the time of day where it can be set, optimistically", async () => {
    results["combatHud:scene"] = CORE;
    renderHud(createElement(HudScene, { state: state("gm"), toolbar }));
    const seg = screen.getByRole("group", { name: "Time of day" });
    expect(within(seg).getByRole("button", { name: "Dim" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => fireEvent.click(within(seg).getByRole("button", { name: "Night" })));
    expect(calls).toEqual([{ name: "campaigns:setTimeOfDay", args: { campaignId: CAMPAIGN, timeOfDay: "night" } }]);
    const store = new Map<string, unknown>([
      ["combatHud:scene", { ...CORE }],
      ["campaigns:timeOfDay", { phase: null, light: "dim", canSet: true }],
    ]);
    optimistic["campaigns:setTimeOfDay"](
      { getQuery: (ref) => store.get(getFunctionName(ref as never)), setQuery: (ref, _a, value) => store.set(getFunctionName(ref as never), value) },
      { campaignId: CAMPAIGN, timeOfDay: "night" },
    );
    expect((store.get("combatHud:scene") as { light: string }).light).toBe("night");
    expect((store.get("campaigns:timeOfDay") as { light: string }).light).toBe("night");
  });

  it("Areas, Fog and Dice open the existing tools in one pop-over at a time", () => {
    renderHud(createElement(HudScene, { state: state("gm"), toolbar }));
    // H5.3: Areas toggles the GM's "Areas on the map" panel (hud/areas, mounted by the shell; tests/unit/hud/fear-confirm.test.tsx).
    const areas = screen.getByRole("button", { name: "Areas" });
    fireEvent.click(areas);
    expect(areas).toHaveAttribute("aria-expanded", "true");
    expect(areas).toHaveAttribute("aria-controls", "hud-areas");
    fireEvent.click(areas);
    expect(areas).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Fog" }));
    expect(within(screen.getByRole("dialog", { name: "Vision and fog" })).getByTestId("vision-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dice" }));
    expect(screen.getByRole("dialog", { name: "Dice" })).toHaveTextContent("Select a PC token on the map to roll for them.");
    fireEvent.click(screen.getByRole("button", { name: "Close Dice" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the GM's Dice rolls for the selected PC token", () => {
    renderHud(createElement(HudScene, { state: state("gm", { selectedTokenId: "t-brannoc" as Id<"combatTokens"> }), toolbar }));
    fireEvent.click(screen.getByRole("button", { name: "Dice" }));
    expect(within(screen.getByRole("dialog", { name: "Dice" })).getByTestId("dice-box-stub")).toBeInTheDocument();
  });

  it("a player sees 'Live', Dice (their dice box) and Sheet (their own sheet in the HUD panel)", () => {
    renderHud(createElement(HudScene, { state: state("player"), toolbar }));
    expect(screen.getByTestId("hud-title")).toHaveTextContent(/^Forest CampLive$/);
    const tools = screen.getByRole("group", { name: "Your tools" });
    expect(
      within(tools)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Dice", "Sheet", "Map tools"]);
    const sheet = within(tools).getByRole("button", { name: "Sheet" });
    expect(sheet).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sheet);
    expect(sheet).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sheet-probe")).toHaveTextContent(MOSS);
    fireEvent.click(sheet);
    expect(screen.getByTestId("sheet-probe")).toHaveTextContent("none");
    fireEvent.click(within(tools).getByRole("button", { name: "Dice" }));
    expect(within(screen.getByRole("dialog", { name: "Dice" })).getByTestId("dice-box-stub")).toBeInTheDocument();
  });

  it("a player without a PC on the map gets no Dice or Sheet", () => {
    results["combatHud:party"] = [member(BRANNOC, "t-brannoc", false)];
    renderHud(createElement(HudScene, { state: state("player"), toolbar }));
    const tools = screen.getByRole("group", { name: "Your tools" });
    expect(
      within(tools)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Map tools"]);
  });
});
