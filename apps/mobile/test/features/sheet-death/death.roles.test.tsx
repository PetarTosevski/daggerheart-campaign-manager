import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { DeathSlot } from "../../../src/features/sheet/death";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { readCharacter } from "../../../src/features/sheet/types";
import { characterRecord } from "../party/fixture";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000002",
}));

beforeEach(() => {
  resetMotionTest();
});

const deathState = {
  awaitingMove: false,
  pending: null,
  undoEntryId: null,
  lessLethal: true,
  awayRequested: true,
};

function awayCharacter(isGm: boolean): SheetSlotProps {
  const base = readCharacter(
    characterRecord({
      canEdit: true,
      status: "away",
    }),
  );
  if (!base) throw new Error("fixture");
  return {
    campaignId: "campaign-1",
    isGm,
    hopeAndFear: true,
    canEdit: true,
    character: { ...base, away: { reason: "infirmary" } },
  };
}

test("the GM settles a less-lethal away request; a player only sees Requested", async () => {
  const calls: unknown[] = [];
  const gm = await renderAsGm(<DeathSlot {...awayCharacter(true)} />, {
    queries: { "deathMoves:state": deathState },
    mutations: {
      "deathMoves:settleAway": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(gm.getByTestId("death-away-requested")).toBeTruthy();
  await fireEvent.press(gm.getByText("Confirm"));
  expect(calls[0]).toMatchObject({ characterId: "char-1", reason: "infirmary" });

  const player = await renderAsPlayer(<DeathSlot {...awayCharacter(false)} />, {
    queries: { "deathMoves:state": deathState },
  });
  expect(player.getByTestId("death-away-requested")).toBeTruthy();
  expect(player.queryByText("Confirm")).toBeNull();
  expect(player.queryByText(/Change to/)).toBeNull();
});

test("Return to play is GM-only", async () => {
  const gm = await renderAsGm(<DeathSlot {...awayCharacter(true)} />, {
    queries: { "deathMoves:state": { ...deathState, awayRequested: false } },
  });
  expect(gm.getByText("Return to play")).toBeTruthy();

  const player = await renderAsPlayer(<DeathSlot {...awayCharacter(false)} />, {
    queries: { "deathMoves:state": { ...deathState, awayRequested: false } },
  });
  expect(player.queryByText("Return to play")).toBeNull();
});

test("applyDamage sends one keyed mutation per apply", async () => {
  const calls: unknown[] = [];
  const character = readCharacter(characterRecord({ canEdit: true }));
  if (!character) throw new Error("fixture");
  const props: SheetSlotProps = {
    campaignId: "campaign-1",
    isGm: false,
    hopeAndFear: true,
    canEdit: true,
    character,
  };
  const screen = await renderAsPlayer(<DeathSlot {...props} />, {
    queries: { "deathMoves:state": { ...deathState, lessLethal: false, awayRequested: false } },
    mutations: {
      "characters:applyDamage": (args) => {
        calls.push(args);
        return { severity: "major", marks: 2, hp: 4, armorMarked: 0 };
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Damage roll"), "14");
  await fireEvent.press(screen.getByText("Apply"));
  expect(calls[0]).toMatchObject({
    characterId: "char-1",
    damage: 14,
    useArmorSlot: false,
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
  });
});

test("a reader does not subscribe to death queries", async () => {
  const character = readCharacter(characterRecord({ canEdit: false }));
  if (!character) throw new Error("fixture");
  const screen = await renderAsPlayer(
    <DeathSlot campaignId="campaign-1" canEdit={false} character={character} hopeAndFear isGm={false} />,
  );
  expect(screen.client.subscribed).toEqual([]);
});
