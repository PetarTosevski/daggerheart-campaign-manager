/**
 * The Combat Map sheet drawer's models and kept controls (plan sheet-drawer, SD6): the trackers' optimistic step (the
 * sheet's limits), the feature sections in plan order, the kind / cost / limit / state badges, rank locks, the D5 Uses
 * under "Other features" (Q15); and, with Convex mocked, the class controls the HUD's tools drawer keeps
 * (`SheetExtras`: counters, Flying Q16, Beastform Q10, stances Q5, greyed for the GM until "Play for this character")
 * and the D5 Use the HUD's sheet shows. Plan combat-hud H8.1 deleted the drawer dialog: the HUD's sheet panel covers its
 * trackers, features, Use flow, Play-for and loading / error states (tests/unit/hud/sheet-panel.test.tsx).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SheetExtras } from "@/components/combat-map/drawer";
import { D5Use } from "@/components/combat-map/drawer/list/controls";
import type { CombatMapSummary } from "@/components/combat-map/slots";
import {
  activeForm,
  D5_USES,
  d5UseOf,
  kindBadge,
  lockedCards,
  REST_TIME_FEATURES,
  sectionOf,
  sectionsOf,
  usableUses,
  useBadges,
  type Drawer,
  type DrawerFeature,
  type DrawerUse,
} from "@/components/combat-map/drawer/list/model";
import { applyTrackerDelta, trackerText } from "@/components/combat-map/drawer/trackers/model";
import { findFeature } from "@/lib/domain/class-features/hooks";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};
let throwOnQuery: Error | null = null;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    if (throwOnQuery) throw throwOnQuery;
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

vi.mock("@/components/combat-map/drawer/use", () => ({
  FeatureUse: ({ featureId, useId }: { featureId: string; useId?: string }) => <div data-testid="feature-use">{`${featureId} ${useId ?? ""}`}</div>,
}));

afterEach(() => {
  calls.length = 0;
  throwOnQuery = null;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(optimistic)) delete optimistic[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const ASH = "ch-ash" as Id<"characters">;

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

const feature = (over: Partial<DrawerFeature> & Pick<DrawerFeature, "featureId" | "source" | "name">): DrawerFeature => ({
  owner: over.featureId.split(":")[1] ?? "",
  text: `${over.name} text.`,
  card: null,
  multiclass: false,
  usage: "combat",
  how: "action",
  automated: true,
  state: "ready",
  resetLabel: null,
  tokens: 0,
  upgrades: [],
  uses: [aUse()],
  ...over,
});

const FEATURES: DrawerFeature[] = [
  feature({ featureId: "hope:bard", source: "hope", name: "Make a Scene", uses: [aUse({ costs: ["3 Hope"] })] }),
  feature({ featureId: "class:bard:rally", source: "class", name: "Rally", uses: [aUse({ limit: "Once per session" })] }),
  feature({
    featureId: "subclass:troubadour:gifted-performer",
    source: "subclass",
    name: "Gifted Performer",
    card: "foundation",
    state: "exhausted",
    resetLabel: "Back after a long rest",
    uses: [aUse({ ready: false, resetLabel: "Back after a long rest", limit: "Once per long rest" })],
  }),
  feature({ featureId: "ancestry:elf:quick-reactions", source: "ancestry", name: "Quick Reactions", how: "rider", uses: [aUse({ activation: "rider", costs: ["1 Stress"] })] }),
  feature({ featureId: "ancestry:elf:celestial-trance", source: "ancestry", name: "Celestial Trance", usage: "outOfCombat", how: "passive", state: "outOfCombat", uses: [] }),
  feature({ featureId: "community:loreborne:well-read", source: "community", name: "Well-Read", usage: "outOfCombat", how: "passive", state: "outOfCombat", uses: [] }),
];

const drawer = (over: Partial<Drawer> = {}): Drawer => ({
  characterId: ASH,
  name: "Ash",
  trackers: { hp: { marked: 1, max: 6 }, stress: { marked: 5, max: 6 }, hope: { value: 2, max: 6 }, armor: { marked: 0, max: 3 } },
  flying: false,
  canFly: false,
  martial: null,
  counters: [],
  heldDice: [],
  features: FEATURES,
  ...over,
});

// ---------------------------------------------------------------- models

describe("tracker model", () => {
  const t = drawer().trackers;
  it("steps each track within its slots and Hope within its maximum", () => {
    expect(applyTrackerDelta(t, "hp", 1).hp.marked).toBe(2);
    expect(applyTrackerDelta(t, "hp", -5).hp.marked).toBe(0);
    expect(applyTrackerDelta(t, "armor", 9).armor.marked).toBe(3);
    expect(applyTrackerDelta({ ...t, hope: { value: 6, max: 6 } }, "hope", 1).hope.value).toBe(6);
  });
  it("marks a Hit Point when Stress past full is marked (CB p.106)", () => {
    const full = { ...t, stress: { marked: 6, max: 6 } };
    const next = applyTrackerDelta(full, "stress", 1);
    expect(next.stress.marked).toBe(6);
    expect(next.hp.marked).toBe(2);
  });
  it("labels the marked tracks and Hope", () => {
    expect(trackerText(t, "stress")).toBe("5 / 6 marked");
    expect(trackerText(t, "hope")).toBe("2 / 6");
  });
});

describe("feature list model", () => {
  it("orders the sections as the plan does and sends out-of-combat and rest-time features to Other features", () => {
    const extra = [
      feature({ featureId: "transformation:vampire:feed", source: "transformation", name: "Feed" }),
      feature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile" }),
    ];
    expect(sectionsOf({ features: [...extra, ...FEATURES], martial: null }).map((s) => s.id)).toEqual([
      "hope",
      "class",
      "subclass",
      "ancestry",
      "transformation",
      "form",
      "other",
    ]);
    expect(sectionOf(FEATURES[4]!)).toBe("other");
  });

  it("keeps the Beastform and stance section for a Martial Artist with no stance features yet", () => {
    const sections = sectionsOf({ features: [], martial: { known: [], active: null, focus: 0, max: 6, refocusReady: true } });
    expect(sections.map((s) => s.id)).toEqual(["form"]);
  });

  it("names the kind badge of each activation and lists cost and limit badges", () => {
    expect(["action", "reaction", "rider", "auto", "passive", "text", "?"].map((how) => kindBadge({ how }))).toEqual([
      "Use",
      "Reaction",
      "With an attack",
      "Automatic",
      "Passive",
      "Text",
      "Text",
    ]);
    expect(useBadges(aUse({ costs: ["1 Stress or 1 Hope"], limit: "Once per rest" }))).toEqual(["1 Stress or 1 Hope", "Once per rest"]);
  });

  it("gives a Use button only to automated combat actions and reactions", () => {
    expect(usableUses(FEATURES[0]!)).toHaveLength(1);
    expect(usableUses(FEATURES[3]!)).toHaveLength(0); // a rider
    expect(usableUses({ ...FEATURES[0]!, automated: false })).toHaveLength(0);
    expect(usableUses({ ...FEATURES[0]!, usage: "outOfCombat" })).toHaveLength(0);
  });

  it("locks the subclass cards above the rank, never the multiclass mastery", () => {
    expect(lockedCards(FEATURES)).toEqual([
      { owner: "troubadour", card: "specialization" },
      { owner: "troubadour", card: "mastery" },
    ]);
    const multi = feature({ featureId: "subclass:stalwart:unwavering", source: "subclass", name: "Unwavering", card: "foundation", multiclass: true });
    expect(lockedCards([multi])).toEqual([]);
  });

  it("knows the rest-time features (Q15 b) and the D5 Uses of Other features (Q15 a)", () => {
    for (const id of REST_TIME_FEATURES) expect(FEATURE_CLASSIFICATION[id]?.usage).toBe("outOfCombat");
    for (const [id, key] of Object.entries(D5_USES)) {
      expect(FEATURE_CLASSIFICATION[id]?.usage).toBe("outOfCombat");
      const classId = id.split(":")[1]!;
      const d5 = findFeature({ classId, multiclass: undefined } as never, key);
      expect(d5?.use, key).toBeDefined();
      expect(d5?.inputs ?? [], key).toEqual([]);
    }
    expect(d5UseOf({ featureId: "class:witch:commune", usage: "outOfCombat" })).toBe("commune");
    expect(d5UseOf({ featureId: "class:witch:commune", usage: "combat" })).toBeNull();
  });

  it("reads the active Beastform from the form's features", () => {
    expect(activeForm(FEATURES)).toBeNull();
    expect(activeForm([feature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile" })])).toBe("agile-scout");
  });
});

// ---------------------------------------------------------------- the class controls (SheetExtras) and D5 Use

const MAP = { _id: "m1" as Id<"combatMaps">, name: "Road", live: true, source: "generated", w: 20, h: 20 } as unknown as CombatMapSummary;
const ASH_TOKEN = "t-ash" as Id<"combatTokens">;

/** SheetExtras for the player's own PC (Ash's token is theirs), or for the GM with Ash's token selected. */
function open(role: "gm" | "player" = "player") {
  queries["combatTokens:party"] = [{ _id: ASH_TOKEN, kind: "pc", characterId: ASH, mine: role === "player" }];
  render(<SheetExtras campaignId={CAMPAIGN} role={role} map={MAP} selectedTokenId={role === "gm" ? ASH_TOKEN : null} />);
}

const extras = () => screen.getByRole("region", { name: "Ash: class controls" });

describe("SheetExtras (the drawer's class controls, kept in the HUD's tools drawer by H8.1)", () => {
  it("renders nothing for a character without counters, Flying, Beastform or stances, and nothing without a PC", () => {
    queries["combatFeatures:drawer"] = drawer();
    open();
    expect(screen.queryByTestId("sheet-extras")).toBeNull();
    cleanup();
    queries["combatFeatures:drawer"] = drawer({ canFly: true });
    queries["combatTokens:party"] = [];
    render(<SheetExtras campaignId={CAMPAIGN} role="player" map={MAP} selectedTokenId={null} />);
    expect(screen.queryByTestId("sheet-extras")).toBeNull();
  });

  it("lists the class counters and held dice", () => {
    queries["combatFeatures:drawer"] = drawer({ counters: [{ key: "rally", label: "Rally die", value: "d6" }], heldDice: [{ id: "h1", sides: 6, kind: "Prayer", value: 4 }] } as unknown as Partial<Drawer>);
    open();
    const chips = within(extras()).getByRole("list", { name: "Class counters" });
    expect(chips).toHaveTextContent("Rally die: d6");
    expect(chips).toHaveTextContent("d6 Prayer: 4");
  });

  it("toggles Flying for a character with a flying feature (Q16)", async () => {
    queries["combatFeatures:drawer"] = drawer({ canFly: true });
    open();
    const flying = within(extras()).getByRole("button", { name: "Flying" });
    expect(flying).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(flying);
    });
    expect(calls[0]).toMatchObject({ name: "combatFeatures:setFlying", args: { campaignId: CAMPAIGN, characterId: ASH, flying: true } });
    let written: Drawer | null = null;
    optimistic["combatFeatures:setFlying"]!({ getQuery: () => drawer({ canFly: true }), setQuery: (_ref, _args, value) => (written = value as Drawer) }, { characterId: ASH, flying: true });
    expect(written!.flying).toBe(true);
  });

  it("drops out of the Beastform (Q10)", async () => {
    queries["combatFeatures:drawer"] = drawer({ features: [feature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile", how: "passive", uses: [] })] });
    open();
    const form = within(extras()).getByRole("group", { name: "Beastform" });
    expect(form).toHaveTextContent("Agile Scout");
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Drop out of Agile Scout" }));
    });
    expect(calls[0]).toMatchObject({ name: "classFeatures:endEffect", args: { characterId: ASH, effectId: "beastform" } });
  });

  it("shows the Martial Artist's stances and shifts with a Focus (Q5)", async () => {
    const stances = [
      feature({ featureId: "stance:martial-artist:mountain", source: "stance", name: "Mountain Stance", how: "passive", uses: [] }),
      feature({ featureId: "stance:martial-artist:reed", source: "stance", name: "Reed Stance", how: "passive", uses: [] }),
    ];
    queries["combatFeatures:drawer"] = drawer({ features: stances, martial: { known: ["mountain", "reed"], active: "mountain", focus: 2, max: 6, refocusReady: true } });
    open();
    const group = within(extras()).getByRole("group", { name: "Stances" });
    expect(within(group).queryByRole("button", { name: /Shift into Mountain Stance/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "Shift into Reed Stance, spending 1 Focus" }));
    });
    expect(calls[0]).toMatchObject({ name: "combatFeatures:shiftStance", args: { characterId: ASH, stance: "reed", payWith: "focus" } });
    expect(within(group).getByRole("button", { name: "Refocus" })).toBeDisabled();
  });

  it("greys the GM's controls for the selected PC until Play for this character is on (DA6)", () => {
    queries["combatFeatures:drawer"] = drawer({ canFly: true });
    open("gm");
    expect((extras().querySelector(".sd-grey") as HTMLElement).dataset.greyed).toBe("true");
    expect(within(extras()).getByRole("button", { name: "Flying" })).toBeDisabled();
    cleanup();
    queries["playFor:list"] = [ASH];
    open("gm");
    expect((extras().querySelector(".sd-grey") as HTMLElement).dataset.greyed).toBe("false");
    expect(within(extras()).getByRole("button", { name: "Flying" })).toBeEnabled();
  });

  it("shows a refused intent as an alert", async () => {
    queries["combatFeatures:drawer"] = drawer({ canFly: true });
    results["combatFeatures:setFlying"] = [new Error("Nope")];
    open();
    await act(async () => {
      fireEvent.click(within(extras()).getByRole("button", { name: "Flying" }));
    });
    expect(within(extras()).getByRole("alert")).toBeTruthy();
  });
});

describe("D5Use (the HUD's sheet shows it)", () => {
  it("keeps the D5 Use of an out-of-combat feature (Q15 a)", async () => {
    results["classFeatures:use"] = [{ summary: "used Commune: d6 4; best 4", roll: null }];
    render(<D5Use characterId={ASH} canAct featureKey="commune" name="Commune" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Commune" }));
    });
    expect(calls[0]).toMatchObject({ name: "classFeatures:use", args: { characterId: ASH, featureKey: "commune", params: {} } });
    expect(screen.getByText("used Commune: d6 4; best 4")).toBeTruthy();
  });
});
