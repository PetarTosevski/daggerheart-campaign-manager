import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, expectNoHorizontalScroll, VIEWPORTS } from "./helpers";

// D11 N5 visual spec (E2E_VISUAL=1): the open @ picker and a page with mentions (a character with a role, a location,
// and a mention of a deleted entry that stays plain text), at 1440x900 and 390x844, seen by the GM.
// Board counterpart: `node scripts/board-shots.mjs notes:page` (test-results/visual/board/notes-page-1440.png); the
// picker is not on the board and is judged against its tokens.

test("D11 N5 picker and mentions at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);

  const entry = async (kind: "character" | "location", patch: { name: string; role?: string }) => {
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind, idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.codex.update, { entryId, patch });
    return entryId;
  };
  const mira = await entry("character", { name: "Mira", role: "River guide" });
  const marlow = await entry("character", { name: "Marlow", role: "Ferryman" });
  await entry("character", { name: "Old Mag", role: "Toll keeper" });
  const ford = await entry("location", { name: "Mabry Ford" });
  const gone = await entry("character", { name: "The Hooded One" });

  const lines = [
    ["event", `Crossed the river at dawn with @[Mira](${mira})`],
    ["task", `Ask @[Marlow](${marlow}) about the well`],
    ["note", `@[Marlow](${marlow}) owes @[Mira](${mira}) a favour`],
    ["fear", `Bandits at @[Mabry Ford](${ford})`],
    ["idea", `Was @[The Hooded One](${gone}) at the ford?`],
  ] as const;
  let pageId: Id<"journalPages"> | null = null;
  for (const [kind, text] of lines) {
    const added: { pageId: Id<"journalPages"> } = await gm.mutation(api.notesEntries.add, { campaignId, page: pageId ?? { template: 0 }, kind, text });
    pageId = added.pageId;
  }
  // A deleted entry: its token stays and shows the stored name as plain text.
  await gm.mutation(api.codex.remove, { entryId: gone });

  await page.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
  const sheet = page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
  await expect(sheet.getByRole("link", { name: "Mira" })).toHaveCount(2);
  await expect(sheet.getByRole("link")).toHaveCount(5);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.mouse.move(0, 0);
    await expect(sheet.getByRole("link", { name: "Mabry Ford" })).toBeVisible();
    await sheet.screenshot({ path: `test-results/visual/D11-N5/page-${viewport.width}.png`, animations: "disabled" });

    const input = sheet.getByRole("textbox", { name: "New entry" });
    await input.fill("");
    await input.click();
    await input.pressSequentially("Pay @ma");
    const listbox = sheet.getByRole("listbox", { name: "Characters & Locations" });
    await expect(listbox.getByRole("option")).toHaveCount(3);
    await input.press("ArrowDown");
    await listbox.scrollIntoViewIfNeeded();
    if (viewport.width < 640) await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/visual/D11-N5/picker-${viewport.width}.png`, animations: "disabled" });
    await input.press("Escape");
    await input.fill("");
  }
});
