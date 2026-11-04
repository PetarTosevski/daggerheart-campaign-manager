import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { combatMapUrl } from "./hud/helpers";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JT (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JT.md): the Session tally tiles and the Spotlight
// bars on the design's campaign (tests/e2e/journal/helpers.ts, session 6 live). Live, without a reload: Fear and a
// critical roll raise the tiles (the open window is read without an upper time bound); the GM hands the spotlight to
// a PC on the Combat Map and the bar grows; Reset zeroes the bars. Players (Q5) see neither card. Axe and no sideways
// scroll at 1440x900 and 390x844.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const presence = {
  kind: "action" as const,
  trait: "presence" as const,
  modifier: 0,
  experienceIds: [],
  advantage: 0,
  disadvantage: 0,
  help: 0,
  attack: false,
  options: [],
};

let table: JournalTable;

test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 30_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
});

test.afterAll(async () => {
  await table?.close();
});

const tallyOf = (page: Page) => page.getByRole("region", { name: "Session tally" });
const tile = (page: Page, label: string) => tallyOf(page).getByRole("listitem").filter({ hasText: label });
const spotOf = (page: Page) => page.getByRole("region", { name: "Spotlight" });
const bar = (page: Page, name: string) => spotOf(page).getByRole("listitem").filter({ hasText: name });

test("tally: Fear and a critical roll raise the tiles live; players see no tally or spotlight", async () => {
  const { gm, player, client, playerClient, campaignId, characterId, liveSessionId } = table;
  await openJournal(gm, table, `?s=${liveSessionId}&sv=log`);
  await openJournal(player, table, `?s=${liveSessionId}`);
  await expect(tile(gm, "Fear gained")).toHaveText("0 Fear gained");
  await expect(tile(gm, "Critical successes")).toHaveText("0 Critical successes");
  await expect(tallyOf(gm).getByRole("listitem")).toHaveCount(6);

  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  await expect(tile(gm, "Fear gained")).toHaveText("3 Fear gained");
  // Matching Duality Dice: a critical success.
  await playerClient.mutation(api.rolls.manualRoll, { characterId, roll: presence, values: [7, 7], idempotencyKey: crypto.randomUUID() });
  await expect(tile(gm, "Critical successes")).toHaveText("1 Critical successes");

  // Q5: the player sees neither card.
  await expect(player.getByRole("region", { name: "Session log" })).toBeVisible();
  await expect(tallyOf(player)).toHaveCount(0);
  await expect(spotOf(player)).toHaveCount(0);

  for (const viewport of VIEWPORTS) {
    await gm.setViewportSize(viewport);
    await expect(tallyOf(gm)).toBeVisible();
    await expectFitsViewport(gm);
    await expectNoSeriousA11yViolations(gm);
  }
  await gm.setViewportSize(VIEWPORTS[0]);
});

test("spotlight: handing it to a PC on the Combat Map grows the bar live; Reset zeroes it", async () => {
  const { gm, client, campaignId, liveSessionId } = table;
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest Camp", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });

  await openJournal(gm, table, `?s=${liveSessionId}&sv=log`);
  await expect(bar(gm, "Brannoc")).toHaveAttribute("aria-label", "Brannoc: 0 spotlight moments");
  // No tap to add (Q9): the bars are not buttons.
  await expect(spotOf(gm).getByRole("listitem").getByRole("button")).toHaveCount(0);

  const map = await gm.context().newPage();
  try {
    await map.setViewportSize(VIEWPORTS[0]);
    await map.goto(combatMapUrl(campaignId));
    await map.getByRole("button", { name: /^Spotlight: .*Change who has it$/ }).click({ timeout: 60_000 });
    await map.getByRole("dialog", { name: "Spotlight" }).getByRole("button", { name: "Give the spotlight to Brannoc" }).click();
    await expect(map.getByRole("button", { name: "Spotlight: Brannoc. Change who has it" })).toBeVisible();
  } finally {
    await map.close();
  }

  await expect(bar(gm, "Brannoc")).toHaveAttribute("aria-label", "Brannoc: 1 spotlight moment");
  await expect(gm.getByText("Moss, Vex and Oriel have had the least spotlight this session.")).toBeVisible();
  await expectNoSeriousA11yViolations(gm);

  await spotOf(gm).getByRole("button", { name: "Reset" }).click();
  await expect(bar(gm, "Brannoc")).toHaveAttribute("aria-label", "Brannoc: 0 spotlight moments");
  await expect(gm.getByText(/least spotlight/)).toHaveCount(0);
  await gm.reload();
  await expect(bar(gm, "Brannoc")).toHaveAttribute("aria-label", "Brannoc: 0 spotlight moments");
});
