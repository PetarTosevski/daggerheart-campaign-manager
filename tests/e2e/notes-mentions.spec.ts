import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N5: the @ picker and mention links (.omc/plans/d11-notes.yaml). The GM mentions an NPC the party has not met and
// a rename shows on the link at once. The player's picker does not offer that NPC until the GM marks it known; the
// player mentions it; while the GM hides it again the player reads the stored name as plain text, and once it is known
// again a link with its CURRENT name that opens the Codex on that NPC (?entry=).
// Deviation: the plan's case is one GM page shared with everyone, but no UI shows another person's page before N6
// (SharedPageView) and N8 (JournalView); each writer uses their own page here. Every optimistic change is confirmed on
// the server (expect.poll) before the page is left.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Mentions ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
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
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

const paper = (page: Page) => page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
const rowOf = (page: Page, text: string | RegExp): Locator => paper(page).getByRole("listitem").filter({ hasText: text });

test("the GM mentions an unmet NPC and renames it; the player gets it only once known, plain text while hidden, a link that opens the Codex", async ({
  page,
  browser,
}) => {
  test.slow();
  const { name, campaignId } = await gmCreatesCampaign(page);
  const gm = await convexAs(page);
  const { entryId: npc } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.codex.update, { entryId: npc, patch: { name: "Marlow", role: "Ferryman" } });

  // The GM writes with the picker, by keyboard only; the NPC is still secret.
  await page.goto(`/campaigns/${campaignId}/notes?page=template-0`);
  const input = paper(page).getByRole("textbox", { name: "New entry" });
  const combobox = paper(page).getByRole("combobox", { name: "New entry" });
  await input.click();
  await input.pressSequentially("* ask @mar");
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  const listbox = paper(page).getByRole("listbox", { name: "Characters & Locations" });
  await expect(listbox.getByRole("option", { name: /Marlow/ })).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", (await listbox.getByRole("option", { name: /Marlow/ }).getAttribute("id"))!);
  await input.press("Enter");
  await expect(listbox).toHaveCount(0);
  await expect(input).toHaveText(/^\* ask Marlow\s*$/);
  await input.pressSequentially("about the toll");
  await input.press("Enter");
  await expect(input).toHaveText("");

  const gmLink = rowOf(page, "about the toll").getByRole("link");
  await expect(gmLink).toHaveText("Marlow");
  await expect(gmLink).toHaveAttribute("title", "Ferryman");
  await expect(gmLink).toHaveAttribute("href", `/campaigns/${campaignId}/codex?entry=${npc}`);
  await expect
    .poll(async () => (await gm.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => [e.text, e.kind]))
    .toEqual([[`ask @[Marlow](${npc}) about the toll`, "task"]]);

  // A rename: the link shows the current name; the stored token keeps the old one.
  await gm.mutation(api.codex.update, { entryId: npc, patch: { name: "Marlow the Grey" } });
  await expect(gmLink).toHaveText("Marlow the Grey");

  const { player, close } = await playerJoins(page, browser, name);
  try {
    const client = await convexAs(player);
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await player.goto(`/campaigns/${campaignId}/notes?page=template-0`);
    const playerInput = paper(player).getByRole("textbox", { name: "New entry" });

    // The party has not met the NPC: the player's picker does not offer it.
    await playerInput.click();
    await playerInput.pressSequentially("met @mar");
    await expect(paper(player).getByRole("option")).toHaveText(["Nothing in Characters & Locations yet."]);

    // Known now: the open list updates live; the player picks it with the keyboard.
    await gm.mutation(api.codex.update, { entryId: npc, patch: { known: true } });
    await expect(paper(player).getByRole("option", { name: /Marlow the Grey/ })).toBeVisible();
    await playerInput.press("Enter");
    await playerInput.pressSequentially("at the ford");
    await playerInput.press("Enter");
    await expect(playerInput).toHaveText("");
    const playerRow = rowOf(player, "at the ford");
    await expect(playerRow.getByRole("link")).toHaveText("Marlow the Grey");
    await expect
      .poll(async () => (await client.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => e.text))
      .toEqual([`met @[Marlow the Grey](${npc}) at the ford`]);

    // Hidden again and renamed: the player reads the stored name as plain text, no link, no role.
    await gm.mutation(api.codex.update, { entryId: npc, patch: { known: false, name: "Marlow the Black" } });
    await expect(playerRow.getByRole("link")).toHaveCount(0);
    await expect(playerRow.locator(".bj-text")).toHaveText("met Marlow the Grey at the ford");
    await expect(playerRow.getByTitle("Ferryman")).toHaveCount(0);

    // Known again: a link with the current name.
    await gm.mutation(api.codex.update, { entryId: npc, patch: { known: true } });
    await expect(playerRow.getByRole("link")).toHaveText("Marlow the Black");
    await expect(playerRow.getByRole("link")).toHaveAttribute("title", "Ferryman");

    // The link opens the Codex on that NPC.
    await playerRow.getByRole("link").click();
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}/codex\\?entry=${npc}$`));
    const entries = player.getByRole("complementary", { name: "Entries" });
    await expect(entries.getByRole("tab", { name: /Characters/ })).toHaveAttribute("aria-selected", "true");
    await expect(entries.getByRole("button", { name: /Marlow the Black/ })).toHaveAttribute("aria-current", "true");
    await expect(player.getByRole("region", { name: "Entry detail" }).getByRole("heading", { level: 2, name: "Marlow the Black" })).toBeVisible();
  } finally {
    await close();
  }
});

test("at 390 px: the picker is usable by touch, 44 px options, no horizontal scroll; a location link opens the Locations tab", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const gm = await convexAs(page);
  const { entryId: ford } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.codex.update, { entryId: ford, patch: { name: "Mabry Ford" } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/notes?page=template-0`);

  const input = paper(page).getByRole("textbox", { name: "New entry" });
  await input.click();
  await input.pressSequentially("camped at @mabry");
  const option = paper(page).getByRole("option", { name: /Mabry Ford/ });
  await expect(option).toBeVisible();
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
  await option.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveText(/^camped at Mabry Ford\s*$/);
  await input.press("Enter");
  const link = rowOf(page, "camped at").getByRole("link", { name: "Mabry Ford" });
  await expect(link).toHaveAttribute("title", "Location");
  await expect
    .poll(async () => (await gm.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => e.text))
    .toEqual([`camped at @[Mabry Ford](${ford})`]);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/codex\\?entry=${ford}$`));
  const entries = page.getByRole("complementary", { name: "Entries" });
  await expect(entries.getByRole("tab", { name: /Locations/ })).toHaveAttribute("aria-selected", "true");
  await expect(entries.getByRole("button", { name: /Mabry Ford/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Entry detail" }).getByLabel("Name")).toHaveValue("Mabry Ford");
  await expectNoHorizontalScroll(page);
});
