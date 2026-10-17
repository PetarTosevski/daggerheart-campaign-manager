import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page, frameId: string) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Codex");
  await page.goto(`/frames/${frameId}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];
  return { name, campaignId };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

/** Creates a character on the Codex board and fills its fields (saved on blur). */
async function newCharacter(page: Page, fields: { name: string; pdesc?: string; gmn?: string; known?: boolean }) {
  await page.getByRole("button", { name: "+ New character" }).click();
  const detail = page.getByRole("region", { name: "Entry detail" });
  const nameInput = detail.getByLabel("Name", { exact: true });
  await expect(nameInput).toHaveValue("");
  await nameInput.fill(fields.name);
  await nameInput.press("Tab");
  const entries = page.getByRole("complementary", { name: "Entries" });
  await expect(entries.getByRole("button", { name: new RegExp(fields.name) })).toBeVisible();
  if (fields.pdesc) {
    await detail.getByLabel("What the players know").fill(fields.pdesc);
    await detail.getByLabel("What the players know").press("Tab");
  }
  if (fields.gmn) {
    await detail.getByLabel("GM notes").fill(fields.gmn);
    await detail.getByLabel("GM notes").press("Tab");
  }
  if (fields.known) {
    await detail.getByRole("button", { name: "🔒 Secret from players" }).click();
    await expect(detail.getByRole("button", { name: "👁 Known to players" })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(entries.getByRole("button", { name: new RegExp(fields.name) })).toContainText(fields.known ? "Known" : "Secret");
}

test("players see only the characters the party knows, never the GM's notes", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page, "witherwild");
  const known = unique("Known NPC");
  const secret = unique("Hidden NPC");
  const gmNote = "Secretly works for the Fanewraith";

  await page.goto(`/campaigns/${campaignId}/codex`);
  await expect(page.getByRole("heading", { level: 1, name: "Characters & Locations" })).toBeVisible();
  // The frame's characters are seeded once, all secret.
  await expect(page.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: /Kreil Dirn/ })).toBeVisible();

  await newCharacter(page, { name: known, pdesc: "A quiet man in a grey coat.", gmn: gmNote, known: true });
  await newCharacter(page, { name: secret, gmn: "Not met yet" });

  // The GM's Player view preview hides the secret entry and the notes.
  await page.getByRole("button", { name: "👁 Player view" }).click();
  await expect(page.getByRole("note")).toContainText("Player view");
  await expect(page.getByRole("button", { name: new RegExp(secret) })).toHaveCount(0);
  await page.getByRole("button", { name: "← Back to GM view" }).click();

  await page.goto(`/campaigns/${campaignId}`);
  const { player, close } = await playerJoins(page, browser, name);
  await player.goto(`/campaigns/${campaignId}/codex`);
  const entries = player.getByRole("complementary", { name: "Entries" });
  await expect(entries.getByRole("button", { name: new RegExp(known) })).toBeVisible();
  await expect(entries.getByRole("button", { name: new RegExp(secret) })).toHaveCount(0);
  await expect(entries.getByRole("button", { name: /Kreil Dirn/ })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "+ New character" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "👁 Player view" })).toHaveCount(0);

  const detail = player.getByRole("region", { name: "Entry detail" });
  await expect(detail.getByRole("heading", { level: 2, name: known })).toBeVisible();
  await expect(detail.getByText("A quiet man in a grey coat.")).toBeVisible();
  await expect(detail.getByText("⚑ Allegiance unknown")).toBeVisible();
  await expect(player.getByText(gmNote)).toHaveCount(0);
  await expect(player.getByLabel("GM notes")).toHaveCount(0);
  await close();
});
