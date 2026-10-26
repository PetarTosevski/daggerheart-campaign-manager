import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

// countdowns-advanced K4: long-term countdowns (CB p.164). The GM writes a track in the New countdown dialog, a finished
// long rest ticks it once (the card highlights the step, the rest panel lists it), the rest's undo takes it back; a
// countdown set to Reminder only asks "Tick <name>?" and ticks on one click; a player sees the boxes, never the steps.

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Long-term ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

test("the GM writes a long-term track, a finished long rest ticks it, undo takes it back; Reminder asks; players see no steps", async ({
  page,
  browser,
}) => {
  const campaignId = await newCampaign(page);
  const campaignUrl = page.url();
  const grid = page.getByRole("region", { name: "Countdowns" });
  const rest = page.getByRole("region", { name: "Rest", exact: true });

  // 'Invasion': long-term 8 with three steps written (7 with news, 4, the final event).
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("Invasion");
  await dialog.getByLabel("What happens at zero").fill("The city falls.");
  await dialog.getByRole("radio", { name: "Long-term", exact: true }).check();
  await expect(dialog.getByRole("radio", { name: "Roll dice", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Loop", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: /Tick on every long rest/ })).toBeChecked();
  await expect(dialog.getByRole("group", { name: "On long rest" }).getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("radio", { name: "8", exact: true }).click();
  const editor = dialog.getByRole("list", { name: "Steps" });
  await expect(editor.getByRole("listitem")).toHaveCount(9);
  await editor.getByLabel("Step at 7", { exact: true }).fill("The theocracy's troops gather at the border");
  await editor.getByLabel("News reaches the party at 7").check();
  await editor.getByLabel("Step at 4", { exact: true }).fill("Refugees arrive");
  await editor.getByLabel("Final event").fill("The city falls");
  await dialog.getByRole("button", { name: "Start at 8" }).click();
  await expect(dialog).toBeHidden();

  const invasion = grid.getByRole("article", { name: "Invasion" });
  await expect(invasion.getByTestId("countdown-type")).toContainText("Long-term");
  await expect(invasion.getByTestId("countdown-value")).toHaveText("8/8");
  const track = invasion.getByTestId("long-term-track");
  await expect(track.locator("li[data-ticked=true]")).toHaveCount(0);
  await expect(track.getByTestId("track-next")).toContainText("The theocracy's troops gather at the border");

  // A long rest, finished by the GM: Invasion ticks once, step 7 highlighted; the rest panel lists it.
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(invasion.getByTestId("countdown-value")).toHaveText("7/8");
  await expect(track.locator("li[data-current=true]")).toHaveAttribute("data-value", "7");
  await expect(track.getByTestId("track-current")).toContainText("The theocracy's troops gather at the border");
  await expect(track.getByTestId("track-current")).toContainText("News reaches the party");
  const panel = rest.getByTestId("rest-long-term");
  await expect(panel).toContainText("Invasion: 7 left - The theocracy's troops gather at the border");

  // Undo the rest: back to 8.
  await rest.getByRole("button", { name: "Undo rest" }).click();
  await expect(invasion.getByTestId("countdown-value")).toHaveText("8/8");
  await expect(panel).toHaveCount(0);
  await rest.getByRole("button", { name: "Interrupt" }).click();
  await expect(invasion.getByTestId("countdown-value")).toHaveText("8/8");

  // Edit a step inline (optimistic) and switch to Reminder.
  await invasion.getByRole("button", { name: "Edit steps" }).click();
  const inline = invasion.getByRole("list", { name: "Steps of Invasion" });
  await inline.getByLabel("Step at 8", { exact: true }).fill("Envoys stop answering letters");
  await inline.getByLabel("Step at 8", { exact: true }).press("Enter");
  await expect(track.getByTestId("track-current")).toContainText("Envoys stop answering letters");
  await invasion.getByRole("group", { name: "On long rest" }).getByRole("button", { name: "Reminder" }).click();
  await expect(invasion.getByRole("group", { name: "On long rest" }).getByRole("button", { name: "Reminder" })).toHaveAttribute("aria-pressed", "true");
  const gm = await convexAs(page);
  await expect
    .poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Invasion")?.restMode)
    .toBe("remind");
  expect((await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Invasion")?.steps?.[0]).toEqual({
    value: 8,
    text: "Envoys stop answering letters",
  });

  // Reminder: the long rest moves nothing and asks; one click ticks it.
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(panel).toContainText("Tick Invasion? (8 left)");
  await expect(invasion.getByTestId("countdown-value")).toHaveText("8/8");
  await panel.getByRole("button", { name: "Tick Invasion" }).click();
  await expect(invasion.getByTestId("countdown-value")).toHaveText("7/8");
  await expect(panel).toContainText("Invasion: 7 left - The theocracy's troops gather at the border");
  await expect(panel.getByRole("button", { name: "Tick Invasion" })).toHaveCount(0);
  await expect
    .poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Invasion")?.currentValue)
    .toBe(7);

  // A player sees the boxes but no step text, no editor and no switch.
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
  await expect(theirs.getByTestId("long-term-track").locator("li[data-ticked=true]")).toHaveCount(1);
  await expect(theirs).not.toContainText("theocracy");
  await expect(theirs.getByRole("button", { name: "Edit steps" })).toHaveCount(0);
  await expect(theirs.getByRole("group", { name: "On long rest" })).toHaveCount(0);
  await context.close();
});
