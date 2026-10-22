/**
 * The incoming-hit prompt (plan combat-actions AA4): the pure model (what the hit PC is asked, CB p.114, p.99, p.341;
 * the optimistic `pending` after an answer) and the prompt with Convex mocked: the hit PC's Mark / Don't, OK only for
 * direct damage, a count of slots under I Am Your Shield, an ally's reaction card with Use / Pass, the one line
 * "Bandit hit Mira" when nothing is owed (Q14), one `respond` per tap, nothing for the GM on the map, a death move
 * brought up on the map, and the sheet's prompt only for a viewer who edits the character.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { IncomingHit, PendingHits } from "@/components/combat-map/actions/reactions";
import {
  afterAnswer,
  armorQuestion,
  damageLine,
  hitLine,
  playableCards,
  promptMode,
  reactionCard,
  type HitView,
} from "@/components/combat-map/actions/reactions/model";

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
      return { status: "open", requestId: args.requestId };
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const sheetState: { canEdit: boolean } = { canEdit: true };
vi.mock("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet-context", () => ({
  useSheet: () => ({
    character: { _id: "c-mira", sheet: { name: "Mira" } },
    canEdit: sheetState.canEdit,
    slot: { campaignId: "camp" },
  }),
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
  sheetState.canEdit = true;
});

const CAMPAIGN = "camp" as Id<"campaigns">;
const MIRA = "c-mira" as Id<"characters">;
const TABBY = "c-tabby" as Id<"characters">;
const REQ = "req-1" as Id<"combatRequests">;

const base = { requestId: REQ, attackerLabel: "Bandit", targetCharacterId: MIRA, targetName: "Mira", awaiting: true, cardIds: [] as string[], createdAt: 1 };

/** Mira is hit for 14: Major (2 HP), one slot makes it Minor (1 HP). */
const miraHit: HitView = {
  ...base,
  role: "target",
  damage: 14,
  severity: "major",
  direct: false,
  maxSlots: 1,
  armorPreview: [
    { slots: 0, severity: "major", hp: 2 },
    { slots: 1, severity: "minor", hp: 1 },
  ],
};
/** Tabby sees Mira's hit with I Am Your Shield. */
const tabbyAlly: HitView = { ...base, role: "ally", cardIds: ["i-am-your-shield"] };
/** Tabby after I Am Your Shield: the target, any number of slots (CB p.341). */
const tabbyShield: HitView = {
  ...base,
  targetCharacterId: TABBY,
  targetName: "Tabby",
  role: "target",
  damage: 14,
  severity: "major",
  direct: false,
  maxSlots: 3,
  armorPreview: [
    { slots: 0, severity: "major", hp: 2 },
    { slots: 1, severity: "minor", hp: 1 },
    { slots: 2, severity: "none", hp: 0 },
    { slots: 3, severity: "none", hp: 0 },
  ],
};

const respondCalls = () => calls.filter((c) => c.name === "adversaryActions:respond");
const ENEMY_WORDS = /roll|Evasion|Difficulty|threshold|Stress|\bATK\b|d20/i;

describe("incoming-hit model", () => {
  it("asks the hit PC to mark one slot, in their own numbers (CB p.114)", () => {
    expect(promptMode(miraHit)).toBe("armorOne");
    expect(damageLine(miraHit)).toBe("14 damage: Major (2 HP).");
    expect(armorQuestion(miraHit)).toBe("Mark an Armor Slot to make it Minor?");
  });

  it("offers OK only for direct damage (CB p.99) or no slot left", () => {
    expect(promptMode({ ...miraHit, direct: true })).toBe("ok");
    expect(armorQuestion({ ...miraHit, direct: true })).toMatch(/Direct damage/);
    expect(promptMode({ ...miraHit, maxSlots: 0, armorPreview: [miraHit.armorPreview![0]!] })).toBe("ok");
  });

  it("asks for a count under I Am Your Shield; one slot to nothing says so", () => {
    expect(promptMode(tabbyShield)).toBe("armorMany");
    const toNone: HitView = { ...miraHit, armorPreview: [{ slots: 0, severity: "minor", hp: 1 }, { slots: 1, severity: "none", hp: 0 }] };
    expect(armorQuestion(toNone)).toBe("Mark an Armor Slot to take no damage?");
  });

  it("an ally reacts; nothing owed is waiting", () => {
    expect(promptMode(tabbyAlly)).toBe("ally");
    expect(promptMode({ ...tabbyAlly, awaiting: false })).toBe("waiting");
    expect(hitLine(tabbyAlly)).toBe("Bandit hit Mira");
    expect(reactionCard("i-am-your-shield").name).toBe("I Am Your Shield");
  });

  it("the new target after I Am Your Shield can't play it again; Shrug It Off stays", () => {
    expect(playableCards({ role: "target", cardIds: ["i-am-your-shield", "shrug-it-off"] })).toEqual(["shrug-it-off"]);
    expect(playableCards(tabbyAlly)).toEqual(["i-am-your-shield"]);
  });

  it("the optimistic pending: an answer stops awaiting; the target's card only leaves the list", () => {
    expect(afterAnswer([tabbyAlly], REQ, { kind: "pass" })[0]!.awaiting).toBe(false);
    const shrug: HitView = { ...miraHit, cardIds: ["shrug-it-off"] };
    const after = afterAnswer([shrug], REQ, { kind: "card", cardId: "shrug-it-off" })[0]!;
    expect(after).toMatchObject({ awaiting: true, cardIds: [] });
    expect(afterAnswer([miraHit], "other" as Id<"combatRequests">, { kind: "noArmor" })[0]).toBe(miraHit);
  });
});

function renderFor(characterId: Id<"characters">, name: string, views: HitView[]) {
  queries["adversaryActions:pending"] = views;
  return render(<PendingHits campaignId={CAMPAIGN} characterId={characterId} characterName={name} variant="map" />);
}

describe("the prompt", () => {
  it("the hit PC: Mark sends one armor answer; Don't sends noArmor; never the roll", () => {
    renderFor(MIRA, "Mira", [miraHit]);
    const card = screen.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    expect(within(card).getByText("14 damage: Major (2 HP).")).toBeTruthy();
    expect(within(card).getByText("Mark an Armor Slot to make it Minor?")).toBeTruthy();
    expect(card.textContent).not.toMatch(ENEMY_WORDS);
    fireEvent.click(within(card).getByRole("button", { name: "Mark" }));
    expect(respondCalls()).toHaveLength(1);
    expect(respondCalls()[0]!.args).toMatchObject({ campaignId: CAMPAIGN, requestId: REQ, characterId: MIRA, choice: { kind: "armor", slots: 1 } });
    expect(typeof respondCalls()[0]!.args.idempotencyKey).toBe("string");
  });

  it("Don't answers noArmor", () => {
    renderFor(MIRA, "Mira", [miraHit]);
    fireEvent.click(screen.getByRole("button", { name: "Don't" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "noArmor" });
  });

  it("direct damage: only OK", () => {
    renderFor(MIRA, "Mira", [{ ...miraHit, direct: true }]);
    expect(screen.queryByRole("button", { name: "Mark" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "noArmor" });
  });

  it("an ally: the card with Use and Pass, no damage numbers", () => {
    renderFor(TABBY, "Tabby", [tabbyAlly]);
    const card = screen.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    expect(within(card).getByText("Tabby can react")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "I Am Your Shield" })).toBeTruthy();
    expect(card.textContent).not.toMatch(/\d+ damage/);
    fireEvent.click(within(card).getByRole("button", { name: "Use I Am Your Shield" }));
    expect(respondCalls()[0]!.args).toMatchObject({ characterId: TABBY, choice: { kind: "card", cardId: "i-am-your-shield" } });
  });

  it("an ally passes", () => {
    renderFor(TABBY, "Tabby", [tabbyAlly]);
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "pass" });
  });

  it("I Am Your Shield: Tabby marks two Armor Slots", () => {
    renderFor(TABBY, "Tabby", [{ ...tabbyShield, cardIds: ["i-am-your-shield"] }]);
    expect(screen.queryByRole("button", { name: "Use I Am Your Shield" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark 1: Minor (1 HP)" })).toBeTruthy();
    expect(screen.getByText("Mark any number of Armor Slots to reduce it.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Mark \d/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^Mark 2/ }));
    expect(respondCalls()).toHaveLength(1);
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "armor", slots: 2 });
  });

  it("nothing owed: only 'Bandit hit Mira'", () => {
    renderFor(MIRA, "Mira", [{ ...tabbyAlly, cardIds: [], awaiting: false }]);
    expect(screen.getByRole("status").textContent).toMatch(/^Bandit hit Mira/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("nothing open renders nothing", () => {
    const { container } = renderFor(MIRA, "Mira", []);
    expect(container.innerHTML).toBe("");
  });
});

const mapProps = (role: "gm" | "player") =>
  ({
    campaignId: CAMPAIGN,
    role,
    mode: "play",
    map: { _id: "m", name: "Road", live: true, source: "generated", w: 20, h: 20 },
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
  }) as unknown as Parameters<typeof IncomingHit>[0];

const character = (id: string, name: string, mine: boolean) => ({ _id: id, mine, canEdit: mine, status: "active", updatedAt: 1, sheet: { name } });

describe("IncomingHit on the map", () => {
  it("the GM column shows nothing", () => {
    queries["characters:listByCampaign"] = [character(MIRA, "Mira", true)];
    queries["adversaryActions:pending"] = [miraHit];
    const { container } = render(<IncomingHit {...mapProps("gm")} />);
    expect(container.innerHTML).toBe("");
  });

  it("a player sees the prompts of their own characters only", () => {
    queries["characters:listByCampaign"] = [character(MIRA, "Mira", true), character(TABBY, "Tabby", false)];
    queries["adversaryActions:pending"] = [miraHit];
    queries["deathMoves:state"] = { awaitingMove: false, pending: null, undoEntryId: null, lessLethal: false, awayRequested: false };
    render(<IncomingHit {...mapProps("player")} />);
    expect(screen.getAllByTestId("incoming-hit")).toHaveLength(1);
    expect(screen.queryByTestId("incoming-hit-death")).toBeNull();
  });

  it("a hit to the last Hit Point brings up the death move", () => {
    queries["characters:listByCampaign"] = [character(MIRA, "Mira", true)];
    queries["adversaryActions:pending"] = [];
    queries["deathMoves:state"] = { awaitingMove: true, pending: null, undoEntryId: null, lessLethal: false, awayRequested: false };
    render(<IncomingHit {...mapProps("player")} />);
    expect(screen.getByTestId("incoming-hit-death")).toBeTruthy();
  });
});

describe("SheetIncomingHit", () => {
  it("shows the prompt to an editor and nothing to anyone else", async () => {
    const { SheetIncomingHit } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/incoming-hit");
    queries["adversaryActions:pending"] = [miraHit];
    const { unmount } = render(<SheetIncomingHit />);
    expect(screen.getByRole("region", { name: "Incoming hit: Bandit hit Mira" })).toBeTruthy();
    unmount();
    sheetState.canEdit = false;
    const { container } = render(<SheetIncomingHit />);
    expect(container.innerHTML).toBe("");
  });
});
