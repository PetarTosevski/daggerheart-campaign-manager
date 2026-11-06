import { beforeEach, expect, jest, test } from "@jest/globals";
import { useMutation } from "convex/react";
import { fireEvent } from "@testing-library/react-native";

import { scanGmFunctions } from "../../harness/gm-functions";
import { fn, renderAsGm, renderAsPlayer, type RenderedScreen } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api, type Id } from "../../../src/convex";
import { RestSlot, type RestSheetState } from "../../../src/features/sheet/rest";
import { readCharacter } from "../../../src/features/sheet/types";
import { characterRecord } from "../party/fixture";

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
const campaignId = "campaign-1" as Id<"campaigns">;

function slot(canEdit: boolean, mine = true) {
  const character = readCharacter(characterRecord({ canEdit, mine }));
  if (!character) throw new Error("fixture");
  return {
    campaignId,
    isGm: false,
    hopeAndFear: true,
    character,
    canEdit,
  };
}

function openRest(kind: "short" | "long"): RestSheetState {
  return {
    open: {
      _id: "rest-open" as Id<"rests">,
      kind,
      startedAt: 1,
      gmOverride: false,
      extended: false,
      choices: [],
      moves: [
        {
          characterId: "char-1" as Id<"characters">,
          moves:
            kind === "short"
              ? ["tendToWounds", "clearStress", "repairArmor", "prepare"]
              : ["tendToAllWounds", "clearAllStress", "workOnProject", "prepare"],
          efficient: [],
          slots: 2,
          trance: false,
          extraMoves: 0,
          oasis: false,
        },
      ],
    },
    shortRestsSinceLong: 0,
    last: null,
    rules: { fearFromRests: "book", shortRestLimit: "book", interruptedRest: "book" },
  };
}

const ally = {
  _id: "char-2",
  ownerId: "player-2",
  status: "active",
  mine: false,
  canEdit: false,
  portraitUrl: null,
  sheet: {
    name: "Ash",
    pronouns: "",
    description: "",
    level: 1,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "human" },
    communityId: "ridgeborne",
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    traitMarks: {},
    evasion: 10,
    hp: 4,
    hpMax: 6,
    stress: 0,
    stressMax: 6,
    hope: 2,
    scars: 0,
    hopeSlotBonus: 0,
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
};

function expectNoGm(screen: RenderedScreen) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function CallsStartRest() {
  const start = useMutation(api.rests.start);
  start({ campaignId, kind: "short", idempotencyKey: "key" } as never);
  return null;
}

test("a player render fails when it calls a GM rest function", async () => {
  await expect(renderAsPlayer(<CallsStartRest />)).rejects.toThrow("Player called GM function rests:start");
});

test("with no open rest the slot stays empty and subscribes to nothing", async () => {
  const screen = await renderAsPlayer(<RestSlot {...slot(true)} restState={{ open: null, shortRestsSinceLong: 0, last: null, rules: { fearFromRests: "book", shortRestLimit: "book", interruptedRest: "book" } }} />);
  expect(screen.getByLabelText("Rest slot for Mira")).toBeTruthy();
  expect(screen.queryByText("downtime moves")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
  expectNoGm(screen);
});

test("a player saves two short-rest moves", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<RestSlot {...slot(true)} restState={openRest("short")} />, {
    queries: {
      [fn(api.charactersReads.listByCampaign)]: [characterRecord({ canEdit: true }), ally],
    },
    mutations: {
      [fn(api.rests.choose)]: (args) => {
        seen.push(args);
        return null;
      },
    },
  });
  expect(screen.getByRole("header", { name: "Short rest: downtime moves" })).toBeTruthy();
  await fireEvent.press(screen.getAllByRole("radio", { name: "Clear Stress" })[1]!);
  await fireEvent.press(screen.getByRole("button", { name: "Save moves" }));
  expect(seen[0]).toMatchObject({
    restId: "rest-open",
    characterId: "char-1",
    moves: [
      { move: "tendToWounds" },
      { move: "clearStress" },
    ],
  });
  expect(typeof (seen[0] as { idempotencyKey: unknown }).idempotencyKey).toBe("string");
  expect(screen.client.subscribed).toEqual([fn(api.charactersReads.listByCampaign)]);
  expect(screen.client.called).toEqual([fn(api.rests.choose)]);
  expectNoGm(screen);
});

test("a player targets an ally and creates a project on a long rest", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<RestSlot {...slot(true)} restState={openRest("long")} />, {
    queries: {
      [fn(api.charactersReads.listByCampaign)]: [characterRecord({ canEdit: true }), ally],
      [fn(api.restsReads.projects)]: [{ _id: "proj-1", name: "Forge", startingValue: 4, currentValue: 3, status: "active" }],
    },
    mutations: {
      [fn(api.rests.choose)]: (args) => {
        seen.push(args);
        return null;
      },
      [fn(api.rests.createProject)]: (args) => {
        seen.push(args);
        return { countdownId: "proj-2" };
      },
    },
  });
  expect(screen.getByRole("header", { name: "Long rest: downtime moves" })).toBeTruthy();
  await fireEvent.press(screen.getAllByRole("radio", { name: "Work on a Project" })[0]!);
  await fireEvent.press(screen.getAllByRole("radio", { name: "Forge (3 left)" })[0]!);
  await fireEvent.changeText(screen.getByLabelText("Project name"), "Decipher the tome");
  await fireEvent.changeText(screen.getByLabelText("Project countdown"), "5");
  await fireEvent.press(screen.getByRole("button", { name: "Create project" }));
  expect(seen[0]).toMatchObject({ characterId: "char-1", name: "Decipher the tome", startingValue: 5 });
  await fireEvent.press(screen.getAllByRole("radio", { name: "Clear All Stress" })[1]!);
  await fireEvent.press(screen.getByRole("button", { name: "Save moves" }));
  expect(seen[1]).toMatchObject({
    moves: [
      { move: "workOnProject", countdownId: "proj-1" },
      { move: "clearAllStress" },
    ],
  });
  expect(screen.client.subscribed).toEqual([fn(api.charactersReads.listByCampaign), fn(api.restsReads.projects)]);
  expect(screen.client.called).toEqual([fn(api.rests.createProject), fn(api.rests.choose)]);
  expectNoGm(screen);
});

test("a reader sees picks and cannot save", async () => {
  const state: RestSheetState = {
    ...openRest("short"),
    open: {
      ...openRest("short").open!,
      choices: [{ characterId: "char-1" as Id<"characters">, moves: [{ move: "clearStress" }, { move: "clearStress" }] }],
    },
  };
  const screen = await renderAsPlayer(<RestSlot {...slot(false, false)} restState={state} />);
  expect(screen.getByText(/Picked: Clear Stress, Clear Stress/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save moves" })).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
  expectNoGm(screen);
});

test("the GM can read another character's picks without calling player mutations", async () => {
  const state: RestSheetState = {
    ...openRest("short"),
    open: {
      ...openRest("short").open!,
      choices: [{ characterId: "char-1" as Id<"characters">, moves: [{ move: "prepare" }, { move: "prepare" }] }],
    },
  };
  const props = slot(false, false);
  const screen = await renderAsGm(<RestSlot {...props} isGm restState={state} />);
  expect(screen.getByText(/Picked: Prepare, Prepare/)).toBeTruthy();
  expectNoGm(screen);
});
