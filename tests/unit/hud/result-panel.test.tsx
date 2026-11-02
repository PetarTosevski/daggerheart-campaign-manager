/**
 * The HUD's result panel (plan combat-hud H4.1; boards Main 'Card result', CmpPromptsPlayer 'Your roll waits',
 * CmpPicking 'After the roll'): the pure model (outcome tag, dice parts, damage formula and type, gains, the card and
 * attack views, the held roll's lines, splits, ally picks) and the panel in the HUD (a card's result with its target
 * rows and condition names, Done on a manual step, ✕; hidden while a pick session is open; "Your roll waits" from the
 * server's open request with Use / Pass; a damage-phase rider's ask under the result and on its own; "After the roll"
 * with split steppers, "n left", each ally's pick "n of m chose", Cancel). U1: no adversary number ever shows. Convex is
 * mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RollRecord } from "@/lib/domain/duality";
import { PickProvider, usePick } from "@/components/combat-map/hud/pick";
import { askAfterRoll, HudResult, hudResults, showAttackOutcome, showCardResult } from "@/components/combat-map/hud/result";
import {
  asksPrimary,
  asksProblem,
  attackResultView,
  cardResultView,
  choseCount,
  damageFormula,
  dualityParts,
  gainsOf,
  groupAsks,
  heldPrimary,
  heldSub,
  outcomeTag,
  splitLeft,
  weaponDamageType,
  withAnswers,
  type ChooseAsk,
  type SplitAsk,
} from "@/components/combat-map/hud/result/model";
import { HudProvider } from "@/components/combat-map/hud/state";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      const r = results[name];
      if (r instanceof Error) throw r;
      return r;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
  hudResults.reset();
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "map1" as Id<"combatMaps">;
const CHARACTER = "mossc" as Id<"characters">;
const tok = (s: string) => s as Id<"combatTokens">;
const MOSS = tok("moss");
const BRANNOC = tok("brannoc");
const ORIEL = tok("oriel");
const VEX = tok("vex");
const LT = tok("lt");
const BANDIT = tok("bandit");

const playerState = { campaignId: CAMPAIGN, role: "player", mode: "play", map: { _id: MAP, name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
const gmState = { ...playerState, role: "gm" } as unknown as CombatPageState;

const ROLL: RollRecord = {
  kind: "action",
  dice: [
    { sides: 12, value: 9, role: "hope" },
    { sides: 12, value: 4, role: "fear" },
  ],
  modifier: 2,
  total: 15,
  outcome: "successHope",
  manual: false,
};
const DAMAGE: RollRecord = { kind: "damage", dice: [{ sides: 8, value: 6, role: "damage" }], modifier: 1, total: 7, outcome: "none", manual: false };
const NAMES = new Map<string, string>([
  [LT, "Lieutenant"],
  [BANDIT, "Bandit"],
  [BRANNOC, "Brannoc"],
  [ORIEL, "Oriel"],
  [VEX, "Vex"],
]);

function seedView() {
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: CHARACTER,
    tokenId: MOSS,
    pcs: [{ _id: MOSS, name: "Moss", x: 5, y: 10, size: 1, stats: { conditions: [] } }],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 14, y: 10, size: 1, face: 0, revealed: false, conditions: [{ id: "restrained", label: "Restrained" }] },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 6, y: 10, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatRequests:mine"] = [];
}

const cardResolved = (over: Record<string, unknown> = {}) => ({
  status: "resolved" as const,
  entryId: "e1",
  cardId: "vicious-entangle",
  useId: "main",
  roll: ROLL,
  damage: [DAMAGE],
  success: true,
  targets: [
    { tokenId: LT, hit: true, defeated: false },
    { tokenId: BANDIT, hit: false, defeated: false },
  ],
  fearDelta: 0,
  prompts: [] as { kind: "manual" | "move" | "pcSave" | "pcDamage" | "fold"; text: string; tokenIds: string[] }[],
  minionOffer: null,
  ...over,
});

/** Opens and cancels a pick session the way a picker does (from clicks). */
function PickHandle() {
  const pick = usePick();
  return (
    <>
      <button
        type="button"
        onClick={() => pick.open({ id: "card:x", source: { kind: "card", name: "X" }, rule: { side: "enemy", max: 1, range: "far" }, primary: { label: () => "Go", send: async () => ({ kind: "done" }) } })}
      >
        Open a pick
      </button>
      <button type="button" onClick={() => pick.cancel()}>
        Cancel the pick
      </button>
    </>
  );
}

function renderHud(state: CombatPageState = playerState) {
  return render(
    <HudProvider>
      <PickProvider>
        <PickHandle />
        <div className="hud-map" />
        <HudResult state={state} />
      </PickProvider>
    </HudProvider>,
  );
}

describe("the result panel's model", () => {
  it("names the outcome: success / failure with Hope or Fear, a critical, a mixed attack, no roll", () => {
    expect(outcomeTag(ROLL, true)).toEqual({ text: "Success with Hope", tone: "hope" });
    expect(outcomeTag({ ...ROLL, outcome: "failFear" }, false)).toEqual({ text: "Failure with Fear", tone: "fear" });
    expect(outcomeTag({ ...ROLL, outcome: "critical" }, true).text).toBe("Critical success");
    expect(outcomeTag(ROLL, null).text).toBe("With Hope");
    expect(outcomeTag(null, null).text).toBe("Used");
  });

  it("splits the duality line: Hope, Fear, the rest signed, the total; damage as 1d8+1; gains", () => {
    expect(dualityParts(ROLL)).toEqual({ hope: 9, fear: 4, rest: 2, total: 15 });
    expect(dualityParts(DAMAGE)).toBeNull();
    expect(damageFormula(DAMAGE)).toBe("1d8+1");
    expect(damageFormula({ ...DAMAGE, dice: [...DAMAGE.dice, { sides: 8, value: 2, role: "damage" }, { sides: 6, value: 3, role: "damage", dropped: true }], total: 9 })).toBe("2d8+1");
    // A critical starts from the dice's maximum (CB p.98): named after the formula.
    expect(damageFormula({ ...DAMAGE, dice: [{ sides: 8, value: 3, role: "damage" }], total: 12 }, true)).toBe("1d8+1 +8 critical");
    expect(gainsOf(ROLL, 0)).toEqual([{ text: "+1 Hope", tone: "hope" }]);
    expect(gainsOf({ ...ROLL, outcome: "successFear" }, 1)).toEqual([{ text: "GM +1 Fear", tone: "fear" }]);
    expect(gainsOf({ ...ROLL, outcome: "critical" }, 0).map((g) => g.text)).toEqual(["+1 Hope", "Clear a Stress"]);
    expect(weaponDamageType("d8+1 mag")).toBe("magic");
    expect(weaponDamageType("1d6 phy")).toBe("physical");
  });

  it("builds a card's view (the card's roll word and damage type) and an attack's (success only when all hit)", () => {
    const card = cardResultView({ characterId: CHARACTER, actorName: "Moss", cardName: "Vicious Entangle", result: cardResolved(), names: NAMES });
    expect(card).toMatchObject({ title: "Vicious Entangle", sub: "Moss · Spellcast Roll", cardId: "vicious-entangle", success: true, damage: [{ formula: "1d8+1", total: 7, type: "physical" }] });
    expect(card.targets.map((t) => `${t.name}:${t.verdict}`)).toEqual(["Lieutenant:Hit", "Bandit:Miss"]);
    const base = { entryId: "e2", roll: ROLL, damage: DAMAGE, fearGained: 1, minionOffer: null };
    const mixed = attackResultView({ characterId: CHARACTER, actorName: "Moss", weaponName: "Shortstaff", damageType: "magic", names: NAMES, result: { ...base, targets: [{ tokenId: LT, hit: true, defeated: false }, { tokenId: BANDIT, hit: false, defeated: false }], riders: ["Marked for Death"] } });
    expect(mixed).toMatchObject({ title: "Shortstaff", sub: "Moss · Attack Roll", success: null, fear: 1, notes: ["With Marked for Death"] });
    expect(attackResultView({ characterId: CHARACTER, actorName: "Moss", weaponName: "Shortstaff", damageType: null, names: NAMES, result: { ...base, targets: [{ tokenId: LT, hit: true, defeated: true }] } }).targets[0]!.verdict).toBe("Defeated");
  });

  it("the held roll's lines; splits with and without a total; ally picks grouped by step; answers merged", () => {
    expect(heldSub("Brannoc", ROLL)).toBe("Brannoc · 15 with Hope · before damage");
    expect(heldPrimary([{ hit: true }])).toBe("Use and roll damage");
    expect(heldPrimary([{ hit: false }])).toBe("Use");
    const split = { kind: "split", label: "Distribute the damage", tokenIds: [LT, BANDIT], amount: 14 } as SplitAsk;
    expect(splitLeft(split, { [LT]: 9 })).toBe(5);
    expect(splitLeft({ kind: "split", label: "Divide the Hope", tokenIds: [LT] }, {})).toBeNull();
    expect(asksPrimary([split])).toBe("Deal the damage");
    expect(asksProblem([split], {}, { [LT]: 9 }, () => "split")).toBe("5 left to share");
    expect(asksProblem([split], {}, { [LT]: 9, [BANDIT]: 5 }, () => "split")).toBeNull();
    const ally = (chooserId: Id<"combatTokens">): ChooseAsk => ({ kind: "choose", stepId: "rally", label: "Rousing Strike", options: [{ id: "hp", label: "Clear a Hit Point" }], chooserId });
    const groups = groupAsks([split, ally(BRANNOC), ally(ORIEL), { kind: "choose", stepId: "x", label: "Pick", options: [] }]);
    expect(groups.map((g) => g.kind)).toEqual(["split", "allies", "choose"]);
    expect(choseCount([ally(BRANNOC), ally(ORIEL)], { [`rally:${BRANNOC}`]: ["hp"] }, (a) => `${a.stepId}:${a.chooserId}`)).toEqual({ chose: 1, of: 2 });
    expect(withAnswers({ choices: [{ id: "a", value: 1 }, { id: "b", value: 2 }] }, [{ id: "b", value: 3 }]).choices).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 3 },
    ]);
  });
});

describe("the result panel in the HUD", () => {
  it("a card's result: art, name, 'Moss · Spellcast Roll', the tag, dice, +1 Hope, rows with damage and conditions; Done; ✕", () => {
    seedView();
    renderHud();
    expect(screen.queryByTestId("hud-result")).toBeNull();
    act(() =>
      showCardResult({
        characterId: CHARACTER,
        actorName: "Moss",
        cardName: "Vicious Entangle",
        result: cardResolved({ prompts: [{ kind: "manual", text: "Restrain the Bandit if it is within Very Close", tokenIds: [] }] }),
        names: NAMES,
      }),
    );
    const panel = screen.getByTestId("hud-result");
    expect(panel).toHaveAccessibleName("Vicious Entangle");
    expect(panel).toHaveTextContent("Moss · Spellcast Roll");
    expect(within(panel).getByTestId("hud-result-tag")).toHaveTextContent("Success with Hope");
    expect(within(panel).getByRole("img", { name: "Hope die 9" })).toBeTruthy();
    expect(within(panel).getByRole("img", { name: "Fear die 4" })).toBeTruthy();
    expect(within(panel).getByTestId("hud-result-total")).toHaveTextContent("15");
    expect(within(panel).getByTestId("hud-result-dice")).toHaveTextContent("+1 Hope");
    const rows = within(panel).getAllByTestId("hud-result-row");
    expect(rows[0]).toHaveTextContent("LieutenantHit1d8+1 → 7 physicalRestrained");
    expect(rows[1]).toHaveTextContent("BanditMiss");
    expect(rows[1]).not.toHaveTextContent("→");
    expect(panel.textContent).not.toMatch(/HP|Difficulty|threshold|Major|Severe/);

    fireEvent.click(within(panel).getByRole("button", { name: /^Done: Restrain the Bandit/ }));
    expect(within(panel).queryByTestId("hud-result-prompt")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Close the result of Vicious Entangle" }));
    expect(screen.queryByTestId("hud-result")).toBeNull();
  });

  it("an attack's result from the attack picker; nothing while a picking session is open", () => {
    seedView();
    renderHud();
    act(() =>
      showAttackOutcome({
        characterId: CHARACTER,
        actorName: "Moss",
        weapon: { name: "Shortstaff", damage: "d8+1 mag" },
        names: NAMES,
        out: { status: "resolved", entryId: "e1" as Id<"actionLog">, roll: ROLL, damage: DAMAGE, targets: [{ tokenId: LT, hit: true, defeated: true }], fearGained: 0, minionOffer: null, prompts: [] },
      }),
    );
    expect(screen.getByTestId("hud-result-row")).toHaveTextContent("LieutenantDefeated1d8+1 → 7 magic");
    fireEvent.click(screen.getByRole("button", { name: "Open a pick" }));
    expect(screen.queryByTestId("hud-result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the pick" }));
    expect(screen.getByTestId("hud-result")).toBeTruthy();
  });

  it("'Your roll waits': the held roll from the server; Use and roll damage sends the feature, then the result shows", async () => {
    seedView();
    queries["combatRequests:mine"] = [
      {
        kind: "afterRoll",
        requestId: "held1",
        characterId: CHARACTER,
        characterName: "Moss",
        createdAt: 1,
        roll: ROLL,
        targets: [{ tokenId: LT, name: "Lieutenant", hit: true }],
        options: [
          { featureId: "no-mercy", useId: "main", name: "No Mercy", costs: ["3 Hope"] },
          { featureId: "combat-training", useId: "main", name: "Combat Training", costs: [] },
        ],
      },
    ];
    results["combatActions:afterRoll"] = { status: "resolved", entryId: "e9", roll: ROLL, damage: DAMAGE, targets: [{ tokenId: LT, hit: true, defeated: false }], fearGained: 0, minionOffer: null, prompts: [] };
    hudResults.noteHeld("held1", { weaponName: "Shortstaff", damageType: "magic", actorName: "Moss" });
    renderHud();
    const held = screen.getByTestId("hud-result-held");
    const dialog = within(held).getByRole("dialog", { name: "Your roll waits" });
    expect(dialog).toHaveTextContent("Moss · 15 with Hope · before damage");
    expect(within(dialog).getByTestId("hud-result-row")).toHaveTextContent("LieutenantHit");
    expect(within(dialog).getByRole("radio", { name: /No Mercy/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Combat Training/ }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use and roll damage" })));
    expect(calls[0]).toMatchObject({ name: "combatActions:afterRoll", args: { campaignId: CAMPAIGN, requestId: "held1", choice: { kind: "use", featureId: "combat-training", useId: "main", choices: [] } } });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    // The attack's result is next, named by the weapon the picker noted (the server drops the request).
    expect(hudResults.get()).toMatchObject({ kind: "result", view: { title: "Shortstaff", sub: "Moss · Attack Roll" } });
  });

  it("Pass on a held roll; the GM sees no held roll here (the queue answers it)", async () => {
    seedView();
    queries["combatRequests:mine"] = [{ kind: "afterRoll", requestId: "held1", characterId: CHARACTER, characterName: "Moss", createdAt: 1, roll: ROLL, targets: [{ tokenId: LT, name: "Lieutenant", hit: false }], options: [] }];
    results["combatActions:afterRoll"] = { status: "declined" };
    const view = renderHud();
    const dialog = screen.getByRole("dialog", { name: "Your roll waits" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Pass" })));
    expect(calls[0]!.args.choice).toEqual({ kind: "pass" });
    view.unmount();
    renderHud(gmState);
    expect(screen.queryByTestId("hud-result-held")).toBeNull();
  });

  it("a damage-phase rider: under the result as 'Not now' / the rider; on its own as 'After your hit'", async () => {
    seedView();
    queries["combatRequests:mine"] = [
      { kind: "riderPick", requestId: "rp1", characterId: CHARACTER, characterName: "Moss", createdAt: 1, name: "Death Strike", costs: ["1 Stress"], candidates: [{ tokenId: LT, name: "Lieutenant" }, { tokenId: BANDIT, name: "Bandit" }] },
    ];
    results["combatActions:riderPick"] = { status: "resolved" };
    renderHud();
    const alone = screen.getByTestId("hud-result-riders");
    expect(within(alone).getByRole("dialog", { name: "After your hit" })).toBeTruthy();
    const ask = within(alone).getByTestId("hud-result-rider");
    const use = within(ask).getByRole("button", { name: "Death Strike · 1 Stress" });
    expect(use).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Bandit" }));
    await act(async () => fireEvent.click(use));
    expect(calls[0]).toMatchObject({ name: "combatActions:riderPick", args: { requestId: "rp1", choice: { kind: "use", tokenId: BANDIT } } });

    act(() => showCardResult({ characterId: CHARACTER, actorName: "Moss", cardName: "Vicious Entangle", result: cardResolved(), names: NAMES }));
    expect(within(screen.getByTestId("hud-result")).getByTestId("hud-result-rider")).toBeTruthy();
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-result-rider")).getByRole("button", { name: "Not now" })));
    expect(calls[1]!.args.choice).toEqual({ kind: "pass" });
  });

  it("'After the roll': split steppers with 'n left' and Deal the damage; each ally's pick 'n of m chose'; the answers go back", async () => {
    seedView();
    renderHud();
    const answer = vi.fn(async () => {});
    const cancel = vi.fn();
    act(() =>
      askAfterRoll({
        characterId: CHARACTER,
        title: "Rousing Strike",
        cardId: null,
        names: NAMES,
        asks: [
          { kind: "split", label: "Distribute the damage", tokenIds: [LT, BANDIT], amount: 3 } as SplitAsk,
          { kind: "choose", stepId: "rally", label: "Rousing Strike", options: [{ id: "hp", label: "Clear a Hit Point" }, { id: "stress", label: "Clear 1d4 Stress" }], chooserId: BRANNOC },
          { kind: "choose", stepId: "rally", label: "Rousing Strike", options: [{ id: "hp", label: "Clear a Hit Point" }, { id: "stress", label: "Clear 1d4 Stress" }], chooserId: ORIEL },
        ],
        answer,
        cancel,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Rousing Strike" });
    expect(dialog).toHaveTextContent("After the roll");
    const split = within(dialog).getByTestId("hud-result-split");
    expect(split).toHaveTextContent("Split 3 damage between your targets");
    expect(within(split).getByTestId("hud-result-left")).toHaveTextContent("3 left");
    expect(split.textContent).not.toMatch(/Major|Minor|Severe/);
    const go = within(dialog).getByRole("button", { name: "Deal the damage" });
    expect(go).toBeDisabled();
    fireEvent.click(within(split).getByRole("button", { name: "More Distribute the damage: Lieutenant" }));
    fireEvent.click(within(split).getByRole("button", { name: "More Distribute the damage: Lieutenant" }));
    fireEvent.click(within(split).getByRole("button", { name: "More Distribute the damage: Bandit" }));
    expect(within(split).getByTestId("hud-result-left")).toHaveTextContent("0 left");
    expect(within(split).getByRole("button", { name: "More Distribute the damage: Bandit" })).toBeDisabled();

    const allies = within(dialog).getByTestId("hud-result-allies");
    expect(allies).toHaveTextContent("Rousing Strike · each ally picks their own");
    expect(within(allies).getByTestId("hud-result-chose")).toHaveTextContent("0 of 2 chose");
    fireEvent.click(within(within(allies).getByRole("group", { name: "Brannoc: Rousing Strike" })).getByRole("button", { name: "Clear a Hit Point" }));
    expect(within(allies).getByTestId("hud-result-chose")).toHaveTextContent("1 of 2 chose");
    expect(go).toBeDisabled();
    fireEvent.click(within(within(allies).getByRole("group", { name: "Oriel: Rousing Strike" })).getByRole("button", { name: "Clear 1d4 Stress" }));
    expect(go).toBeEnabled();
    await act(async () => fireEvent.click(go));
    expect(answer).toHaveBeenCalledWith([
      { id: `split:${LT}`, value: 2 },
      { id: `split:${BANDIT}`, value: 1 },
      { id: `by:rally:${BRANNOC}`, value: ["hp"] },
      { id: `by:rally:${ORIEL}`, value: ["stress"] },
    ]);
    expect(screen.queryByRole("dialog", { name: "Rousing Strike" })).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("'After the roll': a refusal stays under the primary; Cancel drops the use's wait", async () => {
    seedView();
    renderHud();
    const cancel = vi.fn();
    act(() =>
      askAfterRoll({
        characterId: CHARACTER,
        title: "Stone of Omens",
        cardId: null,
        names: NAMES,
        asks: [{ kind: "choose", stepId: "pick", label: "Pick one", options: [{ id: "a", label: "First" }] }],
        answer: async () => {
          throw new Error("Short of: 1 Hope");
        },
        cancel,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Stone of Omens" });
    fireEvent.click(within(dialog).getByRole("button", { name: "First" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" })));
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Stone of Omens" })).toBeNull();
  });
});
