/**
 * The tracker's waiting line for a held adversary attack (plan drawer-answers DA1, SD4 follow-up; SD4 Q2): an attack
 * waiting for before-roll answers reads "Bear attacks Mira, before the roll", shows no damage and names who still has to
 * answer; Resolve now rolls it. A hit's window keeps its damage line. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAdversaryActions } from "@/components/adversaries/tracker/actions/use-adversary-actions";
import { ReactionWindows } from "@/components/adversaries/tracker/actions/windows";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;

/** `preRollWindow`'s shape (convex/adversaryActions.ts): damage 0, `preRoll: true`, the PCs with a before-roll feature. */
const HELD = {
  requestId: "r1",
  encounterId: "enc1",
  instanceId: "i1",
  attackerLabel: "Bear",
  originalTargetId: "mira",
  targetCharacterId: "mira",
  targetName: "Mira",
  damage: 0,
  damageType: "physical",
  direct: false,
  critical: false,
  awaiting: [{ characterId: "mira", name: "Mira", role: "target" }],
  answers: 0,
  createdAt: 1,
  preRoll: true,
};

function Windows() {
  const acts = useAdversaryActions(CAMPAIGN);
  return <ReactionWindows campaignId={CAMPAIGN} encounterId="enc1" acts={acts} />;
}

describe("a held attack in the tracker (SD4 Q2)", () => {
  it("reads 'attacks Mira, before the roll' with no damage line, and waits for the before-roll answer", async () => {
    queries["adversaryActionsReads:windows"] = [HELD];
    render(<Windows />);
    const row = within(screen.getByRole("region", { name: "Reaction windows" })).getByTestId("tracker-window");
    expect(row).toHaveTextContent("Bear attacks Mira, before the roll");
    expect(row).not.toHaveTextContent(/damage/);
    expect(row).not.toHaveTextContent(/\bhit\b/);
    expect(row).toHaveTextContent("Waiting for Mira (before-roll answer)");
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Resolve now: Bear attacks Mira" }));
    });
    expect(calls).toEqual([expect.objectContaining({ name: "adversaryActions:resolve", args: expect.objectContaining({ campaignId: CAMPAIGN, requestId: "r1" }) })]);
  });

  it("names the feature of a held feature attack and every target", () => {
    queries["adversaryActionsReads:windows"] = [{ ...HELD, feature: "Claws", targetName: "Mira, Tabby" }];
    render(<Windows />);
    expect(screen.getByTestId("tracker-window")).toHaveTextContent("Bear (Claws) attacks Mira, Tabby, before the roll");
  });

  it("a hit's window keeps its damage line", () => {
    const { preRoll: _held, ...hit } = HELD;
    void _held;
    queries["adversaryActionsReads:windows"] = [{ ...hit, damage: 9 }];
    render(<Windows />);
    const row = screen.getByTestId("tracker-window");
    expect(row).toHaveTextContent("Bear hit Mira: 9 physical damage");
    expect(row).toHaveTextContent("Waiting for Mira (armor choice)");
  });
});
