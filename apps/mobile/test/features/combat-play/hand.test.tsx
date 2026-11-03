import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, handCard, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000002",
}));

beforeEach(() => {
  resetMotionTest();
});

test("use card calls combatCards:useCard with the picked target", async () => {
  const calls: unknown[] = [];
  const props = slotProps();
  const card = handCard("bolt-beacon", "Bolt Beacon");
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      "combatCards:hand": { characterId: okCharacterId(props), loadout: [card], vault: [] },
      "characters:get": characterForAttack(),
      "adversaryActions:pending": [],
    },
    mutations: {
      "combatCards:useCard": (args) => {
        calls.push(args);
        return { status: "resolved", entryId: "log-1", summary: "Hit" };
      },
    },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  await fireEvent.press(screen.getByTestId("combat-target-tok-bandit"));
  await fireEvent.press(screen.getByLabelText("Use Bolt Beacon"));
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    characterId: "char-1",
    mapId: "map-1",
    cardId: "bolt-beacon",
    targetTokenIds: ["tok-bandit"],
  });
});
