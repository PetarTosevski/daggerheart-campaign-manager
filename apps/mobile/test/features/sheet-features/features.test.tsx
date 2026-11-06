import { webcrypto } from "node:crypto";

import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";
import { useMutation } from "convex/react";

import { scanGmFunctions } from "../../harness/gm-functions";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api } from "../../../src/convex";
import { FeaturesSlot } from "../../../src/features/sheet/features";
import type { SheetSlotProps } from "../../../src/features/sheet/contract";
import type { SheetCharacter } from "../../../src/features/sheet/types";
import { asSheetCharacter } from "../party/fixture";
import type { ReactElement } from "react";

import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";

jest.mock("expo-crypto", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => (require("node:crypto") as typeof import("node:crypto")).randomUUID(),
}));

beforeEach(() => {
  resetMotionTest();
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const gmNames = new Set(scanGmFunctions());

function expectNoGm(screen: Awaited<ReturnType<typeof renderAsPlayer>>) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function moonCharacter(overrides: Record<string, unknown> = {}): SheetCharacter {
  const base = asSheetCharacter({
    _id: "char-moon",
    ownerId: "player-1",
    status: "active",
    mine: true,
    canEdit: true,
    portraitUrl: null,
    sheet: {
      name: "Mira",
      pronouns: "",
      description: "",
      level: 7,
      classId: "witch",
      subclassId: "moon",
      subclassRank: "mastery",
      ancestry: { kind: "single", id: "elf" },
      communityId: "loreborne",
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
      traitMarks: {},
      evasion: 10,
      hpMax: 6,
      hp: 2,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 3,
      primaryWeaponId: "dualstaff",
      armorId: "gambeson-armor",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
      ...overrides,
    },
  });
  if (!base) throw new Error("fixture");
  return {
    ...base,
    sheet: {
      ...base.sheet,
      subclassRank: "mastery",
      sessionFeatures: { moonDie: 3 },
      ...(overrides.sessionFeatures ? { sessionFeatures: overrides.sessionFeatures as { moonDie: number } } : {}),
    } as SheetCharacter["sheet"] & { sessionFeatures: { moonDie: number } },
  };
}

function slotProps(character: SheetCharacter, hopeAndFear = true): SheetSlotProps {
  return {
    campaignId: "campaign-1",
    isGm: false,
    hopeAndFear,
    character,
    canEdit: true,
  };
}

function inCampaign(ui: ReactElement) {
  return (
    <CampaignProvider campaignId="campaign-1">
      <CampaignScreen>
        <OfflineFrame offline={false}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}

function CallsGmExtras() {
  const assign = useMutation(api.trackers.weredragon.assignReading);
  assign({ campaignId: "campaign-1", assignment: [0, 1, 2, 3, 4] } as never);
  return null;
}

test("a player render fails when it calls a GM-only function", async () => {
  await expect(renderAsPlayer(<CallsGmExtras />)).rejects.toThrow(
    "Player called GM function trackers/weredragon:assignReading",
  );
});

test("a warrior on Witherwild does not subscribe to character extras", async () => {
  const character = asSheetCharacter({
    _id: "char-1",
    ownerId: "player-1",
    status: "active",
    mine: true,
    canEdit: true,
    portraitUrl: null,
    sheet: {
      name: "Mira",
      pronouns: "",
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
      inventory: [],
      gold: { handfuls: 0, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
    },
  });
  if (!character) throw new Error("fixture");
  const screen = await renderAsPlayer(
    inCampaign(<FeaturesSlot {...slotProps(character)} />),
    {
      queries: {
        [fn(api.campaigns.get)]: {
          _id: "campaign-1",
          frameId: "witherwild",
          name: "Table",
          role: "player",
          tier: 1,
          level: 1,
          custom: null,
          tome: null,
          options: { hopeAndFear: true },
          createdAt: 1,
          lastOpenedAt: 1,
          players: 2,
        },
      },
    },
  );
  expect(screen.getByLabelText("Features slot for Mira")).toBeTruthy();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get)]);
  expect(screen.client.subscribed).not.toContain(fn(api.characterExtras.get));
  expectNoGm(screen);
});

test("lunar phases show for a Moon Witch at mastery and bump the moon die", async () => {
  const character = moonCharacter();
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(inCampaign(<FeaturesSlot {...slotProps(character)} />), {
    queries: {
      [fn(api.campaigns.get)]: {
        _id: "campaign-1",
        frameId: "witherwild",
        name: "Table",
        role: "player",
        tier: 1,
        level: 1,
        custom: null,
        tome: null,
        options: { hopeAndFear: true },
        createdAt: 1,
        lastOpenedAt: 1,
        players: 2,
      },
    },
    mutations: {
      [fn(api.sessionFeatures.bumpMoonDie)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByLabelText("Lunar Phases")).toBeTruthy();
  expect(screen.getByText("Waxing moon")).toBeTruthy();
  expect(screen.getByLabelText("Moon die 3")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Spend a Hope: +1 to the moon die" }));
  expect(calls[0]).toMatchObject({ characterId: "char-moon" });
  expect(typeof (calls[0] as { idempotencyKey: string }).idempotencyKey).toBe("string");
  expectNoGm(screen);
});

test("session chips show Slayer dice for a Slayer holder", async () => {
  const character = asSheetCharacter({
    _id: "char-slayer",
    ownerId: "player-1",
    status: "active",
    mine: true,
    canEdit: true,
    portraitUrl: null,
    sheet: {
      name: "Bryn",
      pronouns: "",
      description: "",
      level: 5,
      classId: "warrior",
      subclassId: "call-of-the-slayer",
      subclassRank: "foundation",
      ancestry: { kind: "single", id: "human" },
      communityId: "ridgeborne",
      traits: { agility: 0, strength: 2, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
      traitMarks: {},
      evasion: 10,
      hp: 2,
      hpMax: 6,
      stress: 0,
      stressMax: 6,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 3,
      primaryWeaponId: "broadsword",
      inventory: [],
      gold: { handfuls: 0, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
      sessionFeatures: { slayerDice: 2 },
    },
  });
  if (!character) throw new Error("fixture");
  const withSlayer = {
    ...character,
    sheet: {
      ...character.sheet,
      sessionFeatures: { slayerDice: 2 },
    },
  };
  const screen = await renderAsPlayer(inCampaign(<FeaturesSlot {...slotProps(withSlayer)} />), {
    queries: {
      [fn(api.campaigns.get)]: {
        _id: "campaign-1",
        frameId: "witherwild",
        name: "Table",
        role: "player",
        tier: 1,
        level: 1,
        custom: null,
        tome: null,
        options: { hopeAndFear: true },
        createdAt: 1,
        lastOpenedAt: 1,
        players: 2,
      },
    },
  });
  expect(screen.getByText("Slayer Dice 2/3")).toBeTruthy();
  expectNoGm(screen);
});

test("a druid opens the Beastform sheet from class extras", async () => {
  const character = asSheetCharacter({
    _id: "char-druid",
    ownerId: "player-1",
    status: "active",
    mine: true,
    canEdit: true,
    portraitUrl: null,
    sheet: {
      name: "Rowan",
      pronouns: "",
      description: "",
      level: 3,
      classId: "druid",
      subclassId: "warden-of-the-elements",
      ancestry: { kind: "single", id: "human" },
      communityId: "ridgeborne",
      traits: { agility: 0, strength: 0, finesse: 0, instinct: 2, presence: 0, knowledge: 0 },
      traitMarks: {},
      evasion: 10,
      hp: 2,
      hpMax: 6,
      stress: 0,
      stressMax: 6,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 2,
      primaryWeaponId: "broadsword",
      inventory: [],
      gold: { handfuls: 0, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
    },
  });
  if (!character) throw new Error("fixture");
  const screen = await renderAsPlayer(inCampaign(<FeaturesSlot {...slotProps(character)} />), {
    queries: {
      [fn(api.campaigns.get)]: {
        _id: "campaign-1",
        frameId: "witherwild",
        name: "Table",
        role: "player",
        tier: 1,
        level: 1,
        custom: null,
        tome: null,
        options: { hopeAndFear: true },
        createdAt: 1,
        lastOpenedAt: 1,
        players: 2,
      },
      [fn(api.characterExtras.get)]: {
        canEdit: true,
        level: 3,
        tier: 1,
        ingredientCapacity: 2,
        beastform: { formId: null },
        companion: null,
        motherboard: null,
        beastFeast: null,
        castleHigh: null,
        cookbook: null,
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Beastform" }));
  expect(screen.getByRole("header", { name: "Druid Beastform" })).toBeTruthy();
  expect(screen.client.subscribed).toContain(fn(api.characterExtras.get));
  expectNoGm(screen);
});

test("the GM sees the same features region without GM-only calls", async () => {
  const character = moonCharacter();
  const screen = await renderAsGm(inCampaign(<FeaturesSlot {...slotProps(character)} isGm />), {
    queries: {
      [fn(api.campaigns.get)]: {
        _id: "campaign-1",
        frameId: "witherwild",
        name: "Table",
        role: "gm",
        tier: 1,
        level: 1,
        custom: null,
        tome: null,
        options: { hopeAndFear: true },
        createdAt: 1,
        lastOpenedAt: 1,
        players: 2,
      },
    },
  });
  expect(screen.getByLabelText("Lunar Phases")).toBeTruthy();
  expectNoGm(screen);
});
