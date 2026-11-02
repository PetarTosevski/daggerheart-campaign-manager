/**
 * The HUD spotlight (plan combat-hud H1.S; docs/tasks/TASK-HUD-H1.S.md): the players' "The GM has the spotlight" card
 * and reactions note, the banner tag, the Fear banner's SPOTLIGHT, the GM's menu (Take / hand back) and the hand-back
 * button, and the copy / optimistic-update helpers. Convex is mocked.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FearSpotlightTag, HudSpotlight, SpotlightBannerTag, SpotlightHandBack } from "@/components/combat-map/hud/spotlight";
import { afterHandTo, afterTake, holderLine, spotlightReasonLine, type SpotlightState } from "@/components/combat-map/hud/spotlight/model";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { moved: true };
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MOSS = "moss" as Id<"characters">;
const BRANNOC = "brannoc" as Id<"characters">;

const base: SpotlightState = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove: false };
const gmTurn = (canMove: boolean): SpotlightState => ({
  holder: { kind: "gm" },
  since: 1,
  reason: "rollWithFear",
  rollBy: { characterId: MOSS, name: "Moss" },
  reactionsOnly: !canMove,
  canMove,
});
const mossHolds = (canMove: boolean): SpotlightState => ({
  ...base,
  holder: { kind: "pc", characterId: MOSS, name: "Moss" },
  since: 1,
  reason: "handedBack",
  canMove,
});

const page = (role: "gm" | "player") => ({ campaignId: CAMPAIGN, role, map: null }) as unknown as CombatPageState;
const party = [
  { characterId: MOSS, name: "Moss" },
  { characterId: BRANNOC, name: "Brannoc" },
];

describe("the players' view", () => {
  it("shows the GM's-turn card with why and the reactions note while the GM holds it", () => {
    queries["combatSpotlight:state"] = gmTurn(false);
    render(<HudSpotlight state={page("player")} />);
    const card = screen.getByTestId("hud-gm-turn");
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveTextContent("The GM has the spotlight");
    expect(card).toHaveTextContent("Moss rolled with Fear.");
    expect(screen.getByText("Reactions only until the spotlight comes back to you")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing while a PC or nobody holds it, and a status line while loading", () => {
    queries["combatSpotlight:state"] = mossHolds(false);
    const { container, rerender } = render(<HudSpotlight state={page("player")} />);
    expect(container).toBeEmptyDOMElement();
    queries["combatSpotlight:state"] = base;
    rerender(<HudSpotlight state={page("player")} />);
    expect(container).toBeEmptyDOMElement();
    delete queries["combatSpotlight:state"];
    rerender(<HudSpotlight state={page("player")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the spotlight");
  });
});

describe("the banner and Fear banner tags", () => {
  it("tags the PC who holds it, and the Fear banner while the GM does", () => {
    queries["combatSpotlight:state"] = mossHolds(false);
    const { rerender } = render(
      <>
        <span data-testid="moss">
          Druid
          <SpotlightBannerTag campaignId={CAMPAIGN} characterId={MOSS} />
        </span>
        <span data-testid="brannoc">
          Warrior
          <SpotlightBannerTag campaignId={CAMPAIGN} characterId={BRANNOC} />
        </span>
        <span data-testid="fear">
          <FearSpotlightTag campaignId={CAMPAIGN} />
        </span>
      </>,
    );
    expect(screen.getByTestId("moss")).toHaveTextContent("Druid · Spotlight");
    expect(screen.getByTestId("brannoc")).toHaveTextContent(/^Warrior$/);
    expect(screen.getByTestId("fear")).toBeEmptyDOMElement();

    queries["combatSpotlight:state"] = gmTurn(false);
    rerender(
      <span data-testid="fear2">
        <SpotlightBannerTag campaignId={CAMPAIGN} characterId={MOSS} />
        <FearSpotlightTag campaignId={CAMPAIGN} />
      </span>,
    );
    expect(screen.getByTestId("fear2")).toHaveTextContent(/^Spotlight$/);
  });
});

describe("the GM's menu", () => {
  it("while the GM holds it: says why and hands it back to a PC on the map", () => {
    queries["combatSpotlight:state"] = gmTurn(true);
    queries["combatHud:party"] = party;
    render(<HudSpotlight state={page("gm")} />);
    const menu = screen.getByRole("region", { name: "Spotlight" });
    expect(menu).toHaveTextContent("You have the spotlight. Moss rolled with Fear.");
    expect(within(menu).queryByRole("button", { name: "Take the spotlight" })).toBeNull();
    expect(screen.queryByTestId("hud-gm-turn")).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: "Hand the spotlight to Brannoc" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("combatSpotlight:handTo");
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN, characterId: BRANNOC });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
  });

  it("while a PC holds it: Take the spotlight, and the other PCs only", () => {
    queries["combatSpotlight:state"] = mossHolds(true);
    queries["combatHud:party"] = party;
    render(<HudSpotlight state={page("gm")} />);
    const menu = screen.getByRole("region", { name: "Spotlight" });
    expect(menu).toHaveTextContent("Moss has the spotlight.");
    expect(within(menu).queryByRole("button", { name: "Hand the spotlight to Moss" })).toBeNull();
    expect(within(menu).getByRole("button", { name: "Hand the spotlight to Brannoc" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "Take the spotlight" }));
    expect(calls.map((c) => c.name)).toEqual(["combatSpotlight:gmTake"]);
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN });
  });

  it("the banner menu's hand-back is the GM's, and not offered to the PC who holds it", () => {
    queries["combatSpotlight:state"] = gmTurn(true);
    const { rerender } = render(<SpotlightHandBack campaignId={CAMPAIGN} characterId={MOSS} name="Moss" />);
    fireEvent.click(screen.getByRole("button", { name: "Give Moss the spotlight" }));
    expect(calls[0]!.args).toMatchObject({ characterId: MOSS });

    queries["combatSpotlight:state"] = mossHolds(true);
    rerender(<SpotlightHandBack campaignId={CAMPAIGN} characterId={MOSS} name="Moss" />);
    expect(screen.queryByRole("button")).toBeNull();

    queries["combatSpotlight:state"] = gmTurn(false);
    rerender(<SpotlightHandBack campaignId={CAMPAIGN} characterId={MOSS} name="Moss" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("copy and optimistic updates (model.ts)", () => {
  it("says why the GM has it", () => {
    expect(spotlightReasonLine(gmTurn(false))).toBe("Moss rolled with Fear.");
    expect(spotlightReasonLine({ reason: "failedRoll", rollBy: { characterId: BRANNOC, name: "Brannoc" } })).toBe("Brannoc failed a roll.");
    expect(spotlightReasonLine({ reason: "adversary", rollBy: null })).toBe("An adversary is acting.");
    expect(spotlightReasonLine({ reason: "gmTook", rollBy: null })).toBe("The GM is making a move.");
    expect(spotlightReasonLine({ reason: "handedBack", rollBy: null })).toBe("");
    expect(holderLine(base)).toBe("The players have the spotlight.");
    expect(holderLine(gmTurn(false))).toBe("The GM has the spotlight.");
    expect(holderLine(gmTurn(true))).toBe("You have the spotlight.");
    expect(holderLine(mossHolds(false))).toBe("Moss has the spotlight.");
  });

  it("take and hand-back give the server's next state; a repeat changes nothing", () => {
    const taken = afterTake(mossHolds(true), 5);
    expect(taken).toEqual({ holder: { kind: "gm" }, since: 5, reason: "gmTook", rollBy: null, reactionsOnly: false, canMove: true });
    expect(afterTake(taken, 9)).toBe(taken);
    const back = afterHandTo(taken, { characterId: BRANNOC, name: "Brannoc" }, 7);
    expect(back).toEqual({ holder: { kind: "pc", characterId: BRANNOC, name: "Brannoc" }, since: 7, reason: "handedBack", rollBy: null, reactionsOnly: false, canMove: true });
    expect(afterHandTo(back, { characterId: BRANNOC, name: "Brannoc" }, 9)).toBe(back);
  });
});
