/**
 * The HUD hit window (plan combat-hud H4.2; docs/tasks/TASK-HUD-H4.2.md): 'You were hit' with damage, tiles, the armor
 * offer, HP / Armor "n of 6 marked", Take n HP / Mark Armor; no Armor Slot left hides the armor option; reactions and
 * features that answer; "Pay something else?" with the engine's grants; the GM's own PC on the GM view; usable while
 * the GM holds the spotlight; an ally's Pass. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HitView } from "@/components/combat-map/actions/reactions/model";
import { HudHit } from "@/components/combat-map/hud/hit";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
type QueryValue = unknown | ((args: Record<string, unknown>) => unknown);
const queries: Record<string, QueryValue> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const value = queries[functionName(ref)];
    return typeof value === "function" ? (value as (a: unknown) => unknown)(args) : value;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { status: "pending" };
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

const page = (role: "gm" | "player") => ({ campaignId: CAMPAIGN, role, map: { _id: "m1" } }) as unknown as CombatPageState;

function hitView(over: Partial<HitView> = {}): HitView {
  return {
    requestId: "r1" as Id<"combatRequests">,
    attackerLabel: "Bandit",
    targetCharacterId: MOSS,
    targetName: "Moss",
    role: "target",
    awaiting: true,
    cardIds: [],
    createdAt: 1,
    damage: 9,
    severity: "major",
    maxSlots: 1,
    armorPreview: [
      { slots: 0, severity: "major", hp: 2 },
      { slots: 1, severity: "minor", hp: 1 },
    ],
    ...over,
  };
}

const sheetOf = (hp: number, armor: number, armorMax = 3) => ({
  thresholds: { major: 9, severe: 16 },
  trackers: { hp: { marked: hp, max: 6 }, stress: { marked: 0, max: 6 }, hope: { value: 2, max: 6 }, armor: { marked: armor, max: armorMax } },
});

function seed({ mine = [{ _id: MOSS, name: "Moss" }], hits = { [MOSS]: [hitView()] } as Record<string, HitView[]>, sheet = sheetOf(2, 1) } = {}) {
  queries["characters:listByCampaign"] = mine.map((c) => ({ _id: c._id, mine: true, corrupt: false, sheet: { name: c.name } }));
  queries["combatHud:party"] = mine.map((c) => ({ characterId: c._id, tokenId: `t-${c._id}` }));
  queries["adversaryActions:pending"] = (args: { characterId: string }) => hits[args.characterId] ?? [];
  queries["combatHud:sheet"] = sheet;
}

/** A click, then the answer's promise settles (the window is busy while it runs). */
async function press(el: HTMLElement) {
  fireEvent.click(el);
  await act(async () => {});
}

const respondCalls = () =>calls.filter((c) => c.name === "adversaryActions:respond");

describe("You were hit", () => {
  it("shows damage, the lit threshold, the question, HP / Armor n of 6 marked, and both answers", async () => {
    seed();
    render(<HudHit state={page("player")} />);
    const win = screen.getByRole("dialog", { name: "You were hit" });
    expect(win).toHaveTextContent("Bandit hit Moss");
    expect(within(win).getByTestId("hud-hit-damage")).toHaveTextContent("9");
    const tiles = within(win).getByRole("list", { name: "Damage thresholds" });
    expect(within(tiles).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Minor1 HP", "Major 9+2 HP", "Severe 16+3 HP"]);
    expect(within(tiles).getByText("Major 9+").closest("li")).toHaveAttribute("aria-current", "true");
    expect(within(win).getByTestId("hud-hit-question")).toHaveTextContent("Mark an Armor Slot to drop it to Minor?");
    expect(within(win).getByTestId("hud-hit-hp")).toHaveTextContent("2 → 3 of 6 marked");
    expect(within(win).getByTestId("hud-hit-armor")).toHaveTextContent("1 → 2 of 3 marked");
    // Pips show HP left (answer 2): 4 left now, 3 after; the one this answer marks is hollow.
    const hpPips = within(win).getByRole("img", { name: "Hit Points: 2 of 6 marked now, 3 after" });
    expect(hpPips.querySelectorAll("i.on")).toHaveLength(3);
    expect(hpPips.querySelectorAll("i.hud-hit-lose")).toHaveLength(1);

    await press(within(win).getByRole("button", { name: "Mark Armor · take 1 HP" }));
    expect(respondCalls()[0]!.args).toMatchObject({ campaignId: CAMPAIGN, requestId: "r1", characterId: MOSS, choice: { kind: "armor", slots: 1 } });
    await press(within(win).getByRole("button", { name: "Take 2 HP" }));
    expect(respondCalls()[1]!.args.choice).toEqual({ kind: "noArmor" });
    expect(typeof respondCalls()[1]!.args.idempotencyKey).toBe("string");
    expect(respondCalls()[0]!.args.idempotencyKey).not.toBe(respondCalls()[1]!.args.idempotencyKey);
  });

  it("hides the armor option when no Armor Slot is left", async () => {
    seed({ hits: { [MOSS]: [hitView({ maxSlots: 0 })] }, sheet: sheetOf(2, 3) });
    render(<HudHit state={page("player")} />);
    const win = screen.getByRole("dialog", { name: "You were hit" });
    expect(within(win).queryByRole("button", { name: /Mark Armor/ })).toBeNull();
    expect(within(win).queryByTestId("hud-hit-armor")).toBeNull();
    expect(within(win).getByTestId("hud-hit-question")).toHaveTextContent("No Armor Slot left to mark.");
    expect(within(win).getByTestId("hud-hit-hp")).toHaveTextContent("2 → 4 of 6 marked");
    await press(within(win).getByRole("button", { name: "Take 2 HP" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "noArmor" });
  });

  it("steps through several Armor Slots under I Am Your Shield", async () => {
    const many = hitView({
      maxSlots: 3,
      armorPreview: [
        { slots: 0, severity: "severe", hp: 3 },
        { slots: 1, severity: "major", hp: 2 },
        { slots: 2, severity: "minor", hp: 1 },
        { slots: 3, severity: "none", hp: 0 },
      ],
    });
    seed({ hits: { [MOSS]: [many] } });
    render(<HudHit state={page("player")} />);
    const win = screen.getByRole("dialog", { name: "You were hit" });
    expect(within(win).getByRole("button", { name: "Mark Armor · take 2 HP" })).toBeInTheDocument();
    await press(within(win).getByRole("button", { name: "More Armor Slots to mark" }));
    await press(within(win).getByRole("button", { name: "More Armor Slots to mark" }));
    expect(within(win).getByTestId("hud-hit-question")).toHaveTextContent("Mark 3 Armor Slots to take no damage?");
    await press(within(win).getByRole("button", { name: "Mark 3 Armor · take no damage" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "armor", slots: 3 });
  });

  it("lists the reaction cards and features that answer, each with Use", async () => {
    const feature = {
      featureId: "iron-will",
      useId: "u1",
      name: "Iron Will",
      text: "Mark an extra Armor Slot.",
      numbers: [],
      options: [],
      optionals: [],
      situations: ["The hit is physical"],
    };
    seed({ hits: { [MOSS]: [hitView({ cardIds: ["i-am-your-shield", "shrug-it-off"], features: [feature] })] } });
    render(<HudHit state={page("player")} />);
    const answers = screen.getByRole("region", { name: "Reactions that answer" });
    // I Am Your Shield only answers a hit on someone else (the classic playableCards).
    expect(within(answers).queryByRole("button", { name: "Use I Am Your Shield" })).toBeNull();
    await press(within(answers).getByRole("button", { name: "Use Shrug It Off" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "card", cardId: "shrug-it-off" });
    const use = within(answers).getByRole("button", { name: "Use Iron Will" });
    expect(use).toBeDisabled();
    await press(within(answers).getByRole("checkbox", { name: "The hit is physical" }));
    await press(use);
    expect(respondCalls()[1]!.args.choice).toEqual({ kind: "feature", featureId: "iron-will", useId: "u1", choices: [{ id: "situations", value: ["The hit is physical"] }] });
  });

  it("offers the engine's grants under Pay something else?", async () => {
    const grants = [
      { id: "hope", label: "Spend Hope to mark that many fewer of the Hit Points this attack forces", amount: 2 },
      { id: "gold", label: "Spend handfuls of gold instead of marking Hit Points (1 handful per HP)", amount: 2 },
    ];
    seed({ hits: { [MOSS]: [hitView({ grants })] } });
    render(<HudHit state={page("player")} />);
    const pay = screen.getByRole("region", { name: "Pay something else?" });
    const toggle = within(pay).getByRole("button", { name: /Pay something else\?/ });
    expect(toggle).toHaveTextContent("2 HP coming");
    await press(toggle);
    expect(within(pay).getByRole("radio", { name: /Spend Hope to mark that many fewer/ })).toHaveAttribute("aria-checked", "true");
    expect(within(pay).queryByText(/1 Hope = 1 HP/)).toBeNull();
    await press(within(pay).getByRole("button", { name: "Less Hope to spend" }));
    await press(within(pay).getByRole("button", { name: "Spend 1 Hope" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "grant", id: "hope", amount: 1 });
    await press(within(pay).getByRole("radio", { name: /handfuls of gold/ }));
    await press(within(pay).getByRole("button", { name: "Spend 2 handfuls of gold" }));
    expect(respondCalls()[1]!.args.choice).toEqual({ kind: "grant", id: "gold", amount: 2 });
  });

  it("shows nothing without a hit, and a waiting line once answered", async () => {
    seed({ hits: {} });
    const { container, rerender } = render(<HudHit state={page("player")} />);
    expect(container).toBeEmptyDOMElement();
    seed({ hits: { [MOSS]: [hitView({ awaiting: false })] } });
    rerender(<HudHit state={page("player")} />);
    expect(screen.getByTestId("hud-hit-waiting")).toHaveTextContent("Waiting for the others");
  });
});

describe("other answers and views", () => {
  it("gives the GM's own PC the same window on the GM view", async () => {
    seed({ mine: [{ _id: BRANNOC, name: "Brannoc" }], hits: { [BRANNOC]: [hitView({ targetCharacterId: BRANNOC, targetName: "Brannoc" })] } });
    render(<HudHit state={page("gm")} />);
    const win = screen.getByRole("dialog", { name: "Brannoc was hit" });
    await press(within(win).getByRole("button", { name: "Mark Armor · take 1 HP" }));
    expect(respondCalls()[0]!.args).toMatchObject({ characterId: BRANNOC, choice: { kind: "armor", slots: 1 } });
  });

  it("stays usable while the GM holds the spotlight (answer 1c: it never reads the spotlight)", async () => {
    seed();
    queries["combatSpotlight:state"] = { holder: { kind: "gm" }, reactionsOnly: true, canMove: false };
    render(<HudHit state={page("player")} />);
    const win = screen.getByRole("dialog", { name: "You were hit" });
    for (const button of within(win).getAllByRole("button")) expect(button).toBeEnabled();
  });

  it("lets an ally use a card or pass", async () => {
    seed({ hits: { [MOSS]: [hitView({ role: "ally", targetName: "Brannoc", cardIds: ["i-am-your-shield"], damage: undefined, maxSlots: undefined, armorPreview: undefined })] } });
    render(<HudHit state={page("player")} />);
    const win = screen.getByRole("dialog", { name: "Moss can react" });
    expect(win).not.toHaveTextContent(/\d+ damage/);
    expect(within(win).queryByTestId("hud-hit-damage")).toBeNull();
    await press(within(win).getByRole("button", { name: "Use I Am Your Shield" }));
    await press(within(win).getByRole("button", { name: "Pass" }));
    expect(respondCalls().map((c) => c.args.choice)).toEqual([{ kind: "card", cardId: "i-am-your-shield" }, { kind: "pass" }]);
  });

  it("ends the after-armor and after-hit windows with Done (pass)", async () => {
    seed({ hits: { [MOSS]: [hitView({ armorAnswered: true, cardIds: ["shrug-it-off"] })] } });
    const { unmount } = render(<HudHit state={page("player")} />);
    await press(screen.getByRole("button", { name: "Done" }));
    expect(respondCalls()[0]!.args.choice).toEqual({ kind: "pass" });
    unmount();
    seed({ hits: { [MOSS]: [hitView({ afterHit: true, cardIds: ["unbreakable"] })] } });
    render(<HudHit state={page("player")} />);
    expect(screen.getByRole("dialog", { name: "After the hit" })).toBeInTheDocument();
    await press(screen.getByRole("button", { name: "Done" }));
    expect(respondCalls()[1]!.args.choice).toEqual({ kind: "pass" });
  });

  it("renders nothing before a live map", async () => {
    seed();
    const { container } = render(<HudHit state={{ ...page("player"), map: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
