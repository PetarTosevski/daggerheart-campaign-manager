/**
 * The class controls in the HUD sheet panel (plan combat-hud H9.5, user answer Q5 a, bead dcm-bxp.99.32.43), ported
 * from the Map tools drawer's `SheetExtras` tests (tests/unit/sheet-drawer.test.tsx before H9.5): the class counters
 * and held dice under the trackers, Flying (Q16) with the conditions, Beastform "Drop out" (Q10) and the Martial
 * Artist's stances (Q5) above the features, the GM's controls greyed until "Play for this character" (DA6), a refused
 * intent as an alert, DA7's "Active" on a feature whose effect holds, and view mode (read only, never the drawer).
 * Convex is mocked; the classic Use flow and prompts are stubs; the controls themselves are the real ones.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Drawer, DrawerFeature, DrawerUse } from "@/components/combat-map/drawer/list/model";
import { HudSheet } from "@/components/combat-map/hud/sheet";
import { classControlsOf } from "@/components/combat-map/hud/sheet/class";
import type { HudSheetData, HudSheetFeature } from "@/components/combat-map/hud/sheet/model";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const asked: string[] = [];
const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };
const optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};
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
      const next = results[name]?.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: FakeStore, args: Record<string, unknown>) => void) => {
        optimistic[name] = fn;
        return run;
      },
    });
  },
}));

vi.mock("@/components/combat-map/drawer/use", () => ({ FeatureUse: () => <section data-testid="classic-feature-use" /> }));
vi.mock("@/components/combat-map/drawer/prompts", () => ({ DrawerPrompts: () => <div data-testid="classic-prompts" /> }));
vi.mock("@/components/combat-map/hud/pick-feature", () => ({ useFeatureUse: () => ({ open: () => "classic" }) }));
vi.mock("@/components/combat-map/hud/pick-attack", () => ({
  useAttackPicker: () => ({ ready: true, reason: null, open: () => {}, isOpen: false, forced: [], characterId: null, weapons: [] }),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(optimistic)) delete optimistic[k];
  asked.length = 0;
  calls.length = 0;
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Road", live: true, source: "generated", w: 20, h: 20 } as CombatPageState["map"];
const ASH = "ch-ash" as Id<"characters">;

const pageState = (role: "gm" | "player"): CombatPageState => ({
  campaignId: CAMPAIGN,
  role,
  mode: "play",
  map: MAP,
  selectedTokenId: null,
  onSelectToken: () => {},
  previewCharacterId: null,
  onPreview: () => {},
});

const aUse = (over: Partial<DrawerUse> = {}): DrawerUse => ({
  useId: "main",
  name: "Main",
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: false,
  targets: null,
  choices: [],
  costs: [],
  limit: null,
  repeatable: false,
  situations: [],
  ...over,
});

const drawerFeature = (over: Partial<DrawerFeature> & Pick<DrawerFeature, "featureId" | "source" | "name">): DrawerFeature => ({
  owner: over.featureId.split(":")[1] ?? "",
  text: `${over.name} text.`,
  card: null,
  multiclass: false,
  usage: "combat",
  how: "passive",
  automated: true,
  state: "ready",
  resetLabel: null,
  tokens: 0,
  upgrades: [],
  uses: [],
  ...over,
});

const drawer = (over: Partial<Drawer> = {}): Drawer => ({
  characterId: ASH,
  name: "Ash",
  trackers: { hp: { marked: 1, max: 6 }, stress: { marked: 1, max: 6 }, hope: { value: 2, max: 6 }, armor: { marked: 0, max: 3 } },
  flying: false,
  canFly: false,
  martial: null,
  counters: [],
  heldDice: [],
  features: [],
  ...over,
});

const sheetFeature = (name: string, over: Partial<HudSheetFeature> = {}): HudSheetFeature => ({
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
});

const sheet = (over: Partial<HudSheetData> = {}): HudSheetData => ({
  characterId: ASH,
  mode: "own",
  name: "Ash",
  className: "Druid",
  level: 2,
  evasion: 10,
  armorScore: 3,
  thresholds: { major: 8, severe: 15 },
  experiences: [],
  trackers: { hp: { marked: 1, max: 6 }, stress: { marked: 1, max: 6 }, hope: { value: 2, max: 6 }, armor: { marked: 0, max: 3 } },
  features: [],
  conditions: [],
  effects: [],
  ...over,
});

function Opener() {
  const hud = useHud();
  return (
    <button type="button" onClick={() => hud.toggleSheet({ kind: "pc", characterId: ASH })}>
      Open it
    </button>
  );
}

/** Ash's sheet, opened as a banner or token does: the player's own (`own`), the GM's (`gm`) or another player's (`view`). */
function open(mode: HudSheetData["mode"] = "own", over: Partial<HudSheetData> = {}) {
  queries["combatHud:sheet"] = sheet({ mode, ...over });
  render(
    <HudProvider>
      <Opener />
      <HudSheet state={pageState(mode === "gm" ? "gm" : "player")} />
    </HudProvider>,
  );
  act(() => screen.getByRole("button", { name: "Open it" }).click());
  return screen.getByRole("complementary", { name: "Ash’s sheet" });
}

describe("classControlsOf (what the sheet shows of the drawer)", () => {
  it("chips for counters and held dice, Flying, the form and the stances; none for a bare drawer", () => {
    expect(classControlsOf(drawer())).toEqual({ chips: [], canFly: false, form: null, martial: null });
    const all = classControlsOf(
      drawer({
        counters: [{ key: "rally", label: "Rally die", value: "d6" }],
        heldDice: [{ id: "h1", sides: 6, kind: "Prayer", value: 4 }, { id: "h2", sides: 8, kind: "Rally", value: null }],
        canFly: true,
        features: [drawerFeature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile" })],
      }),
    );
    expect(all.chips.map((c) => c.text)).toEqual(["Rally die: d6", "d6 Prayer: 4", "d8 Rally"]);
    expect(all.canFly).toBe(true);
    expect(all.form).toBe("agile-scout");
  });
});

describe("HudSheet class controls (own PC: they act)", () => {
  it("renders none of them for a character without counters, Flying, Beastform or stances", () => {
    queries["combatFeaturesReads:drawer"] = drawer();
    const panel = open();
    expect(within(panel).queryByTestId("hud-sheet-counters")).toBeNull();
    expect(within(panel).queryByTestId("hud-sheet-form")).toBeNull();
    expect(within(panel).queryByTestId("hud-sheet-flying")).toBeNull();
  });

  it("lists the class counters and held dice under the trackers", () => {
    queries["combatFeaturesReads:drawer"] = drawer({ counters: [{ key: "rally", label: "Rally die", value: "d6" }], heldDice: [{ id: "h1", sides: 6, kind: "Prayer", value: 4 }] });
    const panel = open();
    const chips = within(panel).getByRole("list", { name: "Class counters" });
    expect(chips).toHaveTextContent("Rally die: d6");
    expect(chips).toHaveTextContent("d6 Prayer: 4");
    // Placed right after the trackers.
    expect(within(panel).getByTestId("hud-sheet-trackers").nextElementSibling).toBe(within(panel).getByTestId("hud-sheet-counters"));
  });

  it("toggles Flying (Q16) from the conditions section, with its optimistic update", async () => {
    queries["combatFeaturesReads:drawer"] = drawer({ canFly: true });
    const panel = open();
    const section = within(panel).getByRole("region", { name: "Conditions & lasting effects" });
    const flying = within(section).getByRole("button", { name: "Flying" });
    expect(flying).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(flying);
    });
    expect(calls.find((c) => c.name === "combatFeatures:setFlying")).toMatchObject({ args: { campaignId: CAMPAIGN, characterId: ASH, flying: true } });
    let written: Drawer | null = null;
    optimistic["combatFeatures:setFlying"]!({ getQuery: () => drawer({ canFly: true }), setQuery: (_ref, _args, value) => (written = value as Drawer) }, { characterId: ASH, flying: true });
    expect(written!.flying).toBe(true);
  });

  it("drops out of the Beastform (Q10) above the features", async () => {
    queries["combatFeaturesReads:drawer"] = drawer({ features: [drawerFeature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile" })] });
    const panel = open();
    const section = within(panel).getByRole("region", { name: "Beastform and stance" });
    expect(section.nextElementSibling).toBe(within(panel).getByRole("region", { name: "Features" }));
    const form = within(section).getByRole("group", { name: "Beastform" });
    expect(form).toHaveTextContent("Agile Scout");
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Drop out of Agile Scout" }));
    });
    expect(calls.find((c) => c.name === "classFeatures:endEffect")).toMatchObject({ args: { characterId: ASH, effectId: "beastform" } });
  });

  it("shows the Martial Artist's stances and shifts with a Focus (Q5)", async () => {
    const stances = [
      drawerFeature({ featureId: "stance:martial-artist:mountain", source: "stance", name: "Mountain Stance" }),
      drawerFeature({ featureId: "stance:martial-artist:reed", source: "stance", name: "Reed Stance" }),
    ];
    queries["combatFeaturesReads:drawer"] = drawer({ features: stances, martial: { known: ["mountain", "reed"], active: "mountain", focus: 2, max: 6, refocusReady: true } });
    const panel = open();
    const group = within(panel).getByRole("group", { name: "Stances" });
    expect(group).toHaveTextContent("Focus 2 / 6");
    expect(within(group).queryByRole("button", { name: /Shift into Mountain Stance/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "Shift into Reed Stance, spending 1 Focus" }));
    });
    expect(calls.find((c) => c.name === "combatFeatures:shiftStance")).toMatchObject({ args: { characterId: ASH, stance: "reed", payWith: "focus" } });
    // Refocus needs "a moment of calm".
    const refocus = within(group).getByRole("button", { name: "Refocus" });
    expect(refocus).toBeDisabled();
    fireEvent.click(within(group).getByRole("checkbox", { name: "It is a moment of calm" }));
    expect(refocus).toBeEnabled();
    await act(async () => {
      fireEvent.click(refocus);
    });
    expect(calls.find((c) => c.name === "combatFeatures:refocus")).toMatchObject({ args: { characterId: ASH, calm: true } });
  });

  it("shows a refused intent as an alert", async () => {
    queries["combatFeaturesReads:drawer"] = drawer({ canFly: true });
    results["combatFeatures:setFlying"] = [new Error("Nope")];
    const panel = open();
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Flying" }));
    });
    expect(within(within(panel).getByTestId("hud-sheet-flying")).getByRole("alert")).toBeTruthy();
  });
});

describe("HudSheet class controls (GM: greyed until Play for this character, DA6)", () => {
  it("greys the GM's controls until Play-for is on, then they act", () => {
    queries["combatFeaturesReads:drawer"] = drawer({ canFly: true, counters: [{ key: "rally", label: "Rally die", value: "d6" }] });
    queries["playFor:list"] = [];
    const panel = open("gm");
    expect(within(panel).getByTestId("hud-sheet-flying")).toHaveAttribute("data-greyed", "true");
    expect(within(panel).getByTestId("hud-sheet-counters")).toHaveAttribute("data-greyed", "true");
    expect(within(panel).getByRole("button", { name: "Flying" })).toBeDisabled();
  });

  it("with Play-for on, Flying works for the GM", () => {
    queries["combatFeaturesReads:drawer"] = drawer({ canFly: true });
    queries["playFor:list"] = [ASH];
    const panel = open("gm");
    expect(within(panel).getByTestId("hud-sheet-flying")).toHaveAttribute("data-greyed", "false");
    expect(within(panel).getByRole("button", { name: "Flying" })).toBeEnabled();
  });
});

describe("HudSheet: DA7 'Active' on a feature whose effect holds", () => {
  const BACK = "Until an attack succeeds against you, or your next rest";
  const DODGE_SHEET = sheetFeature("Rogue’s Dodge", { featureId: "hope:rogue", kind: "action", cost: "3 Hope", used: true, resetLabel: BACK, automated: true, uses: [aUse({ name: "Rogue’s Dodge", ready: false, resetLabel: BACK, costs: ["3 Hope"] })] });

  it("own: an Active banner with when it comes back, no Use, no 'Used'", () => {
    queries["combatFeaturesReads:drawer"] = drawer({ features: [drawerFeature({ featureId: "hope:rogue", source: "hope", name: "Rogue’s Dodge", how: "action", state: "active", resetLabel: BACK })] });
    const panel = open("own", { features: [DODGE_SHEET] });
    const row = panel.querySelector<HTMLElement>('[data-feature="hope:rogue"]')!;
    expect(row.dataset.state).toBe("active");
    expect(within(row).getByTestId("hud-sheet-active")).toHaveTextContent(`Active ${BACK}.`);
    expect(within(row).getByTestId("hud-sheet-held")).toHaveTextContent("Active");
    expect(within(row).queryByTestId("hud-sheet-used")).toBeNull();
    expect(within(row).queryByRole("button", { name: /Use Rogue’s Dodge/ })).toBeNull();
  });

  it("an exhausted feature keeps 'Used · back …'", () => {
    queries["combatFeaturesReads:drawer"] = drawer({ features: [drawerFeature({ featureId: "hope:rogue", source: "hope", name: "Rogue’s Dodge", how: "action", state: "exhausted", resetLabel: BACK })] });
    const panel = open("own", { features: [DODGE_SHEET] });
    expect(within(panel).queryByTestId("hud-sheet-active")).toBeNull();
    expect(within(panel).getByTestId("hud-sheet-used")).toBeInTheDocument();
  });
});

describe("HudSheet class controls: view only (another player's PC)", () => {
  it("shows the form and Flying read only and never reads the drawer", () => {
    const panel = open("view", {
      features: [sheetFeature("Agile", { featureId: "beastform:agile-scout:agile", source: "beastform" })],
      effects: [{ id: "flying", source: "Flying", text: "Flying", until: "Until turned off", ends: "manual", canEnd: false }],
    });
    const state = within(panel).getByRole("list", { name: "Class state" });
    expect(state).toHaveTextContent("Beastform: Agile Scout");
    expect(state).toHaveTextContent("Flying");
    expect(within(panel).queryByRole("button", { name: "Flying" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Drop out/ })).toBeNull();
    expect(asked).not.toContain("combatFeaturesReads:drawer");
  });

  it("shows nothing extra for a PC in no form and on the ground", () => {
    const panel = open("view");
    expect(within(panel).queryByTestId("hud-sheet-class-view")).toBeNull();
  });
});
