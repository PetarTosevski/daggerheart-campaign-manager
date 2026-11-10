import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000004",
}));

beforeEach(() => {
  resetMotionTest();
});

const miraHit = {
  requestId: "req-1",
  attackerLabel: "Bandit",
  targetCharacterId: "char-1",
  targetName: "Briar",
  awaiting: true,
  cardIds: [] as string[],
  createdAt: 1,
  role: "target" as const,
  damage: 14,
  severity: "major" as const,
  direct: false,
  maxSlots: 1,
  armorPreview: [
    { slots: 0, severity: "major" as const, hp: 2 },
    { slots: 1, severity: "minor" as const, hp: 1 },
  ],
};

test("incoming hit answers with adversaryActions:respond", async () => {
  const calls: unknown[] = [];
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      [fn(api.combatCardsReads.hand)]: { characterId: okCharacterId(props), loadout: [], vault: [] },
      [fn(api.charactersReads.get)]: characterForAttack(),
      [fn(api.adversaryActionsReads.pending)]: [miraHit],
    },
    mutations: {
      [fn(api.adversaryActions.respond)]: (args) => {
        calls.push(args);
        return { status: "open", requestId: "req-1" };
      },
    },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  expect(screen.getByTestId("incoming-hit")).toBeTruthy();
  await fireEvent.press(screen.getByText("Mark"));
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    requestId: "req-1",
    characterId: "char-1",
    choice: { kind: "armor", slots: 1 },
  });
});
