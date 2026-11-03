import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000003",
}));

beforeEach(() => {
  resetMotionTest();
});

test("attack calls combatActions:attack", async () => {
  const calls: unknown[] = [];
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      "combatCards:hand": { characterId: okCharacterId(props), loadout: [], vault: [] },
      "characters:get": characterForAttack(),
      "adversaryActions:pending": [],
    },
    mutations: {
      "combatActions:attack": (args) => {
        calls.push(args);
        return {
          status: "resolved",
          roll: {
            kind: "action",
            dice: [
              { role: "hope", sides: 12, value: 10 },
              { role: "fear", sides: 12, value: 3 },
            ],
            modifier: 0,
            total: 13,
            outcome: "successHope",
            manual: false,
          },
          damage: null,
          targets: [{ tokenId: "tok-bandit", hit: true, defeated: false }],
          fearGained: 0,
        };
      },
    },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Attack selected target"));
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    characterId: "char-1",
    mapId: "map-1",
    targetTokenIds: ["tok-bandit"],
    slot: "primary",
  });
});
