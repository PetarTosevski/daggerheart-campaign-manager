/**
 * The action ring around your own token (plan combat-hud H3.4; board Main 'Picking a target' / 'Can't afford'; answer
 * 3b): the pure model (which buttons, lock reasons, the geometry that keeps every button off the token's arcs, the
 * "More" overflow, arrow keys) and the ring itself (Attack -> H3.2, Cast raises the hand, Sheet -> your sheet, each
 * feature -> H3.3, a classic flow beside the ring, locked reasons, Esc, arrows, More, players only). Convex and the
 * three pickers are mocked; the ring's store and the pick provider are real.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARC_REACH,
  BUTTON,
  HudActionRing,
  attackLock,
  castLock,
  clearsArcs,
  closeActionRing,
  featureLock,
  hopeNeeded,
  moreItem,
  openActionRing,
  raiseHand,
  reactionLock,
  resetActionRingForTests,
  ringItems,
  ringOutside,
  ringReactions,
  ringPoint,
  ringRadius,
  ringSlots,
  ringStep,
  ringUses,
  splitRing,
  stepFocus,
  toggleActionRing,
  useActionRing,
} from "@/components/combat-map/hud/action-ring";
import { PickProvider } from "@/components/combat-map/hud/pick";
import type { HudSheetData, HudSheetFeature } from "@/components/combat-map/hud/sheet/model";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import { hudToasts } from "@/components/combat-map/hud/toasts";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const mutate = vi.fn<(args: unknown) => Promise<unknown>>(async () => null);
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: () => Object.assign((args: unknown) => mutate(args), { withOptimisticUpdate: () => async () => null }),
}));

const MOSS_TOKEN = "tk-moss" as Id<"combatTokens">;
const MOSS = "ch-moss" as Id<"characters">;

const attack = { ready: true, reason: null as string | null, isOpen: false, open: vi.fn(), forced: [], characterId: MOSS };
vi.mock("@/components/combat-map/hud/pick-attack", () => ({ useAttackPicker: () => attack }));

const featureOpen = vi.fn<(input: { featureId: string; useId: string }) => "picker" | "area" | "classic">(() => "picker");
/** Hope each test feature's use costs (featurePlan is mocked: the SRD isn't what this tests). */
const HOPE_COST: Record<string, number> = { "hope:druid": 3 };
vi.mock("@/components/combat-map/hud/pick-feature", () => ({
  useFeatureUse: () => ({ open: featureOpen }),
  featurePlan: (featureId: string) =>
    featureId === "classic:feature"
      ? { kind: "classic" }
      : { kind: "panel", use: { costs: HOPE_COST[featureId] ? [{ kind: "hope", amount: { kind: "fixed", value: HOPE_COST[featureId] } }] : [] } },
}));

let actor: unknown = null;
vi.mock("@/components/combat-map/actions/targets", () => ({ useActor: () => actor }));

vi.mock("@/components/combat-map/drawer/use", () => ({
  FeatureUse: ({ featureId, onClose }: { featureId: string; onClose: () => void }) => (
    <section data-testid="classic-feature-use" data-feature={featureId}>
      <button type="button" onClick={onClose}>
        Close use
      </button>
    </section>
  ),
}));

const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];

function layer(over: Partial<MapLayerProps> = {}): MapLayerProps {
  return {
    campaignId: "c1" as Id<"campaigns">,
    role: "player",
    mode: "play",
    map: MAP,
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
    viewport: { cell: 48, zoom: 1, w: 30, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false },
    ...over,
  } as MapLayerProps;
}

function feature(name: string, over: Partial<HudSheetFeature> = {}): HudSheetFeature {
  return {
    featureId: `f:${name}`,
    name,
    text: `${name} text`,
    source: "class",
    kind: "action",
    cost: null,
    limit: null,
    used: false,
    resetLabel: null,
    usesLeft: null,
    tokens: 0,
    automated: true,
    uses: [makeUse()],
    ...over,
  };
}

function makeUse(over: Partial<NonNullable<HudSheetFeature["uses"]>[number]> = {}): NonNullable<HudSheetFeature["uses"]>[number] {
  return { useId: "u1", name: "Use", activation: "action", ready: true, resetLabel: null, usesLeft: null, rolls: false, targets: null, choices: [], costs: [], limit: null, repeatable: false, situations: [], ...over };
}

function sheet(features: HudSheetFeature[], hope = 1): HudSheetData {
  return {
    characterId: MOSS,
    mode: "own",
    name: "Moss",
    className: "Druid",
    level: 3,
    evasion: 10,
    armorScore: 3,
    thresholds: { major: 9, severe: 16 },
    experiences: [],
    trackers: { hp: { marked: 2, max: 6 }, stress: { marked: 3, max: 6 }, hope: { value: hope, max: 6 }, armor: { marked: 1, max: 3 } },
    features,
    conditions: [],
    effects: [],
  } as HudSheetData;
}

const DRUID = [
  feature("Evolution", { featureId: "hope:druid", source: "hope", cost: "3 Hope" }),
  feature("Beastform", { featureId: "class:druid:beastform", cost: "1 Stress" }),
  feature("Wildtouch", { kind: "auto", automated: false, uses: [] }),
];

beforeEach(() => {
  resetActionRingForTests();
  actor = { characterId: MOSS, view: { tokenId: MOSS_TOKEN, pcs: [{ _id: MOSS_TOKEN, characterId: MOSS, name: "Moss", x: 5, y: 10, size: 1 }], others: [] }, enemies: [] };
  queries["combatHud:sheet"] = sheet(DRUID);
  queries["combatCardsReads:hand"] = { loadout: [{ cardId: "vicious-entangle" }], vault: [] };
  attack.ready = true;
  attack.reason = null;
  attack.isOpen = false;
});

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  attack.open.mockReset();
  featureOpen.mockReset();
  featureOpen.mockImplementation(() => "picker");
  mutate.mockReset();
  mutate.mockImplementation(async () => null);
  hudToasts.reset();
  document.body.innerHTML = "";
});

/** Reads the HUD state beside the ring (the sheet the Sheet button opened). */
function SheetProbe() {
  const hud = useHud();
  return <output data-testid="sheet-probe">{hud.sheet?.kind === "pc" ? hud.sheet.characterId : "none"}</output>;
}

/** A stand-in for your token's button on the map (H1.3), so focus can go back to it. */
function Token() {
  const ring = useActionRing();
  return (
    <button type="button" data-token={MOSS_TOKEN} aria-expanded={ring?.tokenId === MOSS_TOKEN} onClick={() => toggleActionRing(MOSS_TOKEN)}>
      Moss
    </button>
  );
}

function renderRing(over: Partial<MapLayerProps> = {}) {
  return render(
    <HudProvider>
      <PickProvider>
        <div className="hud-map">
          <Token />
          <HudActionRing {...layer(over)} />
        </div>
        <SheetProbe />
      </PickProvider>
    </HudProvider>,
  );
}

const ringButton = (name: string | RegExp) => within(screen.getByTestId("hud-action-ring")).getByRole("button", { name });

describe("model", () => {
  it("the board's geometry: radius 96 around a 48 px token, 38° apart, six slots from the left over the top", () => {
    expect(ringRadius(48)).toBe(96);
    expect(ringStep(96)).toBeCloseTo(37.7, 1);
    expect(ringSlots(96)).toBe(6);
    const [attackAt, castAt, sheetAt] = [0, 1, 2].map((i) => ringPoint(i, 96));
    // Board: Attack (264, 459), Cast (284, 397), Sheet (340, 362) around Moss at (360, 456).
    expect(attackAt!.x).toBeCloseTo(-96, 0);
    expect(attackAt!.y).toBeCloseTo(0, 0);
    expect(Math.hypot(castAt!.x - -76, castAt!.y - -59)).toBeLessThan(4);
    expect(Math.hypot(sheetAt!.x - -20, sheetAt!.y - -94)).toBeLessThan(6);
  });

  it("never covers the token's arcs, at any size and in every slot", () => {
    for (const size of [24, 36, 48, 72, 96, 144, 240, 400]) {
      const r = ringRadius(size);
      for (let i = 0; i < ringSlots(r); i += 1) {
        const p = ringPoint(i, r);
        expect(clearsArcs(p, size), `size ${size}, slot ${i}`).toBe(true);
        expect(Math.hypot(p.x, p.y) - BUTTON / 2).toBeGreaterThanOrEqual(ARC_REACH * size);
        // Never under the token: the lowest slot is at most 20° below the horizontal.
        expect(p.angle).toBeGreaterThanOrEqual(-20);
      }
    }
  });

  it("ring uses: the sheet's Use buttons (action uses only), one per use when a feature has several", () => {
    const uses = ringUses([
      ...DRUID,
      feature("Twin", { uses: [makeUse({ useId: "a", name: "Strike" }), makeUse({ useId: "b", name: "Guard" })] }),
      feature("Parry", { kind: "reaction", uses: [makeUse({ activation: "reaction" })] }),
      feature("Commune", { kind: "outOfCombat", uses: [makeUse()] }),
      feature("Manual", { automated: false }),
    ]);
    expect(uses.map((u) => u.label)).toEqual(["Evolution", "Beastform", "Strike", "Guard"]);
  });

  it("reactions and out-of-combat Uses (user answer 2026-11-02): the sheet's React and D5 Use buttons", () => {
    const features = [
      ...DRUID,
      feature("Parry", { kind: "reaction", uses: [makeUse({ activation: "reaction" })] }),
      feature("Commune", { featureId: "class:witch:commune", kind: "outOfCombat", uses: null, resetLabel: "Back after a long rest" }),
      feature("Manual", { kind: "outOfCombat", uses: null }),
    ];
    expect(ringReactions(features).map((u) => u.label)).toEqual(["Parry"]);
    expect(ringOutside(features)).toEqual([{ featureId: "class:witch:commune", featureKey: "commune", label: "Commune", ready: true, resetLabel: "Back after a long rest" }]);
    expect(reactionLock({ label: "Parry", ready: true, resetLabel: null }, false)).toBe("Parry is a reaction: it waits for its trigger.");
    expect(reactionLock({ label: "Parry", ready: true, resetLabel: null }, true)).toBeNull();
    expect(reactionLock({ label: "Parry", ready: false, resetLabel: "Back after a rest" }, true)).toBe("Parry is used up for now. Back after a rest.");
    const items = ringItems({
      attack: { locked: null, on: false },
      cast: { locked: null, on: false },
      sheet: { on: false },
      features: [],
      reactions: [{ featureId: "f:Parry", useId: "u1", label: "Parry", ready: true, resetLabel: null, locked: null, on: false }],
      outside: [{ featureId: "class:witch:commune", featureKey: "commune", label: "Commune", ready: true, resetLabel: null, locked: null, on: false }],
    });
    expect(items.map((i) => [i.kind, i.name])).toEqual([
      ["attack", "Attack"],
      ["cast", "Cast"],
      ["sheet", "Sheet"],
      ["reaction", "React with Parry"],
      ["outside", "Use Commune"],
    ]);
  });

  it("lock reasons: used first, then a fixed Hope cost; Attack and Cast", () => {
    expect(featureLock({ label: "Evolution", ready: true, resetLabel: null }, 3, 1)).toBe("Evolution needs 3 Hope. You have 1.");
    expect(featureLock({ label: "Evolution", ready: true, resetLabel: null }, 3, 3)).toBeNull();
    expect(featureLock({ label: "Evolution", ready: true, resetLabel: null }, 3, null)).toBeNull();
    expect(featureLock({ label: "Rally", ready: false, resetLabel: "Back after a long rest" }, 0, 5)).toBe("Rally is used up for now. Back after a long rest.");
    expect(hopeNeeded([{ kind: "hope", amount: { kind: "fixed", value: 2 } }, { kind: "stress", amount: { kind: "fixed", value: 1 } }] as never)).toBe(2);
    expect(attackLock(false, "No weapon equipped")).toBe("No weapon equipped");
    expect(attackLock(true, null)).toBeNull();
    expect(castLock(0)).toBe("No cards in your loadout.");
    expect(castLock(null)).toBeNull();
  });

  it("items in the board's order, names that contain the label; More takes the last slot", () => {
    const items = ringItems({
      attack: { locked: null, on: false },
      cast: { locked: null, on: true },
      sheet: { on: false },
      features: [{ featureId: "hope:druid", useId: "u1", label: "Evolution", ready: true, resetLabel: null, locked: "Evolution needs 3 Hope. You have 1.", on: false }],
    });
    expect(items.map((i) => i.name)).toEqual(["Attack", "Cast", "Sheet", "Use Evolution"]);
    for (const i of items) expect(i.name).toContain(i.label);
    expect(splitRing(items, 6).more).toEqual([]);
    const many = [...items, ...items.slice(3), ...items.slice(3), ...items.slice(3)].map((i, n) => ({ ...i, id: `${i.id}:${n}` }));
    const split = splitRing(many, 6);
    expect(split.ring).toHaveLength(5);
    expect(split.more).toHaveLength(2);
    expect(moreItem(2, false).name).toBe("More actions (2)");
  });

  it("arrow keys go round the ring", () => {
    expect(stepFocus(0, 4, "ArrowRight")).toBe(1);
    expect(stepFocus(3, 4, "ArrowDown")).toBe(0);
    expect(stepFocus(0, 4, "ArrowLeft")).toBe(3);
    expect(stepFocus(2, 4, "Home")).toBe(0);
    expect(stepFocus(0, 4, "End")).toBe(3);
    expect(stepFocus(0, 4, "Enter")).toBeNull();
  });
});

describe("the ring", () => {
  it("opens around your token from the store; Attack, Cast, Sheet and each feature with a Use, a locked one with its reason", () => {
    renderRing();
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    const ring = screen.getByTestId("hud-action-ring");
    expect(ring).toHaveAttribute("role", "toolbar");
    expect(ring).toHaveAccessibleName("Your actions (Moss)");
    // Centred on the token: square (5, 10), 48 px cells.
    expect(ring.style.left).toBe(`${5.5 * 48}px`);
    expect(ring.style.top).toBe(`${10.5 * 48}px`);
    const names = within(ring)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Attack", "Cast", "Sheet", "Use Evolution", "Use Beastform"]);
    const evolution = ringButton("Use Evolution");
    expect(evolution).toHaveAttribute("aria-disabled", "true");
    expect(evolution).toHaveAccessibleDescription("Evolution needs 3 Hope. You have 1.");
    expect(ringButton("Use Beastform")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Moss" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Attack opens H3.2's picker; a locked Attack shows why and opens nothing", () => {
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    fireEvent.click(ringButton("Attack"));
    expect(attack.open).toHaveBeenCalledTimes(1);

    attack.ready = false;
    attack.reason = "No weapon equipped";
    act(() => closeActionRing());
    act(() => openActionRing(MOSS_TOKEN));
    fireEvent.click(ringButton("Attack"));
    expect(attack.open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hud-ar-tip")).toHaveTextContent("No weapon equipped");
  });

  it("Sheet opens your sheet (and is on while it shows)", () => {
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    fireEvent.click(ringButton("Sheet"));
    expect(screen.getByTestId("sheet-probe")).toHaveTextContent(MOSS);
    expect(ringButton("Sheet")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(ringButton("Sheet"));
    expect(screen.getByTestId("sheet-probe")).toHaveTextContent("none");
  });

  it("a feature opens H3.3's picker; 'classic' shows the classic flow beside the ring; a locked one shows its reason only", () => {
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    fireEvent.click(ringButton("Use Beastform"));
    expect(featureOpen).toHaveBeenCalledWith({ featureId: "class:druid:beastform", useId: "u1" });
    expect(screen.queryByTestId("classic-feature-use")).toBeNull();

    featureOpen.mockImplementation(() => "classic");
    fireEvent.click(ringButton("Use Beastform"));
    expect(screen.getByTestId("classic-feature-use")).toHaveAttribute("data-feature", "class:druid:beastform");
    expect(ringButton("Use Beastform")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close use" }));
    expect(screen.queryByTestId("classic-feature-use")).toBeNull();

    featureOpen.mockClear();
    fireEvent.click(ringButton("Use Evolution"));
    expect(featureOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("hud-ar-tip")).toHaveTextContent("Evolution needs 3 Hope. You have 1.");
  });

  it("with enough Hope Evolution unlocks; a used feature says when it comes back", () => {
    queries["combatHud:sheet"] = sheet([DRUID[0]!, feature("Beastform", { featureId: "class:druid:beastform", uses: [makeUse({ ready: false, resetLabel: "Back after a rest" })] })], 3);
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    expect(ringButton("Use Evolution")).not.toHaveAttribute("aria-disabled");
    expect(ringButton("Use Beastform")).toHaveAccessibleDescription("Beastform is used up for now. Back after a rest.");
  });

  it("Cast raises the hand: unfolds it and focuses the first playable card's Use", () => {
    renderRing();
    const hud = document.createElement("div");
    hud.dataset.testid = "combat-hud";
    hud.innerHTML = `<section data-testid="hud-hand" data-mode="own"><ul>
      <li data-testid="hud-hand-card" tabindex="-1"><button class="cmh-use" disabled>Use</button></li>
      <li data-testid="hud-hand-card" tabindex="-1"><button class="cmh-use" aria-label="Use Vicious Entangle">Use</button></li>
    </ul></section>`;
    document.body.append(hud);
    act(() => openActionRing(MOSS_TOKEN));
    fireEvent.click(ringButton("Cast"));
    expect(document.activeElement).toHaveAccessibleName("Use Vicious Entangle");
    hud.remove();
  });

  it("raiseHand: a folded hand is shown first; no hand of yours does nothing", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-testid="combat-hud"><section data-testid="hud-hand" data-mode="own" data-folded="true"><button data-testid="hud-hand-hide">Show cards (1)</button></section></div>`;
    const show = vi.fn();
    root.querySelector("button")!.addEventListener("click", show);
    expect(raiseHand(root, 0)).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(raiseHand(document.createElement("div"))).toBe(false);
  });

  it("Cast is locked without cards", () => {
    queries["combatCardsReads:hand"] = { loadout: [], vault: [] };
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    expect(ringButton("Cast")).toHaveAccessibleDescription("No cards in your loadout.");
  });

  it("from the keyboard: focus to Attack, arrows go round, Esc closes and gives focus back to the token", () => {
    renderRing();
    act(() => openActionRing(MOSS_TOKEN, true));
    expect(ringButton("Attack")).toHaveFocus();
    fireEvent.keyDown(ringButton("Attack"), { key: "ArrowRight" });
    expect(ringButton("Cast")).toHaveFocus();
    fireEvent.keyDown(ringButton("Cast"), { key: "ArrowLeft" });
    fireEvent.keyDown(ringButton("Attack"), { key: "ArrowLeft" });
    expect(ringButton("Use Beastform")).toHaveFocus();
    fireEvent.keyDown(ringButton("Use Beastform"), { key: "Escape" });
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "Moss" })).toHaveFocus();
  });

  it("a click on your token again or on the bare map closes it; a press inside does not", () => {
    renderRing();
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    fireEvent.pointerDown(ringButton("Sheet"));
    expect(screen.getByTestId("hud-action-ring")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    const map = document.querySelector(".hud-map")!;
    fireEvent.pointerDown(map);
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
  });

  it("many features: the last slot is More, a list with the rest (locked ones with their reason)", () => {
    const many = ["A", "B", "C", "D"].map((n) => feature(n, { featureId: `f:${n}` }));
    queries["combatHud:sheet"] = sheet([...DRUID, ...many]);
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    const ring = screen.getByTestId("hud-action-ring");
    const top = within(ring)
      .getAllByTestId("hud-ar-button")
      .map((b) => b.getAttribute("aria-label"));
    expect(top).toEqual(["Attack", "Cast", "Sheet", "Use Evolution", "Use Beastform", "More actions (4)"]);
    const more = ringButton("More actions (4)");
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    const list = screen.getByRole("group", { name: "More actions" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Use A", "Use B", "Use C", "Use D"]);
    expect(within(list).getByRole("button", { name: "Use A" })).toHaveFocus();
    fireEvent.click(within(list).getByRole("button", { name: "Use C" }));
    expect(featureOpen).toHaveBeenCalledWith({ featureId: "f:C", useId: "u1" });
    // Esc closes the list first and gives focus back to More.
    fireEvent.click(more);
    fireEvent.keyDown(within(screen.getByRole("group", { name: "More actions" })).getByRole("button", { name: "Use A" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More actions" })).toBeNull();
    expect(more).toHaveFocus();
    expect(screen.getByTestId("hud-action-ring")).toBeInTheDocument();
  });

  it("a reaction is greyed with its reason until the server offers it for an open hit; then it goes to that answer's Use", () => {
    queries["combatHud:sheet"] = sheet([...DRUID, feature("Parry", { kind: "reaction", uses: [makeUse({ activation: "reaction" })] })]);
    const view = renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    const parry = ringButton("React with Parry");
    expect(parry).toHaveAttribute("aria-disabled", "true");
    expect(parry).toHaveAccessibleDescription("Parry is a reaction: it waits for its trigger.");
    fireEvent.click(parry);
    expect(featureOpen).not.toHaveBeenCalled();
    // The server offers it for an open hit: it unlocks and takes focus to the hit window's Use.
    queries["adversaryActions:pending"] = [{ features: [{ featureId: "f:Parry", useId: "u1" }] }];
    const hit = document.createElement("div");
    hit.dataset.testid = "hud-hit-window";
    hit.innerHTML = '<ul><li data-testid="hud-hit-feature" data-feature="f:Parry" data-use="u1"><button type="button" aria-label="Use Parry">Use</button></li></ul>';
    document.body.append(hit);
    view.rerender(
      <HudProvider>
        <PickProvider>
          <div className="hud-map">
            <Token />
            <HudActionRing {...layer()} />
          </div>
        </PickProvider>
      </HudProvider>,
    );
    act(() => openActionRing(MOSS_TOKEN));
    const offered = ringButton("React with Parry");
    expect(offered).not.toHaveAttribute("aria-disabled");
    fireEvent.click(offered);
    expect(hit.querySelector("button")).toHaveFocus();
  });

  it("an out-of-combat Use (Commune) runs classFeatures.use; its summary shows as a toast; a refusal as one too", async () => {
    queries["combatHud:sheet"] = sheet([...DRUID, feature("Commune", { featureId: "class:witch:commune", kind: "outOfCombat", uses: null })]);
    mutate.mockImplementation(async () => ({ summary: "Commune: rolled 4, 2, 6.", roll: null }));
    renderRing();
    act(() => openActionRing(MOSS_TOKEN));
    await act(async () => {
      fireEvent.click(ringButton("Use Commune"));
    });
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ characterId: MOSS, featureKey: "commune", params: {} }));
    expect(hudToasts.get().map((t) => [t.title, t.message])).toEqual([["Commune", "Commune: rolled 4, 2, 6."]]);
    // A used-up one is greyed with when it comes back.
    queries["combatHud:sheet"] = sheet([...DRUID, feature("Commune", { featureId: "class:witch:commune", kind: "outOfCombat", uses: null, used: true, resetLabel: "Back after a long rest" })]);
    act(() => closeActionRing());
    act(() => openActionRing(MOSS_TOKEN));
    expect(ringButton("Use Commune")).toHaveAccessibleDescription("Commune is used up for now. Back after a long rest.");
  });

  it("players only, on your own token; nothing for the GM or another token", () => {
    renderRing({ role: "gm" });
    act(() => openActionRing(MOSS_TOKEN));
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
  });

  it("another token's id never opens a ring", () => {
    renderRing();
    act(() => openActionRing("tk-brannoc"));
    expect(screen.queryByTestId("hud-action-ring")).toBeNull();
  });
});
