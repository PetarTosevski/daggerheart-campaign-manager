import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { getClass } from "../../../../../src/lib/srd";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CharacterWizard } from "../../../src/features/party/create/wizard";
import { CreateCharacterSlot } from "../../../src/features/party/create";
import { PhotoImportButton } from "../../../src/features/party/create/photo-import";
import { PartyScreen } from "../../../src/features/party";
import { createDraftSaver, isTypedPatch } from "../../../src/features/party/create/draft-storage";
import {
  classItemsFor,
  domainCardOptions,
  emptyWizard,
  gearSummary,
  hasPurposefulDesign,
  missingByStep,
  normalizeWizard,
  partyCardHolders,
  refusedCardsMissing,
  toCharacterDraft,
} from "../../../src/features/party/create/wizard-logic";
import { api, type Id } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignRecord, inCampaign, queriesFor } from "../party/fixture";
import { characterRow, ruleSettingsRecord } from "../../harness/records";

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
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get), fn(api.charactersReads.listByCampaign), fn(api.ruleSettings.get)]);
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

const opts = { hopeAndFear: true };

function clank() {
  return normalizeWizard({ ...completeGuardian(), ancestryMode: "single", ancestryId: "clank" }, opts);
}

test("a Clank picks an Experience for Purposeful Design (CB p.53) and the draft sends it", () => {
  const draft = clank();
  expect(hasPurposefulDesign(draft, opts)).toBe(true);
  expect(missingByStep(draft, opts)[7]).toEqual(["an Experience for Purposeful Design"]);
  const picked = normalizeWizard({ ...draft, purposefulExperience: 1 }, opts);
  expect(missingByStep(picked, opts)[7]).toEqual([]);
  expect(toCharacterDraft(picked, null, opts).purposefulExperience).toBe(1);
});

test("a non-Clank never keeps or sends a Purposeful Design pick", () => {
  const dwarf = normalizeWizard({ ...completeGuardian(), purposefulExperience: 0 }, opts);
  expect(hasPurposefulDesign(dwarf, opts)).toBe(false);
  expect(dwarf.purposefulExperience).toBeNull();
  expect(missingByStep(dwarf, opts)[7]).toEqual([]);
  expect(toCharacterDraft(dwarf, null, opts)).not.toHaveProperty("purposefulExperience");
});

test("the Experiences step shows the Clank's +1 on the chosen Experience", async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ ...clank(), step: 7, purposefulExperience: 0 }));
  const screen = await renderAsPlayer(inCampaign("player", <CharacterWizard />), { queries: queriesFor("player", []) });
  await waitFor(() => {
    expect(screen.getByRole("header", { name: "Experiences" })).toBeTruthy();
  });
  expect(screen.getByLabelText("First Experience modifier +3")).toBeTruthy();
  expect(screen.getByLabelText("Second Experience modifier +2")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Purposeful Design: Soldier"));
  expect(screen.getByLabelText("First Experience modifier +2")).toBeTruthy();
  expect(screen.getByLabelText("Second Experience modifier +3")).toBeTruthy();
});

test("the gear summary shows thresholds with the level added (Gambeson 5 / 11 → 6 / 12 at level 1)", () => {
  // No subclass yet, so no subclass feature moves the thresholds.
  expect(gearSummary({ ...completeGuardian(), subclassId: null, armorId: "gambeson-armor" })).toContain("Thresholds 6 / 12");
  // Stalwart's Unwavering (+1 to damage thresholds) comes through the sheet's own derivedThresholds too.
  expect(gearSummary({ ...completeGuardian(), armorId: "gambeson-armor" })).toContain("Thresholds 7 / 13");
});

test("shared domain cards: Refuse holds step 8 for a card another character holds; Warn and Allow do not", () => {
  const [first] = completeGuardian().domainCards;
  const party = [{ _id: "c1", sheet: { name: "Mira", domainCards: { owned: [first], loadout: [] } } }];
  const nameOf = (id: string) => id;
  expect(refusedCardsMissing([first], "refuse", partyCardHolders("refuse", party), nameOf)).toEqual([
    `a card nobody else holds instead of ${first}`,
  ]);
  expect(refusedCardsMissing([first], "warn", partyCardHolders("warn", party), nameOf)).toEqual([]);
  expect(partyCardHolders("allow", party).size).toBe(0);
});

test("the domain card step notes a held card under Warn and disables it under Refuse", async () => {
  const base = completeGuardian();
  const [held] = domainCardOptions("guardian", opts).map((c) => c.id);
  const stored = { ...base, step: 8, domainCards: [] };
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(stored));
  const mira = characterRow({ _id: "char-9", ownerId: "player-2", status: "active", mine: false, canEdit: false, sheet: { name: "Mira", domainCards: { owned: [held], loadout: [] } } });
  const rules = (mode: string) => (ruleSettingsRecord({ sharedDomainCards: mode }, { locked: false, canEdit: false }));
  const warn = await renderAsPlayer(inCampaign("player", <CharacterWizard />), {
    queries: { ...queriesFor("player", [mira]), [fn(api.ruleSettings.get)]: rules("warn") },
  });
  await waitFor(() => {
    expect(warn.getByText("Mira already has this card.")).toBeTruthy();
  });
  await warn.unmount();
  const refuse = await renderAsPlayer(inCampaign("player", <CharacterWizard />), {
    queries: { ...queriesFor("player", [mira]), [fn(api.ruleSettings.get)]: rules("refuse") },
  });
  await waitFor(() => {
    expect(refuse.getByText("Mira already has this card; this campaign doesn't share domain cards.")).toBeTruthy();
  });
});

test("typing is saved after a pause, a tap at once, and only the latest state is written", () => {
  jest.useFakeTimers();
  try {
    const setItem = jest.mocked(SecureStore.setItemAsync);
    setItem.mockClear();
    const saver = createDraftSaver("campaign-1");
    expect(isTypedPatch({ name: "B" })).toBe(true);
    expect(isTypedPatch({ classId: "bard" })).toBe(false);
    saver.save({ ...emptyWizard(), name: "B" }, { typed: true });
    saver.save({ ...emptyWizard(), name: "Br" }, { typed: true });
    expect(setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(setItem.mock.calls[0]?.[1])).name).toBe("Br");
    saver.save({ ...emptyWizard(), classId: "bard" }, { typed: false });
    expect(setItem).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
