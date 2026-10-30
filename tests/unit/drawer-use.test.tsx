/**
 * The sheet drawer's server-decided uses (plan lanes B1, dcm-bxp.99.19.56; docs/tasks/TASK-LN-B1.md).
 * - CB p.31, Warden's Protection: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close
 *   range." User 2026-10-29: the server rolls the 1d4 first, then the player picks that many allies.
 * - CB p.59, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
 *   more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." The player picks
 *   the target and the square before the roll; the Difficulty is the GM's.
 * Convex is mocked; the intents and the views are checked.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeatureUse } from "@/components/combat-map/drawer/use";
import { chargeLine, serverUseOf, squareLabels, validAllies } from "@/components/combat-map/drawer/use/model";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => queries[functionName(ref)],
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

afterEach(() => {
  cleanup();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(optimistic)) delete optimistic[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const ASH = "ch-ash" as Id<"characters">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Field", live: true, source: "generated", w: 30, h: 20 } as never;
const WARDEN = "subclass:warden-of-renewal:wardens-protection";
const CHARGE = "ancestry:firbolg:charge";
const tok = (s: string) => s as Id<"combatTokens">;

const props = (featureId: string, role: "gm" | "player" = "player") => ({ campaignId: CAMPAIGN, role, map: MAP, characterId: ASH, featureId, useId: "main", onClose: vi.fn() });

describe("model", () => {
  it("knows the two server-decided uses and nothing else", () => {
    expect(serverUseOf(WARDEN, "main")).toMatchObject({ kind: "count", name: "Warden's Protection", range: "Close" });
    expect(serverUseOf(CHARGE, "main")).toMatchObject({ kind: "charge", name: "Charge" });
    expect(serverUseOf("ancestry:firbolg:unshakable", "main")).toBeNull();
    expect(serverUseOf("nope", undefined)).toBeNull();
  });

  it("keeps at most the rolled number of in-range allies", () => {
    const view = { allies: [{ tokenId: tok("a"), name: "A", inRange: true }, { tokenId: tok("b"), name: "B", inRange: false }, { tokenId: tok("c"), name: "C", inRange: true }] };
    expect(validAllies(view, ["a", "b", "c"], 1)).toEqual(["a"]);
    expect(validAllies(view, ["b", "c"], 2)).toEqual(["c"]);
  });

  it("labels squares by side and numbers repeats; the result line names Hit / Defeated only", () => {
    expect(squareLabels({ name: "Bear", squares: [{ x: 1, y: 1, label: "west" }, { x: 1, y: 2, label: "north" }, { x: 2, y: 2, label: "north" }] })).toEqual(["West of Bear", "North of Bear (1)", "North of Bear (2)"]);
    const names = new Map([["t1", "Bear"]]);
    expect(chargeLine(true, { roll: { total: 14, outcome: "successHope" }, targets: [{ tokenId: "t1", hit: true, defeated: false }, { tokenId: "t2", hit: true, defeated: true }] }, names)).toBe("Rolled 14: charged into Melee → Bear: Hit, Target: Defeated");
    expect(chargeLine(false, { roll: { total: 7, outcome: "failureFear" }, targets: [] }, names)).toBe("Rolled 7: the Agility Roll failed, the token stays.");
  });
});

describe("Warden's Protection", () => {
  it("rolls the number of allies first", async () => {
    queries["featurePrompts:targetCount"] = { roll: null, allies: [] };
    results["featurePrompts:rollCount"] = [{ requestId: "r1", count: 2 }];
    render(<FeatureUse {...props(WARDEN)} />);
    fireEvent.click(screen.getByRole("button", { name: "Roll the number of allies" }));
    expect(await screen.findByText("Rolled 2: pick up to 2 allies.")).toBeTruthy();
    expect(calls[0]).toMatchObject({ name: "featurePrompts:rollCount", args: { campaignId: CAMPAIGN, characterId: ASH, featureId: WARDEN, useId: "main" } });
  });

  it("picks up to the rolled count of allies in range and uses the feature; the roll drops at once", async () => {
    queries["featurePrompts:targetCount"] = {
      roll: { requestId: "r1", count: 1 },
      allies: [
        { tokenId: tok("bryn"), name: "Bryn", inRange: true },
        { tokenId: tok("cara"), name: "Cara", inRange: true },
        { tokenId: tok("dov"), name: "Dov", inRange: false },
      ],
    };
    results["combatFeatures:useFeature"] = [{ status: "resolved", targets: [{ tokenId: "bryn", hit: true, defeated: false }] }];
    render(<FeatureUse {...props(WARDEN)} />);
    expect(screen.getByTestId("server-use-count").textContent).toContain("Rolled 1");
    expect((screen.getByLabelText("Dov (out of range)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Bryn"));
    // One rolled: Cara can't be added.
    expect((screen.getByLabelText("Cara") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use Warden's Protection" }));
    expect(await screen.findByText("Warden's Protection used on Bryn.")).toBeTruthy();
    expect(calls[0]).toMatchObject({ name: "combatFeatures:useFeature", args: { featureId: WARDEN, useId: "main", mapId: "m1", targetTokenIds: ["bryn"], choices: [] } });

    const set = vi.fn();
    optimistic["combatFeatures:useFeature"]!({ getQuery: () => queries["featurePrompts:targetCount"], setQuery: set }, calls[0]!.args);
    expect(set.mock.calls[0]![2]).toMatchObject({ roll: null });
  });
});

describe("Charge", () => {
  const options = [
    {
      tokenId: tok("bear"),
      name: "Bear",
      band: "far",
      squares: [
        { x: 11, y: 10, label: "west" },
        { x: 11, y: 9, label: "north-west" },
      ],
    },
  ];

  it("the GM sets the Difficulty and sends the target, the square and the Stress", async () => {
    queries["featurePrompts:chargeOptions"] = options;
    results["featurePrompts:charge"] = [{ status: "charged", moved: true, use: { roll: { total: 14, outcome: "successHope" }, targets: [{ tokenId: "bear", hit: true, defeated: false }] } }];
    render(<FeatureUse {...props(CHARGE, "gm")} />);
    const go = screen.getByRole("button", { name: "Roll Agility and charge" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Charge at"), { target: { value: "bear" } });
    fireEvent.change(screen.getByLabelText("Square in Melee range"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Difficulty of the Agility Roll"), { target: { value: "12" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(await screen.findByText("Rolled 14: charged into Melee → Bear: Hit")).toBeTruthy();
    expect(calls[0]).toMatchObject({ name: "featurePrompts:charge", args: { characterId: ASH, mapId: "m1", targetTokenId: "bear", square: { x: 11, y: 10 }, stress: true, roll: { difficulty: 12 } } });
  });

  it("a player is told the GM sets the Difficulty; no enemy at range says so", () => {
    queries["featurePrompts:chargeOptions"] = options;
    render(<FeatureUse {...props(CHARGE)} />);
    expect(screen.getByText(/The GM sets the Difficulty/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Roll Agility and charge" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    queries["featurePrompts:chargeOptions"] = [];
    render(<FeatureUse {...props(CHARGE)} />);
    expect(screen.getByText("No enemy in sight at Far or Very Far range.")).toBeTruthy();
  });

  it("renders nothing for another feature (the general Use flow is SD7's)", () => {
    const { container } = render(<FeatureUse {...props("ancestry:firbolg:unshakable")} />);
    expect(container.innerHTML).toBe("");
  });
});
