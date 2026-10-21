import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

// countdowns-advanced K2: countdown types on the dashboard. The New countdown dialog's Type, Start (number or dice),
// Repeats and Armed; the card's type badge, Armed switch and "Triggered n times"; a manual tick to 0 triggers and
// resets a loop; an environment's "Countdown (Loop 1d4)" starts as a loop; players see the badge, never the switch.

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Modes ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

test("the GM creates typed countdowns, a manual tick to 0 loops, Armed switches, an environment loop starts; a player sees badges only", async ({
  page,
  browser,
}) => {
  const campaignId = await newCampaign(page);
  const campaignUrl = page.url();
  const grid = page.getByRole("region", { name: "Countdowns" });

  // 'Countdown (Loop 2)', armed (the box is checked by default), public.
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("Rockfall");
  await dialog.getByLabel("What happens at zero").fill("Stones rain down.");
  await expect(dialog.getByRole("radio", { name: "Standard", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Advance automatically on action rolls/ })).toBeChecked();
  await dialog.getByRole("radio", { name: "Loop", exact: true }).check();
  await expect(dialog).toContainText("resets to its starting value");
  await dialog.getByRole("radio", { name: "2", exact: true }).click();
  await dialog.getByRole("button", { name: "Start at 2" }).click();
  await expect(dialog).toBeHidden();

  const rockfall = grid.getByRole("article", { name: "Rockfall" });
  await expect(rockfall.getByTestId("countdown-type")).toContainText("Loop 2");
  const armed = rockfall.getByRole("button", { name: /^Armed/ });
  await expect(armed).toHaveAttribute("aria-pressed", "true");
  expect((await armed.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Two manual ticks: the second reaches 0, triggers and the loop is back at 2.
  await rockfall.getByRole("button", { name: "Tick −1" }).click();
  await expect(rockfall.getByTestId("countdown-value")).toHaveText("1/2");
  await rockfall.getByRole("button", { name: "Tick −1" }).click();
  await expect(rockfall.getByTestId("countdown-triggers")).toHaveText("Triggered 1 time");
  await expect(rockfall.getByTestId("countdown-value")).toHaveText("2/2");
  await expect(rockfall).toHaveAttribute("data-status", "active");

  // Disarm (optimistic); the server agrees.
  await armed.click();
  await expect(armed).toHaveAttribute("aria-pressed", "false");
  const gm = await convexAs(page);
  await expect
    .poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Rockfall")?.armed)
    .toBe(false);

  // A progress countdown with a 1d6 start: the server rolls 1-6.
  await page.getByRole("button", { name: "+ New countdown" }).click();
  await dialog.getByLabel("Countdown name").fill("Climb the cliff");
  await dialog.getByRole("radio", { name: "Progress", exact: true }).check();
  await expect(dialog.getByRole("table")).toContainText("Critical Success");
  await dialog.getByRole("radio", { name: "Roll dice", exact: true }).check();
  await dialog.getByLabel("Number of dice").selectOption("1");
  await dialog.getByLabel("Die", { exact: true }).selectOption("6");
  await dialog.getByRole("button", { name: "Roll 1d6" }).click();
  await expect(dialog).toBeHidden();
  const climb = grid.getByRole("article", { name: "Climb the cliff" });
  await expect(climb.getByTestId("countdown-value")).toHaveText(/^[1-6]\/[1-6]$/);
  const rolled = (await climb.getByTestId("countdown-value").textContent())!.split("/")[0];
  await expect(climb.getByTestId("countdown-type")).toContainText("Progress");
  await expect(climb.getByTestId("countdown-type")).toContainText(`Rolled 1d6: ${rolled}`);

  // An environment's 'Countdown (Loop 1d4)' (Chaos Realm) starts as an armed loop.
  const started = await gm.mutation(api.environmentActions.startCountdown, {
    campaignId,
    environmentId: "chaos-realm",
    featureName: "Everything You Are This Place Will Take from You",
    idempotencyKey: crypto.randomUUID(),
  });
  const realm = grid.getByRole("article", { name: started.name });
  await expect(realm.getByTestId("countdown-type")).toContainText(`Loop ${started.startingValue}`);
  await expect(realm.getByTestId("countdown-type")).toContainText(`Rolled 1d4: ${started.startingValue}`);
  await expect(realm.getByRole("button", { name: /^Armed/ })).toHaveAttribute("aria-pressed", "true");

  // A player sees the public countdown's badge, and no Armed switch.
  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${joinCode}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player).toHaveURL(campaignUrl);
  const seen = player.getByRole("region", { name: "Countdowns" });
  const theirs = seen.getByRole("article", { name: "Rockfall" });
  await expect(theirs.getByTestId("countdown-type")).toContainText("Loop 2");
  await expect(theirs.getByTestId("countdown-triggers")).toHaveText("Triggered 1 time");
  await expect(seen.getByRole("button", { name: /^Armed/ })).toHaveCount(0);
  await expect(seen).not.toContainText("Rolled 1d6");
  // The environment countdown is Private: the player never gets it.
  await expect(seen.getByRole("article", { name: started.name })).toHaveCount(0);
  await context.close();
});
