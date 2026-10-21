import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// countdowns-advanced K3: chase countdowns (CB p.163). The GM starts a chase from "+ New chase" (d6, decent lead, the
// PCs pursuing); the player's manual action rolls move the two tracks by the Dynamic Countdown Advancement table; the
// escapee reaches 0 and the pair card says "Got away!"; the player sees the same card without the GM's controls.

const PLAYER = "e2e-player@example.test";
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Chase ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

test("the GM starts a chase; the player's rolls move both tracks by R4 until the thief gets away", async ({ page, browser }) => {
  const campaignId = await newCampaign(page);
  const campaignUrl = page.url();
  const gm = await convexAs(page);
  const grid = page.getByRole("region", { name: "Countdowns" });

  // A player joins and makes a Bard (agility +0).
  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const asPlayer = await convexAs(player);
  await asPlayer.mutation(api.members.joinByCode, { code: joinCode! });
  const hero = `Liriel ${crypto.randomUUID().slice(0, 6)}`;
  const { characterId } = await asPlayer.mutation(api.characters.create, { campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
  const roll = (values: [number, number], difficulty?: number) =>
    asPlayer.mutation(api.rolls.manualRoll, {
      characterId,
      roll: { ...agility, ...(difficulty === undefined ? {} : { difficulty }) },
      values,
      idempotencyKey: crypto.randomUUID(),
    });

  // New chase: d6, decent lead (3 lower), the PCs pursuing, armed by default.
  await page.getByRole("button", { name: "+ New chase" }).click();
  const dialog = page.getByRole("dialog", { name: "New chase" });
  await dialog.getByLabel("Rivals").fill("The thief");
  await dialog.getByLabel("Notes").fill("Across the market square");
  await expect(dialog.getByRole("radio", { name: "Pursuing", exact: true })).toBeChecked();
  await dialog.getByRole("radio", { name: "d6", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Decent lead" })).toBeChecked();
  await expect(dialog).toContainText("range band");
  await expect(dialog.getByTestId("chase-preview")).toContainText("The party starts at 6, The thief at 3.");
  await expect(dialog.getByRole("checkbox", { name: /Advance automatically on action rolls/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Start chase" }).click();
  await expect(dialog).toBeHidden();

  const card = grid.getByRole("article", { name: "Chase: The thief" });
  await expect(card.getByTestId("chase-value-party")).toHaveText("6/6");
  await expect(card.getByTestId("chase-value-rivals")).toHaveText("3/6");
  await expect(card).toContainText("Your successes move this");
  await expect(card).toContainText("Failures and success with Fear move this");
  const armed = card.getByRole("button", { name: /^Armed/ });
  await expect(armed).toHaveAttribute("aria-pressed", "true");
  expect((await armed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // ONE card for the pair.
  await expect(grid.getByRole("article")).toHaveCount(1);

  // Success with Hope (no Difficulty = a success): the party's progress countdown 6 -> 4.
  await roll([8, 3]);
  await expect(card.getByTestId("chase-value-party")).toHaveText("4/6");
  await expect(card.getByTestId("chase-value-rivals")).toHaveText("3/6");
  // Failure with Hope: the thief's consequence countdown 3 -> 1.
  await roll([8, 3], 30);
  await expect(card.getByTestId("chase-value-rivals")).toHaveText("1/6");
  await expect(card.getByTestId("chase-value-party")).toHaveText("4/6");
  // Success with Fear moves both: the party 4 -> 3, the thief 1 -> 0, who gets away.
  await roll([3, 8]);
  await expect(card.getByTestId("chase-value-party")).toHaveText("3/6");
  await expect(card.getByTestId("chase-value-rivals")).toHaveText("0/6");
  await expect(card.getByTestId("chase-outcome")).toHaveText("Got away!");
  await expect(card.getByRole("status").filter({ hasText: "Got away!" })).toContainText("The thief got away from the party.");
  // The chase has ended: another roll moves nothing.
  await roll([5, 5]);
  await expect.poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).map((c) => c.currentValue)).toEqual([3, 0]);
  await expect(card.getByTestId("chase-value-party")).toHaveText("3/6");

  // The player sees the same pair card, without the Armed switch or manual ticks.
  await player.goto(campaignUrl);
  const theirs = player.getByRole("region", { name: "Countdowns" }).getByRole("article", { name: "Chase: The thief" });
  await expect(theirs.getByTestId("chase-outcome")).toHaveText("Got away!");
  await expect(theirs.getByTestId("chase-value-party")).toHaveText("3/6");
  await expect(theirs.getByRole("button")).toHaveCount(0);

  // Cancelling the ended chase removes the whole pair.
  await card.getByRole("button", { name: "Cancel chase…" }).click();
  await card.getByRole("button", { name: "Cancel chase", exact: true }).click();
  await expect(grid.getByRole("article")).toHaveCount(0);
  await expect.poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).length).toBe(0);
  await context.close();
});
