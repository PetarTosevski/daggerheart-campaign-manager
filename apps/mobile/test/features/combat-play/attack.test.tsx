import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000003",
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

const hint = { tokenId: "tok-bandit", band: "close", inRange: true, lineOfSight: true, cover: false };

function character(secondary?: string) {
  const c = characterForAttack() as { sheet: Record<string, unknown> };
  return secondary ? { ...c, sheet: { ...c.sheet, secondaryWeaponId: secondary } } : c;
}

async function renderAttack(opts: {
  attack?: (args: unknown) => unknown;
  hints?: unknown[] | ((args: unknown) => unknown);
  mode?: "book" | "manual";
  secondary?: string;
  extra?: Record<string, (args: unknown) => unknown>;
}) {
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      [fn(api.combatCardsReads.hand)]: { characterId: okCharacterId(props), loadout: [], vault: [] },
      [fn(api.charactersReads.get)]: character(opts.secondary),
      [fn(api.adversaryActionsReads.pending)]: [],
      [fn(api.combatActionsReads.targets)]: opts.hints ?? [hint],
      [fn(api.ruleSettings.get)]: { modes: { lineOfSight: opts.mode ?? "book" }, locked: false, canEdit: false },
    },
    mutations: { [fn(api.combatActions.attack)]: opts.attack ?? (() => null), ...opts.extra },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  return screen;
}

test("attack calls combatActions:attack on the picked target and shows Hit, damage and the roll", async () => {
  const calls: unknown[] = [];
  const screen = await renderAttack({
    attack: (args) => {
      calls.push(args);
      return { status: "resolved", entryId: "log-1", roll, damage: { ...roll, kind: "damage", outcome: "none", total: 9 }, targets: [{ tokenId: "tok-bandit", hit: true, defeated: false }], minionOffer: null, prompts: [] };
    },
  });
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(calls[0]).toMatchObject({ campaignId: "campaign-1", characterId: "char-1", mapId: "map-1", targetTokenIds: ["tok-bandit"], slot: "primary" });
  expect(screen.getByText("Bandit: Hit")).toBeTruthy();
  expect(screen.getByText("Damage 9")).toBeTruthy();
  expect(screen.getByTestId("combat-attack-result")).toBeTruthy();
});

test("an out-of-range attack shows 'waiting for the GM' (Q1)", async () => {
  const screen = await renderAttack({
    hints: [{ ...hint, band: "far", inRange: false }],
    attack: () => ({ status: "pending", requestId: "req-1", outOfRange: [{ tokenId: "tok-bandit", band: "far" }] }),
  });
  expect(screen.getByText("Far · out of range")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(screen.getByText(/waiting for the GM$/)).toBeTruthy();
  expect(screen.getByText("Bandit is out of range (Far).")).toBeTruthy();
});

test("M1 Book: a target without line of sight can't be picked", async () => {
  const calls: unknown[] = [];
  const screen = await renderAttack({ hints: [{ ...hint, lineOfSight: false, cover: false }], attack: (a) => calls.push(a) });
  const chip = screen.getByTestId("combat-target-tok-bandit");
  expect(chip.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(chip);
  expect(screen.getByLabelText("Attack selected target").props.accessibilityState?.disabled).toBe(true);
  expect(calls).toEqual([]);
});

test("M1 Manual: a target without line of sight can be attacked (the GM rules)", async () => {
  const calls: unknown[] = [];
  const screen = await renderAttack({
    mode: "manual",
    hints: [{ ...hint, lineOfSight: false }],
    attack: (args) => {
      calls.push(args);
      return { status: "resolved", entryId: "log-1", roll, damage: null, targets: [{ tokenId: "tok-bandit", hit: false, defeated: false }], minionOffer: null, prompts: [] };
    },
  });
  expect(screen.getByText("Close · no line of sight (GM rules)")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(calls).toHaveLength(1);
  expect(screen.getByText("Bandit: Miss")).toBeTruthy();
});

test("the secondary weapon can be picked and is sent with its own targets", async () => {
  const calls: unknown[] = [];
  const asked: unknown[] = [];
  const screen = await renderAttack({
    secondary: "small-dagger",
    hints: (args) => {
      asked.push(args);
      return [hint];
    },
    attack: (args) => {
      calls.push(args);
      return { status: "pending", requestId: "r", outOfRange: [] };
    },
  });
  await fireEvent.press(screen.getByTestId("combat-weapon-secondary"));
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(calls[0]).toMatchObject({ slot: "secondary" });
  expect(asked.some((a) => (a as { slot?: string }).slot === "secondary")).toBe(true);
});

test("an attack held after its roll offers its features and Pass (combatActions:afterRoll)", async () => {
  const answers: unknown[] = [];
  const screen = await renderAttack({
    attack: () => ({ status: "awaiting", requestId: "req-a", roll, targets: [{ tokenId: "tok-bandit", hit: false }], options: [{ featureId: "f1", useId: "u1", name: "Sneak Attack", costs: [] }] }),
    extra: {
      [fn(api.combatActions.afterRoll)]: (args) => {
        answers.push(args);
        return { status: "declined" };
      },
    },
  });
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(screen.getByLabelText("Use Sneak Attack")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Pass on the roll"));
  expect(answers[0]).toMatchObject({ requestId: "req-a", choice: { kind: "pass" } });
});
