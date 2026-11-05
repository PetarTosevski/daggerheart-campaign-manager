/**
 * Per-ally picks in the HUD (plan finish-hud-lk FH-AP; board CmpPicking 'After the roll': "Rousing Strike · each ally
 * picks their own", "2 of 3 chose", "waiting…"; user 2026-11-05): the pure model, a player's own pick card (chips,
 * Choose, the keyed answer), the actor's waiting line, nothing for the GM on the map (their picks are queue cards) and the
 * GM's queue card for a no-show's pick. Convex is mocked.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AllyPickCard, HudAllyPicks } from "@/components/combat-map/hud/ally-picks";
import { choseLine, myPicks, pickSub, waitingOn, waitingRows, withAnswered, type PickRow } from "@/components/combat-map/hud/ally-picks/model";
import { arrivalTitle, itemLabel, queueItems } from "@/components/combat-map/hud/queue/model";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { status: "open" };
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  calls.length = 0;
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const OPTIONS = [
  { id: "hp", label: "Clear a Hit Point" },
  { id: "stress", label: "Clear 1d4 Stress" },
];
const chooser = (chooserId: string, name: string, over: Partial<PickRow["choosers"][number]> = {}) => ({ stepId: "rousing", chooserId, name, label: "Clear a Hit Point or 1d4 Stress", options: OPTIONS, answered: false, mine: false, ...over });

/** Brannoc's Rousing Strike: Brannoc picked, Moss's pick is the caller's, Oriel hasn't answered. */
const ROW: PickRow = {
  requestId: "r1",
  name: "Rousing Strike",
  actorName: "Brannoc",
  actor: false,
  createdAt: 5,
  choosers: [chooser("t1", "Brannoc", { answered: true }), chooser("t2", "Moss", { mine: true }), chooser("t3", "Oriel")],
};

const state = (role: "gm" | "player") => ({ campaignId: CAMPAIGN, role }) as unknown as CombatPageState;

describe("the model", () => {
  it("the caller's own picks, the waiting line and the optimistic answer", () => {
    expect(myPicks([ROW]).map((p) => [p.key, p.chooser.name])).toEqual([["r1:rousing:t2", "Moss"]]);
    expect(choseLine(ROW)).toBe("1 of 3 chose");
    expect(waitingOn(ROW)).toBe("Moss, Oriel");
    expect(waitingRows([ROW])).toEqual([]);
    expect(waitingRows([{ ...ROW, actor: true }])).toHaveLength(1);
    const after = withAnswered([ROW], "r1", "rousing", "t2");
    expect(after[0]!.choosers.map((c) => [c.answered, c.mine])).toEqual([
      [true, false],
      [true, false],
      [false, false],
    ]);
    expect(choseLine(after[0]!)).toBe("2 of 3 chose");
    expect(myPicks(after)).toEqual([]);
    expect(pickSub(myPicks([ROW])[0]!, false)).toBe("Brannoc’s Rousing Strike · your pick");
    expect(pickSub(myPicks([ROW])[0]!, true)).toBe("Brannoc’s Rousing Strike · Moss’s pick");
  });

  it("the GM queue lists one card per outstanding pick, oldest first", () => {
    const gmRow: PickRow = { ...ROW, choosers: ROW.choosers.map((c) => ({ ...c, mine: !c.answered })) };
    const items = queueItems({ allyPicks: [gmRow] });
    expect(items.map((i) => [i.kind, i.key])).toEqual([
      ["allyPick", "r1:rousing:t2"],
      ["allyPick", "r1:rousing:t3"],
    ]);
    expect(itemLabel(items[0]!)).toBe("Moss · Rousing Strike");
    expect(arrivalTitle(items[1]!)).toBe("Oriel: Rousing Strike pick");
  });
});

describe("a player's screen", () => {
  it("the ally's own pick card: Choose waits for a chip, then sends the one option (keyed)", async () => {
    queries["allyPicksReads:open"] = [ROW];
    render(<HudAllyPicks state={state("player")} />);
    const card = screen.getByTestId("hud-ally-pick");
    expect(within(card).getByRole("heading", { name: "Rousing Strike" })).toBeTruthy();
    expect(card.textContent).toContain("Brannoc’s Rousing Strike · your pick");
    const choose = within(card).getByRole("button", { name: "Choose for Moss: Rousing Strike" }) as HTMLButtonElement;
    expect(choose.disabled).toBe(true);
    fireEvent.click(within(card).getByRole("button", { name: "Clear 1d4 Stress" }));
    expect(within(card).getByRole("button", { name: "Clear 1d4 Stress" }).getAttribute("aria-pressed")).toBe("true");
    expect(choose.disabled).toBe(false);
    fireEvent.click(choose);
    await screen.findByRole("button", { name: "Choose for Moss: Rousing Strike" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("allyPicks:answer");
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN, requestId: "r1", stepId: "rousing", chooserId: "t2", options: ["stress"] });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    expect(screen.queryByTestId("hud-ally-waiting")).toBeNull();
  });

  it("the actor's own use: 'n of m chose · waiting…' and who it waits on", () => {
    queries["allyPicksReads:open"] = [{ ...ROW, actor: true, choosers: ROW.choosers.map((c) => ({ ...c, mine: false })) }];
    render(<HudAllyPicks state={state("player")} />);
    const waiting = screen.getByTestId("hud-ally-waiting");
    expect(within(waiting).getByTestId("hud-ally-chose").textContent).toBe("1 of 3 chose");
    expect(waiting.textContent).toContain("waiting");
    expect(waiting.textContent).toContain("Moss, Oriel");
    expect(screen.queryByTestId("hud-ally-pick")).toBeNull();
  });

  it("nothing while loading or with nothing open; nothing for the GM (their picks are queue cards)", () => {
    const { container, rerender } = render(<HudAllyPicks state={state("player")} />);
    expect(container.textContent).toBe("");
    queries["allyPicksReads:open"] = [];
    rerender(<HudAllyPicks state={state("player")} />);
    expect(container.textContent).toBe("");
    queries["allyPicksReads:open"] = [ROW];
    rerender(<HudAllyPicks state={state("gm")} />);
    expect(container.textContent).toBe("");
  });
});

describe("the GM's queue card", () => {
  it("answers a no-show's pick on the GM tone", async () => {
    const pick = myPicks([{ ...ROW, choosers: ROW.choosers.map((c) => ({ ...c, mine: !c.answered })) }])[1]!;
    render(<AllyPickCard campaignId={CAMPAIGN} pick={pick} gm />);
    const card = screen.getByTestId("hud-ally-pick");
    expect(card.className).toContain("hud-pc-gm");
    expect(card.textContent).toContain("Oriel’s pick");
    fireEvent.click(within(card).getByRole("button", { name: "Clear a Hit Point" }));
    fireEvent.click(within(card).getByRole("button", { name: "Choose for Oriel: Rousing Strike" }));
    await screen.findByRole("button", { name: "Choose for Oriel: Rousing Strike" });
    expect(calls[0]!.args).toMatchObject({ chooserId: "t3", options: ["hp"] });
  });
});
