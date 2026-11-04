// Plan combat-hud H1.2 (docs/tasks/TASK-HUD-H1.2.md): the Fear banner (− / + on the GM view only, no confirm,
// optimistic), the day / time disc (GM button to the time arc with campaign time, read only otherwise) and the title
// with Dice / Sheet (players) or the Live chip alone (GM, H9.3); the light is set from the GM's disc pop-over (Q6a). convex/react is replaced by the query results held here; mutations are recorded
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
  CampaignDay: ({ readOnly }: { readOnly?: boolean }) =>
    createElement("p", { "data-testid": "campaign-day-stub" }, readOnly ? "Week 2 · Day 4" : "Week 2 · Day 4 End day"),
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
const { HudDice } = await import("../../../src/components/combat-map/hud/scene/dice");
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
    "charactersReads:get": { _id: MOSS, canEdit: true, corrupt: false, sheet: { name: "Brannoc" } },
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

  it("writes the scene's live state", () => {
    expect(sceneLine({ live: true })).toBe("Live");
    expect(sceneLine({ live: false })).toBe("Not live");
    expect(sceneLine(null)).toBe("No live map yet");
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
    // Q6a: Day / Dim / Night sits above the calendar where the light can be set.
    const seg = within(pop).getByRole("group", { name: "Time of day" });
    expect(seg.compareDocumentPosition(within(pop).getByTestId("campaign-day-stub")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(seg).getByRole("button", { name: "Dim" })).toHaveAttribute("aria-pressed", "true");
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

describe("the light from the day disc (user answer Q6a)", () => {
  it("Day / Dim / Night in the disc's pop-over sets the time of day, optimistically", async () => {
    results["combatHud:scene"] = CORE;
    renderHud(createElement(HudFear, { state: state("gm") }));
    fireEvent.click(screen.getByRole("button", { name: "Week 2, Day 4, Dim light: open End day" }));
    const seg = within(screen.getByRole("dialog", { name: "Campaign day" })).getByRole("group", { name: "Time of day" });
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

  it("with campaign time the time arc's pop-over has no switch (the light follows the clock)", () => {
    renderHud(createElement(HudFear, { state: state("gm") }));
    fireEvent.click(screen.getByRole("button", { name: /open the time arc$/ }));
    const pop = screen.getByRole("dialog", { name: "Time of the long cycle" });
    expect(within(pop).queryByRole("group", { name: "Time of day" })).toBeNull();
  });

  it("an editor who can set the light but not end the day gets the switch and a read-only calendar", () => {
    results["combatHud:scene"] = { ...CORE, canEndDay: false };
    renderHud(createElement(HudFear, { state: state("gm") }));
    fireEvent.click(screen.getByRole("button", { name: "Week 2, Day 4, Dim light: set the light" }));
    const pop = screen.getByRole("dialog", { name: "Campaign day" });
    expect(within(pop).getByRole("group", { name: "Time of day" })).toBeInTheDocument();
    expect(within(pop).getByTestId("campaign-day-stub")).not.toHaveTextContent("End day");
  });
});

describe("title", () => {
  it("the GM sees the map name and the Live chip only: no tools, no 'GM view', no session", () => {
    renderHud(createElement(HudScene, { state: state("gm"), toolbar }));
    expect(screen.getByRole("heading", { level: 2, name: "Forest Camp" })).toBeInTheDocument();
    expect(screen.getByTestId("hud-title")).toHaveTextContent(/^Forest CampLive$/);
    expect(screen.getByTestId("hud-live").querySelector(".hud-live-dot")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("the GM's chip says 'Not live' without the dot when the map is not live", () => {
    renderHud(createElement(HudScene, { state: state("gm", { map: { ...MAP!, live: false } }), toolbar }));
    expect(screen.getByTestId("hud-live")).toHaveTextContent("Not live");
    expect(screen.getByTestId("hud-live").querySelector(".hud-live-dot")).toBeNull();
  });

  it("the GM's Dice (opened from the dock): the GM roller first; with a PC selected, 'For <PC>' opens that PC's dice box", () => {
    renderHud(createElement(HudDice, { campaignId: CAMPAIGN, characterId: BRANNOC, gm: true }));
    const as = screen.getByRole("group", { name: "Roll as" });
    expect(within(as).getByRole("button", { name: "GM roll" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("hud-gm-roller")).toBeInTheDocument();
    fireEvent.click(within(as).getByRole("button", { name: "For Brannoc" }));
    expect(within(as).getByRole("button", { name: "For Brannoc" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("hud-dice-box")).toBeInTheDocument();
    expect(screen.queryByTestId("hud-gm-roller")).toBeNull();
  });

  it("the GM's Dice without a PC selected: a plain GM roller with a hint", () => {
    renderHud(createElement(HudDice, { campaignId: CAMPAIGN, characterId: null, gm: true }));
    expect(screen.getByTestId("hud-gm-roller")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Select a PC token on the map to roll for them instead.");
    expect(screen.queryByRole("group", { name: "Roll as" })).toBeNull();
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
    // The map controls (from the shell's toolbar) sit on their own row after the break.
    expect(tools.querySelector(".hud-tr-br")).not.toBeNull();
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
