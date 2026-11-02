/**
 * The picking panel, the target rings and "Waiting for the GM" (plan combat-hud H3.0; boards CmpPicking 'One target ·
 * a card', Main 'Picking a target', CmpTokens 'Target rings', CmpPromptsPlayer 'Waiting for the GM'): a session opened
 * through `usePick().open`, rows and rings in step, single pick, out of sight not pickable, the GM line for an
 * out-of-range pick, one primary naming the action, riders with cost pills and secondary ring labels, send outcomes
 * (pending closes, a refusal stays under the primary), Esc / ✕ cancel with onCancel and focus, the HUD slot, and
 * Withdraw with its optimistic update. Convex is mocked.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dropWithdrawn, HudPick, HudPickLayer, PickProvider, plainAttackSession, usePick, type PickSessionSpec } from "@/components/combat-map/hud/pick";
import { HudProvider, useHud } from "@/components/combat-map/hud/state";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";
import { errorMessage } from "@/lib/convex-errors";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
const updaters: Record<string, (store: unknown, args: unknown) => void> = {};
let mutationResult: () => Promise<unknown> = async () => ({ status: "withdrawn" });
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return mutationResult();
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: unknown, args: unknown) => void) => {
        updaters[name] = fn;
        return run;
      },
    });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(updaters)) delete updaters[k];
  calls.length = 0;
  mutationResult = async () => ({ status: "withdrawn" });
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "map1" as Id<"combatMaps">;
const CHARACTER = "mossc" as Id<"characters">;
const tok = (s: string) => s as Id<"combatTokens">;
const MOSS = tok("moss");
const LT = tok("lt");
const BANDIT = tok("bandit");
const SNIPER = tok("sniper");
const WALLED = tok("walled");

const state = { campaignId: CAMPAIGN, role: "player", mode: "play", map: { _id: MAP, name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
const layer = { ...state, viewport: { cell: 40, zoom: 1, w: 30, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false } } as unknown as MapLayerProps;

function seed() {
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: CHARACTER,
    tokenId: MOSS,
    pcs: [{ _id: MOSS, name: "Moss", x: 5, y: 10, size: 1, stats: { conditions: [] } }],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 14, y: 10, size: 1, face: 0, revealed: false, conditions: [{ id: "vulnerable", label: "Vulnerable" }] },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 10, y: 12, size: 1, face: 0, revealed: false },
      { _id: SNIPER, name: "Sniper", side: "enemy", x: 24, y: 14, size: 1, face: 0, revealed: false },
      { _id: WALLED, name: "Bandit B", side: "enemy", x: 21, y: 5, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatActions:targets"] = [
    { tokenId: LT, band: "far", inRange: false, lineOfSight: true, cover: false },
    { tokenId: BANDIT, band: "close", inRange: true, lineOfSight: true, cover: false },
    { tokenId: SNIPER, band: "veryFar", inRange: false, lineOfSight: true, cover: false },
    { tokenId: WALLED, band: "veryFar", inRange: false, lineOfSight: false, cover: false },
  ];
}

const send = vi.fn<PickSessionSpec["primary"]["send"]>();
const onCancel = vi.fn();
const card = (over: Partial<PickSessionSpec> = {}): PickSessionSpec => ({
  id: "card:vicious-entangle",
  source: { kind: "card", name: "Vicious Entangle", cardId: "vicious-entangle" },
  rule: { side: "enemy", max: 1, range: "far" },
  picked: [LT],
  options: [{ id: "restrain", label: "If it hits, also Restrain the Bandit", note: "Very Close to the Lieutenant", cost: { amount: 1, resource: "hope" }, defaultOn: true, tokenId: BANDIT, ringLabel: "Restrain" }],
  primary: {
    label: (s) => (s.targets[0] ? `Cast on ${s.targets[0].name}` : "Cast"),
    pay: () => "Spends your last Hope",
    send,
  },
  onCancel,
  ...over,
});

function Slot() {
  const hud = useHud();
  return <output data-testid="slot">{hud.pick ? `${hud.pick.id}|${hud.pick.anchorTokenId}` : "none"}</output>;
}

function Opener({ spec }: { spec: PickSessionSpec }) {
  const pick = usePick();
  return (
    <button type="button" onClick={() => pick.open(spec)}>
      Open
    </button>
  );
}

function renderHud(spec: PickSessionSpec = card()) {
  return render(
    <HudProvider>
      <PickProvider>
        <Opener spec={spec} />
        <Slot />
        <div className="hud-map">
          <HudPickLayer {...layer} />
        </div>
        <HudPick state={state} />
      </PickProvider>
    </HudProvider>,
  );
}

const open = () => {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
};
const panel = () => screen.getByRole("dialog", { name: "Vicious Entangle" });
const row = (name: RegExp) => within(panel()).getByRole("button", { name });
const ring = (id: string) => screen.getAllByTestId("hud-pick-ring").find((r) => r.dataset.token === id)!;

describe("the picking panel", () => {
  it("opens beside the primary target with the header, one row per creature, riders and one primary; focus to its title", async () => {
    seed();
    renderHud();
    expect(screen.queryByTestId("hud-pick")).toBeNull();
    open();
    const p = panel();
    // Focus moves once the panel stands at its measured spot (the next animation frame).
    await waitFor(() => expect(within(p).getByRole("heading", { name: "Vicious Entangle" })).toHaveFocus());
    expect(p).toHaveClass("hud-pk-placed");
    expect(within(p).getByTestId("hud-pick-rule")).toHaveTextContent("Pick 1 target within Far");
    expect(screen.getByTestId("slot")).toHaveTextContent("card:vicious-entangle|lt");
    const rows = within(p).getAllByTestId("hud-pick-row");
    expect(rows.map((r) => [r.dataset.token, r.dataset.state])).toEqual([
      ["bandit", "in"],
      ["lt", "picked"],
      ["sniper", "out"],
      ["walled", "los"],
    ]);
    expect(row(/^Lieutenant, Far, Vulnerable, picked$/)).toHaveAttribute("aria-pressed", "true");
    expect(rows[2]).toHaveTextContent("GM approves");
    expect(rows[3]).toHaveTextContent("Can’t see");
    expect(rows[3]).toHaveAttribute("aria-disabled", "true");
    const rider = within(p).getByRole("switch", { name: /If it hits, also Restrain the Bandit/ });
    expect(rider).toHaveAttribute("aria-checked", "true");
    expect(within(rider).getByRole("img", { name: "1 Hope" })).toBeInTheDocument();
    expect(within(p).getByTestId("hud-pick-pay")).toHaveTextContent("Spends your last Hope");
    expect(within(p).getByTestId("hud-pick-go")).toHaveTextContent("Cast on Lieutenant");
    expect(within(p).getAllByRole("button").filter((b) => b.classList.contains("hud-btn-primary"))).toHaveLength(1);
  });

  it("rows and rings are one selection: a tap on either picks, single pick replaces", () => {
    seed();
    renderHud();
    open();
    expect(ring("lt")).toHaveClass("hud-tg-picked");
    expect(ring("bandit")).toHaveClass("hud-tg-in");
    expect(ring("sniper")).toHaveClass("hud-tg-out");
    expect(within(ring("sniper")).getByText("GM")).toBeInTheDocument();
    expect(ring("walled")).toHaveClass("hud-tg-los");
    expect(within(ring("walled")).getByText("No line of sight")).toBeInTheDocument();
    expect(within(ring("lt")).getByText("Far")).toBeInTheDocument();
    // The rider names the Bandit: its ring carries the secondary label below.
    expect(within(ring("bandit")).getByText("Restrain")).toHaveClass("hud-tg-rl");

    // A row tap replaces the pick; the ring follows.
    fireEvent.click(row(/^Bandit, Close/));
    expect(row(/^Bandit, Close/)).toHaveAttribute("aria-pressed", "true");
    expect(ring("bandit")).toHaveClass("hud-tg-picked");
    expect(ring("lt")).toHaveClass("hud-tg-in");
    expect(screen.getByTestId("slot")).toHaveTextContent("|bandit");

    // A ring tap picks too; the row follows.
    fireEvent.click(within(ring("lt")).getByTestId("hud-pick-ring-hit"));
    expect(row(/^Lieutenant, Far/)).toHaveAttribute("aria-pressed", "true");
    expect(row(/^Bandit, Close/)).toHaveAttribute("aria-pressed", "false");

    // Out of sight: no tap target on the map, the row does nothing.
    expect(within(ring("walled")).queryByTestId("hud-pick-ring-hit")).toBeNull();
    fireEvent.click(row(/^Bandit B/));
    expect(row(/^Bandit B/)).toHaveAttribute("aria-pressed", "false");

    // Tapping the picked one clears it: the primary waits for a pick.
    fireEvent.click(row(/^Lieutenant, Far/));
    expect(within(panel()).getByTestId("hud-pick-go")).toBeDisabled();
    expect(within(panel()).getByTestId("hud-pick-why")).toHaveTextContent("Pick a target first");
  });

  it("out of range: 'GM approves' on the row, amber ring with the GM badge, the GM line in the footer; the primary still sends", async () => {
    seed();
    send.mockResolvedValueOnce({ kind: "pending", requestId: "r1" as Id<"combatRequests"> });
    renderHud();
    open();
    fireEvent.click(row(/^Sniper, Very Far/));
    expect(row(/^Sniper, Very Far/)).toHaveTextContent("GM approves");
    expect(ring("sniper")).toHaveClass("hud-tg-out");
    expect(ring("sniper")).toHaveClass("hud-tg-on");
    expect(within(panel()).getByTestId("hud-pick-pay")).toHaveTextContent("the GM approves first");
    const go = within(panel()).getByTestId("hud-pick-go");
    expect(go).toBeEnabled();
    expect(go).toHaveTextContent("Cast on Sniper");
    await act(async () => fireEvent.click(go));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ targetIds: ["sniper"], outOfRange: true, options: { restrain: true } });
    // The session ends (not cancelled), the rings go.
    expect(screen.queryByTestId("hud-pick")).toBeNull();
    expect(screen.queryByTestId("hud-pick-ring")).toBeNull();
    expect(screen.getByTestId("slot")).toHaveTextContent("none");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a refusal stays under the primary; options switch; Esc cancels, runs onCancel and gives focus back", async () => {
    seed();
    const refusal = new ConvexError({ code: "CARD_COST_UNPAID", message: "Short of: 1 Hope" });
    send.mockRejectedValueOnce(refusal);
    onCancel.mockClear();
    renderHud();
    open();
    const rider = within(panel()).getByRole("switch", { name: /Restrain/ });
    fireEvent.click(rider);
    expect(rider).toHaveAttribute("aria-checked", "false");
    expect(within(ring("bandit")).queryByText("Restrain")).toBeNull();
    await act(async () => fireEvent.click(within(panel()).getByTestId("hud-pick-go")));
    expect(within(panel()).getByRole("alert")).toHaveTextContent(errorMessage(refusal));
    expect(send.mock.calls.at(-1)![0].options).toEqual({ restrain: false });

    fireEvent.keyDown(within(panel()).getByRole("heading"), { key: "Escape" });
    expect(screen.queryByTestId("hud-pick")).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("✕ cancels; a stay outcome keeps the panel with its message; extra rows get the selection and can update", async () => {
    seed();
    send.mockResolvedValueOnce({ kind: "stay", message: "Pick where it lands next" });
    const extra = vi.fn(({ selection, update }: Parameters<NonNullable<PickSessionSpec["extra"]>>[0]) => (
      <button type="button" onClick={() => update({ rule: { side: "enemy", max: 2, range: "far" } })}>
        {`Extra ${selection.targets.length}`}
      </button>
    ));
    renderHud(card({ extra }));
    open();
    expect(within(panel()).getByRole("button", { name: "Extra 1" })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Extra 1" }));
    expect(within(panel()).getByTestId("hud-pick-rule")).toHaveTextContent("Pick up to 2 targets within Far");
    fireEvent.click(row(/^Bandit, Close/));
    expect(within(panel()).getByRole("button", { name: "Extra 2" })).toBeInTheDocument();
    await act(async () => fireEvent.click(within(panel()).getByTestId("hud-pick-go")));
    expect(within(panel()).getByRole("alert")).toHaveTextContent("Pick where it lands next");
    fireEvent.click(within(panel()).getByRole("button", { name: "Cancel Vicious Entangle" }));
    expect(screen.queryByTestId("hud-pick")).toBeNull();
  });

  it("loading targets shows a status line; a locked rule ignores taps", () => {
    seed();
    delete queries["combatActions:targets"];
    renderHud(card({ rule: { side: "enemy", max: 1, range: "far", locked: true } }));
    open();
    expect(within(panel()).getByRole("status")).toHaveTextContent("Loading the targets");
    seed();
  });
});

describe("Waiting for the GM", () => {
  const waiting = () => {
    seed();
    const targets = [{ tokenId: SNIPER, name: "Sniper" }];
    const outOfRange = [{ tokenId: SNIPER, band: "veryFar" }];
    queries["combatRequests:mine"] = [{ kind: "sanction", requestId: "ra", characterId: CHARACTER, characterName: "Moss", createdAt: 2, slot: "primary", targets, outOfRange }];
    queries["combatCards:pending"] = [{ requestId: "rc", characterId: CHARACTER, characterName: "Moss", cardId: "vicious-entangle", cardName: "Vicious Entangle", useId: "u", createdAt: 1, targets, outOfRange }];
    queries["combatFeatures:pending"] = [];
  };

  it("one card per waiting use, Withdraw sends the request id with an idempotency key", async () => {
    waiting();
    renderHud();
    const cards = screen.getAllByTestId("hud-pick-wait");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Waiting for the GM");
    expect(cards[0]).toHaveTextContent("Vicious Entangle · out of range");
    expect(cards[0]).toHaveTextContent("Sniper is Very Far. Nothing is rolled or paid until the GM decides.");
    expect(cards[0]).toHaveTextContent("Asking the GM…");
    expect(cards[1]).toHaveTextContent("Attack · out of range");
    await act(async () => fireEvent.click(within(cards[0]!).getByRole("button", { name: "Withdraw Vicious Entangle" })));
    expect(calls).toEqual([{ name: "combatWithdraw:withdraw", args: expect.objectContaining({ campaignId: CAMPAIGN, requestId: "rc", idempotencyKey: expect.any(String) }) }]);
  });

  it("a refusal (already answered) shows on the card", async () => {
    waiting();
    const refusal = new ConvexError({ code: "REQUEST_NOT_OPEN" });
    mutationResult = async () => {
      throw refusal;
    };
    renderHud();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Withdraw Attack" })));
    expect(screen.getByRole("alert")).toHaveTextContent(errorMessage(refusal));
  });

  it("the optimistic update drops the request from the three reads", () => {
    const store = new Map<string, unknown>([
      ["combatRequests:mine", [{ requestId: "ra" }, { requestId: "rb" }]],
      ["combatCards:pending", [{ requestId: "ra" }]],
    ]);
    const fake = {
      getQuery: (ref: unknown) => store.get(functionName(ref)),
      setQuery: (ref: unknown, _args: unknown, value: unknown) => store.set(functionName(ref), value),
    };
    dropWithdrawn(fake as never, CAMPAIGN, "ra" as Id<"combatRequests">);
    expect(store.get("combatRequests:mine")).toEqual([{ requestId: "rb" }]);
    expect(store.get("combatCards:pending")).toEqual([]);
    expect(store.has("combatFeatures:pending")).toBe(false);
  });

  it("the GM gets no waiting cards (the queue is theirs)", () => {
    waiting();
    render(
      <HudProvider>
        <PickProvider>
          <HudPick state={{ ...state, role: "gm" } as CombatPageState} />
        </PickProvider>
      </HudProvider>,
    );
    expect(screen.queryByTestId("hud-pick-wait")).toBeNull();
  });
});

describe("the plain attack session", () => {
  it("picks on the weapon's range; out of range sends and ends in pending", async () => {
    seed();
    const sent: unknown[] = [];
    renderHud(
      plainAttackSession({
        campaignId: CAMPAIGN,
        mapId: MAP,
        characterId: CHARACTER,
        slot: "primary",
        weaponName: "Shortstaff",
        picked: [],
        attack: async (args) => {
          sent.push(args);
          return { status: "pending", requestId: "r9" as Id<"combatRequests"> };
        },
        onResult: () => {},
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const p = screen.getByTestId("hud-pick");
    expect(within(p).getByTestId("hud-pick-rule")).toHaveTextContent("Pick 1 target in your weapon’s range");
    const lt = within(p).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === "lt")!;
    expect(lt.dataset.reach).toBe("out");
    fireEvent.click(lt);
    expect(within(p).getByTestId("hud-pick-go")).toHaveTextContent("Attack Lieutenant");
    await act(async () => fireEvent.click(within(p).getByTestId("hud-pick-go")));
    expect(sent).toEqual([{ targetTokenIds: ["lt"], slot: "primary" }]);
    expect(screen.queryByTestId("hud-pick")).toBeNull();
  });
});
