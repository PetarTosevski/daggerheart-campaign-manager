import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { IncomingSlot } from "../../../src/features/sheet/incoming";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { renderAsPlayer } from "../../harness";
import { readCharacter } from "../../../src/features/sheet/types";
import { characterRecord } from "../party/fixture";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
});

const REQ = "req-1";
const miraHit = {
  requestId: REQ,
  attackerLabel: "Bandit",
  targetCharacterId: "char-1",
  targetName: "Mira",
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

function slotProps(overrides: Partial<SheetSlotProps> = {}): SheetSlotProps {
  const character = readCharacter(characterRecord({ canEdit: true }));
  if (!character) throw new Error("fixture");
  return {
    campaignId: "campaign-1",
    isGm: false,
    hopeAndFear: true,
    character,
    canEdit: true,
    ...overrides,
  };
}

test("incoming hit answers with adversaryActions:respond", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(<IncomingSlot {...slotProps()} />, {
    queries: { "adversaryActions:pending": [miraHit] },
    mutations: {
      "adversaryActions:respond": (args) => {
        calls.push(args);
        return { status: "open", requestId: REQ };
      },
    },
  });
  expect(screen.getByTestId("incoming-hit")).toBeTruthy();
  await fireEvent.press(screen.getByText("Mark"));
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    requestId: REQ,
    characterId: "char-1",
    choice: { kind: "armor", slots: 1 },
  });
  expect(screen.client.subscribed).toEqual(["adversaryActions:pending"]);
});

test("a reader does not mount the incoming slot", async () => {
  const screen = await renderAsPlayer(<IncomingSlot {...slotProps({ canEdit: false })} />);
  expect(screen.queryByTestId("incoming-hit")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
});
