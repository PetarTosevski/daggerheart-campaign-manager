import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { bardDraft, D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S6 visual spec (E2E_VISUAL=1): the Wrap-up stage (Recap, 'Loot & gold', 'Countdowns & threads', the milestone row)
// at 1440, 1024 and 390, empty and filled with the milestone called. Board counterpart:
// `node scripts/board-shots.mjs sessions:wrap` (test-results/visual/board/sessions-wrap-*.png; the board's Session 3:
// recap, loot, threads, level-up ticked).

test("D10 S6 wrap-up at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  for (const name of ["Liriel", "Brannoc"]) {
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft(name), idempotencyKey: crypto.randomUUID() });
  }
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/\?s=/);
  const sessionId = new URL(page.url()).searchParams.get("s")!;
  await page.getByRole("tab", { name: "Wrap-up" }).click();
  const detail = page.getByRole("region", { name: "Session detail" });
  const stage = page.getByRole("region", { name: "Wrap-up stage" });
  await expect(stage.getByRole("textbox", { name: "Recap" })).toBeVisible();

  const { shoot } = visual(page, "D10-S6", D10_VIEWPORTS);
  await shoot(detail, "wrap-empty");

  await stage.getByRole("textbox", { name: "Recap" }).fill("The party reached the Grove.");
  await stage.getByRole("textbox", { name: "Loot & gold" }).fill("A silver locket, a handful of gold.");
  await stage.getByRole("textbox", { name: "Countdowns & threads" }).fill("The Doom countdown ticked to 3.");
  await stage.getByRole("textbox", { name: "Countdowns & threads" }).blur();
  await stage.getByRole("button", { name: "Milestone reached: the party levels up" }).click();
  // The status line comes with the server's answer, so the reload below cannot cut the mutation off.
  await expect(stage.getByRole("status").filter({ hasText: "can level up" })).toHaveText("2 characters can level up.");
  await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.threads).toBe("The Doom countdown ticked to 3.");
  // A reload drops the one-off notice, as the board shows the ticked row and the link only.
  await page.reload();
  await expect(stage.getByRole("textbox", { name: "Recap" })).toHaveValue("The party reached the Grove.");
  await expect(stage.getByRole("link", { name: "Open Party to level up →" })).toBeVisible();
  await shoot(detail, "wrap");
});
