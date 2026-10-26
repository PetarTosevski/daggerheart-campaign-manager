import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, D9_VIEWPORTS, visual } from "./helpers";

// CD-K1 (countdowns-advanced): the roll feed's "Tick countdowns" button on a counted action roll and its open list
// (one countdown to pick, one already ticked by the armed auto-tick, one dynamic countdown the roll doesn't move),
// at 1440, 1024 and 390.

test("CD-K1 Tick countdowns button and list, at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);
  const { shoot } = visual(page, "CD-K1", D9_VIEWPORTS);

  const seed = (name: string, extra: Record<string, unknown>) =>
    gm.mutation(api.countdowns.create, { campaignId, name, description: "", category: "threat", consequence: "", idempotencyKey: crypto.randomUUID(), ...extra } as never);
  await seed("The dam breaks", { startingValue: 4 });
  await seed("Patrol sweep", { startingValue: 6, armed: true });
  await seed("Pick the lock", { startingValue: 5, mode: "progress" });

  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  const client = await convexAs(player);
  await client.mutation(api.members.joinByCode, { code: joinCode! });
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
  // Failure with Fear (Hope 3, Fear 8 against 20): standard countdowns tick 1, the progress countdown not at all.
  await client.mutation(api.rolls.manualRoll, {
    characterId,
    values: [3, 8],
    roll: { kind: "action", trait: "agility", modifier: 0, difficulty: 20, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] },
    idempotencyKey: crypto.randomUUID(),
  });

  const row = page.getByRole("list", { name: "Rolls" }).getByRole("listitem").filter({ hasText: "Liriel: Agility action roll" });
  await expect(row.getByRole("button", { name: /^Tick countdowns/ })).toBeVisible();
  await shoot(row, "feed-row");

  await row.getByRole("button", { name: /^Tick countdowns/ }).click();
  const dialog = page.getByRole("dialog", { name: "Tick countdowns" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  await dialog.getByRole("checkbox", { name: /The dam breaks/ }).check();
  await shoot(dialog, "tick-list");
  await context.close();
});
