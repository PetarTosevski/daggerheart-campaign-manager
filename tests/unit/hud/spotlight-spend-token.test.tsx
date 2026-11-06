/**
 * Spotlight Tracker, the GM's "Spend an action" (plan rule-switches RFB; docs/tasks/TASK-RULES-RFB.md; CB p.89: "each
 * time they make an action roll or perform a significant action while in the spotlight, they remove 1 token"): beside
 * "Refill actions" in the spotlight popover's Party tab, only while the tracker is on; it opens a PC picker (a PC at 0 is
 * disabled) whose pick calls `combatSpotlight.spendToken` with an optimistic update (`afterSpend`). Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HudPartyMember } from "@/components/combat-map/hud/banners/banner";
import { resetPanels } from "@/components/combat-map/hud/panels";
import { SpotlightDisc } from "@/components/combat-map/hud/spotlight";
import { afterSpend, type SpotlightState } from "@/components/combat-map/hud/spotlight/model";

import type { Id } from "../../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown>; optimistic: boolean }[] = [];
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const make = (optimistic: boolean) => async (args: Record<string, unknown>) => {
      calls.push({ name, args, optimistic });
      return { spent: true, refilled: false };
    };
    return Object.assign(make(false), { withOptimisticUpdate: () => make(true) });
  },
}));

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
  act(() => resetPanels());
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "m1" as Id<"combatMaps">;
const MOSS = "moss" as Id<"characters">;
const BRANNOC = "brannoc" as Id<"characters">;

const state: SpotlightState = {
  holder: { kind: "pc", characterId: MOSS, name: "Moss" },
  since: 1,
  reason: "handedBack",
  rollBy: null,
  reactionsOnly: false,
  canMove: true,
  adversaryTokenId: null,
  adversaryName: null,
  adversaryPortrait: null,
};

function member(name: string, characterId: Id<"characters">, over: Partial<HudPartyMember> = {}): HudPartyMember {
  return {
    characterId,
    tokenId: `tk-${name}` as Id<"combatTokens">,
    name,
    className: "Warrior",
    level: 1,
    portrait: null,
    mine: false,
    hp: { marked: 2, max: 6 },
    stress: { marked: 0, max: 6 },
    armor: { marked: 0, max: 3 },
    hope: { value: 3, max: 6 },
    conditions: [],
    down: false,
    deathMoveDue: false,
    ...over,
  };
}

function open(party: HudPartyMember[]) {
  queries["combatSpotlight:state"] = state;
  queries["combatHud:party"] = party;
  queries["combatTokensReads:list"] = [];
  render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
  fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
  return screen.getByRole("dialog", { name: "Spotlight" });
}

describe("the GM's 'Spend an action'", () => {
  it("is absent while the Spotlight Tracker is off", () => {
    const pop = open([member("Moss", MOSS), member("Brannoc", BRANNOC)]);
    expect(within(pop).queryByTestId("hud-spend-token")).toBeNull();
    expect(within(pop).queryByTestId("hud-refill-tokens")).toBeNull();
  });

  it("sits beside 'Refill actions'; picking a PC spends one of its tokens (optimistic) and closes the picker", () => {
    const pop = open([member("Moss", MOSS, { tokens: { left: 2, of: 3 } }), member("Brannoc", BRANNOC, { tokens: { left: 0, of: 3 } })]);
    const spend = within(pop).getByTestId("hud-spend-token");
    expect(spend.parentElement).toBe(within(pop).getByTestId("hud-refill-tokens").parentElement);
    expect(spend).toHaveTextContent("Spend an action");
    expect(spend).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(spend);
    expect(spend).toHaveAttribute("aria-expanded", "true");
    const picker = within(pop).getByRole("group", { name: "Whose action token to spend" });
    const brannoc = within(picker).getByRole("button", { name: "Spend one of Brannoc's action tokens (0 of 3 actions left)" });
    expect(brannoc).toBeDisabled();
    fireEvent.click(within(picker).getByRole("button", { name: "Spend one of Moss's action tokens (2 of 3 actions left)" }));
    expect(calls).toEqual([{ name: "combatSpotlight:spendToken", args: expect.objectContaining({ campaignId: CAMPAIGN, characterId: MOSS }), optimistic: true }]);
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    expect(within(pop).queryByRole("group", { name: "Whose action token to spend" })).toBeNull();
    // The popover stays open, so the GM sees the row's count drop.
    expect(screen.getByRole("dialog", { name: "Spotlight" })).toBeInTheDocument();
  });
});

describe("afterSpend (the optimistic party)", () => {
  const party = [member("Moss", MOSS, { tokens: { left: 1, of: 2 } }), member("Brannoc", BRANNOC, { tokens: { left: 1, of: 2 } })];

  it("takes one token from the PC, never below 0, and leaves the others", () => {
    const after = afterSpend(party, MOSS);
    expect(after.map((m) => m.tokens)).toEqual([
      { left: 0, of: 2 },
      { left: 1, of: 2 },
    ]);
    const atZero = [member("Moss", MOSS, { tokens: { left: 0, of: 2 } }), party[1]!];
    expect(afterSpend(atZero, MOSS)[0]!.tokens).toEqual({ left: 0, of: 2 });
  });

  it("refills everyone when the spend leaves every PC out (CB p.89)", () => {
    const out = afterSpend([member("Moss", MOSS, { tokens: { left: 0, of: 2 } }), party[1]!], BRANNOC);
    expect(out.map((m) => m.tokens)).toEqual([
      { left: 2, of: 2 },
      { left: 2, of: 2 },
    ]);
  });
});
