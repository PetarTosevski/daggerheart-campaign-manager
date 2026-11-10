import { beforeEach, expect, jest, test } from "@jest/globals";
import { useMutation } from "convex/react";
import { fireEvent } from "@testing-library/react-native";

import { scanGmFunctions } from "../../harness/gm-functions";
import { fn, renderAsPlayer, type RenderedScreen } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api, type Id } from "../../../src/convex";
import { DiceSlot } from "../../../src/features/sheet/dice";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import { characterRecord, asSheetCharacter } from "../party/fixture";

/** A character with no frame or class extras (`characterExtras.get` for a plain sheet). */
const NO_EXTRAS = {
  canEdit: true,
  level: 1,
  tier: 1,
  ingredientCapacity: 0,
  beastform: null,
  companion: null,
  motherboard: null,
  beastFeast: null,
  castleHigh: null,
  cookbook: null,
};

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

beforeEach(() => {
  resetMotionTest();
});

const gmNames = new Set(scanGmFunctions());

function expectNoGm(screen: RenderedScreen) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function slotProps(overrides?: Partial<SheetSlotProps> & { sheetPatch?: Record<string, unknown> }): SheetSlotProps {
  const base = characterRecord({ canEdit: true });
  if (overrides?.sheetPatch) {
    base.sheet = { ...base.sheet, ...overrides.sheetPatch };
  }
  let character = asSheetCharacter(base);
  if (!character) throw new Error("fixture");
  if (overrides?.sheetPatch) {
    character = { ...character, sheet: { ...character.sheet, ...overrides.sheetPatch } };
  }
  return {
    campaignId: "campaign-1" as Id<"campaigns">,
    isGm: false,
    hopeAndFear: true,
    character,
    canEdit: true,
    ...overrides,
  };
}

function CallsGmRoll() {
  const gmRoll = useMutation(api.rolls.gmRoll);
  gmRoll({ campaignId: "campaign-1", values: [1, 2], roll: { kind: "action", trait: "agility", modifier: 0 } } as never);
  return null;
}

test("a player render fails when it calls a GM roll function", async () => {
  await expect(renderAsPlayer(<CallsGmRoll />)).rejects.toThrow("Player called GM function rolls:gmRoll");
});

test("a reader sees the slot label and does not subscribe", async () => {
  const screen = await renderAsPlayer(<DiceSlot {...slotProps({ canEdit: false })} />);
  expect(screen.getByLabelText("Dice slot for Mira")).toBeTruthy();
  expect(screen.queryByLabelText("Dice")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
  expectNoGm(screen);
});

test("an editor rolls Hope and Fear through actionRoll", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<DiceSlot {...slotProps()} />, {
    queries: {
      [fn(api.campaigns.fear)]: 2,
      [fn(api.characterExtras.get)]: NO_EXTRAS,
      [fn(api.rolls.pendingChoices)]: { slayer: null, tagTeam: null },
    },
    mutations: {
      [fn(api.rolls.actionRoll)]: (args) => {
        seen.push(args);
        return {
          entryId: "log-1",
          roll: {
            kind: "action",
            dice: [
              { role: "hope", sides: 12, value: 8 },
              { role: "fear", sides: 12, value: 3 },
            ],
            modifier: 2,
            total: 13,
            outcome: "successHope",
            manual: false,
          },
          prompts: [],
          fearGained: 0,
        };
      },
    },
  });
  expect(screen.getByLabelText("Dice")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Roll Hope & Fear" }));
  expect(screen.client.called).toContain(fn(api.rolls.actionRoll));
  expect(seen[0]).toMatchObject({ characterId: "char-1", kind: "action", trait: "agility" });
  expect(typeof (seen[0] as { idempotencyKey: string }).idempotencyKey).toBe("string");
  expect(screen.getByLabelText("Hope d12: 8")).toBeTruthy();
  expect(screen.getByLabelText("Fear d12: 3")).toBeTruthy();
  expect(screen.getByText("13")).toBeTruthy();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.fear), fn(api.characterExtras.get), fn(api.rolls.pendingChoices)]);
  expectNoGm(screen);
});

test("an editor rolls damage through damageRoll", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<DiceSlot {...slotProps()} />, {
    queries: {
      [fn(api.campaigns.fear)]: 1,
      [fn(api.characterExtras.get)]: NO_EXTRAS,
      [fn(api.rolls.pendingChoices)]: { slayer: null, tagTeam: null },
    },
    mutations: {
      [fn(api.rolls.damageRoll)]: (args) => {
        seen.push(args);
        return {
          entryId: "log-2",
          roll: {
            kind: "damage",
            dice: [{ role: "damage", sides: 8, value: 5 }],
            modifier: 1,
            total: 6,
            outcome: "none",
            manual: false,
          },
        };
      },
    },
  });
  await fireEvent.press(screen.getByText("Damage", { exact: true }));
  await fireEvent.press(screen.getByRole("button", { name: "Roll damage" }));
  expect(seen[0]).toMatchObject({ characterId: "char-1", source: { kind: "weapon", slot: "primary" } });
  expect(screen.getByText("6")).toBeTruthy();
  expectNoGm(screen);
});

test("a Slayer holder sees the spend stepper and sends slayerDice on damage", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(
    <DiceSlot
      {...slotProps({
        sheetPatch: {
          classId: "warrior",
          subclassId: "call-of-the-slayer",
          sessionFeatures: { slayerDice: 2 },
        },
      })}
    />,
    {
      queries: {
        [fn(api.campaigns.fear)]: 0,
        [fn(api.characterExtras.get)]: NO_EXTRAS,
        [fn(api.rolls.pendingChoices)]: { slayer: null, tagTeam: null },
      },
      mutations: {
        [fn(api.rolls.damageRoll)]: (args) => {
          seen.push(args);
          return {
            entryId: "log-3",
            roll: {
              kind: "damage",
              dice: [
                { role: "damage", sides: 8, value: 4 },
                { role: "extra", sides: 6, value: 6 },
              ],
              modifier: 0,
              total: 10,
              outcome: "none",
              manual: false,
            },
          };
        },
      },
    },
  );
  await fireEvent.press(screen.getByText("Damage", { exact: true }));
  await fireEvent.press(screen.getByRole("button", { name: "Increase Slayer Dice to spend" }));
  await fireEvent.press(screen.getByRole("button", { name: "Roll damage" }));
  expect(seen[0]).toMatchObject({ slayerDice: 1 });
  expectNoGm(screen);
});

test("only a Know the Tide holder sees Tide tokens on action rolls", async () => {
  const screen = await renderAsPlayer(
    <DiceSlot
      {...slotProps({
        sheetPatch: {
          communityId: "seaborne",
          sessionFeatures: { tideTokens: 1 },
        },
      })}
    />,
    {
      queries: {
        [fn(api.campaigns.fear)]: 0,
        [fn(api.characterExtras.get)]: NO_EXTRAS,
        [fn(api.rolls.pendingChoices)]: { slayer: null, tagTeam: null },
      },
    },
  );
  expect(screen.getByLabelText("Tide tokens to spend")).toBeTruthy();
  expectNoGm(screen);

  const other = await renderAsPlayer(<DiceSlot {...slotProps()} />, {
    queries: {
      [fn(api.campaigns.fear)]: 0,
      [fn(api.characterExtras.get)]: NO_EXTRAS,
      [fn(api.rolls.pendingChoices)]: { slayer: null, tagTeam: null },
    },
  });
  expect(other.queryByLabelText("Tide tokens to spend")).toBeNull();
  expectNoGm(other);
});

test("a pending Slayer choice renders the offer", async () => {
  const screen = await renderAsPlayer(<DiceSlot {...slotProps()} />, {
    queries: {
      [fn(api.campaigns.fear)]: 0,
      [fn(api.characterExtras.get)]: NO_EXTRAS,
      [fn(api.rolls.pendingChoices)]: {
        slayer: {
          entryId: "log-4",
          prompt: {
            key: "slayerStore",
            text: "Store a Slayer Die instead of taking the Hope?",
            featureKey: "slayer",
            choices: [
              { key: "hope", label: "Take the Hope" },
              { key: "store", label: "Store a Slayer Die" },
            ],
          },
        },
        tagTeam: null,
      },
    },
    mutations: {
      [fn(api.rolls.storeSlayerDie)]: () => ({ slayerDice: 1, capacity: 3, hope: 2 }),
    },
  });
  expect(screen.getByText("Store a Slayer Die instead of taking the Hope?")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Store a Slayer Die" }));
  expect(screen.client.called).toContain(fn(api.rolls.storeSlayerDie));
  expectNoGm(screen);
});

test("Tag Team apply picks a roll for both characters", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<DiceSlot {...slotProps()} />, {
    queries: {
      [fn(api.campaigns.fear)]: 0,
      [fn(api.characterExtras.get)]: NO_EXTRAS,
      [fn(api.rolls.pendingChoices)]: {
        slayer: null,
        tagTeam: {
          entryId: "log-5",
          rolls: [
            {
              characterId: "char-1",
              entryId: "log-5a",
              name: "Mira",
              roll: {
                kind: "action",
                dice: [
                  { role: "hope", sides: 12, value: 5 },
                  { role: "fear", sides: 12, value: 7 },
                ],
                modifier: 0,
                total: 12,
                outcome: "successHope",
                manual: false,
              },
            },
            {
              characterId: "char-2",
              entryId: "log-5b",
              name: "Bryn",
              roll: {
                kind: "action",
                dice: [
                  { role: "hope", sides: 12, value: 2 },
                  { role: "fear", sides: 12, value: 11 },
                ],
                modifier: 0,
                total: 13,
                outcome: "successFear",
                manual: false,
              },
            },
          ],
        },
      },
      [fn(api.charactersReads.listByCampaign)]: [
        characterRecord({ canEdit: true, name: "Mira" }),
        { ...characterRecord({ canEdit: true, name: "Bryn", mine: false }), _id: "char-2" },
      ],
    },
    mutations: {
      [fn(api.rolls.tagTeamApply)]: (args) => {
        seen.push(args);
        return { outcome: "successHope", fearGained: 0 };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Use Bryn’s roll" }));
  expect(seen[0]).toMatchObject({ entryId: "log-5", pick: "char-2" });
  expect(screen.client.called).toContain(fn(api.rolls.tagTeamApply));
  expectNoGm(screen);
});
