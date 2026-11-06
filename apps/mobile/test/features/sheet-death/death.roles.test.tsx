import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { DeathSlot } from "../../../src/features/sheet/death";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { sheetCharacter } from "../party/fixture";

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
  const base = sheetCharacter({
      canEdit: true,
      status: "away",
    });
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
    queries: { [fn(api.deathMoves.state)]: deathState },
    mutations: {
      [fn(api.deathMoves.settleAway)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(gm.getByTestId("death-away-requested")).toBeTruthy();
  await fireEvent.press(gm.getByText("Confirm"));
  expect(calls[0]).toMatchObject({ characterId: "char-1", reason: "infirmary" });

  const player = await renderAsPlayer(<DeathSlot {...awayCharacter(false)} />, {
    queries: { [fn(api.deathMoves.state)]: deathState },
  });
  expect(player.getByTestId("death-away-requested")).toBeTruthy();
  expect(player.queryByText("Confirm")).toBeNull();
  expect(player.queryByText(/Change to/)).toBeNull();
});

test("Return to play is GM-only", async () => {
  const gm = await renderAsGm(<DeathSlot {...awayCharacter(true)} />, {
    queries: { [fn(api.deathMoves.state)]: { ...deathState, awayRequested: false } },
  });
  expect(gm.getByText("Return to play")).toBeTruthy();

  const player = await renderAsPlayer(<DeathSlot {...awayCharacter(false)} />, {
    queries: { [fn(api.deathMoves.state)]: { ...deathState, awayRequested: false } },
  });
  expect(player.queryByText("Return to play")).toBeNull();
});

test("applyDamage sends one keyed mutation per apply", async () => {
  const calls: unknown[] = [];
  const character = sheetCharacter({ canEdit: true });
  if (!character) throw new Error("fixture");
  const props: SheetSlotProps = {
    campaignId: "campaign-1",
    isGm: false,
    hopeAndFear: true,
    canEdit: true,
    character,
  };
  const screen = await renderAsPlayer(<DeathSlot {...props} />, {
    queries: { [fn(api.deathMoves.state)]: { ...deathState, lessLethal: false, awayRequested: false } },
    mutations: {
      [fn(api.characters.applyDamage)]: (args) => {
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
  const character = sheetCharacter({ canEdit: false });
  if (!character) throw new Error("fixture");
  const screen = await renderAsPlayer(
    <DeathSlot campaignId="campaign-1" canEdit={false} character={character} hopeAndFear isGm={false} />,
  );
  expect(screen.client.subscribed).toEqual([]);
});

function dyingProps(): SheetSlotProps {
  return { campaignId: "campaign-1", isGm: false, hopeAndFear: true, canEdit: true, character: sheetCharacter({ canEdit: true }, { hp: 6 }) };
}

const dying = { ...deathState, awaitingMove: true, lessLethal: false, awayRequested: false };

test("a death move fires once on a double tap and shows a refusal's text (dcm-gdzi.21)", async () => {
  const calls: unknown[] = [];
  let reject: (e: unknown) => void = () => undefined;
  const screen = await renderAsPlayer(<DeathSlot {...dyingProps()} />, {
    queries: { [fn(api.deathMoves.state)]: dying },
    mutations: {
      [fn(api.deathMoves.choose)]: (args) => {
        calls.push(args);
        return new Promise((_, no) => {
          reject = no;
        });
      },
    },
  });
  await fireEvent.press(screen.getByText("Avoid Death"));
  await fireEvent.press(screen.getByText("Avoid Death"));
  expect(calls).toHaveLength(1);
  await act(async () => {
    reject(new ConvexError({ code: "FORBIDDEN" }));
  });
  expect(screen.getByText(errorMessage(new ConvexError({ code: "FORBIDDEN" })))).toBeTruthy();
});
