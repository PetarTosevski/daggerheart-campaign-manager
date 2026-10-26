import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openAdversaries, visual } from "./helpers";

// A3 (D8): the encounter builder at 1440 and 390: the encounter list, the Battle Points panel and the add dialog.
// The builder has no Adversaries board counterpart; it follows the Sessions board's encounter builder
// (reference/designs/project/Sessions.dc.html, lines 119-140), shot for docs/tasks/TASK-D8-A3.md with the same
// Playwright setup (the board-shots script has no Sessions regions).

test("A3 encounter builder: list, Battle Points panel and add dialog at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openAdversaries(page);
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Ambush at the ford", pcs: 4, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.create, { campaignId, name: "The hollow oak", pcs: 4, idempotencyKey: crypto.randomUUID() });
  const add = (adversaryId: string, count: number) =>
    client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId }, count, summoned: false, idempotencyKey: crypto.randomUUID() });
  await add("bear", 2);
  await add("jagged-knife-lackey", 4);
  await add("jagged-knife-bandit", 1);
  await client.mutation(api.encounters.setBudget, { campaignId, encounterId, change: { kind: "adjustment", adjustment: "hard", on: true } });

  await page.getByRole("tab", { name: "Encounters" }).click();
  const panel = page.getByRole("tabpanel", { name: "Encounters" });
  await panel.getByRole("navigation", { name: "Encounter list" }).getByRole("button", { name: /Ambush at the ford/ }).click();
  await expect(panel.getByTestId("bp-spent")).toHaveText(/Spent 11 of 16/);
  const { shoot } = visual(page, "A3");

  await shoot(panel.getByRole("navigation", { name: "Encounter list" }), "list");
  await shoot(panel.locator(".enc-card").filter({ has: page.getByRole("heading", { name: "Encounter builder" }) }), "bp-panel");
  await shoot(panel.getByRole("region", { name: "Encounter detail" }), "detail");

  await panel.getByRole("button", { name: "+ Add adversary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to encounter" });
  await dialog.getByPlaceholder("Search by name or type").fill("bear");
  await dialog.getByRole("button", { name: "Bear, Tier 1 Bruiser" }).click();
  await shoot(dialog, "add-dialog");
});
