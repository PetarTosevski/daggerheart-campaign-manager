import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CountdownVisibility } from "../../../src/lib/domain/countdowns";
import { signInAsTestGm } from "../fixtures";
import { convexAs, visual } from "./helpers";

// CV1: countdown visibility. The New countdown dialog's "Who can see this" control, the GM's cards with their
// visibility badges, and the player's cards with hidden fields as placeholders, at 1440 and 390.

test("CV1 countdown visibility, GM and player views, at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);
  const { shoot } = visual(page, "CV1");

  const seed = (name: string, visibility: CountdownVisibility, startingValue: number) =>
    gm.mutation(api.countdowns.create, {
      campaignId,
      name,
      description: `${name}: the GM's notes`,
      category: "threat",
      startingValue,
      consequence: "The valley floods.",
      visibility,
      idempotencyKey: crypto.randomUUID(),
    });
  await seed("Shadow plot", { mode: "private" }, 6);
  await seed("The dam breaks", { mode: "public", hidden: ["name", "description"] }, 8);
  await seed("The Fanewraith stirs", { mode: "public", hidden: ["progress", "consequence", "category"] }, 5);
  await seed("Market day", { mode: "public", hidden: [] }, 4);

  const board = page.getByRole("region", { name: "Countdowns" });
  await expect(board.getByRole("article")).toHaveCount(4);
  await shoot(board, "gm-cards");

  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByRole("radio", { name: "Public, details hidden", exact: true }).check();
  await shoot(dialog, "new-countdown");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await board.getByRole("button", { name: "Who can see The dam breaks: Partly hidden" }).click();
  await shoot(page.getByRole("dialog", { name: "Who can see this" }), "change-visibility");
  await page.getByRole("dialog", { name: "Who can see this" }).getByRole("button", { name: "Cancel" }).click();

  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await (await convexAs(player)).mutation(api.members.joinByCode, { code: joinCode! });
  await player.goto(`/campaigns/${campaignId}`);
  const seen = player.getByRole("region", { name: "Countdowns" });
  await expect(seen.getByRole("article")).toHaveCount(3);
  await visual(player, "CV1").shoot(seen, "player-cards");
  await context.close();
});
