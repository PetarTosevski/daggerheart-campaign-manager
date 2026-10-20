import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bardDraft, expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// D10 S5: the Play stage (B4, K7, Q3, Q12). The GM taps characters into the spotlight (the least-spotlit are ringed
// as due), keeps a session log, and reads the tally that counts the Fear gained during the live session.

async function addCharacters(client: ConvexHttpClient, campaignId: Id<"campaigns">, names: string[]) {
  for (const name of names) await client.mutation(api.characters.create, { campaignId, draft: bardDraft(name), idempotencyKey: crypto.randomUUID() });
}

/** Creates a session with '+ New session' and opens its Play stage; returns the session id. */
async function newSessionOnPlay(page: Page) {
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/\?s=[^&]+&stage=prep$/);
  await page.getByRole("tab", { name: "Play" }).click();
  await expect(page.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");
  return new URL(page.url()).searchParams.get("s")!;
}

test("the GM shares the spotlight, keeps a log and sees the Fear gained in the tally", async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  await addCharacters(client, campaignId, ["Ash", "Bryn"]);
  const sessionId = await newSessionOnPlay(page);

  // Spotlight: nobody tapped, both are due; tapping Ash leaves Bryn the only one due.
  const spot = page.getByRole("region", { name: "Spotlight" });
  const ash = spot.getByRole("button", { name: /^Ash, / });
  const bryn = spot.getByRole("button", { name: /^Bryn, / });
  await expect(ash).toHaveAttribute("data-due", "true");
  await expect(bryn).toHaveAttribute("data-due", "true");
  await ash.click();
  await expect(ash).toHaveAccessibleName("Ash, 1 spotlight moment");
  await expect(ash).toHaveAttribute("data-due", "false");
  await expect(bryn).toHaveAccessibleName("Bryn, 0 spotlight moments, due");
  await bryn.click();
  await bryn.click();
  await expect(bryn).toHaveAccessibleName("Bryn, 2 spotlight moments");
  await expect(ash).toHaveAttribute("data-due", "true");
  // The taps are optimistic: wait for the server before reloading (a reload drops mutations still in flight).
  const counts = async () => (await client.query(api.sessionPlay.spotlight, { campaignId, sessionId })).map((e) => e.count);
  await expect.poll(counts).toEqual([1, 2]);
  await page.reload();
  await expect(bryn).toContainText("2");
  await spot.getByRole("button", { name: "Reset spotlight" }).click();
  await expect(ash).toHaveAccessibleName("Ash, 0 spotlight moments, due");
  await expect(bryn).toHaveAccessibleName("Bryn, 0 spotlight moments, due");

  // Log: Enter adds, Add adds, newest first, remove one.
  const log = page.getByRole("region", { name: "Session log" });
  const entries = log.getByRole("list", { name: "Log entries, newest first" }).getByRole("listitem");
  await expect(log.getByText("Quick notes as you play")).toBeVisible();
  await log.getByLabel("New log entry").fill("Ash bargained with the ferryman.");
  await log.getByLabel("New log entry").press("Enter");
  await expect(log.getByLabel("New log entry")).toHaveValue("");
  await log.getByLabel("New log entry").fill("Bryn found the key.");
  await log.getByRole("button", { name: "Add", exact: true }).click();
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Bryn found the key.");
  await expect(entries.nth(0)).toContainText(/\d\d:\d\d/);
  await expect(entries.nth(1)).toContainText("Ash bargained with the ferryman.");
  await log.getByRole("button", { name: "Remove log entry: Ash bargained with the ferryman." }).click();
  await expect(entries).toHaveCount(1);
  await expect.poll(async () => (await client.query(api.sessionPlay.log, { campaignId, sessionId })).map((l) => l.text)).toEqual(["Bryn found the key."]);
  await page.reload();
  await expect(entries).toHaveCount(1);
  await expect(entries.nth(0)).toContainText("Bryn found the key.");

  // Tally: a planned session shows dashes; nothing to step by hand (Q3).
  const tally = page.getByRole("region", { name: "Session tally" });
  await expect(tally.getByRole("definition")).toHaveText(["—", "—", "—", "—"]);
  await expect(tally.getByRole("button")).toHaveCount(0);

  // Start the session (S3: without a session id, the newest planned session goes live), gain 2 Fear on the dashboard.
  await client.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Fear 2 of 12" }).click();
  await expect(page.getByTestId("fear-value")).toHaveText("II");
  await page.goto(`${url}?s=${sessionId}&stage=play`);
  await expect(tally.getByRole("term")).toHaveText(["Fear gained", "Fear spent", "Short rests", "Long rests"]);
  await expect(tally.getByRole("definition")).toHaveText(["2", "0", "0", "0"]);
  await client.mutation(api.sessions.end, { campaignId, idempotencyKey: crypto.randomUUID() });
});

test("Play fits a phone: one column, 44 px targets, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { client, campaignId } = await openSessions(page);
  await addCharacters(client, campaignId, ["Ash"]);
  await newSessionOnPlay(page);
  const pill = page.getByRole("region", { name: "Spotlight" }).getByRole("button", { name: /^Ash, / });
  await expect(pill).toBeVisible();
  const log = page.getByRole("region", { name: "Session log" });
  await log.getByLabel("New log entry").fill("A note");
  await log.getByLabel("New log entry").press("Enter");
  const remove = log.getByRole("button", { name: "Remove log entry: A note" });
  await expect(remove).toBeEnabled();
  for (const target of [pill, log.getByLabel("New log entry"), log.getByRole("button", { name: "Add", exact: true }), remove]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
});

test("a session with no active characters says so", async ({ page }) => {
  await openSessions(page);
  await newSessionOnPlay(page);
  await expect(page.getByRole("region", { name: "Spotlight" }).getByText("No characters in the party yet.")).toBeVisible();
});
