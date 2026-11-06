/**
 * Blocked states on the player surfaces (plan combat-hud H6.2; boards CmpBlocked, Main 'Can't afford', CmpCards):
 * H6.1's three layers applied to the hand, the sheet's features, the picking panel and its rings, the action ring and
 * the token. Before the click: the reason (card tag + Use aria-disabled, feature disabled, sheet badge, picker counter);
 * while the GM holds the spotlight every non-reaction control waits with the SPOTLIGHT_WITH_GM reason, reactions and
 * follow-ups do not (answer 1c). At the click: the refusal under the control (ring dimmed / dotted / hint) or as a toast
 * where the table places it. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HandCard } from "@/components/combat-map/actions/hand/model";
import { featureLock, spotlightLock } from "@/components/combat-map/hud/action-ring/model";
import { HudHandBody, type HudHandBodyProps } from "@/components/combat-map/hud/hand/body";
import { cardLook, type LookContext } from "@/components/combat-map/hud/hand/states";
import { HudPick, HudPickLayer, PickProvider, usePick, type PickSessionSpec } from "@/components/combat-map/hud/pick";
import { pickCount, refusedRing, spotlightBlocks } from "@/components/combat-map/hud/pick/model";
import { refusalContext } from "@/components/combat-map/hud/pick/session";
import { attackBlocked } from "@/components/combat-map/hud/pick-attack/model";
import { hopeShortfall } from "@/components/combat-map/hud/pick-feature/model";
import { HudSheet } from "@/components/combat-map/hud/sheet";
import type { HudSheetData, HudSheetFeature } from "@/components/combat-map/hud/sheet/model";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import { moveNoticeText } from "@/components/combat-map/hud/token/model";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";
import { refusalForCode } from "@/lib/errors/refusals";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
let mutationResult: () => Promise<unknown> = async () => null;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return mutationResult();
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
  // The feature picker's one-shot riders read (dcm-bxp.99.32.19).
  useConvex: () => ({ query: async (ref: unknown) => queries[functionName(ref)] ?? [] }),
}));
vi.mock("@/components/combat-map/drawer/use", () => ({ FeatureUse: () => <section data-testid="classic-feature-use" /> }));
vi.mock("@/components/combat-map/drawer/prompts", () => ({ DrawerPrompts: () => <div data-testid="classic-prompts" /> }));
vi.mock("@/components/combat-map/drawer/list/controls", () => ({ D5Use: () => null }));

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
  for (const k of Object.keys(queries)) delete queries[k];
  calls.length = 0;
  mutationResult = async () => null;
  hudToasts.reset();
  window.localStorage.clear();
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "m1" as Id<"combatMaps">;
const MOSS = "ch-moss" as Id<"characters">;
const tok = (s: string) => s as Id<"combatTokens">;
const MOSS_T = tok("moss");
const LT = tok("lt");
const BANDIT = tok("bandit");
const SNIPER = tok("sniper");

/** The GM holds the spotlight: a player's `combatSpotlight.state` (H1.S). */
function gmHoldsSpotlight() {
  queries["combatSpotlight:state"] = { holder: { kind: "gm" }, since: 1, reason: "gmTook", rollBy: null, reactionsOnly: true, canMove: false };
}

// ---------------------------------------------------------------- the words (H6.1's helpers)

describe("the lock words come from H6.1's table and shortfall helper", () => {
  it("ring: used first, then the Hope it needs; the spotlight lock", () => {
    expect(featureLock({ label: "Evolution", ready: true, resetLabel: null }, 3, 1)).toBe("Evolution needs 3 Hope. You have 1.");
    expect(featureLock({ label: "Rally", ready: false, resetLabel: "Back after a long rest" }, 0, 5)).toBe("Rally is used up for now. Back after a long rest.");
    expect(featureLock({ label: "Evolution", ready: true, resetLabel: null }, 3, 3)).toBeNull();
    expect(spotlightLock(true)).toBe("The GM has the spotlight · reactions only");
    expect(spotlightLock(false)).toBeNull();
  });

  it("pickers: 'Needs n Hope · you have m' (feature, attack); Stress never locks", () => {
    expect(hopeShortfall([{ kind: "hope", amount: { kind: "fixed", value: 3 } }], 0)).toBe("Needs 3 Hope · you have 0");
    expect(hopeShortfall([{ kind: "stress", amount: { kind: "fixed", value: 1 } }], 0)).toBeNull();
    const roller = { experiences: [{ id: "x1", name: "Forest Guide", value: 2 }], hope: 0 };
    expect(attackBlocked({ weapons: [{ slot: "primary" } as never], roller }, [], { roll: { experienceIds: ["x1"], edge: 0, help: 0 }, riders: {} } as never)).toBe("Needs 1 Hope · you have 0");
  });

  it("a refused move reads the table (MOVE_BLOCKED, then the token snaps back)", () => {
    expect(moveNoticeText({ kind: "blocked", text: "Blocked" })).toBe("Something blocks the way.");
    expect(moveNoticeText({ kind: "warning", text: "Moved through a wall" })).toBe("Moved through a wall");
    expect(refusalForCode("MOVE_BLOCKED").then).toBe("snap-back");
  });
});

// ---------------------------------------------------------------- the hand

type HandUseFixture = HandCard["uses"][number];
const handUse = (name: string, extra: Partial<HandUseFixture> = {}): HandUseFixture => ({
  useId: "main",
  name,
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: false,
  targets: { side: "any", range: "melee", count: "one" },
  choices: [],
  ...extra,
});
const card = (cardId: string, name: string, extra: Partial<HandCard> = {}): HandCard => ({
  cardId,
  name,
  domain: "arcana",
  level: 1,
  type: "spell",
  recallCost: 1,
  place: "loadout",
  usage: "combat",
  state: "ready",
  resetLabel: null,
  tokens: 0,
  uses: [handUse(name)],
  ...extra,
});
const WALL = card("wall-walk", "Wall Walk");
const ENTANGLE = card("vicious-entangle", "Vicious Entangle", { domain: "sage", uses: [handUse("Vicious Entangle", { rolls: true, targets: { side: "enemy", range: "far", count: "one" } })] });
const RUNE = card("rune-ward", "Rune Ward", { recallCost: 0, uses: [handUse("Rune Ward", { activation: "reaction", targets: null })] });

const look = (over: Partial<LookContext> = {}): LookContext => ({ mode: "own", canPlay: true, name: "Moss", hope: 2, playing: false, rollBlock: null, ...over });

describe("the hand (CmpCards, Main 'Can't afford')", () => {
  it("can't afford: the tag names the shortfall, Use is blocked with the reason and the full refusal", () => {
    const l = cardLook(WALL, look({ hope: 0 }));
    expect(l.tag).toEqual({ kind: "no", text: "Needs 1 Hope", lock: true });
    expect(l).toMatchObject({ wash: "afford", canUse: false, showUse: true, reason: "Needs 1 Hope · you have 0" });
    expect(l.blocked?.code).toBe("CARD_COST_UNPAID");
    expect(l.blocked?.refusal).toMatchObject({ title: "Not enough Hope", text: "Wall Walk needs 1 Hope. You have 0.", hint: "Roll with Hope, or rest, to gain Hope." });
  });

  it("the GM's spotlight: every card that starts something waits with SPOTLIGHT_WITH_GM; reaction cards keep their tag", () => {
    const l = cardLook(ENTANGLE, look({ spotlightWithGm: true }));
    expect(l.blocked?.code).toBe("SPOTLIGHT_WITH_GM");
    expect(l).toMatchObject({ canUse: false, showUse: true, reason: "The GM has the spotlight · reactions only" });
    expect(cardLook(RUNE, look({ spotlightWithGm: true })).tag?.text).toBe("Reaction · shows in the hit window");
    expect(cardLook(RUNE, look({ spotlightWithGm: true })).blocked).toBeUndefined();
  });

  function renderHand(over: Partial<HudHandBodyProps> = {}) {
    const props: HudHandBodyProps = {
      campaignId: CAMPAIGN,
      mapId: MAP,
      characterId: MOSS,
      name: "Moss",
      mode: "own",
      canPlay: true,
      creatures: [{ tokenId: MOSS_T, name: "You", side: "self" }, { tokenId: BANDIT, name: "Bandit", side: "enemy" }],
      pickedEnemies: [],
      ...over,
    };
    return render(
      <HudProvider>
        <PickProvider>
          <HudHandBody {...props} />
        </PickProvider>
      </HudProvider>,
    );
  }
  const fanCard = (name: string) => screen.getAllByTestId("hud-hand-card").find((el) => within(el).queryByRole("heading", { name }))!;

  it("a press on a blocked Use shows the refusal as a toast near the hand and sends nothing (Main 'Can't afford')", () => {
    queries["combatCardsReads:hand"] = { characterId: MOSS, loadout: [WALL], vault: [] };
    queries["charactersReads:get"] = { _id: MOSS, sheet: { hope: 0, experiences: [], level: 1 } };
    renderHand();
    const use = within(fanCard("Wall Walk")).getByRole("button", { name: "Use Wall Walk" });
    expect(use).toHaveAttribute("aria-disabled", "true");
    expect(use).toBeEnabled();
    fireEvent.click(use);
    expect(hudToasts.get().map((t) => [t.title, t.message, t.hint])).toEqual([["Not enough Hope", "Wall Walk needs 1 Hope. You have 0.", "Roll with Hope, or rest, to gain Hope."]]);
    expect(calls).toEqual([]);
  });

  it("while the GM holds the spotlight Use waits with its reason; a press says why", () => {
    gmHoldsSpotlight();
    queries["combatCardsReads:hand"] = { characterId: MOSS, loadout: [WALL, RUNE], vault: [] };
    queries["charactersReads:get"] = { _id: MOSS, sheet: { hope: 3, experiences: [], level: 1 } };
    renderHand();
    const use = within(fanCard("Wall Walk")).getByRole("button", { name: "Use Wall Walk" });
    expect(use).toHaveAttribute("aria-disabled", "true");
    expect(use).toHaveAccessibleDescription("The GM has the spotlight · reactions only");
    fireEvent.click(use);
    expect(hudToasts.get()[0]).toMatchObject({ title: "The GM has the spotlight", message: "The GM has the spotlight. You can use reactions until it comes back." });
    expect(calls).toEqual([]);
  });

  it("a card that asks nothing, refused at the click: the table's words above the fan (layer 2)", async () => {
    queries["combatCardsReads:hand"] = { characterId: MOSS, loadout: [card("rune-ward", "Rune Ward", { uses: [handUse("Rune Ward", { targets: null })] })], vault: [] };
    queries["charactersReads:get"] = { _id: MOSS, sheet: { hope: 3, experiences: [], level: 1 } };
    mutationResult = async () => {
      throw new ConvexError({ code: "CARD_EXHAUSTED" });
    };
    renderHand();
    await act(async () => fireEvent.click(within(fanCard("Rune Ward")).getByRole("button", { name: "Use Rune Ward" })));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "CARD_EXHAUSTED");
    expect(alert).toHaveTextContent("Rune Ward is used until your next rest.");
  });
});

// ---------------------------------------------------------------- the picking panel and its rings

const state = { campaignId: CAMPAIGN, role: "player", mode: "play", map: { _id: MAP, name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
const layer = { ...state, viewport: { cell: 40, zoom: 1, w: 30, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false } } as unknown as MapLayerProps;

function seedMap() {
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: MOSS,
    tokenId: MOSS_T,
    pcs: [{ _id: MOSS_T, name: "Moss", x: 5, y: 10, size: 1, stats: { conditions: [] } }],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 8, y: 10, size: 1, face: 0, revealed: false },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 7, y: 12, size: 1, face: 0, revealed: false },
      { _id: SNIPER, name: "Sniper", side: "enemy", x: 9, y: 9, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatActionsReads:targets"] = [
    { tokenId: LT, band: "close", inRange: true, lineOfSight: true, cover: false },
    { tokenId: BANDIT, band: "close", inRange: true, lineOfSight: true, cover: false },
    { tokenId: SNIPER, band: "close", inRange: true, lineOfSight: true, cover: false },
  ];
}

const send = vi.fn<PickSessionSpec["primary"]["send"]>();
const spec = (over: Partial<PickSessionSpec> = {}): PickSessionSpec => ({
  id: "card:entangle",
  source: { kind: "card", name: "Vicious Entangle", cardId: "vicious-entangle" },
  rule: { side: "enemy", max: 1, range: "far" },
  picked: [LT],
  primary: { label: (s) => (s.targets[0] ? `Cast on ${s.targets[0].name}` : "Cast"), send },
  ...over,
});

function Opener({ s }: { s: PickSessionSpec }) {
  const pick = usePick();
  return (
    <button type="button" onClick={() => pick.open(s)}>
      Open
    </button>
  );
}

function renderPick(s: PickSessionSpec) {
  render(
    <HudProvider>
      <PickProvider>
        <Opener s={s} />
        <div className="hud-map">
          <HudPickLayer {...layer} />
        </div>
        <HudPick state={state} />
      </PickProvider>
    </HudProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}
const panel = () => screen.getByTestId("hud-pick");
const ring = (id: string) => screen.getAllByTestId("hud-pick-ring").find((r) => r.dataset.token === id)!;
const go = () => within(panel()).getByTestId("hud-pick-go");

describe("the picking panel (CmpBlocked layers 1 and 2)", () => {
  it("the spotlight rule: a new action waits; a reaction, a follow-up and the GM's adversary never do", () => {
    expect(spotlightBlocks(true, { source: { kind: "card" } })).toBe(true);
    expect(spotlightBlocks(true, { source: { kind: "card" }, followUp: true })).toBe(false);
    expect(spotlightBlocks(true, { source: { kind: "reaction" } })).toBe(false);
    expect(spotlightBlocks(true, { source: { kind: "adversary" } })).toBe(false);
    expect(spotlightBlocks(false, { source: { kind: "attack" } })).toBe(false);
  });

  it("while the GM holds the spotlight the primary waits with the reason; a follow-up session sends", async () => {
    seedMap();
    gmHoldsSpotlight();
    renderPick(spec());
    expect(go()).toBeDisabled();
    expect(within(panel()).getByTestId("hud-pick-why")).toHaveTextContent("The GM has the spotlight · reactions only");
  });

  it("a follow-up (a chain link, an after-the-roll ask) is never held back", async () => {
    seedMap();
    gmHoldsSpotlight();
    send.mockResolvedValueOnce({ kind: "done" });
    renderPick(spec({ followUp: true }));
    expect(go()).toBeEnabled();
    await act(async () => fireEvent.click(go()));
    expect(send).toHaveBeenCalled();
  });

  it("picker counter: '1 of 2', then full with the limit; the other rows can't be added", () => {
    seedMap();
    expect(pickCount(1, { max: 2 })).toEqual({ text: "1 of 2", full: false });
    expect(pickCount(1, { max: 1 })).toBeNull();
    expect(pickCount(1, { max: null })).toBeNull();
    renderPick(spec({ rule: { side: "enemy", max: 2, range: "far" }, picked: [LT, BANDIT] }));
    const count = within(panel()).getByTestId("hud-pick-count");
    expect(count).toHaveTextContent("2 of 2");
    expect(count).toHaveTextContent("Pick up to 2 targets.");
    const sniper = within(panel()).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === SNIPER)!;
    expect(sniper).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sniper);
    expect(sniper).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["COMBAT_NO_LINE_OF_SIGHT", "dotted", "You can’t see Lieutenant from where you stand."],
    ["COMBAT_TARGET_INVALID", "dimmed", "Lieutenant can’t be attacked right now."],
    ["COMBAT_OUT_OF_REACH", "hint", "Move next to Lieutenant first."],
  ])("a %s refusal stays under the primary and marks the target's ring (%s)", async (code, form, text) => {
    seedMap();
    send.mockRejectedValueOnce(new ConvexError({ code }));
    renderPick(spec());
    await act(async () => fireEvent.click(go()));
    const alert = within(panel()).getByRole("alert");
    expect(alert).toHaveAttribute("data-code", code);
    expect(alert).toHaveTextContent(text);
    expect(ring(LT)).toHaveAttribute("data-refused", form);
    if (form === "hint") expect(ring(LT)).toHaveTextContent("Move next to Lieutenant first.");
  });

  it("a refusal the table places in a toast (no live map) goes there, not under the primary", async () => {
    seedMap();
    send.mockRejectedValueOnce(new ConvexError({ code: "FEATURE_NEEDS_MAP" }));
    renderPick(spec());
    await act(async () => fireEvent.click(go()));
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(hudToasts.get().map((t) => t.title)).toEqual(["No live map"]);
  });

  it("the refusal's names: the source, the first pick, the maximum only past it; the ring form of each", () => {
    const s = { source: { kind: "card" as const, name: "Vicious Entangle" }, rule: { side: "enemy" as const, max: 1, range: "far" } };
    const t = (name: string) => ({ tokenId: tok(name), name, side: "enemy" as const, band: null, reach: "in" as const, conditions: [] });
    expect(refusalContext(s, { targets: [t("Bandit")] })).toEqual({ subject: "Vicious Entangle", target: "Bandit" });
    expect(refusalContext(s, { targets: [t("Bandit"), t("Sniper")] })).toEqual({ subject: "Vicious Entangle", target: "Bandit", max: 1 });
    expect(refusedRing({ refusal: refusalForCode("COMBAT_NO_LINE_OF_SIGHT"), tokenId: LT })).toMatchObject({ form: "dotted" });
    expect(refusedRing({ refusal: refusalForCode("CARD_EXHAUSTED"), tokenId: LT })).toBeNull();
    expect(refusedRing({ refusal: refusalForCode("COMBAT_TARGET_INVALID"), tokenId: null })).toBeNull();
  });
});

// ---------------------------------------------------------------- the sheet's features

function feature(name: string, over: Partial<HudSheetFeature> = {}): HudSheetFeature {
  return { featureId: `f:${name}`, name, text: `${name} text`, source: "class", kind: "action", cost: null, limit: null, used: false, resetLabel: null, usesLeft: null, tokens: 0, automated: true, uses: null, ...over };
}
const use = (over: Record<string, unknown> = {}) => ({ useId: "main", name: "Use", activation: "action" as const, ready: true, resetLabel: null, usesLeft: null, rolls: false, targets: null, choices: [], costs: [], limit: null, repeatable: false, situations: [], ...over });

function sheet(features: HudSheetFeature[], hope: number): HudSheetData {
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
    trackers: { hp: { marked: 0, max: 6 }, stress: { marked: 6, max: 6 }, hope: { value: hope, max: 6 }, armor: { marked: 0, max: 3 } },
    features,
    conditions: [],
    effects: [],
  } as HudSheetData;
}

function SheetOpener() {
  const hud = useHud();
  return (
    <button type="button" onClick={() => hud.toggleSheet({ kind: "pc", characterId: MOSS })}>
      Open it
    </button>
  );
}

function renderSheet() {
  render(
    <HudProvider>
      <PickProvider>
        <SheetOpener />
        <HudSheet state={state} />
      </PickProvider>
    </HudProvider>,
  );
  act(() => screen.getByRole("button", { name: "Open it" }).click());
}

describe("the sheet's features (CmpBlocked 'feature disabled', 'sheet badge'; Main 'Can't afford')", () => {
  const EVOLUTION = feature("Evolution", { featureId: "hope:druid", cost: "3 Hope", uses: [use({ name: "Evolution" })] });
  const BEASTFORM = feature("Beastform", { featureId: "class:druid:beastform", cost: "1 Stress", uses: [use({ name: "Beastform" })] });
  const RALLY = feature("Rally", { used: true, resetLabel: "Back after a long rest", uses: [use({ name: "Rally", ready: false, resetLabel: "Back after a long rest" })] });
  const WARD = feature("Ward", { kind: "reaction", uses: [use({ name: "Ward", activation: "reaction" })] });

  it("a Hope cost it can't pay: Use disabled with the reason beside the feature; a press shows the refusal under it", () => {
    queries["combatHud:sheet"] = sheet([EVOLUTION, BEASTFORM, RALLY], 0);
    renderSheet();
    const evolution = screen.getByRole("button", { name: "Use Evolution" });
    expect(evolution).toHaveAttribute("aria-disabled", "true");
    expect(evolution).toHaveAccessibleDescription("Needs 3 Hope · you have 0");
    fireEvent.click(evolution);
    const row = evolution.closest("li")!;
    expect(within(row).getByRole("alert")).toHaveAttribute("data-code", "FEATURE_COST_UNPAID");
    expect(within(row).getByRole("alert")).toHaveTextContent("Evolution needs 3 Hope. You have 0.");
    // Stress past full marks a Hit Point (CB p.106): Beastform is never locked on Stress.
    expect(screen.getByRole("button", { name: "Use Beastform" })).not.toHaveAttribute("aria-disabled");
    // A spent use: the sheet badge says when it comes back.
    expect(screen.getByTestId("hud-sheet-used")).toHaveTextContent("Used · back after a long rest");
    expect(screen.queryByRole("button", { name: "Use Rally" })).toBeNull();
  });

  it("while the GM holds the spotlight every action Use waits; React stays", () => {
    gmHoldsSpotlight();
    queries["combatHud:sheet"] = sheet([BEASTFORM, WARD], 3);
    renderSheet();
    const beastform = screen.getByRole("button", { name: "Use Beastform" });
    expect(beastform).toHaveAttribute("aria-disabled", "true");
    expect(beastform).toHaveAccessibleDescription("The GM has the spotlight · reactions only");
    expect(screen.getByRole("button", { name: "React with Ward" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "React with Ward" })).toBeEnabled();
  });
});
