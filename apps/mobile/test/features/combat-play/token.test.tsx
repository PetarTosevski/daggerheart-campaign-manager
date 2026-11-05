import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, okCharacterId, slotProps } from "./fixtures";

beforeEach(() => {
  resetMotionTest();
});

test("move and turn call combatTokens mutations", async () => {
  const calls: unknown[] = [];
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      "combatCardsReads:hand": { characterId: okCharacterId(props), loadout: [], vault: [] },
      "charactersReads:get": characterForAttack(),
      "adversaryActions:pending": [],
    },
    mutations: {
      "combatTokens:move": (args: unknown) => {
        calls.push(args);
        const a = args as { x: number; y: number };
        return { x: a.x, y: a.y, face: 0, blocked: false, difficult: false };
      },
      "combatTokens:turn": (args: unknown) => {
        calls.push(args);
        return { face: (args as { angle: number }).angle };
      },
    },
  });
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  await fireEvent.press(screen.getByLabelText("Move east"));
  expect(calls[0]).toMatchObject({ campaignId: "campaign-1", tokenId: "tok-1", x: 2, y: 1 });
  await fireEvent.press(screen.getByLabelText("Turn right"));
  expect(calls[1]).toMatchObject({ campaignId: "campaign-1", tokenId: "tok-1" });
});
