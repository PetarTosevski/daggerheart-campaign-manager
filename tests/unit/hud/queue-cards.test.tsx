/**
 * Plan combat-hud H5.1 (GMDesktop 'Requests', CmpPromptsGM): the GM's "Waiting on you" queue — one card per open request
 * from the merged reads, each answered by its existing keyed mutation; "Already answered" on REQUEST_NOT_OPEN; the death
 * move confirm in the queue; Resolutions with Undo and UNDO_STALE shown. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudQueue } from "@/components/combat-map/hud/queue";
import { HudResolutions } from "@/components/combat-map/hud/queue/resolutions";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";
import type { CombatPageState } from "@/components/combat-map/slots";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const results: Record<string, unknown> = {};
const failures: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  // deathMoves.state is per character: its entry is keyed by characterId.
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    const value = queries[name];
    return name === "deathMoves:state" ? (value as Record<string, unknown> | undefined)?.[(args as { characterId: string }).characterId] : value;
  },
  useQueries: (request: Record<string, { query: unknown; args: { characterId: string } }>) =>
    Object.fromEntries(Object.entries(request).map(([k, q]) => [k, (queries[functionName(q.query)] as Record<string, unknown> | undefined)?.[q.args.characterId]])),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (failures[name]) throw failures[name];
      return results[name];
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  calls.length = 0;
  for (const m of [queries, results, failures]) for (const k of Object.keys(m)) delete m[k];
});

function page(role: "gm" | "player"): CombatPageState {
  return { campaignId: "camp", role, mode: "play", map: null, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
}

const deathBase = { awaitingMove: false, pending: null, request: null, undoEntryId: null, lessLethal: false, awayRequested: false };
const moss = { _id: "c-moss", mine: false, canEdit: true, corrupt: false, status: "active", updatedAt: 5, sheet: { name: "Moss", level: 1, hp: 6, hpMax: 6, stress: 0, conditions: [] } };
const sniper = { tokenId: "t-sniper", name: "Sniper" };

/** Every read loaded and empty, Moss in the party. */
function empty() {
  queries["combatRequestsReads:mine"] = [];
  queries["combatCardsReads:pending"] = [];
  queries["combatFeaturesReads:pending"] = [];
  queries["combatRequestsReads:difficulties"] = [];
  queries["adversaryActionsReads:windows"] = [];
  queries["cloakPromptsReads:pending"] = [];
  queries["hitKeywordsReads:asks"] = [];
  queries["charactersReads:listByCampaign"] = [moss];
  queries["featurePromptsReads:allyRolls"] = { asks: [], waiting: [], allies: [], pending: [] };
  queries["deathMoves:state"] = { "c-moss": deathBase };
  queries["feed:list"] = { page: [], isDone: true, continueCursor: "" };
}

function full() {
  empty();
  queries["combatRequestsReads:mine"] = [{ kind: "sanction", requestId: "r-att", characterId: "c-moss", characterName: "Moss", createdAt: 1, slot: "primary", targets: [sniper], outOfRange: [{ tokenId: "t-sniper", band: "veryFar" }] }];
  queries["combatCardsReads:pending"] = [{ requestId: "r-card", characterId: "c-moss", characterName: "Moss", cardId: "vicious-entangle", cardName: "Vicious Entangle", useId: "main", createdAt: 2, targets: [sniper], outOfRange: [{ tokenId: "t-sniper", band: "veryFar" }] }];
  queries["combatRequestsReads:difficulties"] = [{ requestId: "r-dif", characterId: "c-b", characterName: "Brannoc", createdAt: 3, ask: "charge", target: { tokenId: "t-b", name: "Bandit" }, seers: [] }];
  queries["adversaryActionsReads:windows"] = [
    { requestId: "r-win", attackerLabel: "Bandit", originalTargetId: "c-moss", targetCharacterId: "c-moss", targetName: "Moss", damage: 9, damageType: "physical", direct: false, critical: false, awaiting: [{ characterId: "c-o", name: "Oriel", role: "ally" }], answers: 0, createdAt: 4 },
  ];
  queries["cloakPromptsReads:pending"] = [{ requestId: "r-clo", characterId: "c-v", characterName: "Vex", label: "Words of Discord", targets: [{ tokenId: "t-b", name: "Bandit" }], createdAt: 5 }];
  queries["hitKeywordsReads:asks"] = [{ requestId: "r-key", attackerLabel: "Bandit", targetCharacterId: "c-a", targetName: "Ash", keyword: "fire", guard: "Fireproof", question: "Was this hit fire?", damage: 6, damageType: "physical", createdAt: 6 }];
  queries["featurePromptsReads:allyRolls"] = { asks: [], waiting: [], allies: [], pending: [{ requestId: "r-ally", characterName: "Moss", rollerName: "Brannoc", featureName: "Cannonball", createdAt: 7 }] };
  queries["deathMoves:state"] = { "c-moss": { ...deathBase, request: { move: "avoidDeath", entryId: "e", at: 8 } } };
}

describe("Waiting on you", () => {
  it("renders nothing on a player's view", () => {
    full();
    const { container } = render(<HudQueue state={page("player")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("one CmpPromptsGM card per request, oldest first, the death confirm counted; no Momentum or Hope split", () => {
    full();
    render(<HudQueue state={page("gm")} />);
    const queue = screen.getByRole("region", { name: /Waiting on you/ });
    expect(within(queue).getByTestId("hud-queue-count")).toHaveTextContent("8");
    const list = within(queue).getByRole("list", { name: "Requests waiting on you" });
    const titles = within(list)
      .getAllByRole("dialog")
      .map((d) => d.querySelector(".hud-pc-t")?.textContent);
    expect(titles).toEqual(["Out of range: your call", "Out of range: your call", "Set the Difficulty", "Reactions", "Does Vex’s Cloaked end?", "Was this hit fire?", "Ally roll"]);
    expect(within(queue).getByRole("dialog", { name: "Death move to confirm" })).toHaveTextContent("Moss chose Avoid Death");
    expect(queue).not.toHaveTextContent(/Momentum|Hope split/);
    expect(within(list).getAllByRole("dialog")[0]).toHaveTextContent("Moss · Attack on Sniper (Very Far)");
    expect(within(list).getAllByRole("dialog")[0]).toHaveTextContent("Sniper is Very Far. Nothing is rolled or paid until you decide.");
    expect(within(list).getAllByRole("dialog")[3]).toHaveTextContent("Waiting on Oriel");
  });

  it("empty and loading", () => {
    empty();
    const view = render(<HudQueue state={page("gm")} />);
    expect(screen.getByText("Nothing is waiting on you.")).toBeInTheDocument();
    expect(screen.getByTestId("hud-queue-count")).toHaveTextContent("0");
    delete queries["combatRequestsReads:mine"];
    view.rerender(<HudQueue state={page("gm")} />);
    expect(screen.getByText("Loading the requests…")).toHaveAttribute("role", "status");
  });

  it("Allow sends combatRequests.sanction and says so; Decline on a card sends combatCards.sanction", async () => {
    full();
    results["combatRequests:sanction"] = { status: "resolved" };
    results["combatCards:sanction"] = { status: "declined" };
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Attack" })));
    expect(calls[0]).toEqual({ name: "combatRequests:sanction", args: expect.objectContaining({ campaignId: "camp", requestId: "r-att", approve: true, idempotencyKey: expect.any(String) }) });
    expect(screen.getByTestId("hud-queue-result")).toHaveTextContent("Allowed: Moss · Attack.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Decline: Moss · Vicious Entangle" })));
    expect(calls[1]).toEqual({ name: "combatCards:sanction", args: expect.objectContaining({ requestId: "r-card", approve: false }) });
    expect(screen.getByTestId("hud-queue-result")).toHaveTextContent("Declined: Moss · Vicious Entangle.");
  });

  it("a card that needs a choice keeps its card with a note", async () => {
    full();
    results["combatCards:sanction"] = { status: "needsChoice", asks: [] };
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Vicious Entangle" })));
    expect(screen.getByRole("alert")).toHaveTextContent("needs a choice the player makes");
  });

  it("REQUEST_NOT_OPEN: 'Already answered' as the table's neutral toast, nothing on the card", async () => {
    // H6.3: the in-queue "Already answered: <label>" row became CmpBlocked's STALE_REQUEST toast (toast host, dismissable there).
    hudToasts.reset();
    full();
    failures["combatRequests:sanction"] = new ConvexError({ code: "REQUEST_NOT_OPEN" });
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Attack" })));
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Already answered", message: "Someone already answered this.", tone: "neutral" })]);
    expect(within(screen.getAllByTestId("hud-queue-range")[0]!).queryByRole("alert")).toBeNull();
    hudToasts.reset();
  });

  it("another refusal stays on the card as an alert", async () => {
    full();
    failures["adversaryActions:resolve"] = new ConvexError({ code: "COMBAT_TARGET_INVALID" });
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Resolve now/ })));
    expect(within(screen.getByTestId("hud-queue-reactions")).getByRole("alert")).toBeInTheDocument();
  });

  it("Set the Difficulty: the stepper, Set and roll sends featurePrompts.answerDifficulty; Decline sends null", async () => {
    full();
    results["featurePrompts:answerDifficulty"] = { status: "charged", moved: true, use: { roll: { total: 15 } } };
    render(<HudQueue state={page("gm")} />);
    const card = screen.getByTestId("hud-queue-difficulty");
    expect(card).toHaveTextContent("Brannoc · Agility Roll");
    fireEvent.click(within(card).getByRole("button", { name: "More Difficulty" }));
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: /^Set Difficulty 13 and roll/ })));
    expect(calls[0]).toEqual({ name: "featurePrompts:answerDifficulty", args: expect.objectContaining({ requestId: "r-dif", difficulty: 13 }) });
    expect(screen.getByTestId("hud-queue-result")).toHaveTextContent("Brannoc rolled 15: charged into Melee.");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Decline: Brannoc · Agility Roll" })));
    expect(calls[1]).toEqual({ name: "featurePrompts:answerDifficulty", args: expect.objectContaining({ difficulty: null }) });
  });

  it("Cloaked, fire, reactions and ally rolls each send their own mutation", async () => {
    full();
    results["cloakPrompts:answer"] = { status: "ended" };
    results["hitKeywords:answer"] = { status: "resolved" };
    results["adversaryActions:resolve"] = { status: "resolved", requestId: "r-win" };
    results["featurePrompts:cancelAllyRoll"] = null;
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-queue-cloak")).getByRole("button", { name: /^Yes, Cloaked ends/ })));
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-queue-keyword")).getByRole("button", { name: /^Yes, fire/ })));
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-queue-reactions")).getByRole("button", { name: /^Resolve now/ })));
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-queue-ally")).getByRole("button", { name: /^Cancel the roll/ })));
    expect(calls.map((c) => c.name)).toEqual(["cloakPrompts:answer", "hitKeywords:answer", "adversaryActions:resolve", "featurePrompts:cancelAllyRoll"]);
    expect(calls[0]!.args).toEqual(expect.objectContaining({ requestId: "r-clo", ends: true }));
    expect(calls[1]!.args).toEqual(expect.objectContaining({ requestId: "r-key", answer: { keyword: "fire", carries: true } }));
    expect(calls[3]!.args).toEqual(expect.objectContaining({ requestId: "r-ally" }));
  });

  it("the death confirm answers through deathMoves.confirm", async () => {
    full();
    results["deathMoves:confirm"] = { entryId: "m", status: "active", pending: null, hopeDie: 1, fearDie: null, scarred: true, journeyEnds: false, awaitingGm: false };
    render(<HudQueue state={page("gm")} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm the death move" })));
    expect(calls).toEqual([{ name: "deathMoves:confirm", args: expect.objectContaining({ characterId: "c-moss" }) }]);
  });
});

describe("Resolutions", () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({ _id: id, at: 1, kind: "combat", visibility: "gm", summary: `row ${id}`, undone: false, canUndo: true, revealable: false, ...over });

  it("lists the GM's combat and adversary rows with Undo; Undo sends actionLog.undo", async () => {
    empty();
    queries["feed:list"] = { page: [row("a"), row("b", { kind: "adversary", fearDelta: 1 }), row("c", { visibility: "public" }), row("d", { undone: true, canUndo: false })], isDone: true, continueCursor: "" };
    results["actionLog:undo"] = { undone: ["a"], fearReverted: 0 };
    render(<HudResolutions campaignId={page("gm").campaignId} />);
    const list = screen.getByRole("list", { name: "Latest resolutions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("GM gains 1 Fear");
    expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent("undone");
    await act(async () => fireEvent.click(within(list).getByRole("button", { name: "Undo: row a" })));
    expect(calls).toEqual([{ name: "actionLog:undo", args: expect.objectContaining({ entryId: "a" }) }]);
  });

  it("UNDO_STALE is shown", async () => {
    empty();
    queries["feed:list"] = { page: [row("a")], isDone: true, continueCursor: "" };
    failures["actionLog:undo"] = new ConvexError({ code: "UNDO_STALE" });
    render(<HudResolutions campaignId={page("gm").campaignId} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo: row a" })));
    expect(screen.getByTestId("hud-resolutions-error")).toHaveTextContent("That can't be undone any more");
  });
});
