import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, openSessions, startFromJournal } from "./visual/helpers";

// D10 S5 in the Journal (Journal JX2; the old Play stage is gone). Its spotlight taps were dropped (Q9: the Journal
// counts spotlight moves on the Combat Map, tests/e2e/journal-tally.spec.ts), the log is the Journal's session log
// (tests/e2e/journal-log.spec.ts) and the tally the Journal's six tiles (journal-tally). What is left here: a live
// session in a party without characters says so in the Spotlight card, and Log & recap fits a phone.

test("a live session with no active characters says so; Log & recap fits a phone", async ({ page }) => {
  await openSessions(page);
  await startFromJournal(page);
  const spot = page.getByRole("region", { name: "Spotlight" });
  await expect(spot.getByText("No active characters in the party yet.")).toBeVisible();
  await expect(spot.getByRole("button", { name: "Reset" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Session tally" }).getByRole("listitem")).toHaveCount(6);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Session log" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
