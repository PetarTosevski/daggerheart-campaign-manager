import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { getClass } from "../../../../../src/lib/srd";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CharacterWizard } from "../../../src/features/party/create/wizard";
import { CreateCharacterSlot } from "../../../src/features/party/create";
import { PhotoImportButton } from "../../../src/features/party/create/photo-import";
import { PartyScreen } from "../../../src/features/party";
import {
  classItemsFor,
  domainCardOptions,
  emptyWizard,
  missingByStep,
  normalizeWizard,
} from "../../../src/features/party/create/wizard-logic";
import { api, type Id } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignRecord, inCampaign, queriesFor } from "../party/fixture";

const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn() }),
}));

jest.mock("expo-secure-store");

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

function completeGuardian() {
  const opts = { hopeAndFear: true };
  return normalizeWizard(
    {
      ...emptyWizard(),
      step: 9,
      classId: "guardian",
      subclassId: "stalwart",
      ancestryMode: "single",
      ancestryId: "dwarf",
      communityId: "ridgeborne",
      traits: { agility: 1, strength: 2, finesse: -1, instinct: 0, presence: 1, knowledge: 0 },
      name: "Brakka Stonefist",
      pronouns: "they/them",
      primaryWeaponId: "battleaxe",
      armorId: "chainmail-armor",
      potion: "Minor Health Potion",
      classItem: classItemsFor(getClass("guardian"))[0] ?? "",
      experiences: ["Bodyguard", "Soldier"],
      domainCards: domainCardOptions("guardian", opts)
        .slice(0, 2)
        .map((c) => c.id),
    },
    opts,
  );
}

beforeEach(() => {
  resetMotionTest();
  mockReplace.mockReset();
  mockBack.mockReset();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(completeGuardian()));
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      configurable: true,
    });
  }
});

test("a restored complete draft can call characters.create", async () => {
  const draft = completeGuardian();
  expect(missingByStep(draft, { hopeAndFear: true })[9]).toEqual([]);
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(inCampaign("player", <CharacterWizard />), {
    queries: {
      ...queriesFor("player", []),
    },
    mutations: {
      [fn(api.characters.create)]: (args) => {
        calls.push(args);
        return { characterId: "char-new" };
      },
    },
  });
  await waitFor(() => {
    expect(screen.getByRole("header", { name: "Connections" })).toBeTruthy();
  });
  await fireEvent.press(screen.getByRole("button", { name: "Create character" }));
  await waitFor(() => {
    expect(calls.length).toBe(1);
  });
  expect(calls[0]).toMatchObject({
    campaignId: "campaign-1",
    draft: expect.objectContaining({ name: "Brakka Stonefist", classId: "guardian" }),
  });
  expect(mockReplace).toHaveBeenCalledWith("/campaign/campaign-1/party/char-new");
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get), fn(api.charactersReads.listByCampaign)]);
});

test("a player never subscribes to photoImport", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: {
      ...queriesFor("player", []),
      [fn(api.photoImport.available)]: true,
    },
  });
  expect(screen.getByRole("button", { name: "+ Create character" })).toBeTruthy();
  expect(screen.queryByText("Import from photo")).toBeNull();
  expect(screen.client.subscribed).not.toContain(fn(api.photoImport.available));
});

test("the GM sees photo import when available", async () => {
  const screen = await renderAsGm(
    <PhotoImportButton campaignId={"campaign-1" as Id<"campaigns">} hopeAndFear isGm />,
    {
      queries: {
        [fn(api.photoImport.available)]: true,
      },
    },
  );
  await waitFor(() => {
    expect(screen.getByText("Import from photo")).toBeTruthy();
  });
  expect(screen.client.subscribed).toEqual([fn(api.photoImport.available)]);
});

test("CreateCharacterSlot links to the wizard for the GM", async () => {
  const screen = await renderAsGm(inCampaign("gm", <CreateCharacterSlot campaignId="campaign-1" />), {
    queries: {
      [fn(api.campaigns.get)]: campaignRecord("gm"),
      [fn(api.photoImport.available)]: false,
    },
  });
  expect(screen.getByRole("button", { name: "+ Create character" })).toBeTruthy();
  expect(screen.queryByText("Import from photo")).toBeNull();
});
