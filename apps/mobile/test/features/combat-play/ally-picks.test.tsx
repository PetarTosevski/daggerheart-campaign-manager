import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatPlaySlot } from "../../../src/features/combat-map/play";

import { slotProps } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000004",
}));

beforeEach(() => {
  resetMotionTest();
});

const chooser = { stepId: "s1", chooserId: "tok-1", characterId: "char-1", self: false, name: "Briar", label: "Rousing Strike: your pick", options: [{ id: "hope", label: "Gain a Hope" }, { id: "stress", label: "Clear a Stress" }] };

function row(over: Record<string, unknown> = {}) {
  return { requestId: "req-p", name: "Rousing Strike", actorName: "Brannoc", actor: false, createdAt: 1, review: false, choosers: [{ ...chooser, answered: false, mine: true }], ...over };
}

test("an ally pick shows on the ally's phone with the actions closed, and answers allyPicks:answer", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(<CombatPlaySlot {...slotProps()} />, {
    queries: { [fn(api.allyPicksReads.open)]: [row()] },
    mutations: {
      [fn(api.allyPicks.answer)]: (args) => {
        calls.push(args);
        return { status: "open" };
      },
    },
  });
  expect(screen.getByText("Rousing Strike: your pick")).toBeTruthy();
  expect(screen.getByText("Brannoc’s Rousing Strike · your pick")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Clear a Stress"));
  expect(calls[0]).toMatchObject({ campaignId: "campaign-1", requestId: "req-p", stepId: "s1", chooserId: "tok-1", options: ["stress"] });
  expect((calls[0] as { idempotencyKey: string }).idempotencyKey).toBeTruthy();
});

test("the player's own use waiting on others shows who it waits on", async () => {
  const screen = await renderAsPlayer(<CombatPlaySlot {...slotProps()} />, {
    queries: {
      [fn(api.allyPicksReads.open)]: [row({ actor: true, choosers: [{ ...chooser, characterId: "char-2", name: "Moss", answered: false, mine: false }] })],
    },
  });
  expect(screen.getByText("Rousing Strike · 0 of 1 chose · waiting on Moss")).toBeTruthy();
});

test("nothing shows when no pick waits", async () => {
  const screen = await renderAsPlayer(<CombatPlaySlot {...slotProps()} />, { queries: { [fn(api.allyPicksReads.open)]: [] } });
  expect(screen.queryByTestId("combat-ally-picks")).toBeNull();
});
