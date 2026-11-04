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
import { TokenFace } from "@/components/combat-map/hud/token";
import { afterHandToParty, discHolder, discLabel, holderArt, isDefeatedRow, livingFirst, poolOf, takePay, type SpotlightState } from "@/components/combat-map/hud/spotlight/model";

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

const base: SpotlightState = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove: false, adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
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

describe("an adversary's portrait on the disc (user 2026-11-04)", () => {
  const LT_ART = "https://art.example/lieutenant.webp";
  const withArt = TOKENS.map((t) => (t._id === LT ? { ...t, portrait: { kind: "url", url: LT_ART } } : t));
  const playerView = (others: { _id: Id<"combatTokens">; portrait?: { kind: "url"; url: string } | null }[]) => ({ state: "ok", others });
  const art = (root: HTMLElement) => within(root).queryByTestId("hud-spotlight-art");

  it("GM: the disc and the Adversaries rows show the token's portrait; the initial without one", () => {
    setup(ltHolds(true));
    queries["combatTokensReads:list"] = withArt;
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    const disc = screen.getByRole("button", { name: /^Spotlight: Lieutenant/ });
    expect(disc).toHaveClass("hud-spd-gm");
    expect(art(disc)).toHaveAttribute("src", LT_ART);
    fireEvent.click(disc);
    const rows = within(screen.getByRole("tabpanel")).getAllByRole("button", { name: /Lieutenant|Bandit/ });
    expect(art(rows[0]!)).toHaveAttribute("src", LT_ART);
    expect(art(rows[1]!)).toBeNull();
    expect(rows[1]).toHaveTextContent(/^B/);
  });

  it("falls back to the initial when the image fails to load", () => {
    setup(ltHolds(true));
    queries["combatTokensReads:list"] = withArt;
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    const disc = screen.getByRole("button", { name: /^Spotlight: Lieutenant/ });
    fireEvent.error(art(disc)!);
    expect(art(disc)).toBeNull();
    expect(disc.querySelector(".hud-spf-en[data-on='true']")).toHaveTextContent("L");
  });

  it("player: a seen adversary shows the state's portrait (desktop and phone); 'The GM' never does", () => {
    const seen: SpotlightState = { ...ltHolds(false), adversaryPortrait: LT_ART };
    queries["combatSpotlight:state"] = seen;
    queries["combatHud:party"] = PARTY;
    const { rerender } = render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    expect(art(screen.getByRole("img", { name: "Spotlight: Lieutenant" }))).toHaveAttribute("src", LT_ART);

    // Not seen this scene: the server sends neither id, name nor portrait, and the disc shows no art.
    queries["combatSpotlight:state"] = ltHolds(false, false);
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    const gmDisc = screen.getByRole("img", { name: "Spotlight: The GM" });
    expect(art(gmDisc)).toBeNull();
    expect(gmDisc.querySelector("img")).toBeNull();
    // Even an id without a name reads "The GM", with no portrait.
    queries["combatSpotlight:state"] = { ...seen, adversaryName: null };
    rerender(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    expect(screen.getByRole("img", { name: "Spotlight: The GM" }).querySelector("img")).toBeNull();

    rerender(<PhoneSpotlight state={seen} party={PARTY} />);
    expect(art(screen.getByRole("img", { name: "Spotlight: Lieutenant" }))).toHaveAttribute("src", LT_ART);
    rerender(<PhoneSpotlight state={ltHolds(false, false)} party={PARTY} />);
    expect(screen.getByRole("img", { name: "Spotlight: The GM" }).querySelector("img")).toBeNull();
  });

  it("player: a party-seen adversary without art keeps its initial, whatever this player's map draws (dcm-onze)", () => {
    queries["combatSpotlight:state"] = ltHolds(false);
    queries["combatHud:party"] = PARTY;
    queries["combatVision:playerView"] = playerView([{ _id: LT, portrait: { kind: "url", url: LT_ART } }]);
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm={false} fear={3} />);
    const disc = screen.getByRole("img", { name: "Spotlight: Lieutenant" });
    expect(art(disc)).toBeNull();
    expect(disc.querySelector(".hud-spf-en[data-on='true']")).toHaveTextContent("L");
  });

  it("a long name reads in full, as the map token's name tag reads it (disc, popover row, phone)", () => {
    const LONG = "Volcanic Dragon: Ashen Tyrant";
    const tokens = TOKENS.map((t) => (t._id === LT ? { ...t, name: LONG } : t));
    setup({ ...ltHolds(true), adversaryName: LONG });
    queries["combatTokensReads:list"] = tokens;
    const token = render(<TokenFace face={{ tone: "enemy", art: null, arcs: null, hope: null, conditions: [], down: false }} name={tokens[1]!.name} initials="VD" size={48} />);
    const tokenLabel = token.container.querySelector(".tk-name")!.textContent;
    token.unmount();
    expect(tokenLabel).toBe(LONG);

    const { unmount } = render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    expect(screen.getByTestId("hud-spotlight-name").textContent).toBe(tokenLabel);
    fireEvent.click(screen.getByRole("button", { name: `Spotlight: ${LONG}. Change who has it` }));
    const row = screen.getByRole("button", { name: `${LONG} has the spotlight` });
    expect(row.querySelector(".hud-spr-t b")!.textContent).toBe(tokenLabel);
    unmount();

    render(<PhoneSpotlight state={{ ...ltHolds(false), adversaryName: LONG }} party={PARTY} />);
    expect(screen.getByRole("img", { name: `Spotlight: ${LONG}` }).querySelector(".hud-ms-l b")!.textContent).toBe(tokenLabel);
  });

  it("holderArt reads art only for an adversary holder: the GM's map first, else the state's portrait", () => {
    const lt = { src: LT_ART, position: "center 25%", remote: true };
    const map = new Map([[LT as string, lt]]);
    expect(holderArt({ kind: "adversary", tokenId: LT, name: "Lieutenant" }, map, null)).toBe(lt);
    expect(holderArt({ kind: "gm", name: "The GM" }, map, LT_ART)).toBeNull();
    expect(holderArt({ kind: "adversary", tokenId: BANDIT, name: "Bandit" }, map, null)).toBeNull();
    expect(holderArt({ kind: "adversary", tokenId: LT, name: "Lieutenant" }, undefined, null)).toBeNull();
    expect(holderArt({ kind: "adversary", tokenId: LT, name: "Lieutenant" }, undefined, LT_ART)).toEqual(lt);
  });
});

describe("a defeated adversary in the Adversaries tab (user 2026-11-04)", () => {
  const OGRE = "tk-ogre" as Id<"combatTokens">;
  const MINIONS = "tk-minions" as Id<"combatTokens">;
  const tokens = [
    { _id: OGRE, kind: "adversary", name: "Cave Ogre", sub: "Solo", stats: { hp: 8, hpMax: 8, down: true } },
    ...TOKENS,
    // A Minion group with every Minion gone: marked defeated before every HP shows marked.
    { _id: MINIONS, kind: "adversary", name: "Rotted Zombies", sub: "Minion", stats: { hp: 2, hpMax: 4, down: true } },
  ];

  it("sits at the bottom, disabled, tagged 'Defeated', with no Take; a click sends nothing", () => {
    setup(mossHolds(true));
    queries["combatTokensReads:list"] = tokens;
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: Moss/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Adversaries" }));
    const rows = within(screen.getByRole("tabpanel")).getAllByRole("button").filter((b) => b.classList.contains("hud-spr"));
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Take the spotlight for Lieutenant",
      "Take the spotlight for Bandit",
      "Cave Ogre, defeated: can't take the spotlight",
      "Rotted Zombies, defeated: can't take the spotlight",
    ]);
    for (const dead of rows.slice(2)) {
      expect(dead).toHaveAttribute("aria-disabled", "true");
      expect(dead).toHaveTextContent("Defeated");
      expect(dead).not.toHaveTextContent("Take");
      fireEvent.click(dead);
    }
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Spotlight" })).toBeInTheDocument();
    // The living still take it.
    fireEvent.click(rows[0]!);
    expect(calls.map((c) => c.name)).toEqual(["combatSpotlight:gmTake"]);
  });

  it("isDefeatedRow: marked defeated or every HP marked; livingFirst keeps the map's order", () => {
    expect(isDefeatedRow({ hp: 8, hpMax: 8, down: false })).toBe(true);
    expect(isDefeatedRow({ hp: 1, hpMax: 4, down: true })).toBe(true);
    expect(isDefeatedRow({ hp: 7, hpMax: 8, down: false })).toBe(false);
    expect(isDefeatedRow(null)).toBe(false);
    const rows = [{ id: 1, defeated: true }, { id: 2, defeated: false }, { id: 3, defeated: true }, { id: 4, defeated: false }];
    expect(livingFirst(rows).map((r) => r.id)).toEqual([2, 4, 1, 3]);
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
