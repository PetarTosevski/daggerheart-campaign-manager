/**
 * Playing a card through the picking panel (plan combat-hud H3.1; docs/tasks/TASK-HUD-H3.1.md; boards CmpPicking 'One
 * target · a card', Main 'Picking a target'): the pure part (rider switches with "If it hits", cost pills, the footer
 * line, the primary naming the action, blocked reasons, the `combatCards.useCard` request with the classic dialog's
 * choices, vault swap dcm-p1r and the trigger's damage type) and the HUD hand with Convex mocked: Use raises the card and
 * opens the panel, the rider's own pick, Cast sends once, pending / refusal / Esc, a grimoire's spell rows, the vault
 * swap row, a card that asks nothing fires at once. Wiring after H3.3: an area card's square goes through the HUD's
 * square picking (`hud/pick-area`, the open pick session ended first), and a chain link (Chain Lightning) is a pick
 * session of its own with H3.3's chain rows.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CardUse } from "@/lib/domain/card-effects/types";
import { cardEffect } from "@/lib/srd/card-effects";
import { formFor, type HandCard } from "@/components/combat-map/actions/hand/model";
import { NO_ROLL_OPTIONS } from "@/components/combat-map/actions/roll-controls";
import { HudHandBody, type HudHandBodyProps } from "@/components/combat-map/hud/hand/body";
import { PickProvider } from "@/components/combat-map/hud/pick";
import { PickPanel } from "@/components/combat-map/hud/pick/panel";
import { blockedOf, cardAreaAsk, cardAreaLine, payLine, primaryLabel, requestOf, riderOptions, ridersOf, ruleOf, selfRows, startData } from "@/components/combat-map/hud/pick-card";
import { confirmAreaPick, placeSquare, resetAreaPickForTests, useAreaPickState } from "@/components/combat-map/hud/pick-area/store";
import { areaPickOf } from "@/components/combat-map/actions/hand/model";
import { HudProvider } from "@/components/combat-map/hud/state";
import { hudResults } from "@/components/combat-map/hud/result";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
let cardResult: () => Promise<unknown> = async () => ({ status: "pending", requestId: "r1", outOfRange: [] });
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === "combatCards:useCard" ? cardResult() : null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  calls.length = 0;
  cardResult = async () => ({ status: "pending", requestId: "r1", outOfRange: [] });
  window.localStorage.clear();
  resetAreaPickForTests();
  hudResults.reset();
});

const tok = (s: string) => s as Id<"combatTokens">;
const MOSS = tok("moss");
const LT = tok("lt");
const BANDIT = tok("bandit");
const BRANNOC = tok("brannoc");
const effectUse = (cardId: string, useId: string): CardUse => cardEffect(cardId)!.uses.find((u) => u.id === useId)!;
const ENTANGLE = effectUse("vicious-entangle", "main");

// ---------------------------------------------------------------- the pure part

describe("the card's rule, riders, footer and request", () => {
  it("riders: 'If it hits, also …' with the Hope pill, the rider's own pick ringed under its token", () => {
    const riders = ridersOf(ENTANGLE);
    expect(riders).toHaveLength(1);
    expect(riders[0]).toMatchObject({ id: "second", label: "If it hits, also Restrain another adversary within Very Close range of your target", cost: { amount: 1, resource: "hope" }, picks: "Restrain", gated: true });
    const data = startData(ENTANGLE);
    expect(riderOptions(riders, data)[0]).not.toHaveProperty("tokenId");
    const withPick = { ...data, values: { ...data.values, recipients: { picked: [BANDIT] } } };
    expect(riderOptions(riders, withPick)[0]).toMatchObject({ tokenId: BANDIT, ringLabel: "Restrain" });
  });

  it("the footer says what you'll pay: nothing, the rider 'if it hits', your last Hope, an up-front cost", () => {
    const riders = ridersOf(ENTANGLE);
    expect(payLine(ENTANGLE, riders, { options: {} }, 1)).toBeNull();
    expect(payLine(ENTANGLE, riders, { options: { second: true } }, 1)).toBe("Spends your last Hope if it hits");
    expect(payLine(ENTANGLE, riders, { options: { second: true } }, 3)).toBe("Spends 1 Hope if it hits");
    const tava = effectUse("book-of-ava", "tavas-armor");
    expect(payLine(tava, [], { options: {} }, 1)).toBe("Spends your last Hope");
    expect(payLine(tava, [], { options: {} }, 2)).toBe("Spends 1 Hope");
    expect(payLine(effectUse("unleash-chaos", "replenish"), [], { options: {} }, 2)).toBe("Marks 1 Stress");
  });

  it("the primary names the action: Cast on <target>, on two, on n, the use's name, Place <area>", () => {
    const form = formFor(ENTANGLE);
    const row = (name: string, side: "enemy" | "self" = "enemy") => ({ tokenId: tok(name), name, side, band: null, reach: "in" as const, conditions: [] });
    expect(primaryLabel({ type: "spell" }, ENTANGLE, form, { targets: [row("Lieutenant")] })).toBe("Cast on Lieutenant");
    expect(primaryLabel({ type: "spell" }, ENTANGLE, form, { targets: [] })).toBe("Cast Vicious Entangle");
    expect(primaryLabel({ type: "ability" }, ENTANGLE, form, { targets: [row("A"), row("B")] })).toBe("Use on A and B");
    expect(primaryLabel({ type: "spell" }, ENTANGLE, form, { targets: [row("A"), row("B"), row("C")] })).toBe("Cast on 3 targets");
    const mist = effectUse("book-of-tyfar", "mysterious-mist");
    expect(primaryLabel({ type: "grimoire" }, mist, formFor(mist), { targets: [] })).toBe("Place Mysterious Mist");
  });

  it("a use without a target to pick: a locked rule over your own row ('Affects you'), or the square next", () => {
    const swap = effectUse("codex-touched", "swap");
    expect(ruleOf(swap)).toMatchObject({ locked: true, min: 0, text: "Affects you" });
    expect(selfRows(swap, formFor(swap), MOSS)).toEqual({ rows: [{ tokenId: MOSS, name: "You", side: "self", band: null, reach: "in" }], picked: [MOSS] });
    const mist = effectUse("book-of-tyfar", "mysterious-mist");
    expect(ruleOf(mist).text).toBe("Pick the square on the map next");
    expect(ruleOf(ENTANGLE)).toEqual({ side: "enemy", max: 1, range: "far" });
    expect(selfRows(ENTANGLE, formFor(ENTANGLE), MOSS)).toEqual({});
  });

  it("blocked before the click: up-front Hope, the vault card, the roll options' Hope (never a rider's after-roll Hope)", () => {
    const ctx = { gm: false, roller: { hope: 0, experiences: [{ id: "e1", name: "Forest Guide", value: 2 }] }, rollOptions: NO_ROLL_OPTIONS, vault: [] };
    const tava = effectUse("book-of-ava", "tavas-armor");
    expect(blockedOf(tava, formFor(tava), startData(tava), { targetIds: [MOSS] }, ctx)).toBe("Needs 1 Hope · you have 0");
    expect(blockedOf(ENTANGLE, formFor(ENTANGLE), startData(ENTANGLE), { targetIds: [LT] }, ctx)).toBeNull();
    expect(blockedOf(ENTANGLE, formFor(ENTANGLE), startData(ENTANGLE), { targetIds: [LT] }, { ...ctx, rollOptions: { ...NO_ROLL_OPTIONS, experienceIds: ["e1"] } })).toBe("Not enough Hope for those Experiences.");
    const swap = effectUse("codex-touched", "swap");
    expect(blockedOf(swap, formFor(swap), startData(swap), { targetIds: [] }, ctx)).toBe("No vault card to swap in");
    const vault = [{ cardId: "book-of-ava", name: "Book of Ava", level: 1 }];
    expect(blockedOf(swap, formFor(swap), startData(swap), { targetIds: [] }, { ...ctx, vault })).toBe("Pick a vault card");
    expect(blockedOf(swap, formFor(swap), { ...startData(swap), swapWith: "book-of-ava" }, { targetIds: [] }, { ...ctx, vault })).toBeNull();
  });

  it("the request: the picked rows, the rider as its optional, its pick, the vault card (dcm-p1r), the trigger's damage type", () => {
    const data = { ...startData(ENTANGLE), values: { ...startData(ENTANGLE).values, recipients: { picked: [BANDIT] } } };
    const req = requestOf("vicious-entangle", ENTANGLE, formFor(ENTANGLE), data, { targetIds: [LT], options: { second: true } }, { gm: false, rollOptions: { ...NO_ROLL_OPTIONS, edge: 1 } });
    expect(req).toEqual({
      cardId: "vicious-entangle",
      spell: "main",
      targetTokenIds: [LT],
      choices: [
        { id: "optional:second", value: true },
        { id: "picked", value: [BANDIT] },
      ],
      roll: { advantage: 1 },
    });
    const swap = effectUse("codex-touched", "swap");
    expect(requestOf("codex-touched", swap, formFor(swap), { ...startData(swap), swapWith: "book-of-ava" }, { targetIds: [MOSS], options: {} }, { gm: false, rollOptions: NO_ROLL_OPTIONS })).toMatchObject({ targetTokenIds: [], swapWith: "book-of-ava" });
    const encore = effectUse("encore", "main");
    expect(requestOf("encore", encore, formFor(encore), { ...startData(encore), triggerType: "magic" }, { targetIds: [], options: {} }, { gm: false, rollOptions: NO_ROLL_OPTIONS }).choices).toContainEqual({ id: "triggerDamageType", value: "magic" });
  });
});

// ---------------------------------------------------------------- the hand, rendered with the panel

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "map1" as Id<"combatMaps">;
const CHARACTER = "mossc" as Id<"characters">;
const state = { campaignId: CAMPAIGN, role: "player", mode: "play", map: { _id: MAP, name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;

type HandUseFixture = HandCard["uses"][number];
const handUse = (useId: string, name: string, extra: Partial<HandUseFixture> = {}): HandUseFixture => ({
  useId,
  name,
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: true,
  targets: { side: "enemy", range: "far", count: "one" },
  choices: [],
  ...extra,
});
const card = (cardId: string, name: string, extra: Partial<HandCard> = {}): HandCard => ({
  cardId,
  name,
  domain: "sage",
  level: 1,
  type: "spell",
  recallCost: 1,
  place: "loadout",
  usage: "combat",
  state: "ready",
  resetLabel: null,
  tokens: 0,
  uses: [handUse("main", name)],
  ...extra,
});
const ENTANGLE_CARD = card("vicious-entangle", "Vicious Entangle");
const AVA = card("book-of-ava", "Book of Ava", {
  domain: "codex",
  type: "grimoire",
  uses: [handUse("power-push", "Power Push"), handUse("tavas-armor", "Tava's Armor"), handUse("ice-spike", "Ice Spike")],
});
const CODEX = card("codex-touched", "Codex-Touched", { domain: "codex", type: "ability", uses: [handUse("swap", "Codex-Touched: swap from the vault", { rolls: false, targets: null })] });
const EYE = card("floating-eye", "Floating Eye", { uses: [handUse("main", "Floating Eye", { rolls: false, targets: null })] });

function seed(loadout: HandCard[], { hope = 1, vault = [] as HandCard[] } = {}) {
  queries["combatCards:hand"] = { characterId: CHARACTER, loadout, vault };
  queries["characters:get"] = { _id: CHARACTER, sheet: { hope, experiences: [], level: 1 } };
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: CHARACTER,
    tokenId: MOSS,
    pcs: [
      { _id: MOSS, name: "Moss", x: 5, y: 10, size: 1, characterId: CHARACTER, stats: { conditions: [] } },
      { _id: BRANNOC, name: "Brannoc", x: 6, y: 10, size: 1, stats: { conditions: [] } },
    ],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 14, y: 10, size: 1, face: 0, revealed: false },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 15, y: 10, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatActions:targets"] = [
    { tokenId: LT, band: "far", inRange: true, lineOfSight: true, cover: false },
    { tokenId: BANDIT, band: "far", inRange: true, lineOfSight: true, cover: false },
  ];
}

function renderHand(over: Partial<HudHandBodyProps> = {}) {
  const props: HudHandBodyProps = {
    campaignId: CAMPAIGN,
    mapId: MAP,
    characterId: CHARACTER,
    name: "Moss",
    mode: "own",
    canPlay: true,
    creatures: [
      { tokenId: MOSS, name: "You", side: "self", at: { x: 5, y: 10, size: 1 } },
      { tokenId: BRANNOC, name: "Brannoc", side: "pc", at: { x: 6, y: 10, size: 1 } },
      { tokenId: LT, name: "Lieutenant", side: "enemy", at: { x: 14, y: 10, size: 1 } },
      { tokenId: BANDIT, name: "Bandit", side: "enemy", at: { x: 15, y: 10, size: 1 } },
    ],
    pickedEnemies: [LT],
    ...over,
  };
  return render(
    <HudProvider>
      <PickProvider>
        <div className="hud-map" />
        <HudHandBody {...props} />
        <div>
          <PickPanel state={state} />
        </div>
      </PickProvider>
    </HudProvider>,
  );
}

const fanCard = (name: string) => screen.getAllByTestId("hud-hand-card").find((el) => within(el).queryByRole("heading", { name }))!;
const useButton = (name: string) => within(fanCard(name)).getByRole("button", { name: `Use ${name}` });
const panel = (name: string) => screen.getByRole("dialog", { name });
const go = () => screen.getByTestId("hud-pick-go") as HTMLButtonElement;

describe("Use opens the picking panel (CmpPicking 'One target · a card')", () => {
  it("raises the card, opens the panel with the map's pick, the rider and its own pick, and Cast sends once", async () => {
    seed([ENTANGLE_CARD]);
    renderHand();
    fireEvent.click(useButton("Vicious Entangle"));
    const pk = panel("Vicious Entangle");
    expect(within(fanCard("Vicious Entangle")).getByText("Casting · pick a target")).toBeTruthy();
    expect(fanCard("Vicious Entangle").dataset.wash).toBe("play");
    expect(within(pk).getByTestId("hud-pick-rule").textContent).toBe("Pick 1 target within Far");
    // The card's art through next/image in the header.
    expect(pk.querySelector(".hud-pk-art img")).not.toBeNull();
    expect(go().textContent).toBe("Cast on Lieutenant");
    expect(within(pk).getByTestId("hud-pick-pay").textContent).toBe("");

    // The rider: "If it hits", the Hope pill; on, its own pick shows and the footer names the Hope.
    const rider = within(pk).getByRole("switch", { name: /If it hits, also Restrain/ });
    expect(within(rider).getByRole("img", { name: "1 Hope" })).toBeTruthy();
    expect(within(pk).queryByTestId("hud-card-who-picked")).toBeNull();
    fireEvent.click(rider);
    const who = within(pk).getByTestId("hud-card-who-picked");
    expect(within(who).getByText("Restrain: pick who")).toBeTruthy();
    fireEvent.click(within(who).getByRole("radio", { name: "Bandit" }));
    expect(within(pk).getByTestId("hud-pick-pay").textContent).toBe("Spends your last Hope if it hits");

    await act(async () => {
      fireEvent.click(go());
    });
    expect(calls.map((c) => c.name)).toEqual(["combatCards:useCard"]);
    expect(calls[0]!.args).toMatchObject({
      campaignId: CAMPAIGN,
      characterId: CHARACTER,
      mapId: MAP,
      cardId: "vicious-entangle",
      spell: "main",
      targetTokenIds: [LT],
      choices: [
        { id: "optional:second", value: true },
        { id: "picked", value: [BANDIT] },
      ],
    });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    // Out of range answered pending: the panel ends ("Waiting for the GM" is H3.0's), the card lowers.
    expect(screen.queryByRole("dialog", { name: "Vicious Entangle" })).toBeNull();
    expect(within(fanCard("Vicious Entangle")).queryByText("Casting · pick a target")).toBeNull();
  });

  it("a refusal stays under the primary; Esc cancels and lowers the card", async () => {
    seed([ENTANGLE_CARD]);
    cardResult = async () => {
      throw new ConvexError({ code: "CARD_EXHAUSTED" });
    };
    renderHand();
    fireEvent.click(useButton("Vicious Entangle"));
    await act(async () => {
      fireEvent.click(go());
    });
    expect(screen.getByTestId("hud-pick-error").textContent).not.toBe("");
    expect(panel("Vicious Entangle")).toBeTruthy();
    fireEvent.keyDown(panel("Vicious Entangle"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Vicious Entangle" })).toBeNull();
    expect(within(fanCard("Vicious Entangle")).queryByText("Casting · pick a target")).toBeNull();
  });

  it("a grimoire: its spells as rows; another spell changes the rule and the primary", async () => {
    seed([AVA], { hope: 2 });
    renderHand();
    fireEvent.click(useButton("Book of Ava"));
    const pk = panel("Book of Ava");
    const spells = within(pk).getByTestId("hud-card-spell");
    expect(within(spells).getByRole("radio", { name: "Power Push" }).getAttribute("aria-checked")).toBe("true");
    expect(within(pk).getByTestId("hud-pick-rule").textContent).toBe("Pick 1 target within Melee");
    fireEvent.click(within(spells).getByRole("radio", { name: "Tava's Armor" }));
    expect(within(pk).getByTestId("hud-pick-rule").textContent).toBe("Pick 1 ally or yourself within Melee");
    fireEvent.click(within(pk).getByRole("button", { name: /^Brannoc/ }));
    expect(go().textContent).toBe("Cast on Brannoc");
    expect(within(pk).getByTestId("hud-pick-pay").textContent).toBe("Spends 1 Hope");
    await act(async () => {
      fireEvent.click(go());
    });
    expect(calls[0]!.args).toMatchObject({ cardId: "book-of-ava", spell: "tavas-armor", targetTokenIds: [BRANNOC] });
  });

  it("the vault swap row (dcm-p1r): the vault cards at or under your level; blocked until one is picked", async () => {
    const vaultCard = card("book-of-ava", "Book of Ava", { place: "vault", domain: "codex", type: "grimoire" });
    const tooHigh = card("book-of-vyola", "Book of Vyola", { place: "vault", level: 8 });
    seed([CODEX], { vault: [vaultCard, tooHigh] });
    renderHand();
    fireEvent.click(useButton("Codex-Touched"));
    const pk = panel("Codex-Touched");
    expect(within(pk).getByTestId("hud-pick-rule").textContent).toBe("Affects you");
    expect(go().disabled).toBe(true);
    expect(screen.getByTestId("hud-pick-why").textContent).toBe("Pick a vault card");
    const swap = within(pk).getByTestId("hud-card-swap");
    expect(within(swap).queryByRole("radio", { name: /Book of Vyola/ })).toBeNull();
    fireEvent.click(within(swap).getByRole("radio", { name: /Book of Ava/ }));
    expect(go().disabled).toBe(false);
    expect(go().textContent).toBe("Use Codex-Touched: swap from the vault");
    await act(async () => {
      fireEvent.click(go());
    });
    expect(calls[0]!.args).toMatchObject({ cardId: "codex-touched", spell: "swap", targetTokenIds: [], swapWith: "book-of-ava" });
  });

  it("a card that asks nothing fires at once, without a panel", async () => {
    seed([EYE]);
    renderHand();
    await act(async () => {
      fireEvent.click(useButton("Floating Eye"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.map((c) => c.name)).toEqual(["combatCards:useCard"]);
    expect(calls[0]!.args).toMatchObject({ cardId: "floating-eye", spell: "main", targetTokenIds: [], choices: [] });
  });
});

// ---------------------------------------------------------------- wiring after H3.3: squares and chain links

/** The HUD square picking's store as JSON in the DOM (its spec's data; the functions drop). */
function AreaProbe() {
  const { live, line } = useAreaPickState();
  return <output data-testid="area-probe">{JSON.stringify({ live, line })}</output>;
}
const areaState = () => JSON.parse(screen.getByTestId("area-probe").textContent ?? "{}");

describe("an area card asks for its square through the HUD picker (H3.3)", () => {
  it("the ask: the use's own area (radius, within, blocks sight), a wall's two ends; the bar's line", () => {
    const mist = effectUse("book-of-tyfar", "mysterious-mist");
    expect(cardAreaAsk("Book of Tyfar", areaPickOf(mist)!, mist, { x: 5, y: 10, size: 1 })).toEqual({
      name: "Book of Tyfar",
      label: "Mysterious Mist",
      shape: "circle",
      count: 1,
      radius: "veryClose",
      within: "veryClose",
      blocksSight: true,
      origin: { x: 5, y: 10, size: 1 },
    });
    const veil = effectUse("veil-of-night", "main");
    const wall = cardAreaAsk("Veil of Night", areaPickOf(veil)!, veil, null);
    expect(wall).toMatchObject({ shape: "wall", count: 2, within: "far", blocksSight: true });
    expect(wall.radius).toBeUndefined();
    // No use to read: the hand model's pick alone.
    expect(cardAreaAsk("Veil of Night", areaPickOf(veil)!, undefined, null)).toMatchObject({ shape: "wall", count: 2, within: "far" });
    expect(cardAreaLine("Veil of Night", "Veil of Night", { status: "resolved", roll: { total: 15 }, success: true } as never)).toBe("Rolled 15: Veil of Night is on the map.");
    expect(cardAreaLine("Veil of Night", "Veil of Night", { status: "resolved", roll: { total: 9 }, success: false } as never)).toBe("Rolled 9: Veil of Night failed.");
    expect(cardAreaLine("Veil of Night", "Veil of Night", { status: "needsChoice", asks: [] } as never)).toBeNull();
  });

  it("a wall card that asks nothing: two points on the map, then one use with point and points; the card stays raised meanwhile", async () => {
    seed([card("veil-of-night", "Veil of Night", { domain: "midnight", uses: [handUse("main", "Veil of Night", { targets: null })] })]);
    cardResult = async () => ({ status: "resolved", entryId: "e1", cardId: "veil-of-night", useId: "main", roll: null, damage: [], success: true, targets: [], fearDelta: 0, prompts: [], minionOffer: null });
    renderHand();
    render(<AreaProbe />);
    fireEvent.click(useButton("Veil of Night"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(areaState().live.spec).toMatchObject({ id: `card:${CHARACTER}:veil-of-night:area`, mapId: MAP, name: "Veil of Night", shape: "wall", count: 2, within: "far", origin: { x: 5, y: 10, size: 1 } });
    expect(within(fanCard("Veil of Night")).getByText("Casting · pick a target")).toBeTruthy();
    expect(calls).toEqual([]);

    act(() => {
      placeSquare({ x: 7, y: 8 });
      placeSquare({ x: 7, y: 12 });
    });
    await act(async () => {
      await confirmAreaPick();
    });
    expect(calls.map((c) => c.name)).toEqual(["combatCards:useCard"]);
    expect(calls[0]!.args).toMatchObject({ cardId: "veil-of-night", spell: "main", point: { x: 7, y: 8 }, points: [{ x: 7, y: 12 }] });
    expect(areaState().live).toBeNull();
    expect(areaState().line?.text).toBe("Veil of Night is on the map.");
    expect(within(fanCard("Veil of Night")).queryByText("Casting · pick a target")).toBeNull();
  });

  it("from the panel: the grimoire's point spell ends the pick session first, then picks its centre", async () => {
    seed([card("book-of-tyfar", "Book of Tyfar", { domain: "codex", type: "grimoire", uses: [handUse("wild-flame", "Wild Flame"), handUse("mysterious-mist", "Mysterious Mist", { targets: null })] })]);
    renderHand();
    fireEvent.click(useButton("Book of Tyfar"));
    const pk = panel("Book of Tyfar");
    fireEvent.click(within(within(pk).getByTestId("hud-card-spell")).getByRole("radio", { name: "Mysterious Mist" }));
    await act(async () => {
      fireEvent.click(go());
    });
    expect(screen.queryByRole("dialog", { name: "Book of Tyfar" })).toBeNull();
    expect(calls).toEqual([]);
    render(<AreaProbe />);
    expect(areaState().live.spec).toMatchObject({ id: `card:${CHARACTER}:book-of-tyfar:area`, name: "Mysterious Mist", shape: "circle", count: 1, radius: "veryClose", within: "veryClose", blocksSight: true });
    act(() => placeSquare({ x: 6, y: 10 }));
    await act(async () => {
      await confirmAreaPick();
    });
    expect(calls[0]!.args).toMatchObject({ cardId: "book-of-tyfar", spell: "mysterious-mist", point: { x: 6, y: 10 } });
    expect(calls[0]!.args.points).toBeUndefined();
  });
});

describe("a chain link after the roll is a pick session of its own (H3.3 'Chain links')", () => {
  it("Chain Lightning: the next link's creatures as rows, 'Stop here' / 'Next link', the answer as chain:<link>", async () => {
    seed([card("chain-lightning", "Chain Lightning", { domain: "arcana", level: 5, uses: [handUse("main", "Chain Lightning", { targets: { side: "enemy", range: "close", count: "all" } })] })]);
    let n = 0;
    cardResult = async () => {
      n += 1;
      if (n === 1) return { status: "needsChoice", asks: [{ kind: "followUp", label: "Next link", link: 1, tokenIds: [BANDIT] }] };
      return { status: "resolved", entryId: "e1", cardId: "chain-lightning", useId: "main", roll: null, damage: [], success: true, targets: [], fearDelta: 0, prompts: [], minionOffer: null };
    };
    renderHand();
    fireEvent.click(useButton("Chain Lightning"));
    await act(async () => {
      fireEvent.click(go());
    });
    expect(calls).toHaveLength(1);
    // The chain session: the Bandit as the next link's row, no classic after-the-roll dialog.
    const pk = panel("Chain Lightning");
    expect(within(pk).getByTestId("hud-pick-rule").textContent).toContain("Link 2");
    expect(within(pk).queryByRole("button", { name: /^Lieutenant/ })).toBeNull();
    expect(go().textContent).toBe("Stop here");
    fireEvent.click(within(pk).getByRole("button", { name: /^Bandit/ }));
    expect(go().textContent).toBe("Next link");
    expect(within(fanCard("Chain Lightning")).getByText("Casting · pick a target")).toBeTruthy();
    await act(async () => {
      fireEvent.click(go());
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toMatchObject({ cardId: "chain-lightning", spell: "main", targetTokenIds: calls[0]!.args.targetTokenIds });
    expect(calls[1]!.args.choices).toContainEqual({ id: "chain:1", value: [BANDIT] });
    expect(screen.queryByRole("dialog", { name: "Chain Lightning" })).toBeNull();
    // H4.1: the result goes to the result panel (hud/result).
    expect(hudResults.get()).toMatchObject({ kind: "result", view: { title: "Chain Lightning" } });
  });
});
