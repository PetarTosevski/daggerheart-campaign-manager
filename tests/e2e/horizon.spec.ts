import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function playerJoins(page: Page, browser: import("@playwright/test").Browser) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext();
  const player = await context.newPage();
  // On a loaded host the test sign-in can be typed before the form hydrates: sign in again until it lands.
  await expect(async () => {
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/", { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  return { context, player };
}

async function gmCreatesHorizonCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Valloren");
  await page.goto("/frames/journey-to-horizon");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

test("the GM marks the Doom Track; players see Echoes and occurred events only", async ({ page, browser }) => {
  test.slow();
  await gmCreatesHorizonCampaign(page);
  const campaignUrl = page.url();

  // dcm-bxp.60 (Q6): a mark made during a live session is stamped "(session N)".
  await page.getByRole("region", { name: "Campaign header" }).getByRole("button", { name: "Start Session", exact: true }).click();
  await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/journal\?s=[^&]+&sv=log$/);
  await page.goto(campaignUrl);

  const doom = page.getByRole("region", { name: /Doom Track/ });
  await expect(doom.getByText("GM only")).toBeVisible();

  // Nested boxes wait for their parent; higher tiers wait for the party.
  const parent = doom.getByRole("checkbox", { name: "Bandits and marauders harry travelers." });
  const nested = doom.getByRole("checkbox", { name: "Tensions rise over contested resources." });
  await expect(nested).toBeDisabled();
  await expect(doom.getByRole("checkbox", { name: /Roving bands of professional soldiers/ })).toBeDisabled();
  await parent.click();
  await expect(parent).toBeChecked();
  await expect(doom.getByText("(session 1)")).toBeVisible();
  await expect(nested).toBeEnabled();
  await nested.click();
  await expect(nested).toBeChecked();
  await expect(parent).toBeDisabled();

  // Soul Echoes: collecting one levels the party up.
  const echoes = page.getByRole("region", { name: "Soul Echoes" });
  await echoes.getByRole("button", { name: "Soul Echo 2 of 10" }).click();
  await expect(echoes.getByRole("status")).toHaveText("The party levels up.");

  // A player joins and sees no Doom Track events until one occurs.
  const { context, player } = await playerJoins(page, browser);

  const playerEchoes = player.getByRole("region", { name: "Soul Echoes" });
  await expect(playerEchoes.getByRole("button", { name: "Soul Echo 2 of 10" })).toHaveAttribute("aria-pressed", "true");
  await expect(playerEchoes.getByRole("button", { name: "Soul Echo 2 of 10" })).toBeDisabled();
  const playerDoom = player.getByRole("region", { name: /Doom Track/ });
  await expect(playerDoom.getByText("No disasters have struck yet.")).toBeVisible();
  await expect(player.getByText("Bandits and marauders harry travelers.")).toHaveCount(0);

  // The GM marks the event as occurred; only that text reaches the player.
  await doom.getByRole("button", { name: "Occurred: Bandits and marauders harry travelers." }).click();
  await expect(playerDoom.getByText("Bandits and marauders harry travelers.")).toBeVisible();
  await expect(player.getByText("Tensions rise over contested resources.")).toHaveCount(0);
  await context.close();
});

test("dcm-bxp.17: Echo sanctuaries, Locate Soul Echoes and regions; players see the bearing and known rumors only", async ({ page, browser }) => {
  test.slow();
  await gmCreatesHorizonCampaign(page);
  const campaignUrl = page.url();
  const campaignId = new URL(campaignUrl).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  // A sanctuary marker in the middle of the map, and the party on hex (0, 0) at the map's top-left corner.
  await client.mutation(api.maps.addToken, { campaignId, type: "sanctuary", x: 50, y: 50, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 });

  await page.goto(`/campaigns/${campaignId}/world`);
  const panel = page.getByRole("region", { name: "Regions & Soul Echoes" });
  const echo = panel.getByRole("checkbox", { name: "Sanctuary: Soul Echo" });
  // Controlled by the server's answer: click, then wait for the state.
  await echo.click();
  await expect(echo).toBeChecked();
  await panel.getByRole("checkbox", { name: "Alerts the Seekers-in-Shadow" }).check();
  await panel.getByRole("button", { name: "Locate Soul Echoes" }).click();
  await expect(panel.getByRole("status")).toHaveText("Locate Soul Echoes: Southeast.");
  await expect(panel.getByTestId("echo-bearing").getByRole("checkbox", { name: "Seekers alerted" })).toBeChecked();

  // A generated region: its rumor, once known, reaches the players.
  await panel.getByLabel("New region name").fill("Ashen Wood");
  await panel.getByRole("button", { name: "Generate region" }).click();
  const region = panel.getByRole("list", { name: "Regions" }).getByRole("listitem").filter({ hasText: "Ashen Wood" });
  await expect(region).toContainText(/of \d+ hexes/);
  await region.locator("summary").click();
  const rumor = region.getByLabel("Rumor for Ashen Wood");
  await rumor.fill("A bell tolls at midnight, though no source can be found.");
  await rumor.press("Tab");
  await region.getByRole("checkbox", { name: /The party knows this rumor/ }).click();
  await expect(region.getByRole("checkbox", { name: /The party knows this rumor/ })).toBeChecked();

  // Collecting the Echo raises the Soul Echoes count.
  await panel.getByRole("button", { name: "Collect the Echo" }).click();
  await expect(panel.getByRole("status")).toContainText("Soul Echo 2 of 10 collected");

  await page.goto(campaignUrl);
  const { context, player } = await playerJoins(page, browser);
  await expect(player.getByRole("region", { name: "Soul Echoes" }).getByRole("button", { name: "Soul Echo 2 of 10" })).toHaveAttribute("aria-pressed", "true");
  await player.goto(`/campaigns/${campaignId}/world`);
  await expect(player.getByTestId("echo-bearing")).toHaveText(/call from the southeast/);
  await expect(player.getByText("A bell tolls at midnight, though no source can be found.")).toBeVisible();
  await expect(player.getByText(/Seekers/)).toHaveCount(0);
  await context.close();
});

test("dcm-bxp.16: the Codex picker drops a new pin for a location", async ({ page }) => {
  await gmCreatesHorizonCampaign(page);
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  await page.goto(`/campaigns/${campaignId}/codex`);
  const entries = page.getByRole("complementary", { name: "Entries" });
  await entries.getByRole("tab", { name: /^Locations/ }).click();
  await page.getByRole("button", { name: "+ New location" }).click();
  const detail = page.getByRole("region", { name: "Entry detail" });
  await detail.getByRole("button", { name: "📍 Link to map pin" }).click();
  const picker = page.getByRole("dialog", { name: /on the map$/ });
  await picker.getByLabel("Pin type").selectOption("ruins");
  await picker.getByTestId("pin-picker-map").click({ position: { x: 120, y: 90 } });
  await expect(picker).toHaveCount(0);
  await expect(detail.getByRole("link", { name: "🗺 Show on map" })).toBeVisible();
  const view = await client.query(api.maps.get, { campaignId });
  expect(view.state.tokens).toHaveLength(1);
  expect(view.state.tokens[0]).toMatchObject({ type: "ruins", location: true, hidden: true });
});
