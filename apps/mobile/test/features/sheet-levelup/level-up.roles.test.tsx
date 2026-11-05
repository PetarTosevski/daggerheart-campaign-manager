import { webcrypto } from "node:crypto";

import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";
import { useMutation } from "convex/react";

import { scanGmFunctions } from "../../harness/gm-functions";
import { fn, renderAsGm, renderAsPlayer, type RenderedScreen } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api, type Id } from "../../../src/convex";
import { readSheet } from "../../../../../convex/lib/characterSheet";
import { applyLevelUp } from "../../../../../src/lib/domain/level-up";
import { LevelUpSlot } from "../../../src/features/sheet/level-up";
import type { SheetCharacter } from "../../../src/features/sheet/types";

beforeEach(() => {
  resetMotionTest();
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const gmNames = new Set(scanGmFunctions());

function expectNoGm(screen: RenderedScreen) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function CallsPartyLevelUp() {
  const run = useMutation(api.levelUp.partyLevelUp);
  run({ idempotencyKey: "k" } as never);
  return null;
}

test("a player render fails when it calls a GM level-up function", async () => {
  await expect(renderAsPlayer(<CallsPartyLevelUp />)).rejects.toThrow("Player called GM function levelUp:partyLevelUp");
});

function sheetBlob(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    name: "Mira",
    pronouns: "she/her",
    description: "",
    level: 1,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "human" },
    communityId: "ridgeborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 11,
    hp: 2,
    hpMax: 6,
    stress: 1,
    stressMax: 6,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "broadsword",
    armorId: "leather-armor",
    inventory: [],
    gold: { handfuls: 0, bags: 0, chest: false },
    experiences: [{ id: "exp-1", name: "Watch", value: 2 }],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
    levelUpPending: true,
    ...overrides,
  };
}

function pendingCharacter(overrides: Record<string, unknown> = {}): SheetCharacter {
  const sheet = readSheet(sheetBlob(overrides));
  return {
    _id: "char-1" as Id<"characters">,
    ownerId: "player-1",
    status: "active",
    mine: true,
    canEdit: true,
    portraitUrl: null,
    sheet: sheet as unknown as SheetCharacter["sheet"],
  };
}

function leveledCharacter(): SheetCharacter {
  const base = pendingCharacter();
  const sheet = applyLevelUp(readSheet(sheetBlob({ levelUpPending: true })), {
    picks: [
      { option: "hp", tier: 2 },
      { option: "hp", tier: 2 },
    ],
    experienceName: "Gate Watcher",
    cardId: "get-back-up",
  }, { allowExpansion: true, newId: () => "exp-new", at: 1000 });
  return { ...base, sheet: sheet as unknown as SheetCharacter["sheet"] };
}

const slotProps = (character: SheetCharacter, role: "gm" | "player") => ({
  campaignId: "campaign-1",
  isGm: role === "gm",
  hopeAndFear: true,
  character,
  canEdit: character.canEdit,
});

test("a player with a pending level-up starts the ribbon and finishes with levelUp.apply", async () => {
  const calls: unknown[] = [];
  const character = pendingCharacter();
  const screen = await renderAsPlayer(<LevelUpSlot {...slotProps(character, "player")} />, {
    mutations: {
      [fn(api.levelUp.apply)]: (args) => {
        calls.push(args);
        return { level: 2 };
      },
    },
  });
  expect(screen.getByRole("button", { name: "Level up to 2" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Level up to 2" }));
  expect(screen.getByLabelText("Level-up to 2")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("New Experience name"), "Gate Watcher");
  await fireEvent.press(screen.getByText("Next"));
  await fireEvent.press(screen.getByLabelText("Tier 2: +1 Hit Point slot for level 2"));
  await fireEvent.press(screen.getByLabelText("Tier 2: +1 Hit Point slot for level 2"));
  await fireEvent.press(screen.getByText("3. Domain card"));
  await fireEvent.press(screen.getByText("Take Get Back Up"));
  await fireEvent.press(screen.getByRole("button", { name: "Finish level-up" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ characterId: "char-1" });
  expectNoGm(screen);
});

test("a player editor subscribes to canUndo only when undo is offered", async () => {
  const character = leveledCharacter();
  const screen = await renderAsPlayer(<LevelUpSlot {...slotProps(character, "player")} />, {
    queries: {
      [fn(api.levelUp.canUndo)]: true,
    },
  });
  expect(screen.getByRole("button", { name: "Undo level 2" })).toBeTruthy();
  expect(screen.client.subscribed).toContain(fn(api.levelUp.canUndo));
  expectNoGm(screen);
});

test("undo sends levelUp.undoLast; the GM never subscribes to canUndo", async () => {
  const calls: unknown[] = [];
  const character = leveledCharacter();
  const gm = await renderAsGm(<LevelUpSlot {...slotProps(character, "gm")} />, {
    mutations: {
      [fn(api.levelUp.undoLast)]: (args) => {
        calls.push(args);
        return { level: 1 };
      },
    },
  });
  await fireEvent.press(gm.getByRole("button", { name: "Undo level 2" }));
  expect(calls[0]).toMatchObject({ characterId: "char-1" });
  expect(gm.client.subscribed).not.toContain(fn(api.levelUp.canUndo));
});

test("the GM can correct the level; a player never sees that control", async () => {
  const calls: unknown[] = [];
  const character = pendingCharacter({ level: 3, levelUpPending: false });
  const gm = await renderAsGm(<LevelUpSlot {...slotProps(character, "gm")} />, {
    mutations: {
      [fn(api.levelUp.correctLevel)]: (args) => {
        calls.push(args);
        return { level: 4 };
      },
    },
  });
  await fireEvent.changeText(gm.getByLabelText("GM correction level"), "4");
  await fireEvent.press(gm.getByRole("button", { name: "Set level" }));
  expect(calls[0]).toMatchObject({ characterId: "char-1", level: 4 });

  const player = await renderAsPlayer(<LevelUpSlot {...slotProps(character, "player")} />);
  expect(player.queryByLabelText("GM correction level")).toBeNull();
  expectNoGm(player);
});

test("without a pending flag the player cannot start a level-up", async () => {
  const character = pendingCharacter({ levelUpPending: false });
  const screen = await renderAsPlayer(<LevelUpSlot {...slotProps(character, "player")} />);
  expect(screen.queryByRole("button", { name: "Level up to 2" })).toBeNull();
  expect(screen.queryByLabelText("Level-up to 2")).toBeNull();
});
