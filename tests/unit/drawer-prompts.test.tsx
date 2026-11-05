/**
 * The sheet drawer's prompts (plan drawer-answers DA13; docs/tasks/TASK-DA-DA13.md): Cannonball, CB p.33: "Mark a Stress
 * to allow an ally to throw or launch you at an adversary. To do so, the ally makes an attack roll using Agility or
 * Strength (their choice) against a target within Close range. … You can spend a Hope to target an additional adversary
 * within Very Close range of the first. The second target takes half the damage dealt to the first target." User
 * 2026-10-30: the throwing ally gets the prompt in their drawer. Convex is mocked; the intents and the views are checked.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawerPrompts } from "@/components/combat-map/drawer/prompts";
import { allyRolledUse, resultLine, secondCandidates, throwFeatures, type AllyAsk, type AllyRolls } from "@/components/combat-map/drawer/prompts/model";
import type { Drawer, DrawerFeature } from "@/components/combat-map/drawer/list/model";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

type FakeStore = {
  getAllQueries: (ref: unknown) => { args: Record<string, unknown>; value: unknown }[];
  setQuery: (ref: unknown, args: unknown, value: unknown) => void;
};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => queries[functionName(ref)],
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      const next = results[name]?.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: FakeStore, args: Record<string, unknown>) => void) => {
        optimistic[name] = fn;
        return run;
      },
    });
  },
}));

afterEach(() => {
  cleanup();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(optimistic)) delete optimistic[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const ASH = "ch-ash" as Id<"characters">;
const BRYN = "ch-bryn" as Id<"characters">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Field", live: true, source: "generated", w: 30, h: 20 } as never;
const tok = (s: string) => s as Id<"combatTokens">;
const req = (s: string) => s as Id<"combatRequests">;
const CANNONBALL = "beastform:armored-sentry:cannonball";

const cannonball = (ready = true): DrawerFeature =>
  ({
    featureId: CANNONBALL,
    source: "beastform",
    owner: "armored-sentry",
    name: "Cannonball",
    text: "Mark a Stress to allow an ally to throw or launch you at an adversary.",
    card: null,
    multiclass: false,
    usage: "combat",
    how: "action",
    automated: true,
    state: ready ? "ready" : "exhausted",
    resetLabel: null,
    tokens: 0,
    upgrades: [],
    uses: [{ useId: "main", name: "Cannonball", activation: "action", ready, resetLabel: null, usesLeft: null, rolls: true, targets: null, choices: [], costs: ["1 Stress"], limit: null, repeatable: false, situations: [] }],
  }) as DrawerFeature;

const drawerWith = (features: DrawerFeature[]): Drawer => ({ features }) as unknown as Drawer;

const ask = (over: Partial<AllyAsk> = {}): AllyAsk => ({
  requestId: req("r1"),
  characterName: "Ash",
  featureName: "Cannonball",
  hope: 2,
  secondLabel: "Spend a Hope to target an additional adversary within Very Close range of the first",
  enemies: [
    { tokenId: tok("t-bandit"), name: "Bandit", inRange: true, near: [tok("t-two")] },
    { tokenId: tok("t-two"), name: "Bandit Two", inRange: true, near: [tok("t-bandit")] },
    { tokenId: tok("t-far"), name: "Bandit Far", inRange: false, near: [] },
  ],
  ...over,
});

const view = (over: Partial<AllyRolls> = {}): AllyRolls => ({ asks: [], waiting: [], allies: [], pending: [], ...over });

function show(characterId: Id<"characters">, features: DrawerFeature[], role: "gm" | "player" = "player", canAct = true) {
  return render(<DrawerPrompts campaignId={CAMPAIGN} role={role} map={MAP} characterId={characterId} drawer={drawerWith(features)} canAct={canAct} />);
}

describe("model", () => {
  it("finds the uses an ally rolls (Cannonball's main use) and nothing else", () => {
    expect(allyRolledUse(CANNONBALL)).toEqual({ useId: "main", name: "Cannonball" });
    expect(allyRolledUse("beastform:armored-sentry:attack")).toBeNull();
    expect(throwFeatures(drawerWith([cannonball(false)]))).toMatchObject([{ useId: "main", ready: false }]);
  });

  it("the second target is one of the enemies near the first", () => {
    expect(secondCandidates(ask(), tok("t-bandit")).map((e) => e.name)).toEqual(["Bandit Two"]);
    expect(secondCandidates(ask(), tok("t-far"))).toEqual([]);
    expect(secondCandidates(ask(), null)).toEqual([]);
  });

  it("the result names Hit / Miss / Defeated, never adversary numbers (U1)", () => {
    const names = new Map([["t-bandit", "Bandit"], ["t-two", "Bandit Two"]]);
    type Roll = NonNullable<Parameters<typeof resultLine>[0]["roll"]>;
    const roll: Roll = { kind: "action", dice: [], modifier: 2, total: 16, outcome: "successHope", manual: false };
    const damage: Roll[] = [{ kind: "damage", dice: [], modifier: 2, total: 9, outcome: "none", manual: false }];
    expect(resultLine({ roll, damage, targets: [{ tokenId: tok("t-bandit"), hit: true, defeated: false }, { tokenId: tok("t-two"), hit: true, defeated: true }] }, names)).toBe(
      "Rolled 16; damage 9 → Bandit: Hit, Bandit Two: Defeated",
    );
    expect(resultLine({ roll: { ...roll, total: 7, outcome: "failFear" }, damage: [], targets: [{ tokenId: tok("t-bandit"), hit: false, defeated: false }] }, names)).toBe("Rolled 7 → Bandit: Miss");
  });
});

describe("the throwing ally's prompt", () => {
  it("rolls with the picked trait at a target in Close range, with Ash's Hope for a second target in Very Close range", async () => {
    queries["featurePromptsReads:allyRolls"] = view({ asks: [ask()] });
    results["featurePrompts:allyRoll"] = [
      { status: "resolved", roll: { kind: "action", dice: [], modifier: 0, total: 16, outcome: "successHope", manual: false }, damage: [{ kind: "damage", dice: [], modifier: 2, total: 9, outcome: "none", manual: false }], targets: [{ tokenId: "t-bandit", hit: true, defeated: false }, { tokenId: "t-two", hit: true, defeated: false }] },
    ];
    show(BRYN, []);
    const card = screen.getByTestId("ally-roll-ask");
    expect(within(card).getByText(/Ash's Cannonball: throw them/)).toBeTruthy();
    const target = within(card).getByLabelText("Target within Close range") as HTMLSelectElement;
    const far = within(target).getByRole("option", { name: "Bandit Far (out of range)" }) as HTMLOptionElement;
    expect(far.disabled).toBe(true);
    const rollButton = within(card).getByRole("button", { name: "Roll the throw" }) as HTMLButtonElement;
    expect(rollButton.disabled).toBe(true);

    fireEvent.click(within(card).getByLabelText("Agility"));
    fireEvent.change(target, { target: { value: "t-bandit" } });
    fireEvent.click(within(card).getByLabelText(/Second target: spend 1 of Ash's Hope \(2\)/));
    // Waits for the second pick; only the Bandit's neighbour is offered.
    expect(rollButton.disabled).toBe(true);
    const second = within(card).getByLabelText("Second target within Very Close range") as HTMLSelectElement;
    expect(within(second).getAllByRole("option").map((o) => o.textContent)).toEqual(["Pick a second target", "Bandit Two"]);
    fireEvent.change(second, { target: { value: "t-two" } });
    await act(async () => {
      fireEvent.click(rollButton);
    });
    expect(calls).toEqual([
      { name: "featurePrompts:allyRoll", args: expect.objectContaining({ campaignId: CAMPAIGN, requestId: "r1", trait: "agility", targetTokenId: "t-bandit", secondTokenId: "t-two" }) },
    ]);
    expect(screen.getByTestId("ally-roll-result").textContent).toBe("Ash thrown. Rolled 16; damage 9 → Bandit: Hit, Bandit Two: Hit");

    // The optimistic update drops the answered ask from every allyRolls view.
    const set = vi.fn();
    optimistic["featurePrompts:allyRoll"]!({ getAllQueries: () => [{ args: { characterId: BRYN }, value: view({ asks: [ask()] }) }], setQuery: set }, { requestId: "r1" });
    expect(set.mock.calls[0]![2]).toMatchObject({ asks: [] });
  });

  it("without Ash's Hope the second target can't be ticked; a refusal shows an alert", async () => {
    queries["featurePromptsReads:allyRolls"] = view({ asks: [ask({ hope: 0 })] });
    results["featurePrompts:allyRoll"] = [new ConvexError({ code: "COMBAT_TARGET_INVALID" })];
    show(BRYN, []);
    const card = screen.getByTestId("ally-roll-ask");
    expect((within(card).getByLabelText(/Second target/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText("Target within Close range"), { target: { value: "t-bandit" } });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Roll the throw" }));
    });
    expect(calls[0]!.args).toMatchObject({ trait: "strength", targetTokenId: "t-bandit" });
    expect(calls[0]!.args).not.toHaveProperty("secondTokenId");
    expect(within(card).getByRole("alert")).toBeTruthy();
  });

  it("greys the controls while the GM has not turned on Play for this character", () => {
    queries["featurePromptsReads:allyRolls"] = view({ asks: [ask()] });
    show(BRYN, [], "gm", false);
    expect((screen.getByLabelText("Target within Close range") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Roll the throw" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the druid's throw", () => {
  it("picks the ally on the map and uses Cannonball on them (the Stress is the server's)", async () => {
    queries["featurePromptsReads:allyRolls"] = view({ allies: [{ tokenId: tok("t-bryn"), name: "Bryn" }] });
    results["combatFeatures:useFeature"] = [{ status: "resolved" }];
    show(ASH, [cannonball()]);
    const start = screen.getByTestId("ally-roll-start");
    const button = within(start).getByRole("button", { name: "Ask to throw · 1 Stress" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(start).getByLabelText("Ally who throws you"), { target: { value: "t-bryn" } });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls).toEqual([
      { name: "combatFeatures:useFeature", args: expect.objectContaining({ campaignId: CAMPAIGN, characterId: ASH, mapId: "m1", featureId: CANNONBALL, useId: "main", targetTokenIds: ["t-bryn"], choices: [] }) },
    ]);
  });

  it("while a throw waits it says so and offers no second throw; a used Cannonball can't be asked", () => {
    queries["featurePromptsReads:allyRolls"] = view({ waiting: [{ requestId: req("r1"), rollerName: "Bryn", featureName: "Cannonball" }], allies: [{ tokenId: tok("t-bryn"), name: "Bryn" }] });
    show(ASH, [cannonball()]);
    expect(screen.getByTestId("ally-roll-waiting").textContent).toBe("Cannonball: waiting for Bryn to make the roll.");
    expect(screen.queryByTestId("ally-roll-start")).toBeNull();
    cleanup();
    queries["featurePromptsReads:allyRolls"] = view({ allies: [{ tokenId: tok("t-bryn"), name: "Bryn" }] });
    show(ASH, [cannonball(false)]);
    fireEvent.change(screen.getByLabelText("Ally who throws you"), { target: { value: "t-bryn" } });
    expect((screen.getByRole("button", { name: "Ask to throw · 1 Stress" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders nothing for a character without prompts", () => {
    queries["featurePromptsReads:allyRolls"] = view();
    const { container } = show(BRYN, []);
    expect(container.innerHTML).toBe("");
  });
});

describe("the GM's pending list", () => {
  it("lists every open throw with Cancel, which drops it at once", async () => {
    const pending = [{ requestId: req("r1"), characterName: "Ash", rollerName: "Bryn", featureName: "Cannonball", createdAt: 1 }];
    queries["featurePromptsReads:allyRolls"] = view({ pending });
    show(BRYN, [], "gm");
    const list = screen.getByTestId("ally-roll-pending");
    expect(within(list).getByText("Ash's Cannonball: Bryn rolls")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: "Cancel Ash's Cannonball" }));
    });
    expect(calls).toEqual([{ name: "featurePrompts:cancelAllyRoll", args: expect.objectContaining({ campaignId: CAMPAIGN, requestId: "r1" }) }]);
    const set = vi.fn();
    optimistic["featurePrompts:cancelAllyRoll"]!({ getAllQueries: () => [{ args: {}, value: view({ pending, asks: [ask()] }) }], setQuery: set }, { requestId: "r1" });
    expect(set.mock.calls[0]![2]).toMatchObject({ pending: [], asks: [] });
  });

  it("a player never sees the pending list", () => {
    queries["featurePromptsReads:allyRolls"] = view({ pending: [{ requestId: req("r1"), characterName: "Ash", rollerName: "Bryn", featureName: "Cannonball", createdAt: 1 }] });
    const { container } = show(BRYN, [], "player");
    expect(container.querySelector("[data-testid='ally-roll-pending']")).toBeNull();
  });
});
