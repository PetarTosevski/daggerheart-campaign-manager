import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, D9_VIEWPORTS, visual } from "./helpers";

// CD-K2 (countdowns-advanced): the New countdown dialog with Type, Start, Repeats and Armed, and the cards' type
// badges, Armed switch and "Triggered n times", for the GM and a player, at 1440, 1024 and 390.

test("CD-K2 countdown types: the dialog and the cards, at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignUrl = page.url();
  const campaignId = new URL(campaignUrl).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);
  const { shoot } = visual(page, "CD-K2", D9_VIEWPORTS);

  const seed = (name: string, extra: Record<string, unknown>) =>
    gm.mutation(api.countdowns.create, {
      campaignId,
      name,
      description: "",
      category: "threat",
      consequence: `${name}: it happens.`,
      visibility: { mode: "public", hidden: [] },
      ...extra,
      idempotencyKey: crypto.randomUUID(),
    } as never) as Promise<{ countdownId: Id<"countdowns"> }>;
  const { countdownId: loop } = await seed("Rockfall", { startingValue: 3, repeat: "loop", armed: true });
  await gm.mutation(api.countdowns.operate, { countdownId: loop, action: "correction", amount: -3, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.countdowns.operate, { countdownId: loop, action: "advance", idempotencyKey: crypto.randomUUID() });
  await seed("Climb the cliff", { startDice: { count: 1, sides: 6 }, mode: "progress", armed: true });
  await seed("The guards close in", { startingValue: 6, mode: "consequence", armed: false });
  await seed("The tide rises", { startingValue: 8, repeat: "increasing", armed: true });
  await seed("The ward weakens", { startingValue: 8, repeat: "decreasing", armed: true });
  await seed("Market day", { startingValue: 4 });

  const grid = page.getByRole("region", { name: "Countdowns" });
  await expect(grid.getByRole("article")).toHaveCount(6);
  await expect(grid.getByRole("article", { name: "Rockfall" }).getByTestId("countdown-triggers")).toHaveText("Triggered 1 time");
  await shoot(grid, "cards-gm");
  await shoot(grid.getByRole("article", { name: "Rockfall" }), "card-loop-gm");

  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("Climb the cliff");
  await dialog.getByRole("radio", { name: "Progress", exact: true }).check();
  await dialog.getByRole("radio", { name: "Roll dice", exact: true }).check();
  await dialog.getByRole("radio", { name: "Loop", exact: true }).check();
  await shoot(dialog, "dialog-progress-dice-loop");
  await dialog.getByRole("radio", { name: "Standard", exact: true }).check();
  await dialog.getByRole("radio", { name: "A number", exact: true }).check();
  await dialog.getByRole("radio", { name: "No repeat", exact: true }).check();
  await shoot(dialog, "dialog-standard");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${joinCode}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player).toHaveURL(campaignUrl);
  const seen = player.getByRole("region", { name: "Countdowns" });
  await expect(seen.getByRole("article")).toHaveCount(6);
  await expect(seen.getByRole("button", { name: /^Armed/ })).toHaveCount(0);
  await visual(player, "CD-K2", D9_VIEWPORTS).shoot(seen, "cards-player");
  await context.close();
});
