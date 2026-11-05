import { beforeEach, expect, jest, test } from "@jest/globals";
import { Text } from "react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { sheetSlots } from "../../../src/features/sheet/slots";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { renderAsPlayer } from "../../harness";
import { characterRecord } from "../party/fixture";
import { readCharacter } from "../../../src/features/sheet/types";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
});

test("every sheet slot mounts with the contract props", async () => {
  const character = readCharacter(characterRecord({ canEdit: false, mine: false }));
  if (!character) throw new Error("fixture");
  const props: SheetSlotProps = {
    campaignId: "campaign-1",
    isGm: false,
    hopeAndFear: true,
    character,
    canEdit: false,
  };
  const screen = await renderAsPlayer(
    <>
      {sheetSlots.map(({ id, Slot }) => (
        <Slot key={id} {...props} />
      ))}
      <Text>{props.character.sheet.name}</Text>
    </>,
  );
  expect(screen.getByLabelText("Dice slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Level-up slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Death slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Incoming hit slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Rest slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Features slot for Mira")).toBeTruthy();
  expect(screen.client.subscribed).toEqual([]);
  expect(screen.client.called).toEqual([]);
});
