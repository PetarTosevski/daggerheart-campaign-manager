/**
 * Feature uses, areas, walls and chains through the picking panel (plan combat-hud H3.3; CmpPicking 'Area · pick a
 * square', 'Wall · two points', 'Chain links'; fold-in dcm-aiwg): the square-picking model, the store with its bar
 * (banner, summary, confirm, keyboard: arrows + Enter, Esc cancels) and map layer (crosshair, radius, wall handles that
 * drag, pointer maths through `viewport.toSquares`, so a shifted / scaled map still lands on the square), the chain
 * overlay, and the feature picker: which flow a feature takes, its riders on the action roll (Fangs + Feed), the
 * panel's switches and the `useFeature` arguments, a chain's next link from `needsChoice`. Convex is mocked.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudPick, PickProvider } from "@/components/combat-map/hud/pick";
import { hudResults } from "@/components/combat-map/hud/result";
import {
  bannerText,
  cancelAreaPick,
  chainAnswer,
  chainOf,
  chainRows,
  confirmProblem,
  HudAreaPick,
  HudAreaPickLayer,
  placeAt,
  progressText,
  resetAreaPickForTests,
  showPickLine,
  startAreaPick,
  stepCursor,
  summaryText,
  wallLength,
  type AreaPickSpec,
} from "@/components/combat-map/hud/pick-area";
import { placementProblem, previewRadius, startCursor } from "@/components/combat-map/hud/pick-area/model";
import { featureBlocked, featureChoices, featureOptions, riderPicksOf, useFeatureUse } from "@/components/combat-map/hud/pick-feature";
import { areaAskOf, featurePlan, hasActionRoll, hopeShortfall, payLine, resultLine, riderSwitches } from "@/components/combat-map/hud/pick-feature/model";
import type { RiderOption } from "@/components/combat-map/actions/attack/riders";
import { ridersToSend } from "@/components/combat-map/actions/attack/riders";
import { HudProvider } from "@/components/combat-map/hud/state";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
let results: unknown[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const read: string[] = [];
/** One-shot reads (`useConvex().query`): the feature picker's `combatFeatures.riders` (dcm-bxp.99.32.19). */
const oneShot: { name: string; args: Record<string, unknown> }[] = [];
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args !== "skip") read.push(functionName(ref));
    return args === "skip" ? undefined : queries[functionName(ref)];
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results.shift() ?? { status: "withdrawn" };
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
  useConvex: () => ({
    query: async (ref: unknown, args: Record<string, unknown>) => {
      oneShot.push({ name: functionName(ref), args });
      return queries[functionName(ref)] ?? [];
    },
  }),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  calls.length = 0;
  read.length = 0;
  oneShot.length = 0;
  results = [];
  act(() => resetAreaPickForTests());
  hudResults.reset();
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "map1" as Id<"combatMaps">;
const CHARACTER = "vexc" as Id<"characters">;
const tok = (s: string) => s as Id<"combatTokens">;
const VEX = tok("vex");
const LT = tok("lt");
const BANDIT = tok("bandit");

const state = {
  campaignId: CAMPAIGN,
  role: "player",
  mode: "play",
  map: { _id: MAP, name: "Forest Camp", live: true, w: 30, h: 20 },
  selectedTokenId: null,
  onSelectToken: () => {},
  previewCharacterId: null,
  onPreview: () => {},
} as unknown as CombatPageState;

/** A map shown at 2× (the make-room scale and zoom): 40 px squares become 80 client px, the stage starts at 100, 50. */
const toSquares = (x: number, y: number) => ({ x: (x - 100) / 80, y: (y - 50) / 80 });
const layer = { ...state, viewport: { cell: 40, zoom: 1, w: 30, h: 20, pad: 0, toSquares, showNames: false } } as unknown as MapLayerProps;
/** The client point at the centre of a square under `toSquares`. */
const px = (x: number, y: number) => ({ clientX: 100 + (x + 0.5) * 80, clientY: 50 + (y + 0.5) * 80 });

function seedView() {
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: CHARACTER,
    tokenId: VEX,
    pcs: [{ _id: VEX, name: "Vex", x: 7, y: 6, size: 1, stats: { conditions: [] } }],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 8, y: 6, size: 1, face: 0, revealed: false },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 9, y: 7, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatActionsReads:targets"] = [
    { tokenId: LT, band: "melee", inRange: true, lineOfSight: true, cover: false },
    { tokenId: BANDIT, band: "veryClose", inRange: true, lineOfSight: true, cover: false },
  ];
}

function Hud({ children }: { children?: React.ReactNode }) {
  return (
    <HudProvider>
      <PickProvider>
        {children}
        <div className="hud-map">
          <HudAreaPickLayer {...layer} />
        </div>
        <HudAreaPick state={state} />
        <HudPick state={state} />
      </PickProvider>
    </HudProvider>
  );
}

const darkCloud = (over: Partial<AreaPickSpec> = {}): AreaPickSpec => ({
  id: "feature:dark-cloud",
  mapId: MAP,
  name: "Dark Cloud",
  label: "Dark Cloud",
  shape: "circle",
  count: 1,
  radius: "close",
  within: "close",
  blocksSight: true,
  origin: { x: 7, y: 6, size: 1 },
  pay: null,
  send: vi.fn(async () => ({ kind: "done" as const, line: "Rolled 17: Dark Cloud is on the map." })),
  ...over,
});

// ---------------------------------------------------------------- the model

describe("square picking: the model", () => {
  const ask = { name: "Dark Cloud", label: "Dark Cloud", shape: "circle" as const, count: 1, radius: "close" as const, within: "close" as const, origin: { x: 7, y: 6, size: 1 } };
  const wall = { name: "Veil of Night", label: "Veil of Night", shape: "wall" as const, count: 2, within: "far" as const };

  it("places the next point, then moves the nearest; a placed square changes nothing", () => {
    expect(placeAt([], 1, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
    expect(placeAt([{ x: 3, y: 3 }], 1, { x: 5, y: 3 })).toEqual([{ x: 5, y: 3 }]);
    expect(placeAt([{ x: 1, y: 1 }], 2, { x: 9, y: 1 })).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }]);
    expect(placeAt([{ x: 1, y: 1 }, { x: 9, y: 1 }], 2, { x: 8, y: 2 })).toEqual([{ x: 1, y: 1 }, { x: 8, y: 2 }]);
    expect(placeAt([{ x: 1, y: 1 }], 2, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
  });

  it("the keyboard cursor: starts on the caster, arrows step a square and stay on the map", () => {
    expect(startCursor({ x: 7, y: 6, size: 1 }, 30, 20)).toEqual({ x: 7, y: 6 });
    expect(startCursor(null, 30, 20)).toEqual({ x: 15, y: 10 });
    expect(stepCursor({ x: 7, y: 6 }, "ArrowRight", 30, 20)).toEqual({ x: 8, y: 6 });
    expect(stepCursor({ x: 0, y: 0 }, "ArrowUp", 30, 20)).toEqual({ x: 0, y: 0 });
    expect(stepCursor({ x: 0, y: 0 }, "a", 30, 20)).toBeNull();
  });

  it("banner, progress and summary say what the board says", () => {
    expect(bannerText(ask, 0)).toBe("Pick the centre of Dark Cloud within Close");
    expect(progressText(ask, 0)).toBe("Esc cancels");
    expect(summaryText(ask, [])).toBe("Radius: Close (6 squares)");
    expect(bannerText(wall, 1)).toBe("Veil of Night: pick the second point within Far");
    expect(progressText(wall, 2)).toBe("2 of 2 points");
    expect(summaryText(wall, [{ x: 1, y: 1 }, { x: 6, y: 3 }])).toBe("Length 6 squares · within Far");
    expect(wallLength({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(5);
    expect(previewRadius(ask)).toBe(6.5);
    expect(previewRadius(wall)).toBeNull();
  });

  it("blocks the confirm until every point is down and within `placeWithin` (the server's check)", () => {
    expect(confirmProblem(ask, [])).toBe("Pick a square on the map.");
    expect(confirmProblem(wall, [{ x: 1, y: 1 }])).toBe("Pick 1 more point on the map.");
    expect(confirmProblem(ask, [{ x: 10, y: 6 }])).toBeNull();
    expect(placementProblem(ask, [{ x: 20, y: 6 }])).toBe("Dark Cloud must be placed within Close range of you.");
  });

  it("chain links: rows of the next link with bands from the last, the answer, the session data", () => {
    const creatures = [
      { tokenId: LT, name: "Lieutenant", side: "enemy" as const, at: { x: 8, y: 6, size: 1 } },
      { tokenId: BANDIT, name: "Bandit", side: "enemy" as const, at: { x: 9, y: 7, size: 1 } },
    ];
    expect(chainRows([BANDIT, tok("gone")], creatures, [LT])).toEqual([{ tokenId: BANDIT, name: "Bandit", side: "enemy", band: "melee", reach: "in" }]);
    expect(chainAnswer(1, [BANDIT])).toEqual({ id: "chain:1", value: [BANDIT] });
    expect(chainAnswer(2, [])).toEqual({ id: "chain:2", value: [] });
    expect(chainOf({ chain: { links: [[LT]] } })).toEqual({ links: [[LT]] });
    expect(chainOf({ spell: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------- the bar and the layer

describe("square picking: the bar and the map layer", () => {
  it("Area: a click lands on the square under the pointer on a scaled map; the radius previews; the confirm sends it", async () => {
    seedView();
    render(<Hud />);
    const spec = darkCloud();
    act(() => startAreaPick(spec));
    const bar = screen.getByRole("region", { name: "Dark Cloud: pick on the map" });
    expect(within(bar).getByTestId("hud-area-banner")).toHaveTextContent("Pick the centre of Dark Cloud within Close");
    expect(within(bar).getByTestId("hud-area-progress")).toHaveTextContent("Esc cancels");
    expect(within(bar).getByText("Blocks sight")).toBeInTheDocument();
    expect(within(bar).getByTestId("hud-area-banner")).toHaveFocus();
    const go = within(bar).getByRole("button", { name: "Place Dark Cloud here" });
    expect(go).toBeDisabled();

    const layerEl = screen.getByTestId("hud-area-layer");
    fireEvent.pointerMove(layerEl, px(9, 6));
    expect(screen.getByTestId("hud-area-aim")).toHaveAttribute("data-x", "9");
    expect(layerEl.querySelector(".hud-ap-xh")).toHaveAttribute("r", "6.5");
    fireEvent.click(layerEl, px(9, 6));
    expect(screen.getByTestId("hud-area-point")).toHaveAttribute("data-x", "9");
    expect(go).toBeEnabled();
    // Too far: the server's check, before the send.
    fireEvent.click(layerEl, px(25, 6));
    expect(within(bar).getByTestId("hud-area-why")).toHaveTextContent("Dark Cloud must be placed within Close range of you.");
    fireEvent.click(layerEl, px(10, 7));
    fireEvent.click(go);
    await waitFor(() => expect(spec.send).toHaveBeenCalledWith([{ x: 10, y: 7 }]));
    expect(await screen.findByTestId("hud-area-line")).toHaveTextContent("Rolled 17: Dark Cloud is on the map.");
    expect(screen.queryByTestId("hud-area-layer")).toBeNull();
  });

  it("keyboard: arrows move the crosshair from your square, Enter places, Enter again confirms; the token keys never see them", async () => {
    seedView();
    render(<Hud />);
    const spec = darkCloud();
    act(() => startAreaPick(spec));
    const tokenKeys = vi.fn();
    window.addEventListener("keydown", (e) => (e.defaultPrevented ? null : tokenKeys(e.key)));
    const banner = screen.getByTestId("hud-area-banner");
    fireEvent.keyDown(banner, { key: "ArrowRight" });
    fireEvent.keyDown(banner, { key: "ArrowRight" });
    fireEvent.keyDown(banner, { key: "ArrowDown" });
    expect(screen.getByTestId("hud-area-aim")).toHaveAttribute("data-x", "8");
    expect(screen.getByTestId("hud-area-aim")).toHaveAttribute("data-y", "7");
    expect(tokenKeys).not.toHaveBeenCalled();
    fireEvent.keyDown(banner, { key: "Enter" });
    expect(screen.getByTestId("hud-area-point")).toHaveAttribute("data-x", "8");
    fireEvent.keyDown(banner, { key: "Enter" });
    await waitFor(() => expect(spec.send).toHaveBeenCalledWith([{ x: 8, y: 7 }]));
  });

  it("Esc cancels every mode: onCancel runs, nothing is sent, focus goes back", () => {
    seedView();
    render(
      <Hud>
        <button type="button">Use Dark Cloud</button>
      </Hud>,
    );
    const opener = screen.getByRole("button", { name: "Use Dark Cloud" });
    opener.focus();
    const onCancel = vi.fn();
    const spec = darkCloud({ onCancel });
    act(() => startAreaPick(spec));
    fireEvent.keyDown(screen.getByTestId("hud-area-banner"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(spec.send).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hud-area-bar")).toBeNull();
    expect(opener).toHaveFocus();
    // A wall too.
    act(() => startAreaPick(darkCloud({ id: "wall", shape: "wall", count: 2, name: "Veil of Night", label: "Veil of Night" })));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("hud-area-bar")).toBeNull();
  });

  it("Wall: two clicks place the ends, a handle drags to another square, the confirm sends both in order", async () => {
    seedView();
    render(<Hud />);
    const send = vi.fn(async () => ({ kind: "stay" as const, message: "The GM approves first." }));
    act(() => startAreaPick(darkCloud({ id: "veil", shape: "wall", count: 2, name: "Veil of Night", label: "Veil of Night", radius: undefined, within: "far", send })));
    const layerEl = screen.getByTestId("hud-area-layer");
    expect(screen.getByTestId("hud-area-banner")).toHaveTextContent("Veil of Night: pick the first point within Far");
    fireEvent.click(layerEl, px(8, 4));
    expect(screen.getByTestId("hud-area-banner")).toHaveTextContent("pick the second point");
    fireEvent.click(layerEl, px(12, 4));
    expect(screen.getByTestId("hud-area-progress")).toHaveTextContent("2 of 2 points");
    expect(screen.getByTestId("hud-area-summary")).toHaveTextContent("Length 5 squares · within Far");
    const handles = screen.getAllByTestId("hud-area-handle");
    expect(handles).toHaveLength(2);
    fireEvent.pointerDown(handles[1]!, { pointerId: 3, ...px(12, 4) });
    fireEvent.pointerMove(handles[1]!, { pointerId: 3, ...px(12, 8) });
    fireEvent.pointerUp(handles[1]!, { pointerId: 3 });
    expect(screen.getAllByTestId("hud-area-handle")[1]).toHaveAttribute("data-y", "8");
    fireEvent.click(screen.getByRole("button", { name: "Raise Veil of Night" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith([{ x: 8, y: 4 }, { x: 12, y: 8 }]));
    // `stay` keeps the mode with the message under the confirm.
    expect(await screen.findByTestId("hud-area-error")).toHaveTextContent("The GM approves first.");
    act(() => cancelAreaPick());
  });

  it("a refusal keeps the mode open with the server's message; a line can be dismissed", async () => {
    seedView();
    render(<Hud />);
    act(() => startAreaPick(darkCloud({ send: async () => Promise.reject(new Error("boom")) })));
    fireEvent.click(screen.getByTestId("hud-area-layer"), px(9, 6));
    fireEvent.click(screen.getByTestId("hud-area-go"));
    expect(await screen.findByTestId("hud-area-error")).toBeInTheDocument();
    act(() => cancelAreaPick());
    act(() => showPickLine("Shadow Stepper · done"));
    expect(screen.getByTestId("hud-area-line")).toHaveTextContent("Shadow Stepper · done");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("hud-area-line")).toBeNull();
  });
});

// ---------------------------------------------------------------- the feature picker

/** Feed's Fear Die as `combatFeatures.riders` lists it on Fangs' action roll (HF p.39). */
const FEED_RIDER: RiderOption = {
  source: "feature",
  id: "transformation:vampire:feed",
  useId: "fear-die",
  name: "Feed: Fear Die a d20",
  phase: "before",
  when: "Before the roll",
  ready: true,
  resetLabel: null,
  costs: [],
  limit: null,
  numbers: [],
  options: [],
  situations: [],
  addTargets: null,
};

const FEED = {
  featureId: "transformation:vampire:feed",
  name: "Feed",
  usage: "combat" as const,
  uses: [
    { useId: "main", ready: true },
    { useId: "fear-die", ready: true },
  ],
};

describe("feature uses: the model", () => {
  it("picks the flow: the panel, squares on the map, or the classic drawer", () => {
    expect(featurePlan("transformation:vampire:fangs", "main").kind).toBe("panel");
    expect(featurePlan("subclass:nightwalker:dark-cloud", "main").kind).toBe("area");
    expect(featurePlan("subclass:hedge:circle-of-power", "main").kind).toBe("area");
    expect(featurePlan("subclass:nightwalker:shadow-stepper", "main").kind).toBe("panel");
    expect(featurePlan("subclass:warden-of-renewal:wardens-protection", "main").kind).toBe("classic");
    expect(featurePlan("ancestry:firbolg:charge", "main").kind).toBe("classic");
    expect(featurePlan("nope", "main").kind).toBe("classic");
  });

  it("dcm-aiwg / dcm-bxp.99.32.19: the server's riders become switches (default-on ones ride by themselves); no action roll, no riders", () => {
    const plan = featurePlan("transformation:vampire:fangs", "main");
    if (plan.kind !== "panel") throw new Error("panel");
    expect(hasActionRoll(plan.use)).toBe(true);
    const riders = riderSwitches([FEED_RIDER, { ...FEED_RIDER, id: "subclass:call-of-the-brave:rise-to-the-challenge", useId: "main", defaultOn: true }]);
    expect(riders.map((r) => [r.id, r.useId, r.phase])).toEqual([["transformation:vampire:feed", "fear-die", "before"]]);
    // Nothing rides on a use without an action roll (the picker asks the server nothing for it).
    const cloak = featurePlan("subclass:nightwalker:shadow-stepper", "main");
    if (cloak.kind !== "panel") throw new Error("panel");
    expect(hasActionRoll(cloak.use)).toBe(false);
    // The switches and what goes to the server.
    const options = featureOptions(plan.form, riders);
    expect(options).toEqual([expect.objectContaining({ id: "rider:feature|transformation:vampire:feed|fear-die", label: "Feed: Fear Die a d20", disabled: false })]);
    const sent = ridersToSend(riders, riderPicksOf(riders, { [options[0]!.id]: true }));
    expect(sent).toEqual([{ source: "feature", id: "transformation:vampire:feed", useId: "fear-die", choices: [] }]);
    expect(ridersToSend(riders, riderPicksOf(riders, {}))).toEqual([]);
  });

  it("situations are switches the primary waits for; costs make the footer line and the Hope shortfall", () => {
    const plan = featurePlan("subclass:nightwalker:shadow-stepper", "main");
    if (plan.kind !== "panel") throw new Error("panel");
    const options = featureOptions(plan.form, []);
    expect(options).toHaveLength(1);
    const data = { numbers: {}, eithers: {}, recipients: {}, options: {} };
    expect(featureBlocked(plan.form, data, { options: {} }, null)).toMatch(/^Confirm: /);
    expect(featureBlocked(plan.form, data, { options: { [options[0]!.id]: true } }, null)).toBeNull();
    expect(featureChoices(plan.form, data, { targetIds: [], options: { [options[0]!.id]: true } })).toEqual([{ id: "situations", value: [plan.form.situations[0]] }]);
    expect(payLine(plan.use.costs)).toBe("Marks 1 Stress");
    expect(payLine([{ kind: "hope", amount: { kind: "fixed", value: 1 } }], 1)).toBe("Spends your last Hope");
    expect(hopeShortfall([{ kind: "hope", amount: { kind: "fixed", value: 3 } }], 1)).toBe("Needs 3 Hope · you have 1");
  });

  it("the area ask from a use's area, and the result line (Hit / Miss / Defeated, never an adversary number)", () => {
    const plan = featurePlan("subclass:nightwalker:dark-cloud", "main");
    if (plan.kind !== "area") throw new Error("area");
    expect(areaAskOf("Dark Cloud", plan.area, plan.picks, { x: 1, y: 1 })).toMatchObject({ shape: "circle", count: 1, radius: "close", within: "close", blocksSight: true });
    const names = new Map([[LT as string, "Lieutenant"]]);
    const out = { status: "resolved" as const, entryId: "e" as Id<"actionLog">, featureId: "f", useId: "main", roll: { total: 14 } as never, damage: [], success: true, targets: [{ tokenId: LT, hit: true, defeated: false }], fearDelta: 0, prompts: [], notes: [] };
    expect(resultLine("Fangs", out, names)).toBe("Fangs · rolled 14 · Lieutenant: Hit");
  });
});

/** Opens a feature through the hook, as the sheet's Use button does. */
function UseButton({ featureId, onOpened, canUse }: { featureId: string; onOpened: (r: string) => void; canUse?: boolean }) {
  const featureUse = useFeatureUse({ campaignId: CAMPAIGN, role: "player", map: state.map, characterId: CHARACTER, ...(canUse === undefined ? {} : { canUse }) });
  return (
    <button type="button" onClick={() => onOpened(featureUse.open({ featureId, useId: "main" }))}>
      Use {featureId}
    </button>
  );
}

function seedFeatures() {
  seedView();
  queries["combatFeaturesReads:drawer"] = { characterId: CHARACTER, trackers: { hope: { value: 2, max: 6 } }, features: [FEED] };
  queries["combatCardsReads:hand"] = { characterId: CHARACTER, loadout: [], vault: [] };
  queries["combatFeatures:riders"] = [FEED_RIDER];
}

describe("feature uses: the picker (useFeatureUse)", () => {
  it("Fangs: the panel with targets, a trait and the Feed rider; the send carries targets, trait and riders", async () => {
    seedFeatures();
    const opened = vi.fn();
    render(
      <Hud>
        <UseButton featureId="transformation:vampire:fangs" onOpened={opened} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use transformation:vampire:fangs" }));
    expect(opened).toHaveBeenCalledWith("picker");
    const panel = await screen.findByRole("dialog", { name: "Fangs" });
    expect(within(panel).getByTestId("hud-pick-rule")).toHaveTextContent("Pick 1 target within Melee");
    const rider = within(panel).getByRole("switch", { name: /Feed: Fear Die a d20/ });
    expect(within(panel).getByRole("button", { name: "Agility" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(panel).getByRole("button", { name: "Finesse" }));
    fireEvent.click(rider);
    fireEvent.click(within(panel).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === LT)!);
    results = [{ status: "resolved", entryId: "e", featureId: "f", useId: "main", roll: { total: 15 }, damage: [], success: true, targets: [{ tokenId: LT, hit: true, defeated: false }], fearDelta: 0, prompts: [], notes: [] }];
    const go = within(panel).getByTestId("hud-pick-go");
    expect(go).toHaveTextContent("Use Fangs on Lieutenant");
    fireEvent.click(go);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      name: "combatFeatures:useFeature",
      args: { campaignId: CAMPAIGN, characterId: CHARACTER, mapId: MAP, featureId: "transformation:vampire:fangs", useId: "main", targetTokenIds: [LT], roll: { trait: "finesse" }, riders: [{ source: "feature", id: "transformation:vampire:feed", useId: "fear-die", choices: [] }] },
    });
    // dcm-bxp.99.32.19: the riders came from the server, for the trait the panel held (opened on Agility, sent on Finesse).
    expect(oneShot).toEqual([
      { name: "combatFeatures:riders", args: { campaignId: CAMPAIGN, characterId: CHARACTER, featureId: "transformation:vampire:fangs", useId: "main", trait: "agility" } },
      { name: "combatFeatures:riders", args: { campaignId: CAMPAIGN, characterId: CHARACTER, featureId: "transformation:vampire:fangs", useId: "main", trait: "finesse" } },
    ]);
    // dcm-bxp.99.32.26: the result panel shows it (the roll, Hit per target by name), not the square-picking bar.
    await waitFor(() => expect(hudResults.get()).not.toBeNull());
    const entry = hudResults.get();
    if (entry?.kind !== "result") throw new Error("a result");
    expect(entry.view).toMatchObject({ kind: "feature", title: "Fangs", sub: "Vex · Roll", characterId: CHARACTER, success: true });
    expect(entry.view.targets).toEqual([{ tokenId: LT, name: "Lieutenant", verdict: "Hit" }]);
    expect(screen.queryByTestId("hud-area-line")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Fangs" })).toBeNull();
  });

  it("a chain's next link: numbered links on the map, rows from the ask, 'Next link' answers chain:1, 'Stop here' ends it", async () => {
    seedFeatures();
    render(
      <Hud>
        <UseButton featureId="transformation:vampire:fangs" onOpened={() => {}} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use transformation:vampire:fangs" }));
    const panel = await screen.findByRole("dialog", { name: "Fangs" });
    fireEvent.click(within(panel).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === LT)!);
    results = [
      { status: "needsChoice", asks: [{ kind: "followUp", label: "each adversary within Very Close of the last", link: 1, tokenIds: [BANDIT] }] },
      { status: "needsChoice", asks: [{ kind: "followUp", label: "each adversary within Very Close of the last", link: 2, tokenIds: [LT] }] },
      { status: "resolved", entryId: "e", featureId: "f", useId: "main", roll: null, damage: [], success: true, targets: [], fearDelta: 0, prompts: [], notes: [] },
    ];
    fireEvent.click(within(panel).getByTestId("hud-pick-go"));
    const link = await screen.findByText("Link 2: each adversary within Very Close of the last");
    const linkPanel = link.closest("section")!;
    expect(within(linkPanel as HTMLElement).getAllByTestId("hud-pick-row").map((r) => r.dataset.token)).toEqual([BANDIT]);
    fireEvent.click(within(linkPanel as HTMLElement).getAllByTestId("hud-pick-row")[0]!);
    expect(screen.getAllByTestId("hud-chain-node").map((n) => n.textContent)).toEqual(["1", "2"]);
    fireEvent.click(within(linkPanel as HTMLElement).getByRole("button", { name: "Next link" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.args.choices).toEqual(expect.arrayContaining([{ id: "chain:1", value: [BANDIT] }]));
    const stop = await screen.findByRole("button", { name: "Stop here" });
    fireEvent.click(stop);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]!.args.choices).toEqual(expect.arrayContaining([{ id: "chain:1", value: [BANDIT] }, { id: "chain:2", value: [] }]));
  });

  it("Dark Cloud: nothing to ask, so no panel: straight to the square; the send has `point`", async () => {
    seedFeatures();
    queries["combatFeaturesReads:drawer"] = { characterId: CHARACTER, trackers: { hope: { value: 2, max: 6 } }, features: [] };
    queries["combatFeatures:riders"] = [];
    const opened = vi.fn();
    render(
      <Hud>
        <UseButton featureId="subclass:nightwalker:dark-cloud" onOpened={opened} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use subclass:nightwalker:dark-cloud" }));
    expect(opened).toHaveBeenCalledWith("area");
    // The server's riders come first (none), then straight to the square.
    expect(await screen.findByTestId("hud-area-banner")).toHaveTextContent("Pick the centre of Dark Cloud within Close");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("hud-area-layer"), px(9, 6));
    results = [{ status: "resolved", entryId: "e", featureId: "f", useId: "main", roll: { total: 16 }, damage: [], success: true, targets: [], fearDelta: 0, prompts: [], notes: [] }];
    fireEvent.click(screen.getByRole("button", { name: "Place Dark Cloud here" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.args).toMatchObject({ featureId: "subclass:nightwalker:dark-cloud", targetTokenIds: [], point: { x: 9, y: 6 }, choices: [] });
    expect(await screen.findByTestId("hud-area-line")).toHaveTextContent("Rolled 16: Dark Cloud is on the map.");
  });

  it("Dark Cloud with a rider on its Spellcast Roll: the panel first, 'Pick the square' starts the square pick, the riders ride along", async () => {
    seedFeatures();
    render(
      <Hud>
        <UseButton featureId="subclass:nightwalker:dark-cloud" onOpened={() => {}} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use subclass:nightwalker:dark-cloud" }));
    const panel = await screen.findByRole("dialog", { name: "Dark Cloud" });
    expect(within(panel).getByTestId("hud-pick-rule")).toHaveTextContent("Then pick a square on the map");
    fireEvent.click(within(panel).getByRole("switch", { name: /Feed: Fear Die a d20/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Pick the square" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Dark Cloud" })).toBeNull());
    fireEvent.click(screen.getByTestId("hud-area-layer"), px(8, 6));
    results = [{ status: "pending", requestId: "r1", outOfRange: [] }];
    fireEvent.click(screen.getByRole("button", { name: "Place Dark Cloud here" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.args).toMatchObject({ point: { x: 8, y: 6 }, riders: [{ source: "feature", id: "transformation:vampire:feed", useId: "fear-die", choices: [] }] });
    expect(await screen.findByTestId("hud-area-line")).toHaveTextContent("Dark Cloud: waiting for the GM to approve.");
  });

  it("Shadow Stepper: 'On yourself' with you as the locked row; the situation switch gates the primary; no target id is sent", async () => {
    seedFeatures();
    render(
      <Hud>
        <UseButton featureId="subclass:nightwalker:shadow-stepper" onOpened={() => {}} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use subclass:nightwalker:shadow-stepper" }));
    const panel = await screen.findByRole("dialog", { name: "Shadow Stepper" });
    expect(within(panel).getByTestId("hud-pick-rule")).toHaveTextContent("On yourself");
    expect(within(panel).getByTestId("hud-pick-pay")).toHaveTextContent("Marks 1 Stress");
    const go = within(panel).getByTestId("hud-pick-go");
    expect(go).toBeDisabled();
    fireEvent.click(within(panel).getByRole("switch", { name: /shadow/i }));
    results = [{ status: "resolved", entryId: "e", featureId: "f", useId: "main", roll: null, damage: [], success: true, targets: [], fearDelta: 0, prompts: [], notes: [] }];
    fireEvent.click(go);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.args).toMatchObject({ featureId: "subclass:nightwalker:shadow-stepper", targetTokenIds: [] });
    // dcm-bxp.99.32.26: the result panel ("Vex · Feature", no roll), not the square-picking bar.
    await waitFor(() => expect(hudResults.get()).toMatchObject({ kind: "result", view: { kind: "feature", title: "Shadow Stepper", sub: "Vex · Feature" } }));
    expect(screen.queryByTestId("hud-area-line")).toBeNull();
  });

  it("a sheet the viewer can't use (view only, GM without Play for): no drawer or hand read (a hidden hand refuses them), classic", () => {
    seedFeatures();
    const opened = vi.fn();
    render(
      <Hud>
        <UseButton featureId="transformation:vampire:fangs" onOpened={opened} canUse={false} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use transformation:vampire:fangs" }));
    expect(opened).toHaveBeenCalledWith("classic");
    expect(read).not.toContain("combatFeaturesReads:drawer");
    expect(read).not.toContain("combatCardsReads:hand");
  });

  it("Warden's Protection stays classic", () => {
    seedFeatures();
    const opened = vi.fn();
    render(
      <Hud>
        <UseButton featureId="subclass:warden-of-renewal:wardens-protection" onOpened={opened} />
      </Hud>,
    );
    fireEvent.click(screen.getByRole("button", { name: /wardens-protection/ }));
    expect(opened).toHaveBeenCalledWith("classic");
  });
});
