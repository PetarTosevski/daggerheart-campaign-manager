import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { bardDraft, D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S5 visual spec (E2E_VISUAL=1): the Play stage (spotlight, session tally, session log) at 1440, 1024 and 390.
// Board counterpart: `node scripts/board-shots.mjs sessions:play` (test-results/visual/board/sessions-play-*.png).
// Story as on the board: a party of two, a few spotlight taps, three log lines; the tally of a planned session shows
// dashes, then (shot "play-live") the live session's counts.

test("D10 S5 play stage at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  for (const name of ["Liriel", "Thorn"]) {
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft(name), idempotencyKey: crypto.randomUUID() });
  }
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
  const sessionId = new URL(page.url()).searchParams.get("s")!;
  await page.getByRole("tab", { name: "Play" }).click();

  const spot = page.getByRole("region", { name: "Spotlight" });
  await spot.getByRole("button", { name: /^Liriel, / }).click();
  await spot.getByRole("button", { name: /^Liriel, / }).click();
  await spot.getByRole("button", { name: /^Thorn, / }).click();
  await expect(spot.getByRole("button", { name: /^Thorn, 1 spotlight moment, due$/ })).toBeVisible();
  const log = page.getByRole("region", { name: "Session log" });
  for (const line of ["The party reached the bridge at dawn.", "Liriel talked the toll-keeper down.", "Thorn spotted the ambush in the reeds."]) {
    await log.getByLabel("New log entry").fill(line);
    await log.getByLabel("New log entry").press("Enter");
    await expect(log.getByText(line)).toBeVisible();
  }
  await expect(log.getByRole("button", { name: /^Remove log entry/ })).toHaveCount(3);
  for (const button of await log.getByRole("button", { name: /^Remove log entry/ }).all()) await expect(button).toBeEnabled();

  const stage = page.getByRole("region", { name: "Play stage" });
  const { shoot } = visual(page, "D10-S5", D10_VIEWPORTS);
  await shoot(stage, "play");

  // Live: the tally counts the Fear gained on the dashboard (S3's start makes the newest planned session live).
  await client.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.fear.set, { campaignId, value: 2, idempotencyKey: crypto.randomUUID() });
  await page.goto(`${url}?s=${sessionId}&stage=play`);
  await expect(page.getByRole("region", { name: "Session tally" }).getByRole("definition")).toHaveText(["3", "1", "0", "0"]);
  await page.getByRole("region", { name: "Session tally" }).screenshot({ path: "test-results/visual/D10-S5/tally-live-1440.png", animations: "disabled" });
  await client.mutation(api.sessions.end, { campaignId, idempotencyKey: crypto.randomUUID() });
});
