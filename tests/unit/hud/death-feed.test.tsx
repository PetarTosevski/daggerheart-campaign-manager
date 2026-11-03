/**
 * Plan combat-hud H4.3: the HUD's death move (Main 'Last Hit Point') and the player's "Just now" feed. A player at their
 * last Hit Point gets 'Choose a death move' (core wording, the footer), then 'Waiting for the GM to confirm' with Take
 * it back; the GM gets the confirm popup (Confirm the death move / Send it back; H5.1 mounts it in the request queue,
 * so these tests render it directly); both see the outcome. The feed shows
 * `feed.list`'s rows on the player view only. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { HudDeath } from "@/components/combat-map/hud/death";
import { GmDeathConfirm } from "@/components/combat-map/hud/death/confirm";
import { DEATH_MOVE_RULES, deathPhase, requestFate } from "@/components/combat-map/hud/death/model";
import { DEATH_FOOTER } from "@/components/combat-map/hud/death/own";
import { HudFeed } from "@/components/combat-map/hud/feed";
import { feedDetail, feedIcon } from "@/components/combat-map/hud/feed/model";
import type { CombatPageState } from "@/components/combat-map/slots";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const results: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name];
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(results)) delete results[k];
});

const STATE = "deathMoves:state";
const CHARACTERS = "characters:listByCampaign";
const FEED = "feed:list";
const base = { awaitingMove: false, pending: null, request: null, undoEntryId: null, lessLethal: false, awayRequested: false };

function character(mine: boolean) {
  return { _id: "c-moss", mine, canEdit: true, corrupt: false, status: "active", updatedAt: 5, sheet: { name: "Moss", level: 1, hp: 6, hpMax: 6, stress: 0, conditions: [] } };
}

function page(role: "gm" | "player"): CombatPageState {
  return { campaignId: "camp", role, mode: "play", map: null, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
}

function row(id: string, over: Record<string, unknown> = {}) {
  return { _id: id, at: 1, kind: "death", summary: id, characterId: "c-moss", actorId: "u", undone: false, canUndo: false, visibility: "public", ...over };
}

describe("model", () => {
  it("deathPhase: a waiting request first, then a finish step, then the choice", () => {
    expect(deathPhase({ awaitingMove: true, pending: null, request: null })).toBe("choose");
    expect(deathPhase({ awaitingMove: false, pending: null, request: { move: "riskItAll", entryId: "r" } })).toBe("wait");
    expect(deathPhase({ awaitingMove: false, pending: { move: "blazeOfGlory" }, request: null })).toBe("finish");
    expect(deathPhase({ awaitingMove: false, pending: null, request: null })).toBe("none");
  });

  it("requestFate: the newest live death row above the request is the outcome; an undone request came back", () => {
    const req = row("req");
    expect(requestFate([row("move"), req], "req", "c-moss")).toEqual({ kind: "outcome", text: "move" });
    expect(requestFate([row("other", { characterId: "c-x" }), req], "req", "c-moss")).toEqual({ kind: "none" });
    expect(requestFate([row("move", { undone: true }), { ...req, undone: true }], "req", "c-moss")).toEqual({ kind: "back" });
    expect(requestFate([row("move")], "req", "c-moss")).toEqual({ kind: "none" });
  });

  it("the moves read the core book's words (CB p.106), not the board's sample copy", () => {
    expect(DEATH_MOVE_RULES.avoidDeath).toContain("the party finishes a long rest");
    expect(DEATH_MOVE_RULES.avoidDeath).not.toContain("scene ends");
    expect(DEATH_MOVE_RULES.blazeOfGlory).toContain("critically succeeds");
  });

  it("feed icons and detail lines", () => {
    expect(feedIcon({ kind: "adversary" })).toBe("hit");
    expect(feedIcon({ kind: "death" })).toBe("death");
    expect(feedIcon({ kind: "roll", roll: { total: 14, outcome: "successFear", kind: "action" } })).toBe("dice");
    expect(feedDetail({ kind: "roll", roll: { total: 14, outcome: "successFear", kind: "action" }, fearDelta: 1, undone: false })).toBe("14 · Success with Fear · GM gains 1 Fear");
    expect(feedDetail({ kind: "death", roll: { total: 0, outcome: "critical", kind: "action" }, undone: true })).toBe("undone");
  });
});

describe("the player's death move", () => {
  it("the last Hit Point opens 'Choose a death move' with the three moves and the footer; a pick asks the GM", async () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, awaitingMove: true };
    results["deathMoves:choose"] = { entryId: "req", status: "active", pending: null, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false, awaitingGm: true };
    render(<HudDeath state={page("player")} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a death move" });
    expect(dialog).toHaveTextContent("Moss marked their last Hit Point");
    expect(dialog).toHaveTextContent(DEATH_FOOTER);
    for (const name of ["Blaze of Glory", "Avoid Death", "Risk It All"]) expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Avoid Death" })).toHaveAccessibleDescription(DEATH_MOVE_RULES.avoidDeath);
    fireEvent.change(within(dialog).getByLabelText(/your last action/), { target: { value: "holds the gate" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Blaze of Glory" })));
    expect(calls).toEqual([{ name: "deathMoves:choose", args: expect.objectContaining({ characterId: "c-moss", move: "blazeOfGlory", action: "holds the gate" }) }]);
    expect(screen.queryByTestId("hud-death-outcome")).toBeNull();
  });

  it("while it waits: 'Waiting for the GM to confirm' with Take it back (an undo of the request row)", async () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, request: { move: "riskItAll", entryId: "req", at: 1 }, undoEntryId: "req" };
    results["deathMoves:undo"] = null;
    render(<HudDeath state={page("player")} />);
    const dialog = screen.getByRole("dialog", { name: "Waiting for the GM to confirm" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Waiting for the GM to confirm Risk It All.");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Take it back" })));
    expect(calls).toEqual([{ name: "deathMoves:undo", args: expect.objectContaining({ entryId: "req" }) }]);
  });

  it("closing the modal leaves a button that opens it again", () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, awaitingMove: true };
    render(<HudDeath state={page("player")} />);
    fireEvent.click(screen.getByRole("button", { name: "Close choose a death move" }));
    expect(screen.queryByRole("dialog", { name: "Choose a death move" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Moss: choose a death move" }));
    expect(screen.getByRole("dialog", { name: "Choose a death move" })).toBeInTheDocument();
  });

  it("after the GM's confirm the player sees the outcome from the feed; Got it closes it", () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, request: { move: "avoidDeath", entryId: "req", at: 1 } };
    const view = render(<HudDeath state={page("player")} />);
    // The GM confirms: the request is gone, the move's row sits above the request row.
    queries[STATE] = { ...base };
    queries[FEED] = { page: [row("Moss avoids death and drops unconscious. Hope Die 3 against level 1: no scar."), row("req")], isDone: true, continueCursor: "" };
    view.rerender(<HudDeath state={page("player")} />);
    const outcome = screen.getByTestId("hud-death-outcome");
    expect(within(outcome).getByRole("status")).toHaveTextContent("Hope Die 3 against level 1: no scar.");
    expect(outcome).toHaveTextContent("Avoid Death · confirmed by the GM");
    fireEvent.click(within(outcome).getByRole("button", { name: "Got it" }));
    expect(screen.queryByTestId("hud-death-outcome")).toBeNull();
  });

  it("sent back: the choice opens again and says so", () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, request: { move: "riskItAll", entryId: "req", at: 1 } };
    const view = render(<HudDeath state={page("player")} />);
    queries[STATE] = { ...base, awaitingMove: true };
    queries[FEED] = { page: [row("The GM sends back", { characterId: undefined }), row("req", { undone: true })], isDone: true, continueCursor: "" };
    view.rerender(<HudDeath state={page("player")} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a death move" });
    expect(dialog).toHaveTextContent("The GM sent back Risk It All. Choose again.");
  });

  it("a confirmed Blaze of Glory finishes in the sheet's own modal", () => {
    queries[CHARACTERS] = [character(true)];
    queries[STATE] = { ...base, pending: { move: "blazeOfGlory" }, undoEntryId: "m" };
    render(<HudDeath state={page("player")} />);
    expect(screen.getByTestId("hud-death-sheet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cross through the veil" })).toBeInTheDocument();
  });
});

describe("the rest of the table (user answer 2026-11-02)", () => {
  const ROLL = { kind: "free", dice: [], modifier: 0, total: 3, outcome: "none", manual: false };
  const vex = { ...character(true), _id: "c-vex", sheet: { ...character(true).sheet, name: "Vex" } };

  it("every other player sees the outcome popup; history and the request row don't show; Got it closes it", () => {
    queries[CHARACTERS] = [vex, character(false)];
    queries[STATE] = { ...base };
    queries[FEED] = { page: [row("Moss avoided death last session.", { roll: ROLL }), row("older")], isDone: true, continueCursor: "" };
    const view = render(<HudDeath state={page("player")} />);
    expect(screen.queryByTestId("hud-death-table")).toBeNull();
    // Moss asks: the request row carries no dice, so nothing shows yet.
    queries[FEED] = { page: [row("Moss chooses Avoid Death. Waiting for the GM to confirm."), row("Moss avoided death last session.", { roll: ROLL })], isDone: true, continueCursor: "" };
    view.rerender(<HudDeath state={page("player")} />);
    expect(screen.queryByTestId("hud-death-table")).toBeNull();
    // The GM confirms: the move's row (with its Hope Die) shows for Vex's player too.
    queries[FEED] = {
      page: [row("Moss avoids death and drops unconscious. Hope Die 3 against level 1: no scar.", { roll: ROLL }), row("req"), row("Moss avoided death last session.", { roll: ROLL })],
      isDone: true,
      continueCursor: "",
    };
    view.rerender(<HudDeath state={page("player")} />);
    const popup = screen.getByTestId("hud-death-table");
    expect(popup).toHaveTextContent("Moss’s death move");
    expect(within(popup).getByRole("status")).toHaveTextContent("Hope Die 3 against level 1: no scar.");
    fireEvent.click(within(popup).getByRole("button", { name: "Got it" }));
    expect(screen.queryByTestId("hud-death-table")).toBeNull();
  });

  it("an outcome that landed while the view was loading (under 30 s old) still shows", () => {
    queries[CHARACTERS] = [vex, character(false)];
    queries[STATE] = { ...base };
    queries[FEED] = { page: [row("Moss goes out in a Blaze of Glory.", { roll: ROLL, at: Date.now() - 2_000 })], isDone: true, continueCursor: "" };
    render(<HudDeath state={page("player")} />);
    expect(screen.getByTestId("hud-death-table")).toHaveTextContent("Moss goes out in a Blaze of Glory.");
  });

  it("not for the chooser (their own popup shows it) nor on the GM view (the confirm shows it)", () => {
    queries[STATE] = { ...base };
    queries[FEED] = { page: [], isDone: true, continueCursor: "" };
    queries[CHARACTERS] = [character(true)];
    const view = render(<HudDeath state={page("player")} />);
    queries[FEED] = { page: [row("Moss goes out in a Blaze of Glory.", { roll: ROLL })], isDone: true, continueCursor: "" };
    view.rerender(<HudDeath state={page("player")} />);
    expect(screen.queryByTestId("hud-death-table")).toBeNull();
    view.unmount();
    queries[CHARACTERS] = [character(false)];
    queries[FEED] = { page: [], isDone: true, continueCursor: "" };
    const gm = render(<HudDeath state={page("gm")} />);
    queries[FEED] = { page: [row("Moss goes out in a Blaze of Glory.", { roll: ROLL })], isDone: true, continueCursor: "" };
    gm.rerender(<HudDeath state={page("gm")} />);
    expect(screen.queryByTestId("hud-death-table")).toBeNull();
  });
});

describe("the GM's confirm popup", () => {
  it("shows the request; Confirm the death move confirms and shows the outcome", async () => {
    queries[CHARACTERS] = [character(false)];
    queries[STATE] = { ...base, request: { move: "avoidDeath", entryId: "req", at: 1 } };
    results["deathMoves:confirm"] = { entryId: "m", status: "active", pending: null, hopeDie: 1, fearDie: null, scarred: true, journeyEnds: false, awaitingGm: false };
    const gmView = () => <GmDeathConfirm character={character(false) as unknown as Parameters<typeof GmDeathConfirm>[0]["character"]} />;
    const view = render(gmView());
    expect(screen.queryByRole("dialog", { name: "Choose a death move" })).toBeNull();
    const popup = screen.getByRole("dialog", { name: "Death move to confirm" });
    expect(popup).toHaveTextContent("Moss chose Avoid Death");
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Confirm the death move" })));
    expect(calls).toEqual([{ name: "deathMoves:confirm", args: expect.objectContaining({ characterId: "c-moss" }) }]);
    queries[STATE] = { ...base };
    view.rerender(gmView());
    expect(within(screen.getByTestId("hud-death-outcome")).getByRole("status")).toHaveTextContent("Hope Die 1 against level 1: a scar.");
  });

  it("Send it back declines", async () => {
    queries[CHARACTERS] = [character(false)];
    queries[STATE] = { ...base, request: { move: "riskItAll", entryId: "req", at: 1 } };
    results["deathMoves:decline"] = null;
    render(<GmDeathConfirm character={character(false) as unknown as Parameters<typeof GmDeathConfirm>[0]["character"]} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send it back" })));
    expect(calls).toEqual([{ name: "deathMoves:decline", args: expect.objectContaining({ characterId: "c-moss" }) }]);
  });
});

describe("Just now", () => {
  it("lists feed.list's rows on the player view", () => {
    queries[FEED] = { page: [row("a", { kind: "roll", summary: "Vex rolled", roll: { kind: "action", total: 14, outcome: "successFear", dice: [], modifier: 0, manual: false } })], isDone: true, continueCursor: "" };
    render(<HudFeed state={page("player")} />);
    const feed = screen.getByRole("region", { name: "Just now" });
    expect(within(feed).getByRole("listitem")).toHaveTextContent("Vex rolled 14 · Success with Fear");
  });

  it("is empty-safe and loading-safe, and the GM view has none (Resolutions are H5.1's)", () => {
    const view = render(<HudFeed state={page("player")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the feed…");
    queries[FEED] = { page: [], isDone: true, continueCursor: "" };
    view.rerender(<HudFeed state={page("player")} />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    view.rerender(<HudFeed state={page("gm")} />);
    expect(screen.queryByRole("region", { name: "Just now" })).toBeNull();
  });
});
