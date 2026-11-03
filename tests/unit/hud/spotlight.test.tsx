/**
 * The HUD spotlight (plan combat-hud H1.S; docs/tasks/TASK-HUD-H1.S.md): the players' "The GM has the spotlight" card
 * and reactions note, the banner tag, the Fear banner's SPOTLIGHT, the GM's menu (Take / hand back) and the hand-back
 * button, the copy / optimistic-update helpers, and the stage light on the spotlit token (bead dcm-bxp.99.32.35).
 * Convex is mocked.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FearSpotlightTag, HudSpotlight, SpotlightBannerTag, SpotlightHandBack } from "@/components/combat-map/hud/spotlight";
import { SpotlightPools, useSpotlightLit } from "@/components/combat-map/hud/spotlight/light";
import { afterHandTo, afterTake, holderLine, isLit, litOf, spotlightReasonLine, type SpotlightState } from "@/components/combat-map/hud/spotlight/model";
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

const base: SpotlightState = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove: false, adversaryTokenId: null };
const gmTurn = (canMove: boolean): SpotlightState => ({
  holder: { kind: "gm" },
  since: 1,
  reason: "rollWithFear",
  rollBy: { characterId: MOSS, name: "Moss" },
  reactionsOnly: !canMove,
  canMove,
  adversaryTokenId: null,
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
    expect(taken).toEqual({ holder: { kind: "gm" }, since: 5, reason: "gmTook", rollBy: null, reactionsOnly: false, canMove: true, adversaryTokenId: null });
    expect(afterTake(taken, 9)).toBe(taken);
    const back = afterHandTo(taken, { characterId: BRANNOC, name: "Brannoc" }, 7);
    expect(back).toEqual({ holder: { kind: "pc", characterId: BRANNOC, name: "Brannoc" }, since: 7, reason: "handedBack", rollBy: null, reactionsOnly: false, canMove: true, adversaryTokenId: null });
    expect(afterHandTo(back, { characterId: BRANNOC, name: "Brannoc" }, 9)).toBe(back);
  });

  it("spotlighting an adversary names its token; another adversary keeps `since`; a hand-back clears it", () => {
    const lit = afterTake(mossHolds(true), 5, KNIFE);
    expect(lit).toEqual({ holder: { kind: "gm" }, since: 5, reason: "adversary", rollBy: null, reactionsOnly: false, canMove: true, adversaryTokenId: KNIFE });
    expect(afterTake(lit, 9, KNIFE)).toBe(lit);
    // A general take while the GM holds it keeps the lit adversary (as the server does).
    expect(afterTake(lit, 9)).toBe(lit);
    expect(afterTake(lit, 9, BANDIT)).toEqual({ ...lit, adversaryTokenId: BANDIT });
    expect(afterTake(gmTurn(false), 9, BANDIT)).toMatchObject({ since: 1, reason: "adversary", rollBy: null, reactionsOnly: true, adversaryTokenId: BANDIT });
    expect(afterHandTo(lit, { characterId: MOSS, name: "Moss" }, 11).adversaryTokenId).toBeNull();
  });
});

const KNIFE = "knife" as Id<"combatTokens">;
const BANDIT = "bandit" as Id<"combatTokens">;

describe("the stage light (light.tsx, model.ts litOf / isLit)", () => {
  const moss = { _id: "t-moss", kind: "pc", characterId: MOSS, x: 2, y: 3, size: 1 };
  const brannoc = { _id: "t-brannoc", kind: "pc", characterId: BRANNOC, x: 4, y: 3, size: 1 };
  const knife = { _id: KNIFE, kind: "adversary", x: 6, y: 1, size: 2 };
  // A player's `others` row: no kind, no character.
  const otherKnife = { _id: KNIFE, x: 6, y: 1, size: 2 };

  it("lights the PC holder's token, or the spotlighted adversary; nothing for nobody or the GM generally", () => {
    expect(litOf(undefined)).toBeNull();
    expect(litOf(base)).toBeNull();
    expect(litOf(gmTurn(true))).toBeNull();
    expect(litOf(mossHolds(false))).toEqual({ characterId: MOSS });
    expect(litOf(afterTake(gmTurn(false), 2, KNIFE))).toEqual({ tokenId: KNIFE });

    const pc = litOf(mossHolds(false));
    expect([moss, brannoc, knife].map((t) => isLit(pc, t))).toEqual([true, false, false]);
    const adv = { tokenId: KNIFE };
    expect([moss, brannoc, knife, otherKnife].map((t) => isLit(adv, t))).toEqual([false, false, true, true]);
    expect(isLit(null, moss)).toBe(false);
  });

  it("draws one pool per lit token the layer has, centred on its footprint, never taking the pointer", () => {
    const { container, rerender } = render(<SpotlightPools lit={{ tokenId: KNIFE }} tokens={[moss, knife]} cell={50} />);
    const pools = container.querySelectorAll("[data-testid='hud-spotlight-light']");
    expect(pools).toHaveLength(1);
    const pool = pools[0] as HTMLElement;
    expect(pool).toHaveAttribute("data-token", KNIFE);
    expect(pool).toHaveAttribute("aria-hidden", "true");
    expect(pool.style.left).toBe("350px");
    expect(pool.style.top).toBe("100px");
    expect(pool.style.getPropertyValue("--s")).toBe("100px");
    // A layer without the lit token (a player who can't see it) draws nothing.
    rerender(<SpotlightPools lit={{ tokenId: KNIFE }} tokens={[moss, brannoc]} cell={50} />);
    expect(container.querySelector("[data-testid='hud-spotlight-light']")).toBeNull();
    rerender(<SpotlightPools lit={null} tokens={[moss, knife]} cell={50} />);
    expect(container.querySelector("[data-testid='hud-spotlight-light']")).toBeNull();
  });

  it("reads the spotlight only while the HUD face shows", () => {
    queries["combatSpotlight:state"] = mossHolds(false);
    let seen: unknown = "unset";
    function Probe({ on }: { on: boolean }) {
      seen = useSpotlightLit(CAMPAIGN, on);
      return null;
    }
    const { rerender } = render(<Probe on />);
    expect(seen).toEqual({ characterId: MOSS });
    rerender(<Probe on={false} />);
    expect(seen).toBeNull();
  });
});
