import { beforeEach, expect, jest, test } from "@jest/globals";
import { useMutation } from "convex/react";

import { scanGmFunctions } from "../../harness/gm-functions";
import { fireEvent } from "@testing-library/react-native";

import { renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api } from "../../../src/convex";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { characterForAttack, okCharacterId, slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
});

const gmNames = new Set(scanGmFunctions());

function expectNoGm(screen: Awaited<ReturnType<typeof renderAsPlayer>>) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function CallsGmMove() {
  const run = useMutation(api.combatTokens.addParty);
  run({ campaignId: "campaign-1", mapId: "map-1", idempotencyKey: "x" } as never);
  return null;
}

test("a player render fails when it calls a GM token function", async () => {
  await expect(renderAsPlayer(<CallsGmMove />)).rejects.toThrow("Player called GM function combatTokens:addParty");
});

test("combat play subscribes to player combat mutations only", async () => {
  const props = slotProps();
  const screen = await renderAsPlayer(<CombatPlaySlot {...props} />, {
    queries: {
      "combatCardsReads:hand": { characterId: okCharacterId(props), loadout: [], vault: [] },
      "charactersReads:get": characterForAttack(),
      "adversaryActions:pending": [],
    },
  });
  expect(screen.getByTestId("combat-play-slot")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Open combat actions"));
  expect(screen.getByTestId("combat-play-token")).toBeTruthy();
  expectNoGm(screen);
  expect([...screen.client.subscribed].sort()).toEqual(
    ["adversaryActions:pending", "charactersReads:get", "combatCardsReads:hand"].sort(),
  );
});
