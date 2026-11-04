/**
 * The spotlight disc (plan combat-hud H9.1; docs/tasks/TASK-HUD-H9.1.md; CmpTokens 'Spotlight', GMDesktop, PlayerPhone):
 * the players' view-only disc, the GM's button and Party / Adversaries popover (user answers Q7 a, Q8 a), the phone's
 * disc, the light pools (PC gold, adversary purple, the whole party) and the model helpers. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HudPartyMember } from "@/components/combat-map/hud/banners/banner";
import { resetPanels } from "@/components/combat-map/hud/panels";
import { PhoneSpotlight, SpotlightDisc } from "@/components/combat-map/hud/spotlight";
import { SpotlightPools } from "@/components/combat-map/hud/spotlight/light";
import { afterHandToParty, discHolder, discLabel, poolOf, takePay, type SpotlightState } from "@/components/combat-map/hud/spotlight/model";

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
  act(() => resetPanels());
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "m1" as Id<"combatMaps">;
const MOSS = "moss" as Id<"characters">;
const BRANNOC = "brannoc" as Id<"characters">;
const LT = "tk-lt" as Id<"combatTokens">;
const BANDIT = "tk-bandit" as Id<"combatTokens">;

const base: SpotlightState = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove: false, adversaryTokenId: null, adversaryName: null };
const mossHolds = (canMove: boolean): SpotlightState => ({ ...base, holder: { kind: "pc", characterId: MOSS, name: "Moss" }, since: 1, reason: "handedBack", canMove });
const ltHolds = (canMove: boolean, named = true): SpotlightState => ({
  ...base,
  holder: { kind: "gm" },
  since: 1,
  reason: "adversary",
  reactionsOnly: !canMove,
  canMove,
  adversaryTokenId: named ? LT : null,
  adversaryName: named ? "Lieutenant" : null,
});

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
const PARTY = [member("Moss", MOSS, { className: "Druid", hope: { value: 1, max: 6 } }), member("Brannoc", BRANNOC)];
const TOKENS = [
  { _id: "tk-Moss", kind: "pc", name: "Moss", sub: "Druid · level 1", stats: { hp: 2, hpMax: 6 } },
  { _id: LT, kind: "adversary", name: "Lieutenant", sub: "Leader", stats: { hp: 2, hpMax: 6 } },
  { _id: BANDIT, kind: "adversary", name: "Bandit", sub: "Standard", stats: { hp: 0, hpMax: 5 } },
];

function setup(state: SpotlightState) {
  queries["combatSpotlight:state"] = state;
  queries["combatHud:party"] = PARTY;
  queries["combatTokensReads:list"] = TOKENS;
}

describe("the players' disc", () => {
  it("is view only and names the holder: the party, a PC, a seen adversary, else the GM", () => {
    setup(base);
    const { rerender } = render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    expect(screen.getByRole("img", { name: "Spotlight: The party" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();

    queries["combatSpotlight:state"] = mossHolds(false);
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    expect(screen.getByRole("img", { name: "Spotlight: Moss" })).toBeInTheDocument();

    queries["combatSpotlight:state"] = ltHolds(false);
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    const disc = screen.getByRole("img", { name: "Spotlight: Lieutenant" });
    expect(disc).toHaveClass("hud-spd-gm");

    // Never seen this scene: the server sends no id and no name, so the player reads "The GM".
    queries["combatSpotlight:state"] = ltHolds(false, false);
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    expect(screen.getByRole("img", { name: "Spotlight: The GM" })).toBeInTheDocument();
  });
});

describe("the GM's disc and popover", () => {
  it("opens on the Party tab: the whole party first, each PC with class, Hope and HP, the holder 'Has it'", () => {
    setup(mossHolds(true));
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    const disc = screen.getByRole("button", { name: "Spotlight: Moss. Change who has it" });
    expect(disc).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disc);
    expect(disc).toHaveAttribute("aria-expanded", "true");
    const pop = screen.getByRole("dialog", { name: "Spotlight" });
    const partyTab = within(pop).getByRole("tab", { name: "Party" });
    expect(partyTab).toHaveAttribute("aria-selected", "true");
    expect(partyTab).toHaveFocus();
    const rows = within(within(pop).getByRole("tabpanel")).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Give the spotlight to the whole party", "Moss has the spotlight", "Give the spotlight to Brannoc"]);
    expect(rows[1]).toHaveAttribute("aria-pressed", "true");
    expect(rows[1]).toHaveTextContent("Druid · Hope 1 · HP 2 of 6 marked");
    expect(rows[1]).toHaveTextContent("Has it");
    expect(rows[0]).toHaveTextContent("No one chosen · players decide who acts");
    expect(pop).toHaveTextContent("Playing around one screen? Set it to whoever acts and the table sees the light move on the map.");
  });

  it("a row moves the spotlight and closes; the holder's row only closes", () => {
    setup(mossHolds(true));
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("button", { name: "Moss has the spotlight" }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("button", { name: "Give the spotlight to Brannoc" }));
    expect(calls.map((c) => c.name)).toEqual(["combatSpotlight:handTo"]);
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN, characterId: BRANNOC });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("button", { name: "Give the spotlight to the whole party" }));
    expect(calls[1]!.name).toBe("combatSpotlight:handToParty");
    expect(calls[1]!.args).toMatchObject({ campaignId: CAMPAIGN });
    expect(typeof calls[1]!.args.idempotencyKey).toBe("string");
  });

  it("Escape and Close close it and put the focus back on the disc", () => {
    setup(base);
    queries["combatSpotlight:state"] = { ...base, canMove: true };
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    const disc = screen.getByRole("button", { name: "Spotlight: The party. Change who has it" });
    disc.focus();
    fireEvent.click(disc);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Party" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(disc).toHaveFocus();

    fireEvent.click(disc);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(disc).toHaveFocus();
  });

  it("arrow keys move between the tabs", () => {
    setup(mossHolds(true));
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Party" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Adversaries" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Adversaries" })).toHaveFocus();
  });

  it("Adversaries: Free by default; 1 Fear pays when taking it from the party or a PC (Q7 a)", () => {
    setup(mossHolds(true));
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Adversaries" }));
    const how = screen.getByRole("group", { name: "How you take it" });
    const free = within(how).getByRole("button", { name: /^Free/ });
    const fear = within(how).getByRole("button", { name: /1 Fear/ });
    expect(free).toHaveAttribute("aria-pressed", "true");
    const lt = screen.getByRole("button", { name: "Take the spotlight for Lieutenant" });
    expect(lt).toHaveTextContent("Leader · HP 2 of 6 marked");
    expect(lt).toHaveTextContent("Take");
    fireEvent.click(fear);
    expect(fear).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(lt);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "combatSpotlight:gmTake", args: { campaignId: CAMPAIGN, tokenId: LT, pay: "fear" } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Adversaries while one holds it; moving between adversaries is free; 1 Fear is disabled at 0 Fear", () => {
    setup(ltHolds(true));
    const { rerender } = render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    const disc = screen.getByRole("button", { name: "Spotlight: Lieutenant. Change who has it" });
    fireEvent.click(disc);
    expect(screen.getByRole("tab", { name: "Adversaries" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Lieutenant has the spotlight" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /1 Fear/ }));
    fireEvent.click(screen.getByRole("button", { name: "Take the spotlight for Bandit" }));
    expect(calls[0]!.args).toMatchObject({ tokenId: BANDIT, pay: "free" });

    setup(mossHolds(true));
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={0} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Adversaries" }));
    const fear = screen.getByRole("button", { name: /1 Fear/ });
    expect(fear).toHaveAttribute("aria-disabled", "true");
    expect(fear).toHaveAccessibleDescription("This needs 1 Fear. You have 0.");
    fireEvent.click(fear);
    expect(fear).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the phone's disc", () => {
  it("is a view-only image with the holder's name, purple for an adversary", () => {
    const { rerender } = render(<PhoneSpotlight state={mossHolds(false)} party={PARTY} />);
    const disc = screen.getByRole("img", { name: "Spotlight: Moss" });
    expect(disc).toHaveTextContent("Spotlight · Moss");
    expect(disc).not.toHaveClass("hud-mspot-gm");
    rerender(<PhoneSpotlight state={ltHolds(false)} party={PARTY} />);
    expect(screen.getByRole("img", { name: "Spotlight: Lieutenant" })).toHaveClass("hud-mspot-gm");
  });
});

describe("the light pools", () => {
  const moss = { _id: "t-moss", kind: "pc", characterId: MOSS, x: 2, y: 3, size: 1 };
  const brannoc = { _id: "t-brannoc", kind: "pc", characterId: BRANNOC, x: 4, y: 3, size: 1 };
  const lt = { _id: LT, kind: "adversary", x: 6, y: 1, size: 2 };

  it("gold under a PC holder, purple under an adversary, every PC for the whole party", () => {
    expect([moss, brannoc, lt].map((t) => poolOf({ characterId: MOSS }, t))).toEqual(["pc", null, null]);
    expect([moss, brannoc, lt].map((t) => poolOf({ tokenId: LT }, t))).toEqual([null, null, "gm"]);
    expect([moss, brannoc, lt].map((t) => poolOf({ party: true }, t))).toEqual(["party", "party", null]);
    expect(poolOf(null, moss)).toBeNull();
  });

  it("keeps an unlit pool under every token so the light fades between holders; only lit ones carry the test id", () => {
    const { container, rerender } = render(<SpotlightPools lit={{ party: true }} tokens={[moss, brannoc, lt]} cell={50} />);
    const lit = container.querySelectorAll("[data-testid='hud-spotlight-light']");
    expect([...lit].map((p) => p.getAttribute("data-token"))).toEqual(["t-moss", "t-brannoc"]);
    expect(lit[0]).toHaveClass("hud-spot-light-party");
    expect(container.querySelectorAll(".hud-spot-light")).toHaveLength(3);
    expect(container.querySelector(`[data-token='${LT}']`)).toHaveAttribute("data-on", "false");

    rerender(<SpotlightPools lit={{ tokenId: LT }} tokens={[moss, brannoc, lt]} cell={50} />);
    const gm = container.querySelector("[data-testid='hud-spotlight-light']");
    expect(gm).toHaveAttribute("data-token", LT);
    expect(gm).toHaveClass("hud-spot-light-gm");
    expect(gm).toHaveAttribute("data-pool", "gm");
    expect(container.querySelector("[data-token='t-moss']")).toHaveAttribute("data-on", "false");
  });
});

describe("model helpers", () => {
  it("names the holder for the disc and its label", () => {
    expect(discHolder(base)).toEqual({ kind: "party", name: "The party" });
    expect(discHolder(mossHolds(true))).toEqual({ kind: "pc", characterId: MOSS, name: "Moss" });
    expect(discHolder(ltHolds(true))).toEqual({ kind: "adversary", tokenId: LT, name: "Lieutenant" });
    // Just taken (optimistic): the server has not named it yet; the GM's token names stand in.
    expect(discHolder({ ...ltHolds(true), adversaryName: null }, new Map([[LT, "Lieutenant"]]))).toMatchObject({ kind: "adversary", name: "Lieutenant" });
    expect(discHolder({ ...ltHolds(true), adversaryName: null })).toEqual({ kind: "gm", name: "The GM" });
    expect(discLabel({ name: "Moss" }, true)).toBe("Spotlight: Moss. Change who has it");
    expect(discLabel({ name: "Moss" }, false)).toBe("Spotlight: Moss");
  });

  it("pays 1 Fear only from the party or a PC; hands to the party optimistically", () => {
    expect(takePay(base, "fear")).toBe("fear");
    expect(takePay(mossHolds(true), "fear")).toBe("fear");
    expect(takePay(ltHolds(true), "fear")).toBe("free");
    expect(takePay(mossHolds(true), "free")).toBe("free");
    expect(afterHandToParty(ltHolds(true))).toEqual({ ...base, canMove: true });
    const none = { ...base, canMove: true };
    expect(afterHandToParty(none)).toBe(none);
  });
});
