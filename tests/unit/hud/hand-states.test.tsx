/**
 * The HUD hand (plan combat-hud H2.3; docs/tasks/TASK-HUD-H2.3.md; board CmpCards): the states around the app's own
 * card face (tags, lift and glow, grey wash) as pure functions, and the hand itself with Convex mocked: the fan with the
 * classic face, Hide cards (stored on the account, config U6c), Roll options, the full card view (More, Use / Close,
 * Escape), Use opening the picking panel's session (H3.1; the panel itself: tests/unit/hud/card-pick.test.tsx), the vault with its recall labels, the GM's locked hand, another player's hand
 * view only, and a hidden hand.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HandCard } from "@/components/combat-map/actions/hand/model";
import { HiddenHand, HudHandBody, type HudHandBodyProps } from "@/components/combat-map/hud/hand/body";
import { PickProvider, usePick } from "@/components/combat-map/hud/pick";
import { HudProvider } from "@/components/combat-map/hud/state";
import { raiseHand } from "@/components/combat-map/hud/hand/raise";
import { cardLook, experienceShort, hopeNeed, loadoutFullText, recallText, signedEdge, usedText, type LookContext } from "@/components/combat-map/hud/hand/states";

import type { Id } from "../../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name]?.shift() ?? null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
  window.localStorage.clear();
});

type HandUseFixture = HandCard["uses"][number];
const handUse = (useId: string, name: string, extra: Partial<HandUseFixture> = {}): HandUseFixture => ({
  useId,
  name,
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: true,
  targets: { side: "enemy", range: "far", count: "one" },
  choices: [],
  ...extra,
});

const card = (cardId: string, name: string, extra: Partial<HandCard> = {}): HandCard => ({
  cardId,
  name,
  domain: "arcana",
  level: 1,
  type: "spell",
  recallCost: 1,
  place: "loadout",
  usage: "combat",
  state: "ready",
  resetLabel: null,
  tokens: 0,
  uses: [handUse("main", name)],
  ...extra,
});

const ENTANGLE = card("vicious-entangle", "Vicious Entangle", { domain: "sage" });
const CHAOS = card("unleash-chaos", "Unleash Chaos", { tokens: 3 });
const WALL = card("wall-walk", "Wall Walk", { uses: [handUse("main", "Wall Walk", { rolls: false, targets: { side: "any", range: "melee", count: "one" } })] });
const RUNE = card("rune-ward", "Rune Ward", { recallCost: 0, uses: [handUse("main", "Rune Ward", { activation: "reaction", rolls: false, targets: null })] });
const USED = card("rune-ward", "Rune Ward", { recallCost: 0, state: "exhausted", resetLabel: "Back after a rest", uses: [handUse("main", "Rune Ward", { ready: false, resetLabel: "Back after a rest" })] });

const ctx = (over: Partial<LookContext> = {}): LookContext => ({ mode: "own", canPlay: true, name: "Moss", hope: 2, playing: false, rollBlock: null, ...over });

describe("the states around the face (CmpCards 'Card states in the hand')", () => {
  it("ready: Use enabled, tokens or the limit as the tag", () => {
    expect(cardLook(CHAOS, ctx())).toEqual({ tag: { kind: "limit", text: "3 tokens" }, wash: "none", canUse: true, showUse: true });
    expect(cardLook(ENTANGLE, ctx()).tag).toBeNull();
  });

  it("playing: 'Casting · pick a target', lifted and glowing, Use waits", () => {
    const look = cardLook(ENTANGLE, ctx({ playing: true }));
    expect(look.tag).toEqual({ kind: "play", text: "Casting · pick a target" });
    expect(look.wash).toBe("play");
    expect(look.canUse).toBe(false);
  });

  it("can't afford: 'Needs 1 Hope' known before the click, Use disabled with the shortfall, greyed", () => {
    expect(hopeNeed(WALL)).toBe(1);
    const look = cardLook(WALL, ctx({ hope: 0 }));
    expect(look.tag).toEqual({ kind: "no", text: "Needs 1 Hope", lock: true });
    expect(look).toMatchObject({ wash: "afford", canUse: false, showUse: true, reason: "Needs 1 Hope · you have 0" });
    // Unknown Hope shows no shortfall; enough Hope plays.
    expect(cardLook(WALL, ctx({ hope: null })).canUse).toBe(true);
    expect(cardLook(WALL, ctx({ hope: 1 })).canUse).toBe(true);
  });

  it("used: 'Used · back after a rest', no Use", () => {
    expect(usedText("Back after a rest")).toBe("Used · back after a rest");
    expect(cardLook(USED, ctx())).toMatchObject({ tag: { kind: "used", text: "Used · back after a rest" }, canUse: false, showUse: false });
  });

  it("locked (GM): 'Turn on “Play for Moss”' until Play-for, greyed, no Use", () => {
    expect(cardLook(ENTANGLE, ctx({ mode: "gm", canPlay: false }))).toEqual({ tag: { kind: "lock", text: "Turn on “Play for Moss”", lock: true }, wash: "locked", canUse: false, showUse: false });
    expect(cardLook(ENTANGLE, ctx({ mode: "gm", canPlay: true })).canUse).toBe(true);
  });

  it("another player's card: '<name>’s hand · view only', never a Use", () => {
    expect(cardLook(ENTANGLE, ctx({ mode: "view", canPlay: false, name: "Brannoc" }))).toEqual({ tag: { kind: "used", text: "Brannoc’s hand · view only" }, wash: "none", canUse: false, showUse: false });
  });

  it("reaction: 'Reaction · shows in the hit window', no Use button", () => {
    expect(cardLook(RUNE, ctx())).toMatchObject({ tag: { kind: "used", text: "Reaction · shows in the hit window" }, showUse: false });
  });

  it("a rolling card waits while the roll options can't be paid", () => {
    expect(cardLook(ENTANGLE, ctx({ rollBlock: "Not enough Hope for those Experiences." }))).toMatchObject({ canUse: false, reason: "Not enough Hope for those Experiences." });
    expect(cardLook(WALL, ctx({ rollBlock: "Not enough Hope for those Experiences." })).canUse).toBe(true);
  });

  it("the vault's labels and the roll options' helpers", () => {
    expect(recallText(1, false)).toBe("Recall · 1 Stress");
    expect(recallText(1, true)).toBe("Recall · free");
    expect(recallText(0, false)).toBe("Recall · free");
    expect(loadoutFullText(5, 5)).toBe("Loadout full · 5 of 5");
    expect(loadoutFullText(4, 5)).toBeNull();
    expect(experienceShort(0, 0, false)).toBe(true);
    expect(experienceShort(1, 1, false)).toBe(true);
    expect(experienceShort(1, 1, true)).toBe(false);
    expect(experienceShort(2, 1, false)).toBe(false);
    expect([signedEdge(1), signedEdge(-2), signedEdge(0)]).toEqual(["+1", "−2", "0"]);
  });
});

// ---------------------------------------------------------------- the hand, rendered

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "m1" as Id<"combatMaps">;
const MOSS = "ch-moss" as Id<"characters">;
const BANDIT = "t-bandit" as Id<"combatTokens">;

function setHand(loadout: HandCard[], vault: HandCard[] = []) {
  queries["combatCardsReads:hand"] = { characterId: MOSS, loadout, vault };
}
function setCharacter(hope: number, experiences = [{ id: "e1", name: "Forest Guide", value: 2 }, { id: "e2", name: "Herbalist", value: 2 }]) {
  queries["charactersReads:get"] = { _id: MOSS, sheet: { hope, experiences, level: 1 } };
}

function renderHand(over: Partial<HudHandBodyProps> = {}) {
  const props: HudHandBodyProps = {
    campaignId: CAMPAIGN,
    mapId: MAP,
    characterId: MOSS,
    name: "Moss",
    mode: "own",
    canPlay: true,
    creatures: [{ tokenId: "t-moss" as Id<"combatTokens">, name: "You", side: "self" }, { tokenId: BANDIT, name: "Bandit", side: "enemy" }],
    pickedEnemies: [],
    ...over,
  };
  // H3.1: the hand opens its card's pick session, so it renders inside the shell's providers.
  return render(
    <HudProvider>
      <PickProvider>
        <HudHandBody {...props} />
        <SessionId />
      </PickProvider>
    </HudProvider>,
  );
}

/** The open pick session's id (H3.1: Use opens one). */
function SessionId() {
  const pick = usePick();
  return <span data-testid="session">{pick.session?.spec.id ?? "none"}</span>;
}

const fanCards = () => screen.getAllByTestId("hud-hand-card");
const fanCard = (name: string) => fanCards().find((el) => within(el).queryByRole("heading", { name }))!;

describe("the HUD hand", () => {
  it("shows the fan with the app's own face and the states around it", () => {
    setHand([CHAOS, ENTANGLE, WALL, USED]);
    setCharacter(0);
    renderHand();
    expect(screen.getByRole("region", { name: "Your hand" })).toBeTruthy();
    expect(fanCards()).toHaveLength(4);
    // The classic face (actions/hand/face.tsx) inside every slot.
    expect(screen.getAllByTestId("combat-hand-card")).toHaveLength(4);
    expect(within(fanCard("Unleash Chaos")).getByText("3 tokens")).toBeTruthy();
    expect(within(fanCard("Wall Walk")).getByText("Needs 1 Hope")).toBeTruthy();
    expect(fanCard("Wall Walk").dataset.wash).toBe("afford");
    // H6.2: a known limit leaves Use focusable (aria-disabled) with its reason as the description.
    expect(within(fanCard("Wall Walk")).getByRole("button", { name: "Use Wall Walk" })).toHaveAttribute("aria-disabled", "true");
    expect(within(fanCard("Wall Walk")).getByRole("button", { name: "Use Wall Walk" })).toHaveAccessibleDescription("Needs 1 Hope · you have 0");
    expect(within(fanCard("Rune Ward")).getByText("Used · back after a rest")).toBeTruthy();
    expect(within(fanCard("Rune Ward")).queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.getByRole("button", { name: "Open vault, 0 cards" })).toBeTruthy();
  });

  it("Hide cards asks the account to fold this hand (preferences.setFold, config U6c); a folded hand shows Show cards", () => {
    setHand([CHAOS, ENTANGLE]);
    setCharacter(2);
    queries["preferences:folds"] = [];
    const first = renderHand();
    expect(fanCards()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Hide cards" }));
    expect(calls).toEqual([{ name: "preferences:setFold", args: { campaignId: CAMPAIGN, characterId: MOSS, folded: true } }]);
    first.unmount();
    calls.length = 0;
    // The account says folded (the optimistic update, then the server): the fan folds; Show cards asks to unfold.
    queries["preferences:folds"] = [MOSS];
    renderHand();
    expect(screen.queryAllByTestId("hud-hand-card")).toHaveLength(0);
    expect(screen.getByTestId("hud-hand-folded")).toBeTruthy();
    const show = screen.getByRole("button", { name: "Show cards (2)" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(calls).toEqual([{ name: "preferences:setFold", args: { campaignId: CAMPAIGN, characterId: MOSS, folded: false } }]);
  });

  it("Roll options: Experiences with their Hope cost (greyed 'Needs 1 Hope' once spoken for), advantage −3..+3, Help; Esc closes", () => {
    setHand([ENTANGLE]);
    setCharacter(1);
    renderHand();
    const button = screen.getByRole("button", { name: "Roll options" });
    fireEvent.click(button);
    const pop = screen.getByTestId("hud-hand-rolls");
    fireEvent.click(within(pop).getByRole("button", { name: /Forest Guide/ }));
    expect(within(pop).getByRole("button", { name: /Forest Guide/ }).getAttribute("aria-pressed")).toBe("true");
    const herbalist = within(pop).getByRole("button", { name: /Herbalist/ }) as HTMLButtonElement;
    expect(herbalist.disabled).toBe(true);
    expect(herbalist.textContent).toContain("Needs 1 Hope");
    const advantage = within(pop).getByRole("group", { name: "Advantage" });
    for (let i = 0; i < 5; i++) fireEvent.click(within(advantage).getByRole("button", { name: "More advantage" }));
    expect(advantage.querySelector("output")?.textContent).toBe("+3");
    expect((within(advantage).getByRole("button", { name: "More advantage" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(pop).getByRole("group", { name: "Help dice" })).toBeTruthy();
    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByTestId("hud-hand-rolls")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.dataset.set).toBe("true");
  });

  it("More opens the full card over the map with Use and Close; Close and Escape end it and focus goes back to More", () => {
    setHand([ENTANGLE]);
    setCharacter(2);
    renderHand();
    const more = within(fanCard("Vicious Entangle")).getByRole("button", { name: "More about Vicious Entangle" });
    fireEvent.click(more);
    const full = screen.getByTestId("hud-full-card");
    expect(full.hasAttribute("open")).toBe(true);
    // The face's own dialog did not open: only the HUD's full card.
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(within(full).getByRole("heading", { name: "Vicious Entangle", level: 2 })).toBeTruthy();
    expect(within(full).getByRole("button", { name: "Use" })).toBeTruthy();
    fireEvent.click(within(full).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("hud-full-card")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("Use opens the card's pick session (H3.1) with the enemy picked on the map; the card is tagged as being cast", () => {
    const BOLT = card("bolt-beacon", "Bolt Beacon", { domain: "splendor" });
    setHand([BOLT, ENTANGLE]);
    setCharacter(2);
    renderHand({ pickedEnemies: [BANDIT] });
    fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" }));
    expect(calls).toEqual([]);
    expect(screen.getByTestId("session").textContent).toBe(`card:${MOSS}:bolt-beacon`);
    expect(within(fanCard("Bolt Beacon")).getByText("Casting · pick a target")).toBeTruthy();
    expect(fanCard("Bolt Beacon").dataset.wash).toBe("play");
    // Another card's Use replaces the session; the first card lowers.
    fireEvent.click(screen.getByRole("button", { name: "Use Vicious Entangle" }));
    expect(screen.getByTestId("session").textContent).toBe(`card:${MOSS}:vicious-entangle`);
    expect(within(fanCard("Bolt Beacon")).queryByText("Casting · pick a target")).toBeNull();
  });

  it("the vault: Recall · 1 Stress in combat (moveCard), Loadout full · 5 of 5 disabled", async () => {
    setHand([ENTANGLE], [CHAOS]);
    setCharacter(2);
    queries["restsReads:current"] = { open: false };
    const { unmount } = renderHand();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    const vault = screen.getByTestId("hud-hand-vault");
    await act(async () => {
      fireEvent.click(within(vault).getByRole("button", { name: "Recall · 1 Stress, Unleash Chaos" }));
    });
    expect(calls).toEqual([{ name: "characters:moveCard", args: { characterId: MOSS, cardId: "unleash-chaos", to: "loadout", duringRest: false } }]);
    unmount();

    queries["restsReads:current"] = { open: true };
    setHand([ENTANGLE], [CHAOS]);
    const second = renderHand();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    expect(within(screen.getByTestId("hud-hand-vault")).getByRole("button", { name: "Recall · free, Unleash Chaos" })).toBeTruthy();
    second.unmount();

    const five = ["a", "b", "c", "d", "e"].map((id) => card(`wall-walk`, `Card ${id}`, { cardId: `card-${id}` }));
    setHand(five, [CHAOS]);
    renderHand();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    const full = within(screen.getByTestId("hud-hand-vault")).getByRole("button", { name: "Loadout full · 5 of 5, Unleash Chaos" }) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    expect(screen.getByText("Send a card to the vault first")).toBeTruthy();
  });

  it("raiseHand() (the action ring's Cast; dcm-bxp.99.32.20): a folded hand unfolds, the first playable Use takes focus", async () => {
    setHand([WALL, ENTANGLE]);
    setCharacter(0);
    queries["preferences:folds"] = [MOSS];
    const { rerender } = renderHand();
    expect(screen.queryByTestId("hud-hand-fan")).toBeNull();
    await act(async () => {
      expect(raiseHand()).toBe(true);
    });
    expect(calls).toEqual([{ name: "preferences:setFold", args: { campaignId: CAMPAIGN, characterId: MOSS, folded: false } }]);
    // The fold list answers; the fan is drawn and Vicious Entangle's Use (Wall Walk needs 1 Hope) takes focus.
    queries["preferences:folds"] = [];
    rerender(
      <HudProvider>
        <PickProvider>
          <HudHandBody campaignId={CAMPAIGN} mapId={MAP} characterId={MOSS} name="Moss" mode="own" canPlay creatures={[]} pickedEnemies={[]} />
        </PickProvider>
      </HudProvider>,
    );
    expect(document.activeElement).toHaveAccessibleName("Use Vicious Entangle");
    // Already shown: it focuses at once. Another player's hand (view only) registers nothing.
    (document.activeElement as HTMLElement).blur();
    act(() => {
      raiseHand();
    });
    expect(document.activeElement).toHaveAccessibleName("Use Vicious Entangle");
  });

  it("raiseHand() does nothing for a hand that is not yours", () => {
    setHand([ENTANGLE]);
    setCharacter(2);
    renderHand({ mode: "view", canPlay: false });
    expect(raiseHand()).toBe(false);
  });

  it("the vault: Recall waits while the GM holds the spotlight (SPOTLIGHT_WITH_GM; dcm-bxp.99.32.38, CB p.27)", async () => {
    setHand([ENTANGLE], [CHAOS]);
    setCharacter(2);
    queries["restsReads:current"] = { open: false };
    queries["combatSpotlight:state"] = { holder: { kind: "gm" }, since: 1, reason: "gmTook", rollBy: null, reactionsOnly: true, canMove: false };
    renderHand();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    const recall = within(screen.getByTestId("hud-hand-vault")).getByRole("button", { name: "Recall · 1 Stress, Unleash Chaos" });
    expect(recall).toHaveAttribute("aria-disabled", "true");
    expect(recall).toHaveAccessibleDescription("The GM has the spotlight · reactions only");
    await act(async () => {
      fireEvent.click(recall);
    });
    expect(calls).toEqual([]);
  });

  it("the GM's hand is locked until Play-for: the lock tag, no Use, no Roll options, no recall", () => {
    setHand([ENTANGLE], [CHAOS]);
    renderHand({ mode: "gm", canPlay: false });
    expect(screen.getByRole("region", { name: "Hand of Moss" })).toBeTruthy();
    expect(within(fanCard("Vicious Entangle")).getByText("Turn on “Play for Moss”")).toBeTruthy();
    expect(fanCard("Vicious Entangle").dataset.wash).toBe("locked");
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll options" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    expect(within(screen.getByTestId("hud-hand-vault")).queryByRole("button", { name: /Recall/ })).toBeNull();
  });

  it("another player's hand is view only: the tag, no Use, no vault or side buttons", () => {
    setHand([ENTANGLE]);
    renderHand({ mode: "view", canPlay: false, name: "Brannoc" });
    expect(screen.getByRole("region", { name: "Hand of Brannoc" })).toBeTruthy();
    expect(within(fanCard("Vicious Entangle")).getByText("Brannoc’s hand · view only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide cards" })).toBeNull();
    expect(screen.queryByRole("button", { name: /vault/ })).toBeNull();
  });

  it("a hidden hand: the backs and why", () => {
    const { unmount } = render(<HiddenHand name="Vex" gmPrivate={false} />);
    expect(screen.getByText("Vex keeps their hand hidden.")).toBeTruthy();
    unmount();
    render(<HiddenHand name="Vex" gmPrivate />);
    expect(screen.getByText("The GM keeps every player’s cards private.")).toBeTruthy();
  });

  it("shows a loading line while the hand loads", () => {
    renderHand();
    expect(screen.getByRole("status").textContent).toBe("Loading the hand…");
  });
});
