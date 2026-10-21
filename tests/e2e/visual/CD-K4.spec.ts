import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, D9_VIEWPORTS, visual } from "./helpers";

// CD-K4 (countdowns-advanced): long-term countdowns. The track card (GM and player), the inline step editor, the New
// countdown dialog's step editor and the rest panel's lines and reminder, at 1440, 1024 and 390.

test("CD-K4 long-term countdowns: track, step editors and the rest reminder, at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
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
  const { shoot } = visual(page, "CD-K4", D9_VIEWPORTS);

  const seed = (name: string, extra: Record<string, unknown>) =>
    gm.mutation(api.countdowns.create, {
      campaignId,
      name,
      description: "",
      category: "threat",
      consequence: `${name}: it happens.`,
      visibility: { mode: "public", hidden: [] },
      mode: "longTerm",
      armed: true,
      ...extra,
      idempotencyKey: crypto.randomUUID(),
    } as never) as Promise<{ countdownId: Id<"countdowns"> }>;
  await seed("Invasion", {
    startingValue: 8,
    steps: [
      { value: 7, text: "The theocracy's troops gather at the border", news: true },
      { value: 6, text: "Border villages go quiet" },
      { value: 4, text: "Refugees arrive" },
      { value: 0, text: "The city falls" },
    ],
  });
  await seed("The plague spreads", { startingValue: 5, restMode: "remind", steps: [{ value: 4, text: "A cough in the docks" }] });
  const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "long", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: crypto.randomUUID() });

  const grid = page.getByRole("region", { name: "Countdowns" });
  const invasion = grid.getByRole("article", { name: "Invasion" });
  await expect(invasion.getByTestId("countdown-value")).toHaveText("7/8");
  await shoot(invasion, "track-gm");
  await shoot(grid, "cards-gm");

  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await expect(rest.getByTestId("rest-long-term")).toContainText("Tick The plague spreads?");
  await shoot(rest, "rest-panel-reminder");

  await invasion.getByRole("button", { name: "Edit steps" }).click();
  await shoot(invasion, "track-editing-gm");
  await invasion.getByRole("button", { name: "Done editing" }).click();

  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("The dragon wakes");
  await dialog.getByRole("radio", { name: "Long-term", exact: true }).check();
  await dialog.getByRole("radio", { name: "6", exact: true }).click();
  const editor = dialog.getByRole("list", { name: "Steps" });
  await editor.getByLabel("Step at 5", { exact: true }).fill("Tremors under the mountain");
  await editor.getByLabel("News reaches the party at 5").check();
  await editor.getByLabel("Step at 3", { exact: true }).fill("Livestock vanish");
  await editor.getByLabel("Final event").fill("The dragon takes wing");
  await shoot(editor, "dialog-step-editor");
  await shoot(dialog, "dialog-long-term");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${joinCode}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player).toHaveURL(campaignUrl);
  const theirs = player.getByRole("region", { name: "Countdowns" }).getByRole("article", { name: "Invasion" });
  await expect(theirs.getByTestId("countdown-value")).toHaveText("7/8");
  await visual(player, "CD-K4", D9_VIEWPORTS).shoot(theirs, "track-player");
  await context.close();
});
