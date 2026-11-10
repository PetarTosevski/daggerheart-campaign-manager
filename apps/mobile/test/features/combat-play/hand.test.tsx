import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, handCard, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000002",
}));

beforeEach(() => {
  resetMotionTest();
});

const roll = {
  kind: "action" as const,
  dice: [
    { role: "hope", sides: 12, value: 10 },
    { role: "fear", sides: 12, value: 3 },
  ],
  modifier: 0,
  total: 13,
  outcome: "successHope" as const,
  manual: false,
};

function resolved(over: Record<string, unknown> = {}) {
  return { status: "resolved", entryId: "log-1", cardId: "c", useId: "main", roll, damage: [], success: true, targets: [], prompts: [], minionOffer: null, ...over };
}

async function renderHand(cards: ReturnType<typeof handCard>[], useCard: (args: unknown) => unknown, extra: Record<string, (args: unknown) => unknown> = {}) {
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      [fn(api.combatCardsReads.hand)]: { characterId: okCharacterId(props), loadout: cards, vault: [] },
      [fn(api.charactersReads.get)]: characterForAttack(),
      [fn(api.adversaryActionsReads.pending)]: [],
    },
    mutations: { [fn(api.combatCards.useCard)]: useCard, ...extra },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  return screen;
}

test("a one-enemy card opens its picker and sends the picked enemy, then shows Hit and damage", async () => {
  const calls: unknown[] = [];
  const screen = await renderHand([handCard("bolt-beacon", "Bolt Beacon")], (args) => {
    calls.push(args);
    return resolved({ targets: [{ tokenId: "tok-bandit", hit: true, defeated: false }], damage: [{ ...roll, kind: "damage", outcome: "none", total: 7 }] });
  });
  await fireEvent.press(screen.getByLabelText("Use Bolt Beacon"));
  expect(screen.getByLabelText("Play Bolt Beacon").props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId("combat-card-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Play Bolt Beacon"));
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    characterId: "char-1",
    mapId: "map-1",
    cardId: "bolt-beacon",
    spell: "main",
    targetTokenIds: ["tok-bandit"],
    choices: [],
  });
  expect(screen.getByText("Bandit: Hit")).toBeTruthy();
  expect(screen.getByText("Damage 7")).toBeTruthy();
});

test("a self card plays at once with no target: the server fills in the actor (dcm-gdzi.16)", async () => {
  const calls: unknown[] = [];
  const card = handCard("rune-ward", "Rune Ward");
  card.uses[0].targets = { side: "self", range: "melee", count: "one" } as never;
  const screen = await renderHand([card], (args) => {
    calls.push(args);
    return resolved({ roll: null });
  });
  await fireEvent.press(screen.getByLabelText("Use Rune Ward"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ cardId: "rune-ward", targetTokenIds: [] });
  expect(screen.getByText("Rune Ward: done")).toBeTruthy();
});

test("an untargeted card and an 'every enemy in range' card play at once with no target", async () => {
  const calls: unknown[] = [];
  const none = handCard("untargeted", "Untargeted");
  none.uses[0].targets = null as never;
  const all = handCard("all-close", "All Close");
  all.uses[0].targets = { side: "enemy", range: "close", count: "all" } as never;
  const screen = await renderHand([none, all], (args) => {
    calls.push(args);
    return resolved();
  });
  await fireEvent.press(screen.getByLabelText("Use Untargeted"));
  await fireEvent.press(screen.getByLabelText("Use All Close"));
  expect(calls).toHaveLength(2);
  expect(calls.map((c) => (c as { targetTokenIds: string[] }).targetTokenIds)).toEqual([[], []]);
});

test("an ally card picks among the PCs, not the enemies", async () => {
  const calls: unknown[] = [];
  const card = handCard("mend", "Mend");
  card.uses[0].targets = { side: "ally", range: "close", count: "one" } as never;
  const props = slotProps({
    view: {
      pcs: [
        ...((slotProps().view as { pcs: object[] }).pcs as never[]),
        { _id: "tok-2", kind: "pc", name: "Moss", side: "pc", x: 2, y: 2, size: 1, face: 0, light: "none", sub: "", portrait: null, canMove: false, mine: false, stats: null },
      ] as never,
    },
  });
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      [fn(api.combatCardsReads.hand)]: { characterId: okCharacterId(props), loadout: [card], vault: [] },
      [fn(api.charactersReads.get)]: characterForAttack(),
      [fn(api.adversaryActionsReads.pending)]: [],
    },
    mutations: {
      [fn(api.combatCards.useCard)]: (args) => {
        calls.push(args);
        return resolved();
      },
    },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  await fireEvent.press(screen.getByLabelText("Use Mend"));
  expect(screen.queryByTestId("combat-card-target-tok-bandit")).toBeNull();
  await fireEvent.press(screen.getByTestId("combat-card-target-tok-2"));
  await fireEvent.press(screen.getByLabelText("Play Mend"));
  expect(calls[0]).toMatchObject({ targetTokenIds: ["tok-2"] });
});

test("an exhausted card is disabled with its reset", async () => {
  const card = { ...handCard("bolt-beacon", "Bolt Beacon"), state: "exhausted" as const, resetLabel: "until your next rest" };
  card.uses[0] = { ...card.uses[0], ready: false };
  const screen = await renderHand([card as never], () => resolved());
  expect(screen.getByLabelText("Use Bolt Beacon").props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText("Exhausted · until your next rest")).toBeTruthy();
});

test("a card out of range shows 'waiting for the GM'", async () => {
  const card = handCard("bolt-beacon", "Bolt Beacon");
  const screen = await renderHand([card], () => ({ status: "pending", requestId: "req-1", outOfRange: [{ tokenId: "tok-bandit", band: "far" }] }));
  await fireEvent.press(screen.getByLabelText("Use Bolt Beacon"));
  await fireEvent.press(screen.getByTestId("combat-card-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Play Bolt Beacon"));
  expect(screen.getByText("Bolt Beacon: waiting for the GM")).toBeTruthy();
  expect(screen.getByText("Bandit is out of range (Far).")).toBeTruthy();
});

test("a choice the server asks for comes back as chips and the card is sent again with the answer", async () => {
  const calls: unknown[] = [];
  const card = handCard("split-the-sky", "Split the Sky");
  card.uses[0].targets = null as never;
  const screen = await renderHand([card], (args) => {
    calls.push(args);
    if (calls.length === 1) return { status: "needsChoice", asks: [{ kind: "choose", stepId: "s1", label: "Pick an element", options: [{ id: "fire", label: "Fire" }, { id: "ice", label: "Ice" }] }] };
    return resolved();
  });
  await fireEvent.press(screen.getByLabelText("Use Split the Sky"));
  expect(screen.getByText("Pick an element")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Ice"));
  await fireEvent.press(screen.getByLabelText("Play Split the Sky"));
  expect(calls[1]).toMatchObject({ choices: [{ id: "opt:s1", value: ["ice"] }] });
});

test("rule switch D6 'GM picks': the result says the GM picks the extra Minions", async () => {
  const card = handCard("bolt-beacon", "Bolt Beacon");
  const screen = await renderHand([card], () => resolved({ targets: [{ tokenId: "tok-bandit", hit: true, defeated: true }], minionsForGm: 2 }));
  await fireEvent.press(screen.getByLabelText("Use Bolt Beacon"));
  await fireEvent.press(screen.getByTestId("combat-card-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Play Bolt Beacon"));
  expect(screen.getByText("Bandit: Defeated")).toBeTruthy();
  expect(screen.getByText("The GM picks 2 more Minions.")).toBeTruthy();
});

test("a Minion offer is picked on the phone and sent to combatActions:pickMinions", async () => {
  const picks: unknown[] = [];
  const card = handCard("bolt-beacon", "Bolt Beacon");
  const offer = { requestId: "req-m", extra: 2, candidates: [{ instanceId: "inst-m", tokenId: "tok-m", name: "Minions", available: 3 }] };
  const screen = await renderHand([card], () => resolved({ targets: [{ tokenId: "tok-bandit", hit: true, defeated: true }], minionOffer: offer }), {
    [fn(api.combatActions.pickMinions)]: (args) => {
      picks.push(args);
      return { status: "resolved", defeated: 2, targets: [] };
    },
  });
  await fireEvent.press(screen.getByLabelText("Use Bolt Beacon"));
  await fireEvent.press(screen.getByTestId("combat-card-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Play Bolt Beacon"));
  await fireEvent.press(screen.getByLabelText("One more from Minions"));
  await fireEvent.press(screen.getByLabelText("One more from Minions"));
  await fireEvent.press(screen.getByLabelText("One more from Minions"));
  expect(screen.getByText("2 of 2 picked")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Defeat the picked Minions"));
  expect(picks[0]).toMatchObject({ entryId: "log-1", instanceIds: ["inst-m", "inst-m"] });
  expect(screen.queryByTestId("combat-minion-picker")).toBeNull();
});
