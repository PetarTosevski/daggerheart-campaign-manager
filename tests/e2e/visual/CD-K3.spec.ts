import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, D9_VIEWPORTS, visual } from "./helpers";

// CD-K3 (countdowns-advanced): the New chase dialog and the chase pair card (a running chase, one the thief got away
// from, one where the party was caught), for the GM and a player, at 1440, 1024 and 390.

test("CD-K3 chase countdowns: the dialog and the pair card, at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
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
  const { shoot } = visual(page, "CD-K3", D9_VIEWPORTS);

  const chase = (name: string, extra: { startingValue: number; lead: "small" | "decent" | "substantial"; party: "pursuing" | "escaping" }) =>
    gm.mutation(api.countdowns.createChase, {
      campaignId,
      name,
      description: `${name}: notes for the GM.`,
      visibility: { mode: "public", hidden: [] },
      armed: true,
      ...extra,
      idempotencyKey: crypto.randomUUID(),
    });
  const tick = (countdownId: Id<"countdowns">, times = 1) =>
    Array.from({ length: times }).reduce<Promise<unknown>>(
      (p) => p.then(() => gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: crypto.randomUUID() })),
      Promise.resolve(),
    );
  // A running chase (the book's market chase after Tabby's success with Hope), the thief who got away, and a pack of
  // wolves that caught the fleeing party.
  const running = await chase("The thief", { startingValue: 6, lead: "decent", party: "pursuing" });
  await tick(running.partyId, 2);
  const gone = await chase("The courier", { startingValue: 8, lead: "small", party: "pursuing" });
  await tick(gone.rivalsId, 7);
  const caught = await chase("The wolves", { startingValue: 10, lead: "substantial", party: "escaping" });
  await tick(caught.rivalsId, 10);

  const grid = page.getByRole("region", { name: "Countdowns" });
  await expect(grid.getByRole("article")).toHaveCount(3);
  const thief = grid.getByRole("article", { name: "Chase: The thief" });
  await expect(thief.getByTestId("chase-value-party")).toHaveText("4/6");
  await expect(grid.getByRole("article", { name: "Chase: The courier" }).getByTestId("chase-outcome")).toHaveText("Got away!");
  await expect(grid.getByRole("article", { name: "Chase: The wolves" }).getByTestId("chase-outcome")).toHaveText("Caught!");
  await shoot(thief, "card-running");
  await shoot(grid.getByRole("article", { name: "Chase: The courier" }), "card-got-away");
  await shoot(grid.getByRole("article", { name: "Chase: The wolves" }), "card-caught");
  await shoot(grid, "cards-gm");

  await page.getByRole("button", { name: "+ New chase" }).click();
  const dialog = page.getByRole("dialog", { name: "New chase" });
  await dialog.getByLabel("Rivals").fill("The thief");
  await dialog.getByRole("radio", { name: "d6", exact: true }).click();
  await shoot(dialog, "dialog");
  await dialog.getByRole("radio", { name: "Escaping", exact: true }).check();
  await dialog.getByRole("radio", { name: "d4", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Substantial lead" })).toBeDisabled();
  await shoot(dialog, "dialog-escaping-d4");
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
  await expect(seen.getByRole("article")).toHaveCount(3);
  await expect(seen.getByRole("button", { name: /^Armed/ })).toHaveCount(0);
  await visual(player, "CD-K3", D9_VIEWPORTS).shoot(seen, "cards-player");
  await context.close();
});
