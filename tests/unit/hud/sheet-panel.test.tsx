/**
 * The HUD sheet panel (plan combat-hud H2.1; docs/tasks/TASK-HUD-H2.1.md; boards Main 'D · Sheet at hand' own / view
 * only, GMDesktop GM edit): the badge, tiles, trackers reading "n of 6 marked" (answer 2) with intent steppers and an
 * optimistic update, features (Use, locked cost, kind; `auto` reads Passive), the GM's Play-for switch gating Use
 * (answer 5a), "Hide my hand from other players" on your own sheet (answer 16a), conditions, and the non-modal panel's
 * focus and Esc. Convex is mocked; the classic Use flow, prompts and D5 Use are stubs.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudSheet } from "@/components/combat-map/hud/sheet";
import {
  applyStep,
  applyStepToParty,
  featureNotes,
  kindLabel,
  pipsOn,
  sheetBadge,
  sheetRights,
  toggleConditionIn,
  type HudSheetData,
  type HudSheetFeature,
} from "@/components/combat-map/hud/sheet/model";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const asked: string[] = [];
const calls: { name: string; args: Record<string, unknown> }[] = [];
const updaters: Record<string, (store: unknown, args: unknown) => void> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    asked.push(functionName(ref));
    return queries[functionName(ref)];
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: unknown, args: unknown) => void) => {
        updaters[name] = fn;
        return run;
      },
    });
  },
}));

vi.mock("@/components/combat-map/drawer/use", () => ({
  FeatureUse: ({ featureId, useId, onClose }: { featureId: string; useId: string; onClose: () => void }) => (
    <section data-testid="classic-feature-use" data-feature={featureId} data-use={useId}>
      <button type="button" onClick={onClose}>
        Close use
      </button>
    </section>
  ),
}));
vi.mock("@/components/combat-map/drawer/prompts", () => ({
  DrawerPrompts: ({ canAct }: { canAct: boolean }) => <div data-testid="classic-prompts" data-can-act={String(canAct)} />,
}));
vi.mock("@/components/combat-map/drawer/list/controls", () => ({
  D5Use: ({ name, canAct }: { name: string; canAct: boolean }) => (
    <button type="button" disabled={!canAct}>
      D5 {name}
    </button>
  ),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(updaters)) delete updaters[k];
  asked.length = 0;
  calls.length = 0;
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];
const MOSS = "ch-Moss" as Id<"characters">;
const BRANNOC = "ch-Brannoc" as Id<"characters">;
const VEX = "ch-Vex" as Id<"characters">;

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

function feature(name: string, over: Partial<HudSheetFeature> = {}): HudSheetFeature {
  return {
    featureId: `f:${name}`,
    name,
    text: `${name} text`,
    source: "class",
    kind: "passive",
    cost: null,
    limit: null,
    used: false,
    resetLabel: null,
    usesLeft: null,
    tokens: 0,
    automated: false,
    uses: null,
    ...over,
  };
}

const USE = { useId: "u1", name: "Use", activation: "action" as const, ready: true, resetLabel: null, usesLeft: null, rolls: false, targets: null, choices: [], costs: ["1 Stress"], limit: null, repeatable: false, situations: [] };

function sheet(over: Partial<HudSheetData> = {}): HudSheetData {
  return {
    characterId: MOSS,
    mode: "own",
    name: "Moss",
    className: "Druid",
    level: 3,
    evasion: 10,
    armorScore: 3,
    thresholds: { major: 9, severe: 16 },
    experiences: [
      { id: "x1", name: "Forest Guide", value: 2 },
      { id: "x2", name: "Herbalist", value: 2 },
    ],
    trackers: { hp: { marked: 2, max: 6 }, stress: { marked: 3, max: 6 }, hope: { value: 1, max: 6 }, armor: { marked: 1, max: 3 } },
    features: [
      feature("Beastform", { kind: "action", cost: "1 Stress", automated: true, uses: [USE] }),
      feature("Wildtouch", { kind: "auto", uses: [] }),
    ],
    conditions: [],
    effects: [],
    ...over,
  };
}

const BRANNOC_VIEW = sheet({
  characterId: BRANNOC,
  mode: "view",
  name: "Brannoc",
  className: "Warrior",
  evasion: 11,
  armorScore: 5,
  thresholds: { major: 8, severe: 16 },
  trackers: { hp: { marked: 0, max: 6 }, stress: { marked: 1, max: 6 }, hope: { value: 3, max: 6 }, armor: { marked: 0, max: 5 } },
  features: [
    feature("No Mercy", { kind: "action", cost: "3 Hope", automated: true }),
    feature("Attack of Opportunity", { kind: "reaction" }),
    feature("Combat Training", { kind: "auto" }),
  ],
});

const VEX_GM = sheet({
  characterId: VEX,
  mode: "gm",
  name: "Vex",
  className: "Rogue",
  evasion: 12,
  features: [feature("Marked for Death", { kind: "action", automated: true, uses: [USE] }), feature("Get In & Get Out", { featureId: "class:assassin:get-in-get-out", kind: "outOfCombat", uses: [] })],
  conditions: [{ id: "hidden", label: "Hidden", source: null, until: "until an adversary would see you, you move into their sight, or you attack" }],
});

/** A button that opens the sheet through HudProvider (as a banner or token does), plus the panel. */
function Opener({ id }: { id: Id<"characters"> }) {
  const hud = useHud();
  return (
    <button type="button" onClick={() => hud.toggleSheet({ kind: "pc", characterId: id })}>
      Open it
    </button>
  );
}

function renderSheet(id: Id<"characters">, state = pageState()) {
  const view = render(
    <HudProvider>
      <Opener id={id} />
      <HudSheet state={state} />
    </HudProvider>,
  );
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  act(() => opener.click());
  return view;
}

const PARTY = [
  { characterId: MOSS, tokenId: "tk-Moss" as Id<"combatTokens">, name: "Moss", className: "Druid", level: 3, portrait: null, mine: true, hp: { marked: 2, max: 6 }, stress: { marked: 3, max: 6 }, armor: { marked: 1, max: 3 }, hope: { value: 1, max: 6 }, conditions: [], down: false, deathMoveDue: false },
];

describe("HudSheet: own sheet (Main, Moss)", () => {
  it("is a non-modal aside named after the PC with the Spotlight badge, tiles and 'n of 6 marked' trackers; focus on the heading", () => {
    queries["combatHud:sheet"] = sheet();
    queries["combatHud:party"] = PARTY;
    queries["combatSpotlight:state"] = { holder: { kind: "pc", characterId: MOSS, name: "Moss" }, since: 1, reason: null, rollBy: null, reactionsOnly: false, canMove: false };
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    renderSheet(MOSS);
    const panel = screen.getByRole("complementary", { name: "Moss’s sheet" });
    expect(panel.tagName).toBe("ASIDE");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("MossDruid · Level 3");
    expect(screen.getByTestId("hud-sheet-badge")).toHaveTextContent("Spotlight");
    expect([...panel.querySelectorAll(".hud-stat")].map((t) => t.textContent)).toEqual(["10Evasion", "3Armor", "3Level"]);

    const hp = within(panel).getByRole("group", { name: "Hit Points" });
    expect(within(hp).getByRole("img", { name: "Hit Points: 2 of 6 marked" }).querySelectorAll("i.on")).toHaveLength(4);
    expect(hp.querySelector("output")).toHaveTextContent("2 of 6 marked");
    expect(within(panel).getByRole("group", { name: "Stress" }).querySelector("output")).toHaveTextContent("3 of 6 marked");
    expect(within(panel).getByRole("group", { name: "Armor Slots" }).querySelector("output")).toHaveTextContent("1 of 3 marked");
    expect(within(panel).getByRole("group", { name: "Hope" }).querySelector("output")).toHaveTextContent("1 of 6");
    expect(screen.queryByTestId("hud-sheet-note")).toBeNull();
    expect(within(panel).getByText("9+")).toBeInTheDocument();
    expect(within(panel).getByText("Forest Guide").textContent).toBe("Forest Guide +2");
    expect(within(panel).getByText("None right now.")).toBeInTheDocument();
  });

  it("steppers send one adjustResource intent each, with an optimistic update of the sheet and the banners", () => {
    queries["combatHud:sheet"] = sheet();
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    renderSheet(MOSS);
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 Hit Point" }));
    fireEvent.click(screen.getByRole("button", { name: "Spend 1 Hope" }));
    expect(calls.filter((c) => c.name === "characters:adjustResource").map((c) => c.args)).toEqual([
      { characterId: MOSS, resource: "hp", delta: 1 },
      { characterId: MOSS, resource: "hope", delta: -1 },
    ]);

    const set: { name: string; value: unknown }[] = [];
    const store = {
      getQuery: (ref: unknown) => (functionName(ref) === "combatHud:sheet" ? sheet() : undefined),
      setQuery: (ref: unknown, _args: unknown, value: unknown) => set.push({ name: functionName(ref), value }),
      getAllQueries: () => [{ args: { campaignId: CAMPAIGN, mapId: "m1" }, value: PARTY }],
    };
    updaters["characters:adjustResource"]!(store, { characterId: MOSS, resource: "stress", delta: 4 });
    const s = set.find((x) => x.name === "combatHud:sheet")!.value as HudSheetData;
    // Stress past full marks a Hit Point (CB p.106).
    expect(s.trackers.stress.marked).toBe(6);
    expect(s.trackers.hp.marked).toBe(3);
    const p = set.find((x) => x.name === "combatHud:party")!.value as typeof PARTY;
    expect(p[0]!.stress.marked).toBe(6);
  });

  it("holds 'Hide my hand from other players' (setHandHidden) and opens the classic Use flow inside the panel", () => {
    queries["combatHud:sheet"] = sheet();
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    queries["combatFeatures:drawer"] = { features: [] };
    renderSheet(MOSS);
    const hide = screen.getByRole("switch", { name: /Hide my hand from other players/ });
    expect(hide).toHaveAttribute("aria-checked", "false");
    fireEvent.click(hide);
    expect(calls.find((c) => c.name === "combatCards:setHandHidden")?.args).toEqual({ campaignId: CAMPAIGN, characterId: MOSS, hidden: true });

    // Beastform: Use (its cost under the text); Wildtouch (auto): the Passive badge.
    const panel = screen.getByRole("complementary", { name: "Moss’s sheet" });
    expect(within(panel).getByText("Passive")).toBeInTheDocument();
    expect(within(panel).getByText("1 Stress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Beastform" }));
    const flow = within(panel).getByTestId("classic-feature-use");
    expect(flow).toHaveAttribute("data-feature", "f:Beastform");
    expect(flow).toHaveAttribute("data-use", "u1");
    // The drawer's prompts render inside the panel (own: can act).
    expect(within(panel).getByTestId("classic-prompts")).toHaveAttribute("data-can-act", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close use" }));
    expect(screen.queryByTestId("classic-feature-use")).toBeNull();
  });

  it("disables the hand switch while the GM keeps every hand hidden", () => {
    queries["combatHud:sheet"] = sheet();
    queries["combatCards:handSharing"] = { playersSeeHands: false, hidden: [] };
    renderSheet(MOSS);
    expect(screen.getByRole("switch", { name: /Hide my hand from other players/ })).toBeDisabled();
  });

  it("shows a loading line until the sheet arrives", () => {
    renderSheet(MOSS);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the sheet…");
  });
});

describe("HudSheet: view only (Main, Brannoc for Moss's player, answer 4a)", () => {
  it("reads every number and changes nothing", () => {
    queries["combatHud:sheet"] = BRANNOC_VIEW;
    renderSheet(BRANNOC);
    const panel = screen.getByRole("complementary", { name: "Brannoc’s sheet" });
    expect(screen.getByTestId("hud-sheet-badge")).toHaveTextContent("View only");
    expect(screen.getByTestId("hud-sheet-note")).toHaveTextContent("Only Brannoc’s player and the GM can use or change this sheet.");
    expect(within(panel).queryByRole("button", { name: /^(Mark|Clear|Gain|Spend) 1/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Use/ })).toBeNull();
    expect(within(panel).queryByRole("switch")).toBeNull();
    expect(within(panel).queryByRole("group", { name: "Switch conditions" })).toBeNull();
    // The ally's cost as a locked pill; Reaction / Passive badges.
    expect(within(panel).getByRole("img", { name: "3 Hope: only Brannoc’s player and the GM can use it" })).toBeInTheDocument();
    expect(within(panel).getByText("Reaction")).toBeInTheDocument();
    expect(within(panel).getByText("Passive")).toBeInTheDocument();
    // Never the drawer (refused for a hidden hand) nor the hand sharing.
    expect(asked).not.toContain("combatFeatures:drawer");
    expect(asked).not.toContain("combatCards:handSharing");
    expect(within(panel).getByRole("group", { name: "Stress" }).querySelector("output")).toHaveTextContent("1 of 6 marked");
  });

  it("Esc closes it and focus goes back to the opener", () => {
    queries["combatHud:sheet"] = BRANNOC_VIEW;
    renderSheet(BRANNOC);
    const panel = screen.getByRole("complementary", { name: "Brannoc’s sheet" });
    fireEvent.keyDown(screen.getByRole("heading", { level: 2 }), { key: "Escape" });
    expect(panel).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open it" })).toHaveFocus();
  });
});

describe("HudSheet: GM edit (GMDesktop, Vex, answer 5a)", () => {
  it("trackers and conditions always; feature Use only with 'Play for this character' in the header", () => {
    queries["combatHud:sheet"] = VEX_GM;
    queries["playFor:list"] = [];
    queries["combatFeatures:drawer"] = { features: [] };
    const view = renderSheet(VEX, pageState({ role: "gm" }));
    const panel = screen.getByRole("complementary", { name: "Vex’s sheet" });
    expect(screen.getByTestId("hud-sheet-badge")).toHaveTextContent("GM edit");
    expect(screen.getByTestId("hud-sheet-note")).toHaveTextContent("You’re the GM: you can change any value on this sheet.");
    const playFor = within(panel).getByRole("switch", { name: "Play for this character" });
    expect(playFor.closest(".hud-panel-top")).not.toBeNull();
    expect(playFor).toHaveAttribute("aria-checked", "false");
    expect(within(panel).getByRole("button", { name: "Use Marked for Death for Vex" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "D5 Get In & Get Out" })).toBeDisabled();
    expect(within(panel).getByTestId("classic-prompts")).toHaveAttribute("data-can-act", "false");

    // Trackers: editable without the switch.
    fireEvent.click(within(panel).getByRole("button", { name: "Mark 1 Stress" }));
    expect(calls.find((c) => c.name === "characters:adjustResource")?.args).toEqual({ characterId: VEX, resource: "stress", delta: 1 });
    // Conditions: Hidden with its rule, and a switch per condition.
    expect(within(panel).getByText(/until an adversary would see you/)).toBeInTheDocument();
    const conds = within(panel).getByRole("group", { name: "Switch conditions" });
    expect(within(conds).getByRole("button", { name: "Hidden" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(conds).getByRole("button", { name: "Vulnerable" }));
    expect(calls.find((c) => c.name === "characters:toggleCondition")?.args).toEqual({ characterId: VEX, condition: "vulnerable" });

    // The switch: an intent; with it on, Use for Vex opens.
    fireEvent.click(playFor);
    expect(calls.find((c) => c.name === "playFor:set")?.args).toEqual({ campaignId: CAMPAIGN, characterId: VEX, on: true });
    queries["playFor:list"] = [VEX];
    view.rerender(
      <HudProvider>
        <Opener id={VEX} />
        <HudSheet state={pageState({ role: "gm" })} />
      </HudProvider>,
    );
    const use = screen.getByRole("button", { name: "Use Marked for Death for Vex" });
    expect(use).toBeEnabled();
    expect(use).toHaveTextContent("Use for Vex");
    expect(screen.getByTestId("hud-sheet-note")).toHaveTextContent("You’re the GM: you can change any value on this sheet.");
    expect(screen.queryByRole("switch", { name: /Hide my hand/ })).toBeNull();
  });
});

describe("sheet model", () => {
  it("rights and badges per mode", () => {
    expect(sheetRights("own", false)).toEqual({ edit: true, use: true, hideHand: true });
    expect(sheetRights("gm", false)).toEqual({ edit: true, use: false, hideHand: false });
    expect(sheetRights("gm", true).use).toBe(true);
    expect(sheetRights("view", true)).toEqual({ edit: false, use: false, hideHand: false });
    expect(sheetBadge("own", false)).toBeNull();
    expect(sheetBadge("own", true)?.text).toBe("Spotlight");
    expect(sheetBadge("view", true)?.text).toBe("View only");
    expect(sheetBadge("gm", false)?.text).toBe("GM edit");
  });

  it("pips: HP and Armor left, Stress marked, Hope held; steps clamp", () => {
    const t = sheet().trackers;
    expect([pipsOn(t, "hp"), pipsOn(t, "stress"), pipsOn(t, "hope"), pipsOn(t, "armor")]).toEqual([4, 3, 1, 2]);
    expect(applyStep(t, "armor", 5).armor.marked).toBe(3);
    expect(applyStep(t, "hope", -5).hope.value).toBe(0);
    const row = applyStepToParty(PARTY[0]!, "hp", 9);
    expect(row.hp.marked).toBe(6);
    expect(row.down).toBe(true);
  });

  it("kind labels (auto reads Passive), feature notes, condition toggles", () => {
    expect(kindLabel("auto")).toBe("Passive");
    expect(kindLabel("reaction")).toBe("Reaction");
    expect(featureNotes(feature("x", { cost: "3 Hope", limit: "Once per long rest", usesLeft: 2 }))).toEqual(["3 Hope", "Once per long rest", "2 left"]);
    expect(featureNotes(feature("x", { used: true, resetLabel: "Back after a rest", cost: "3 Hope" }))).toEqual(["Used · Back after a rest"]);
    const on = toggleConditionIn(sheet(), "vulnerable");
    expect(on.conditions).toEqual([{ id: "vulnerable", label: "Vulnerable", source: null, until: null }]);
    expect(toggleConditionIn(on, "vulnerable").conditions).toEqual([]);
  });
});
