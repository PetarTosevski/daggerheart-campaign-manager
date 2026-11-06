/**
 * Per-ally picks in the HUD (plan finish-hud-lk FH-AP; board CmpPicking 'After the roll': "Rousing Strike · each ally
 * picks their own", "2 of 3 chose", "waiting…"; user 2026-11-05): the pure model, a player's own pick card (chips,
 * Choose, the keyed answer), the actor's waiting line, nothing for the GM on the map (their picks are queue cards) and the
 * GM's queue card for a no-show's pick; CU2 (user 2026-11-06): the actor's review before the picks go out (untick allies
 * who can't see or hear them), for the player and the GM. Convex is mocked.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AllyPickCard, HudAllyPicks } from "@/components/combat-map/hud/ally-picks";
import { choseLine, myPicks, pickSub, reviewAllies, reviewRows, waitingOn, waitingRows, withAnswered, withSent, type PickRow } from "@/components/combat-map/hud/ally-picks/model";
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

describe("CU2: the actor's review before the picks go out", () => {
  /** Brannoc's own Rousing Strike, still under review: his own pick stays, Moss and Oriel can be unticked. */
  const REVIEW: PickRow = {
    ...ROW,
    actor: true,
    review: true,
    choosers: [chooser("t1", "Brannoc", { self: true }), chooser("t2", "Moss", { self: false }), chooser("t3", "Oriel", { self: false })],
  };

  it("the model: review rows, the allies the actor can untick, the optimistic send", () => {
    expect(reviewRows([ROW, REVIEW])).toEqual([REVIEW]);
    expect(reviewRows([{ ...REVIEW, actor: false }])).toEqual([]);
    expect(waitingRows([REVIEW])).toEqual([]);
    expect(reviewAllies(REVIEW).map((c) => c.name)).toEqual(["Moss", "Oriel"]);
    const sent = withSent([REVIEW], "r1", ["t3"]);
    expect(sent[0]!.review).toBe(false);
    expect(sent[0]!.choosers.map((c) => c.name)).toEqual(["Brannoc", "Moss"]);
    expect(waitingRows(sent)).toHaveLength(1);
  });

  it("the player unticks an ally and sends the rest (keyed); no waiting line yet", async () => {
    queries["allyPicksReads:open"] = [REVIEW];
    render(<HudAllyPicks state={state("player")} />);
    const card = screen.getByTestId("hud-ally-review");
    expect(card.textContent).toContain("Untick allies who can’t see or hear you");
    const boxes = within(card).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => [b.parentElement?.textContent, b.checked])).toEqual([
      ["Moss", true],
      ["Oriel", true],
    ]);
    fireEvent.click(within(card).getByRole("checkbox", { name: "Oriel" }));
    expect((within(card).getByRole("checkbox", { name: "Oriel" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(card).getByRole("button", { name: "Send Rousing Strike to the ticked allies" }));
    await screen.findByRole("button", { name: "Send Rousing Strike to the ticked allies" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("allyPicks:send");
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN, requestId: "r1", drop: ["t3"] });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    expect(screen.queryByTestId("hud-ally-waiting")).toBeNull();
  });

  it("the GM gets the review cards only (a player away, or the GM playing for the PC), on the GM tone", () => {
    queries["allyPicksReads:open"] = [REVIEW, { ...ROW, choosers: ROW.choosers.map((c) => ({ ...c, mine: !c.answered })) }];
    render(<HudAllyPicks state={state("gm")} />);
    const card = screen.getByTestId("hud-ally-review");
    expect(card.className).toContain("hud-pc-gm");
    expect(card.textContent).toContain("Brannoc’s allies");
    expect(screen.queryByTestId("hud-ally-pick")).toBeNull();
  });
});
