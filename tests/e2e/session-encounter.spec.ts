import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { D10_VIEWPORTS, bardDraft, openCombatMap, visual } from "./visual/helpers";

// D10 S8: the Combat Map's '＋ Session encounter' (bead dcm-bxp.50, B11, Q2). The GM links an encounter with a Solo
// and two Standards to the planned session, opens a map and clicks '＋ Session encounter': the encounter runs, three
// tokens appear, the Solo takes 2 × 2; a second click adds nothing. Another running encounter is refused.

/** A campaign with a map, one PC, and a planned session linked to a draft encounter (a Solo, two Standards). */
async function seed(page: Page) {
  const { client, campaignId, url } = await openCombatMap(page);
  const uuid = () => crypto.randomUUID();
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: uuid() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: uuid() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Ford ambush", idempotencyKey: uuid() });
  for (const [adversaryId, count] of [
    ["acid-burrower", 1],
    ["jagged-knife-bandit", 2],
  ] as const) {
    await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId }, count, summoned: false, idempotencyKey: uuid() });
  }
  const { sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
  return { client, campaignId, url, encounterId, sessionId };
}

function combatantsOf(page: Page) {
  return page.getByRole("complementary", { name: "Map tools" }).getByRole("region", { name: "Combatants" });
}

test("the GM places the planned session's encounter with one click; a second click adds nothing", async ({ page }) => {
  const { client, campaignId, url, encounterId, sessionId } = await seed(page);
  await page.goto(url);
  const combatants = combatantsOf(page);
  const button = combatants.getByRole("button", { name: "＋ Session encounter" });

  // No encounter linked yet: disabled, with the board's title.
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", "No planned session with an encounter");

  await client.mutation(api.sessionPrep.linkEncounter, { campaignId, sessionId, encounterId });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("title", "Session 1: 2× Standard, 1× Solo");

  await button.click();
  await expect(combatants.getByRole("status")).toHaveText("Added Session 1's encounter.");
  const board = page.getByRole("region", { name: "Battle map" });
  await expect(board.getByTestId("combat-token")).toHaveCount(3);
  await expect(combatants.getByTestId("combat-token-count")).toHaveText("0 party · 3 enemies");
  await expect.poll(async () => (await client.query(api.encounters.get, { campaignId, encounterId }))?.encounter.status).toBe("running");
  const solo = board.getByRole("button", { name: /^Acid Burrower, Enemy/ });
  await expect(solo).toBeVisible();
  const box = (await solo.boundingBox())!;
  const bandit = (await board.getByRole("button", { name: /^Jagged Knife Bandit, Enemy/ }).boundingBox())!;
  expect(Math.round(box.width / bandit.width)).toBe(2);
  // The running encounter's queue is empty: everything is on the map.
  await expect(combatants.getByRole("group", { name: "From the Adversaries tab" })).toHaveCount(0);

  // A second click places nothing more.
  await button.click();
  await expect(combatants.getByRole("status")).toHaveText("Session 1's encounter is already on the map.");
  await expect(board.getByTestId("combat-token")).toHaveCount(3);
  await expect(combatants.getByRole("alert")).toHaveCount(0);
});

test("another running encounter is refused with 'End the running encounter first'", async ({ page }) => {
  const { client, campaignId, url, encounterId, sessionId } = await seed(page);
  await client.mutation(api.sessionPrep.linkEncounter, { campaignId, sessionId, encounterId });
  const { encounterId: other } = await client.mutation(api.encounters.create, { campaignId, name: "Wolves", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId: other });
  await page.goto(url);
  const combatants = combatantsOf(page);
  await combatants.getByRole("button", { name: "＋ Session encounter" }).click();
  await expect(combatants.getByRole("alert")).toHaveText("End the running encounter first.");
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-token")).toHaveCount(0);
  expect((await client.query(api.encounters.get, { campaignId, encounterId }))?.encounter.status).toBe("draft");
});

// D10 S8 visual shots (E2E_VISUAL=1): the Combatants card before and after the click at 1440, 1024 and 390, in
// test-results/visual/D10-S8/. Board counterpart: Combat.dc.html l.146 (the same button in the Combatants card).
test("D10 S8 combatants card at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId, url, encounterId, sessionId } = await seed(page);
  await client.mutation(api.sessionPrep.linkEncounter, { campaignId, sessionId, encounterId });
  await page.goto(url);
  const combatants = combatantsOf(page);
  const button = combatants.getByRole("button", { name: "＋ Session encounter" });
  await expect(button).toBeEnabled();
  const { shoot } = visual(page, "D10-S8", D10_VIEWPORTS);
  await shoot(combatants, "combatants-ready");
  await button.click();
  await expect(combatants.getByRole("status")).toHaveText("Added Session 1's encounter.");
  await shoot(combatants, "combatants-placed");
  await shoot(page.getByRole("region", { name: "Battle map" }), "map-placed");
});
