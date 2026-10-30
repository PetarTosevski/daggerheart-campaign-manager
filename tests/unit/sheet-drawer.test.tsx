/**
 * The Combat Map sheet drawer (plan sheet-drawer, SD6): the trackers' optimistic step (the sheet's limits), the feature
 * sections in plan order, the kind / cost / limit / state badges, rank locks, the D5 Uses under "Other features" (Q15),
 * the Beastform and Flying controls (Q10, Q16); and the drawer itself with Convex mocked: a labelled modal dialog,
 * loading and error states, intents sent by the trackers and controls, the GM's greyed view until "Play for this
 * character", and the "Full sheet" link.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SheetDrawer } from "@/components/combat-map/drawer";
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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

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

// ---------------------------------------------------------------- the drawer

function open(role: "gm" | "player" = "player", onClose = vi.fn()) {
  render(<SheetDrawer campaignId={CAMPAIGN} role={role} map={null} characterId={ASH} open onClose={onClose} />);
  return { dialog: screen.getByRole("dialog", { name: "Character sheet" }), onClose };
}

describe("SheetDrawer", () => {
  it("is an open, labelled modal dialog with a loading line, the Full sheet link and a close button", () => {
    const { dialog, onClose } = open();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Loading the sheet");
    expect(within(dialog).getByRole("link", { name: "Full sheet" })).toHaveAttribute("href", `/campaigns/${CAMPAIGN}/party/${ASH}`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close character sheet" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows every section, badge and state", () => {
    queries["combatFeatures:drawer"] = drawer();
    const { dialog } = open();
    const titles = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titles).toEqual(["Hope feature", "Class features", "Subclass", "Ancestry", "Other features"]);

    const gifted = dialog.querySelector('[data-feature="subclass:troubadour:gifted-performer"]') as HTMLElement;
    expect(gifted.dataset.state).toBe("exhausted");
    expect(within(gifted).getByText("Used · Back after a long rest")).toBeTruthy();
    expect(within(gifted).getByRole("button", { name: "Use Gifted Performer" })).toBeDisabled();

    const scene = dialog.querySelector('[data-feature="hope:bard"]') as HTMLElement;
    expect(within(scene).getByText("3 Hope")).toBeTruthy();
    expect(within(scene).getByRole("button", { name: "Use Make a Scene" })).toBeEnabled();

    const quick = dialog.querySelector('[data-feature="ancestry:elf:quick-reactions"]') as HTMLElement;
    expect(within(quick).getByText("With an attack")).toBeTruthy();
    expect(within(quick).queryByRole("button")).toBeNull();

    const trance = dialog.querySelector('[data-feature="ancestry:elf:celestial-trance"]') as HTMLElement;
    expect(trance.closest("[data-section]")?.getAttribute("data-section")).toBe("other");
    expect(within(trance).getByText("Applied at rest")).toBeTruthy();
    expect(within(trance).queryByRole("button")).toBeNull();

    const subclass = dialog.querySelector('[data-section="subclass"]') as HTMLElement;
    expect(within(subclass).getByText("Troubadour · Specialization card")).toBeTruthy();
    expect(within(subclass).getByText("Troubadour · Mastery card")).toBeTruthy();
  });

  it("opens the feature's Use flow", () => {
    queries["combatFeatures:drawer"] = drawer();
    const { dialog } = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use Make a Scene" }));
    expect(screen.getByTestId("feature-use")).toHaveTextContent("hope:bard main");
  });

  it("sends tracker intents with an optimistic update on the drawer", async () => {
    queries["combatFeatures:drawer"] = drawer();
    const { dialog } = open();
    const trackers = within(dialog).getByRole("region", { name: "Trackers" });
    await act(async () => {
      fireEvent.click(within(trackers).getByRole("button", { name: "Mark 1 Stress" }));
    });
    expect(calls).toEqual([{ name: "characters:adjustResource", args: { characterId: ASH, resource: "stress", delta: 1 } }]);

    let written: Drawer | null = null;
    const store: FakeStore = { getQuery: () => drawer(), setQuery: (_ref, _args, value) => (written = value as Drawer) };
    optimistic["characters:adjustResource"]!(store, { characterId: ASH, resource: "hope", delta: 1 });
    expect(written!.trackers.hope.value).toBe(3);

    // An empty track's − is off (the sheet's limit).
    expect(within(within(trackers).getByRole("group", { name: "Armor" })).getByRole("button", { name: "Clear 1 Armor Slot" })).toBeDisabled();
  });

  it("shows a refused intent as an alert", async () => {
    queries["combatFeatures:drawer"] = drawer();
    results["characters:adjustResource"] = [new Error("Nope")];
    const { dialog } = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Gain 1 Hope" }));
    });
    expect(within(dialog).getByRole("alert")).toBeTruthy();
  });

  it("greys the GM's view until Play for this character is on", async () => {
    queries["combatFeatures:drawer"] = drawer();
    const { dialog } = open("gm");
    const grey = dialog.querySelector(".sd-grey") as HTMLElement;
    expect(grey.dataset.greyed).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Mark 1 Stress" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Use Make a Scene" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("switch", { name: "Play for this character" }));
    expect(grey.dataset.greyed).toBe("false");
    expect(within(dialog).getByRole("button", { name: "Mark 1 Stress" })).toBeEnabled();
  });

  it("has no switch for a player", () => {
    queries["combatFeatures:drawer"] = drawer();
    const { dialog } = open("player");
    expect(within(dialog).queryByRole("switch")).toBeNull();
  });

  it("toggles Flying for a character with a flying feature (Q16)", async () => {
    queries["combatFeatures:drawer"] = drawer({ canFly: true });
    const { dialog } = open();
    const flying = within(dialog).getByRole("button", { name: "Flying" });
    expect(flying).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(flying);
    });
    expect(calls[0]).toMatchObject({ name: "combatFeatures:setFlying", args: { campaignId: CAMPAIGN, characterId: ASH, flying: true } });
  });

  it("drops out of the Beastform (Q10)", async () => {
    queries["combatFeatures:drawer"] = drawer({ features: [feature({ featureId: "beastform:agile-scout:agile", source: "beastform", name: "Agile", how: "passive", uses: [] })] });
    const { dialog } = open();
    const form = within(dialog).getByRole("group", { name: "Beastform" });
    expect(form).toHaveTextContent("Agile Scout");
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Drop out of Agile Scout" }));
    });
    expect(calls[0]).toMatchObject({ name: "classFeatures:endEffect", args: { characterId: ASH, effectId: "beastform" } });
  });

  it("keeps the D5 Use of an out-of-combat feature (Q15 a)", async () => {
    const commune = feature({ featureId: "class:witch:commune", source: "class", name: "Commune", usage: "outOfCombat", state: "outOfCombat" });
    queries["combatFeatures:drawer"] = drawer({ features: [commune] });
    results["classFeatures:use"] = [{ summary: "used Commune: d6 4; best 4", roll: null }];
    const { dialog } = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Use Commune" }));
    });
    expect(calls[0]).toMatchObject({ name: "classFeatures:use", args: { characterId: ASH, featureKey: "commune", params: {} } });
    expect(within(dialog).getByText("used Commune: d6 4; best 4")).toBeTruthy();
  });

  it("shows the Martial Artist's stances and shifts with a Focus (Q5)", async () => {
    const stances = [
      feature({ featureId: "stance:martial-artist:mountain", source: "stance", name: "Mountain Stance", how: "passive", uses: [] }),
      feature({ featureId: "stance:martial-artist:reed", source: "stance", name: "Reed Stance", how: "passive", uses: [] }),
    ];
    queries["combatFeatures:drawer"] = drawer({ features: stances, martial: { known: ["mountain", "reed"], active: "mountain", focus: 2, max: 6, refocusReady: true } });
    const { dialog } = open();
    const group = within(dialog).getByRole("group", { name: "Stances" });
    expect(within(group).queryByRole("button", { name: /Shift into Mountain Stance/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "Shift into Reed Stance, spending 1 Focus" }));
    });
    expect(calls[0]).toMatchObject({ name: "combatFeatures:shiftStance", args: { characterId: ASH, stance: "reed", payWith: "focus" } });
    expect(within(group).getByRole("button", { name: "Refocus" })).toBeDisabled();
  });

  it("keeps a failing read inside the drawer (rule 11)", () => {
    throwOnQuery = new Error("FORBIDDEN");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { dialog } = open();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The character sheet failed to load");
    expect(within(dialog).getByRole("link", { name: "Full sheet" })).toBeTruthy();
    spy.mockRestore();
  });

  it("keeps keys pressed in the drawer from the map's window shortcuts (Esc must not drop the selected token)", () => {
    queries["combatFeatures:drawer"] = drawer();
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    const { dialog } = open();
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Close character sheet" }), { key: "Escape" });
    window.removeEventListener("keydown", heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it("calls onClose when the dialog closes (Esc) and renders no body while closed", () => {
    queries["combatFeatures:drawer"] = drawer();
    const onClose = vi.fn();
    const { rerender } = render(<SheetDrawer campaignId={CAMPAIGN} role="player" map={null} characterId={ASH} open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Character sheet" });
    act(() => (dialog as HTMLDialogElement).close());
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<SheetDrawer campaignId={CAMPAIGN} role="player" map={null} characterId={ASH} open={false} onClose={onClose} />);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.querySelector(".sd-shell")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
