import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { IncomingSlot } from "../../../src/features/sheet/incoming";
import type { HitView } from "../../../src/features/sheet/incoming/model";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { sheetCharacter } from "../party/fixture";

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

beforeEach(() => {
  resetMotionTest();
});

const REQ = "req-1";

/** A hit on Mira (char-1) as `adversaryActionsReads.pending` lists it: 14 damage, Major, one Armor Slot makes it Minor. */
function hit(overrides: Partial<HitView> = {}): HitView {
  return {
    requestId: REQ,
    attackerLabel: "Bandit",
    targetCharacterId: "char-1",
    targetName: "Mira",
    awaiting: true,
    cardIds: [],
    createdAt: 1,
    role: "target",
    damage: 14,
    severity: "major",
    direct: false,
    maxSlots: 1,
    armorPreview: [
      { slots: 0, severity: "major", hp: 2 },
      { slots: 1, severity: "minor", hp: 1 },
    ],
    ...overrides,
  } as HitView;
}

const feature = {
  featureId: "feature:draining-bane",
  useId: "main",
  name: "Draining Bane",
  text: "Before the roll, clear a Stress.",
  numbers: [{ id: "hope", label: "Hope to spend", min: 1 }],
  options: [{ id: "what", label: "Reroll", options: [{ id: "attack", label: "The attack" }, { id: "damage", label: "The damage" }] }],
  optionals: [{ id: "clear", label: "Clear a Stress", defaultOn: true }],
  situations: [] as string[],
};

function slotProps(overrides: Partial<SheetSlotProps> = {}): SheetSlotProps {
  return { campaignId: "campaign-1", isGm: false, hopeAndFear: true, character: sheetCharacter({ canEdit: true }), canEdit: true, ...overrides };
}

async function renderWith(views: HitView[], status: "open" | "declined" | "resolved" = "open") {
  const calls: { choice: unknown; idempotencyKey: string }[] = [];
  const screen = await renderAsPlayer(<IncomingSlot {...slotProps()} />, {
    queries: { [fn(api.adversaryActionsReads.pending)]: views },
    mutations: {
      [fn(api.adversaryActions.respond)]: (args) => {
        calls.push(args as { choice: unknown; idempotencyKey: string });
        return Promise.resolve({ status, requestId: REQ });
      },
    },
  });
  return { screen, calls };
}

test("armorOne: the damage line, the question, and Mark sends one Armor Slot", async () => {
  const { screen, calls } = await renderWith([hit()]);
  expect(screen.getByText("14 damage: Major (2 HP).")).toBeTruthy();
  expect(screen.getByText("Mark an Armor Slot to make it Minor?")).toBeTruthy();
  await fireEvent.press(screen.getByText("Mark"));
  expect(calls[0]).toMatchObject({ campaignId: "campaign-1", requestId: REQ, characterId: "char-1", choice: { kind: "armor", slots: 1 } });
  expect(screen.client.subscribed).toEqual([fn(api.adversaryActionsReads.pending)]);
});

test("armorOne: Don't sends noArmor", async () => {
  const { screen, calls } = await renderWith([hit()]);
  await fireEvent.press(screen.getByText("Don't"));
  expect(calls[0]?.choice).toEqual({ kind: "noArmor" });
});

test("armorMany under Armor Eater (HF p.71): only the counts the preview lists are offered", async () => {
  const view = hit({
    maxSlots: 4,
    armorPreview: [
      { slots: 0, severity: "severe", hp: 3 },
      { slots: 2, severity: "major", hp: 2 },
      { slots: 4, severity: "minor", hp: 1 },
    ],
  });
  const { screen, calls } = await renderWith([view]);
  expect(screen.getByLabelText("Mark 2: Major (2 HP)")).toBeTruthy();
  expect(screen.getByLabelText("Mark 4: Minor (1 HP)")).toBeTruthy();
  expect(screen.queryByLabelText(/^Mark 1/)).toBeNull();
  expect(screen.queryByLabelText(/^Mark 3/)).toBeNull();
  await fireEvent.press(screen.getByLabelText("Mark 4: Minor (1 HP)"));
  expect(calls[0]?.choice).toEqual({ kind: "armor", slots: 4 });
});

test("armorMany with one dearer step asks for that count", async () => {
  const view = hit({ maxSlots: 2, armorPreview: [{ slots: 0, severity: "major", hp: 2 }, { slots: 2, severity: "minor", hp: 1 }] });
  const { screen } = await renderWith([view]);
  expect(screen.getByText("Mark 2 Armor Slots to make it Minor?")).toBeTruthy();
});

test("ok: direct damage (CB p.99) has only OK, which sends noArmor", async () => {
  const { screen, calls } = await renderWith([hit({ direct: true, maxSlots: 0, armorPreview: [{ slots: 0, severity: "major", hp: 2 }] })]);
  expect(screen.getByText("Direct damage: Armor Slots can't reduce it.")).toBeTruthy();
  expect(screen.queryByText("Mark")).toBeNull();
  await fireEvent.press(screen.getByText("OK"));
  expect(calls[0]?.choice).toEqual({ kind: "noArmor" });
});

test("afterArmor (DA8): what still fits stays listed, and Done sends pass", async () => {
  const view = hit({ armorAnswered: true, maxSlots: 0, cardIds: ["i-am-your-shield"], features: [{ ...feature, featureId: "feature:thick-skin", name: "Thick Skin" }] });
  const { screen, calls } = await renderWith([view]);
  expect(screen.getByText("Armor answered. Use another reaction that fits now, in any order, or Done.")).toBeTruthy();
  expect(screen.getByLabelText("Use Thick Skin")).toBeTruthy();
  // I Am Your Shield answers damage to an ally (CB p.341), so the hit PC can't play it.
  expect(screen.queryByLabelText("Use I Am Your Shield")).toBeNull();
  expect(screen.queryByText("Mark")).toBeNull();
  await fireEvent.press(screen.getByText("Done"));
  expect(calls[0]?.choice).toEqual({ kind: "pass" });
});

test("preRoll (SD4 Q2): a feature Use sends its picks, never noArmor", async () => {
  const view = hit({ preRoll: true, damage: undefined, severity: undefined, maxSlots: undefined, armorPreview: undefined, direct: undefined, features: [feature] });
  const { screen, calls } = await renderWith([view]);
  expect(screen.getByText("Bandit attacks Mira")).toBeTruthy();
  expect(screen.queryByText("OK")).toBeNull();
  expect(screen.queryByText(/damage:/)).toBeNull();
  await fireEvent.press(screen.getByLabelText("The damage"));
  await fireEvent.press(screen.getByLabelText("Use Draining Bane"));
  expect(calls[0]?.choice).toEqual({
    kind: "feature",
    featureId: "feature:draining-bane",
    useId: "main",
    choices: [
      { id: "n:hope", value: 1 },
      { id: "opt:what", value: ["damage"] },
      { id: "optional:clear", value: true },
    ],
  });
});

test("preRoll: Pass sends pass", async () => {
  const { screen, calls } = await renderWith([hit({ preRoll: true, maxSlots: undefined, armorPreview: undefined, features: [feature] })]);
  await fireEvent.press(screen.getByText("Pass"));
  expect(calls[0]?.choice).toEqual({ kind: "pass" });
});

test("a feature with a situation waits for the player to confirm it (Q13)", async () => {
  const view = hit({ preRoll: true, maxSlots: undefined, armorPreview: undefined, features: [{ ...feature, situations: ["The attacker is within Close range"] }] });
  const { screen, calls } = await renderWith([view]);
  await fireEvent.press(screen.getByLabelText("Use Draining Bane"));
  expect(calls).toHaveLength(0);
  await fireEvent.press(screen.getByLabelText("The attacker is within Close range"));
  await fireEvent.press(screen.getByLabelText("Use Draining Bane"));
  expect(calls[0]?.choice).toMatchObject({ kind: "feature", choices: expect.arrayContaining([{ id: "situations", value: ["The attacker is within Close range"] }]) });
});

test("afterHit (AA2b): the hit landed; an after-hit card with Use, or Pass", async () => {
  const view = hit({ afterHit: true, deathMove: true, damage: undefined, severity: undefined, maxSlots: undefined, armorPreview: undefined, direct: undefined, cardIds: ["unbreakable"] });
  const { screen, calls } = await renderWith([view]);
  expect(screen.getByText("The hit marked your last Hit Point. React now, or pass.")).toBeTruthy();
  expect(screen.queryByText("OK")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Use Unbreakable"));
  expect(calls[0]?.choice).toEqual({ kind: "card", cardId: "unbreakable" });
});

test("ally: who was hit, the card with Use, and Pass", async () => {
  const view = hit({ role: "ally", targetCharacterId: "char-2" as HitView["targetCharacterId"], targetName: "Bram", damage: undefined, severity: undefined, maxSlots: undefined, armorPreview: undefined, cardIds: ["i-am-your-shield"] });
  const { screen, calls } = await renderWith([view]);
  expect(screen.getByText("Bandit hit Bram")).toBeTruthy();
  expect(screen.queryByText(/damage:/)).toBeNull();
  await fireEvent.press(screen.getByLabelText("Use I Am Your Shield"));
  expect(calls[0]?.choice).toEqual({ kind: "card", cardId: "i-am-your-shield" });
});

test("grants (lanes-2 E2.3): Spend pays the amount, at most what the grant offers", async () => {
  const view = hit({ grants: [{ id: "gold", label: "Spend a handful of gold instead of marking HP", amount: 2 }] });
  const { screen, calls } = await renderWith([view]);
  await fireEvent.changeText(screen.getByLabelText("How many: Spend a handful of gold instead of marking HP"), "9");
  await fireEvent.press(screen.getByLabelText("Spend 2: Spend a handful of gold instead of marking HP"));
  expect(calls[0]?.choice).toEqual({ kind: "grant", id: "gold", amount: 2 });
});

test("waiting: nothing owed is one line", async () => {
  const { screen } = await renderWith([hit({ awaiting: false })]);
  expect(screen.queryByTestId("incoming-hit")).toBeNull();
  expect(screen.getByTestId("incoming-hit-line")).toBeTruthy();
});

test("a called-off hit says so", async () => {
  const { screen } = await renderWith([hit()], "declined");
  await fireEvent.press(screen.getByText("Mark"));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText("This hit was called off.")).toBeTruthy();
});

test("a double tap sends one answer, each tap with its own key", async () => {
  const resolvers: (() => void)[] = [];
  const calls: { idempotencyKey: string }[] = [];
  const screen = await renderAsPlayer(<IncomingSlot {...slotProps()} />, {
    queries: { [fn(api.adversaryActionsReads.pending)]: [hit()] },
    mutations: {
      [fn(api.adversaryActions.respond)]: (args) => {
        calls.push(args as { idempotencyKey: string });
        return new Promise((resolve) => resolvers.push(() => resolve({ status: "open", requestId: REQ })));
      },
    },
  });
  const mark = screen.getByText("Mark");
  await fireEvent.press(mark);
  await fireEvent.press(mark);
  expect(calls).toHaveLength(1);
});

test("the GM answers for a PC the same way", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(<IncomingSlot {...slotProps({ isGm: true })} />, {
    queries: { [fn(api.adversaryActionsReads.pending)]: [hit()] },
    mutations: { [fn(api.adversaryActions.respond)]: (args) => (calls.push(args), { status: "open", requestId: REQ }) },
  });
  await fireEvent.press(screen.getByText("Mark"));
  expect(calls).toHaveLength(1);
});

test("a reader does not mount the incoming slot", async () => {
  const screen = await renderAsPlayer(<IncomingSlot {...slotProps({ canEdit: false })} />);
  expect(screen.queryByTestId("incoming-hit")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
});
