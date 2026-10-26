import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, VIEWPORTS, visual } from "./helpers";

// D11 N7 visual spec (E2E_VISUAL=1): the rip mid-animation, the 'Page torn out · Undo' toast, the Torn-out pages list
// and a torn-out page, at 1440x900 and 390x844, for the GM. Board counterpart: `node scripts/board-shots.mjs notes:tear`
// (test-results/visual/board/notes-tear-1440.png); the toast and the bin are not on the board (judged on its tokens).

const paper = (page: Page) => page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });

test("D11 N7 bin at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);

  // The board's tear sample: a session log with a few lines.
  const lines = [
    ["event", "Crossed the river at dawn with Mira"],
    ["task", "Ask the ferryman about the well"],
    ["note", "The ferryman owes Mira a favour"],
    ["fear", "Wither spreading through the Grove"],
  ] as const;
  let pageId: Id<"journalPages"> | null = null;
  for (const [kind, text] of lines) {
    pageId = (await client.mutation(api.notesEntries.add, { campaignId, page: pageId ?? { template: 0 }, kind, text })).pageId;
  }
  const rumours = (await client.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "note", text: "The mill burned" })).pageId;

  // The rip, frozen 600 ms in (the board's notes:tear frame), at each viewport.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
    await expect(paper(page).getByRole("listitem")).toHaveCount(lines.length);
    const button = paper(page).getByRole("button", { name: "Tear out page" });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await paper(page).getByRole("button", { name: "Click again to tear out" }).click();
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 600;
      }
    });
    await expect(page.getByTestId("tear-frame")).toBeAttached();
    await page.screenshot({ path: `test-results/visual/D11-N7/tear-${viewport.width}.png` });
    await expect.poll(async () => (await client.query(api.notesBin.bin, { campaignId })).length).toBe(1);
    await client.mutation(api.notesBin.restorePage, { campaignId, page: pageId! });
  }

  // The toast and the bin list (two torn-out pages), then a torn-out page read only.
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`/campaigns/${campaignId}/notes?page=${rumours}`);
  await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
  await client.mutation(api.notesBin.binPage, { campaignId, page: pageId! });
  await paper(page).getByRole("button", { name: "Tear out page" }).click();
  await paper(page).getByRole("button", { name: "Click again to tear out" }).click();
  const { shoot } = visual(page, "D11-N7");
  const toast = page.getByRole("status").filter({ hasText: "Page torn out" });
  await shoot(toast, "toast");
  const bin = page.getByRole("region", { name: "Torn-out pages" });
  await expect(bin.getByRole("listitem")).toHaveCount(2);
  await shoot(bin, "bin");
  await bin.getByRole("button", { name: /^Session 1/ }).click();
  await shoot(page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Torn-out page" }), "bin-page");
});
