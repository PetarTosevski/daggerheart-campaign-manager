import { beforeEach, expect, jest, test } from "@jest/globals";
import { useQuery } from "convex/react";
import { Text } from "react-native";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { api } from "../../../src/convex";
import type { Id } from "../../../src/convex";
import { CharacterSheet } from "../../../src/features/sheet";
import { QueryBoundary } from "../../../src/ui/query-boundary";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignRecord, characterRecord, inCampaign, sheetCharacter } from "../party/fixture";
import { canMarkStress, stepResource, stepTrait } from "../../../src/features/sheet/optimistic";
import { ruleSettingsRecord } from "../../harness/records";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
});

test("a step moves the sheet at once with the shared rules: Stress past full marks a Hit Point unless D4 is Manual", () => {
  const full = sheetCharacter({ canEdit: true }, { stress: 6, hp: 2 });
  const book = stepResource(full, "stress", 1, {}, 3);
  expect(book.sheet.stress).toBe(6);
  expect(book.sheet.hp).toBe(3);
  const manual = stepResource(full, "stress", 1, { stressOverflow: "manual" }, 3);
  expect(manual.sheet.hp).toBe(2);
  expect(canMarkStress(full.sheet, {})).toBe(true);
  expect(canMarkStress(full.sheet, { stressOverflow: "manual" })).toBe(false);
  expect(stepResource(full, "armor", 5, {}, 3).sheet.armorMarked).toBe(3);
  expect(stepResource(full, "hope", 9, {}, 3).sheet.hope).toBe(6);
  expect(stepTrait(full, "agility", 20).sheet.traits.agility).toBe(10);
});

function sheetQueries(role: "gm" | "player", character: unknown, stressOverflow: "book" | "manual" = "book") {
  return {
    [fn(api.campaigns.get)]: campaignRecord(role),
    [fn(api.charactersReads.get)]: character,
    [fn(api.ruleSettings.get)]: ruleSettingsRecord({ stressOverflow, fullStressVulnerable: "book" }, { locked: false, canEdit: role === "gm" }),
  };
}

test("a reader sees the sheet and no steppers", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("player", sheetCharacter({ canEdit: false, mine: false })),
  });
  expect(screen.getByRole("header", { name: "Mira" })).toBeTruthy();
  expect(screen.getByText("Warrior · Call of the Brave · Level 1")).toBeTruthy();
  expect(screen.getByText("Human · Ridgeborne")).toBeTruthy();
  expect(screen.getByText(/Broadsword, agility, Melee, 1d8 phy/)).toBeTruthy();
  expect(screen.getByText(/Leather Armor, score 3, 6\/13/)).toBeTruthy();
  expect(screen.getByText("Read only: only the player and the GM can change this sheet.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Increase Hope" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Decrease Hit Points" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Increase Agility" })).toBeNull();
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get), fn(api.charactersReads.get), fn(api.ruleSettings.get)]);
  expect(screen.client.subscribed).not.toContain(fn(api.restsReads.current));
});

test("an editor sends a resource delta, and a second tap sends another", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("player", characterRecord({ canEdit: true })),
    mutations: {
      [fn(api.characters.adjustResource)]: (args) => {
        calls.push(args);
        return { hp: 2, stress: 1, hope: 4, armorMarked: 0, scars: 0 };
      },
    },
  });
  expect(screen.getByLabelText("Hope 2 of 6")).toBeTruthy();
  expect(screen.client.subscribed).toContain(fn(api.restsReads.current));
  await fireEvent.press(screen.getByRole("button", { name: "Increase Hope" }));
  await fireEvent.press(screen.getByRole("button", { name: "Increase Hope" }));
  expect(calls).toEqual([
    { characterId: "char-1", resource: "hope", delta: 1 },
    { characterId: "char-1", resource: "hope", delta: 1 },
  ]);
  expect(screen.queryByRole("button", { name: "Increase Agility" })).toBeNull();
});

test("Stress at full: + marks a Hit Point under the Book, and is off under D4 Manual", async () => {
  const calls: unknown[] = [];
  const full = sheetCharacter({ canEdit: true }, { stress: 6 });
  const book = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("player", full),
    mutations: {
      [fn(api.characters.adjustResource)]: (args) => {
        calls.push(args);
        return { hp: 3, stress: 6, hope: 2, armorMarked: 0, scars: 0 };
      },
    },
  });
  expect(book.getByLabelText("Stress 6 of 6, full: one more marks a Hit Point")).toBeTruthy();
  await fireEvent.press(book.getByRole("button", { name: "Increase Stress" }));
  expect(calls).toEqual([{ characterId: "char-1", resource: "stress", delta: 1 }]);

  const manual = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("player", full, "manual"),
  });
  expect(manual.getByRole("button", { name: "Increase Stress" }).props.accessibilityState).toEqual({ disabled: true });
});

test("the GM can correct a trait; a player editor cannot", async () => {
  const calls: unknown[] = [];
  const gm = await renderAsGm(inCampaign("gm", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("gm", characterRecord({ canEdit: true })),
    mutations: {
      [fn(api.characters.setTrait)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(gm.getByRole("button", { name: "Increase Agility" }));
  // One trait by a delta (rule 12), never the whole traits object.
  expect(calls[0]).toEqual({ characterId: "char-1", trait: "agility", delta: 1 });

  const player = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("player", characterRecord({ canEdit: true })),
  });
  expect(player.queryByRole("button", { name: "Increase Agility" })).toBeNull();
  expect(player.getByRole("button", { name: "Increase Hope" })).toBeTruthy();
});

test("loading, missing, and offline states", async () => {
  const loading = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />), {
    queries: { [fn(api.campaigns.get)]: campaignRecord("player") },
  });
  expect(loading.getByRole("progressbar", { name: "Loading character" })).toBeTruthy();

  const missing = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="gone" />), {
    queries: sheetQueries("player", null),
  });
  expect(missing.getByRole("header", { name: "Character not found" })).toBeTruthy();

  const calls: unknown[] = [];
  const offline = await renderAsPlayer(inCampaign("player", <CharacterSheet characterId="char-1" />, true), {
    queries: sheetQueries("player", characterRecord({ canEdit: true })),
    mutations: {
      [fn(api.characters.adjustResource)]: (args) => {
        calls.push(args);
        return undefined;
      },
    },
  });
  expect(offline.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const hope = offline.getByRole("button", { name: "Increase Hope" });
  expect(hope.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(hope);
  expect(calls).toEqual([]);
});

test("a failing character query shows the error", async () => {
  function BrokenSheet() {
    useQuery(api.charactersReads.get, { characterId: "char-1" as Id<"characters"> });
    return <Text>Ready</Text>;
  }
  const screen = await renderAsPlayer(
    <QueryBoundary>
      <BrokenSheet />
    </QueryBoundary>,
    {
      queries: {
        [fn(api.charactersReads.get)]: () => {
          throw new Error("sheet down");
        },
      },
    },
  );
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.getByRole("header", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByText("Something went wrong. Check your connection and try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("story, cards, heritage, and the downtime reference are on the sheet", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign("gm", <CharacterSheet characterId="char-1" />), {
    queries: sheetQueries("gm", characterRecord({ canEdit: true })),
    mutations: {
      [fn(api.characters.moveCard)]: (args) => {
        calls.push(args);
        return null;
      },
      [fn(api.characters.adjustGold)]: (args) => {
        calls.push(args);
        return { handfuls: 2, bags: 0, chest: false };
      },
    },
  });
  expect(screen.getByText("Short rest")).toBeTruthy();
  expect(screen.getByText("Tend to Wounds")).toBeTruthy();
  expect(screen.getByText("Long rest")).toBeTruthy();
  expect(screen.getByText("Work on a Project")).toBeTruthy();
  expect(screen.getByLabelText("Dice slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Rest slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Features slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Incoming hit slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Level-up slot for Mira")).toBeTruthy();
  expect(screen.getByLabelText("Death slot for Mira")).toBeTruthy();

  await fireEvent.press(screen.getByRole("tab", { name: "Domains" }));
  expect(screen.getByRole("header", { name: "Heritage" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Vault Get Back Up" }));
  expect(calls[0]).toEqual({ characterId: "char-1", cardId: "get-back-up", to: "vault", duringRest: false });

  await fireEvent.press(screen.getByRole("tab", { name: "Story & Advancement" }));
  await fireEvent.press(screen.getByRole("button", { name: "Increase Handfuls" }));
  expect(calls[1]).toEqual({ characterId: "char-1", coin: "handfuls", delta: 1 });
});
