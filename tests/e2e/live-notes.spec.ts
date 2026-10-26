import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { gmAndPlayer } from "./live";

// D12 H19 (.omc/plans/d12-hardening.yaml; analysis section 4): notes sharing and added entries reach the other
// screen without a reload, at 1440 and 390 (at 390 the index sits behind the 'Pages' disclosure, TASK-D11-N9). The
// player hides their page, then shares it with everyone: it appears in the GM's open 'Shared by players' tab. Each
// side adds an entry and the other's open page shows it. The GM shares their own page: it appears in the player's
// open 'Shared by GM' tab, and the GM's next entry shows on the player's copy. Rule checks live in notes-sharing /
// notes-flow specs.

// Live updates on a heavily loaded machine can take longer than the default 5 s; nothing here waits on a timer.
const expect = baseExpect.configure({ timeout: 15_000 });

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paper = (page: Page) => page.getByRole("region", { name: "Journal page" });
const ownPaper = (page: Page) => paper(page).getByRole("article", { name: "Page" });

/** Opens the index column: at 390 px it sits behind the 'Pages' disclosure (N9), wider it is always shown. */
async function openIndex(page: Page) {
  const toggle = index(page).getByRole("button", { name: /^Pages/ });
  await expect(index(page)).toBeVisible();
  if (await toggle.isVisible()) {
    // Retried: a click that lands before hydration does nothing.
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
  }
  return index(page);
}

async function openTab(page: Page, name: "Shared by players" | "Shared by GM") {
  const shared = (await openIndex(page)).getByRole("region", { name: "Shared" });
  const tab = shared.getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return shared.getByRole("tabpanel");
}

function sharedRow(panel: Locator, title: string, owner: string): Locator {
  return panel.getByRole("group", { name: owner }).getByRole("button").filter({ hasText: title });
}

async function write(page: Page, line: string) {
  const input = paper(page).getByRole("textbox", { name: "New entry" });
  await input.fill(line);
  await input.press("Enter");
  await expect(input).toHaveText("");
}

/** The entry texts on the caller's own first page ('Session 1'), read on the server. */
async function ownEntries(client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  return (await client.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => e.text);
}

async function share(page: Page, option: RegExp) {
  await ownPaper(page).getByRole("button", { name: /^Sharing: / }).click();
  const dialog = page.getByRole("dialog", { name: "Share this page" });
  await dialog.getByRole("radio", { name: option }).check();
  await expect(dialog.getByRole("radio", { name: option })).toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

/** Runs the gmAndPlayer setup again when the loaded local backend times out a Convex function (rolled back). */
async function retryOnTimeout<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 4 || !String(error).includes("timed out")) throw error;
    }
  }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`notes sharing and entries reach the other screen live at ${viewport.width}`, async ({ browser }) => {
    test.setTimeout(200_000);
    const { gm, player, campaignId, characterName, client, playerClient, close } = await retryOnTimeout(() => gmAndPlayer(browser));
    try {
      const url = `/campaigns/${campaignId}/notes`;
      for (const page of [gm, player]) await page.setViewportSize(viewport);
      await Promise.all([gm.goto(url), player.goto(url)]);

      // ---- The player starts their journal and hides the page from everyone.
      await write(player, "found a brass key");
      await expect(paper(player).getByText("found a brass key")).toBeVisible();
      await share(player, /Private · hidden from everyone/);
      await expect(ownPaper(player).getByRole("button", { name: "Sharing: Private · hidden from everyone" })).toBeVisible();
      // (The journal's other default pages stay readable by the GM.)
      await expect
        .poll(async () => (await client.query(api.notesSharing.shared, { campaignId, tab: "players" })).filter((r) => r.title === "Session 1").length)
        .toBe(0);

      // ---- The GM opens 'Shared by players': the player's other default pages, not this one.
      const gmPanel = await openTab(gm, "Shared by players");
      await expect(gmPanel.getByRole("group", { name: characterName })).toBeVisible();
      const row = sharedRow(gmPanel, "Session 1", characterName);
      await expect(row).toHaveCount(0);

      // ---- The player shares it with everyone: the row appears in the GM's open tab.
      await share(player, /^Everyone/);
      await expect(row).toBeVisible();
      await row.click();
      await expect(gm).toHaveURL(/view=shared-players/);
      await expect(paper(gm).getByText(`${characterName}’s page · read only`)).toBeVisible();
      await expect(paper(gm).getByText("found a brass key")).toBeVisible();

      // ---- Entries both ways on the shared page.
      // Each write is confirmed on the server first (it shows optimistically on the writer's screen).
      await write(player, "met the ferryman");
      await expect.poll(() => ownEntries(playerClient, campaignId)).toContain("met the ferryman");
      await expect(paper(gm).getByText("met the ferryman")).toBeVisible();
      await write(gm, "the key is cursed");
      await expect.poll(() => ownEntries(playerClient, campaignId)).toContain("the key is cursed");
      await expect(paper(gm).getByText("the key is cursed - GM")).toBeVisible();
      await expect(paper(player).getByText("the key is cursed - GM")).toBeVisible();

      // ---- The player hides it again: the GM's open copy closes.
      await share(player, /Private · hidden from everyone/);
      await expect(paper(gm).getByText("This page isn't shared with you.")).toBeVisible();

      // ---- The GM shares their own page: it appears in the player's open 'Shared by GM' tab.
      const playerPanel = await openTab(player, "Shared by GM");
      await expect(playerPanel).toHaveText("Nothing shared yet.");
      const gmPages = (await openIndex(gm)).getByRole("navigation", { name: "Your pages" });
      await gmPages.getByRole("button", { name: /^Session 1/ }).click();
      await expect(ownPaper(gm).getByLabel("Page title")).toHaveValue("Session 1");
      await write(gm, "the bridge is out");
      await expect.poll(() => ownEntries(client, campaignId)).toContain("the bridge is out");
      await share(gm, /^Everyone/);
      const gmRow = playerPanel.getByRole("button").filter({ hasText: "Session 1" });
      await expect(gmRow).toBeVisible();
      await gmRow.click();
      await expect(player).toHaveURL(/view=shared-gm/);
      await expect(paper(player).getByText("Game Master’s page · read only")).toBeVisible();
      await expect(paper(player).getByText("the bridge is out")).toBeVisible();

      // ---- The GM's next entry shows on the player's copy.
      await write(gm, "storm on the horizon");
      await expect.poll(() => ownEntries(client, campaignId)).toContain("storm on the horizon");
      await expect(paper(player).getByText("storm on the horizon")).toBeVisible();
    } finally {
      await close();
    }
  });
}
