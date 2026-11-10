import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { defenseOf } from "../../../src/features/sheet/catalog";
import { TakeDamage } from "../../../src/features/sheet/death/take-damage";
import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { sheetCharacter } from "../party/fixture";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000003",
}));

beforeEach(() => {
  resetMotionTest();
});

/** Mira with every slot of her armor marked. */
function fullArmor() {
  const base = sheetCharacter({ canEdit: true });
  return sheetCharacter({ canEdit: true }, { armorMarked: defenseOf(base.sheet).armorScore });
}

test("with every slot marked and no augment, no Armor Slot is offered", async () => {
  const screen = await renderAsPlayer(<TakeDamage character={fullArmor()} />);
  expect(screen.getByText("No Armor Slot free")).toBeTruthy();
});

test("installed Motherboard augments add Armor Slots, as the server counts them (Guard, CB p.301)", async () => {
  const character = fullArmor();
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(<TakeDamage augments={["guard"]} character={character} />, {
    mutations: {
      [fn(api.characters.applyDamage)]: (args) => {
        calls.push(args);
        return { severity: "minor", marks: 1, hp: 3, armorMarked: 4 };
      },
    },
  });
  await fireEvent.press(screen.getByText("Use an Armor Slot"));
  await fireEvent.changeText(screen.getByLabelText("Damage roll"), "9");
  await fireEvent.press(screen.getByText("Apply"));
  expect(calls[0]).toMatchObject({ characterId: "char-1", damage: 9, useArmorSlot: true });
  expect(screen.getByText("Minor damage: 1 Hit Point marked.")).toBeTruthy();
});

test("a refused apply shows the error code's text", async () => {
  const screen = await renderAsPlayer(<TakeDamage character={sheetCharacter({ canEdit: true })} />, {
    mutations: {
      [fn(api.characters.applyDamage)]: () => {
        throw new Error("boom");
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Damage roll"), "9");
  await fireEvent.press(screen.getByText("Apply"));
  expect(screen.getByRole("alert")).toBeTruthy();
});
