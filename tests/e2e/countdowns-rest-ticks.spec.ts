import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// Countdowns tick on rests (plan rest-ticks RT2, bead dcm-674k). The GM sets "On short rest: A die d6, Automatic" on a
// Public countdown and "On long rest: PCs who rested, Reminder" on a Partly hidden one from their cards. A short rest
// ticks the first by the server's d6 and a player sees the public feed row; a long rest moves nothing on the second
// and asks "Tick ...? 2 (2 PCs)", one click ticks it by 2 (GM-only row); undoing the rest brings it back.

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Rest ticks ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

async function newCountdown(page: Page, name: string, visibility: "Public" | "Public, details hidden") {
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill(name);
  await dialog.getByRole("radio", { name: visibility, exact: true }).check();
  await dialog.getByRole("radio", { name: "10", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /Advance automatically on action rolls/ }).uncheck();
  // Both rests start Off for a standard countdown.
  await expect(dialog.getByRole("group", { name: "On long rest" }).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("group", { name: "On short rest" }).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Start at 10" }).click();
  await expect(dialog).toBeHidden();
}

test("the GM sets rest ticks on cards; a short rest rolls and ticks, a long rest reminds and ticks on one click, undo takes it back", async ({
  page,
  browser,
}) => {
  const campaignId = await newCampaign(page);
  const campaignUrl = page.url();
  const gm = await convexAs(page);
  // Two PCs rest ("PCs who rested" = 2).
  for (const hero of ["Liriel", "Kael"]) {
    await gm.mutation(api.characters.create, { campaignId, draft: bardDraft(`${hero} ${crypto.randomUUID().slice(0, 4)}`), idempotencyKey: crypto.randomUUID() });
  }
  const grid = page.getByRole("region", { name: "Countdowns" });
  const rest = page.getByRole("region", { name: "Rest", exact: true });
  const valueOf = async (name: string) => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === name)?.currentValue;

  await newCountdown(page, "Storm", "Public");
  await newCountdown(page, "Plague", "Public, details hidden");

  // Storm: On short rest, a d6, Automatic.
  const storm = grid.getByRole("article", { name: "Storm" });
  await storm.getByRole("button", { name: "Rest ticks of Storm" }).click();
  const stormShort = storm.getByRole("group", { name: "On short rest" });
  await stormShort.getByRole("button", { name: "On", exact: true }).click();
  await stormShort.getByLabel("Ticks").selectOption("die");
  await stormShort.getByLabel("Die").selectOption("6");
  await expect(stormShort.getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  await expect(storm.getByTestId("rest-tick-summary")).toHaveText("Long rest: Off · Short rest: d6, Automatic");
  await expect
    .poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Storm")?.onShortRest)
    .toEqual({ amount: { kind: "die", sides: 6 }, mode: "auto" });

  // Plague: On long rest, the PCs who rested, Reminder.
  const plague = grid.getByRole("article", { name: "Plague" });
  await plague.getByRole("button", { name: "Rest ticks of Plague" }).click();
  const plagueLong = plague.getByRole("group", { name: "On long rest" });
  await plagueLong.getByRole("button", { name: "On", exact: true }).click();
  await plagueLong.getByLabel("Ticks").selectOption("pcs");
  await plagueLong.getByRole("button", { name: "Reminder" }).click();
  await expect(plague.getByTestId("rest-tick-summary")).toHaveText("Long rest: PCs who rested, Reminder · Short rest: Off");
  await expect
    .poll(async () => (await gm.query(api.countdowns.listByCampaign, { campaignId })).find((c) => c.name === "Plague")?.onLongRest)
    .toEqual({ amount: { kind: "pcs" }, mode: "remind" });

  // Axe on the open rest tick controls (the grains row has its own, older target-size findings).
  await expectNoSeriousA11yViolations(page, { include: "[data-testid=\"rest-tick-settings\"]" });

  // A player joins and watches the feed.
  const { joinCode } = await gm.query(api.members.access, { campaignId });
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${joinCode}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player).toHaveURL(campaignUrl);
  const playerFeed = player.getByRole("list", { name: "Rolls" });

  // A short rest: Storm ticks by the server's d6; Plague (long rests only) stays.
  await rest.getByRole("button", { name: "Start short rest" }).click();
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect.poll(() => valueOf("Storm")).toBeLessThan(10);
  const stormAfter = (await valueOf("Storm"))!;
  expect(stormAfter).toBeGreaterThanOrEqual(4);
  await expect(storm.getByTestId("countdown-value")).toHaveText(`${stormAfter}/10`);
  const rolled = 10 - stormAfter;
  await expect(playerFeed).toContainText(`Short rest: Storm ticks ${rolled} (1d6 ${rolled})`);
  expect(await valueOf("Plague")).toBe(10);

  // A long rest: Plague only reminds, with the amount already counted (2 PCs).
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await rest.getByRole("button", { name: "Finish rest" }).click();
  const panel = rest.getByTestId("rest-long-term");
  await expect(panel.getByTestId("rest-reminder")).toHaveText(/Tick Plague\? 2 \(2 PCs\)/);
  await expect(plague.getByTestId("countdown-value")).toHaveText("10/10");
  await panel.getByRole("button", { name: "Tick Plague" }).click();
  await expect(plague.getByTestId("countdown-value")).toHaveText("8/10");
  await expect(panel).toContainText("Plague ticks 2 (2 PCs)");
  await expect(panel.getByRole("button", { name: "Tick Plague" })).toHaveCount(0);
  await expect.poll(() => valueOf("Plague")).toBe(8);
  // Partly hidden: the tick's row is the GM's only.
  await expect(playerFeed).not.toContainText("Plague");

  // Undo the long rest: Plague is back at 10; the short rest's Storm tick stays.
  await rest.getByRole("button", { name: "Undo rest" }).click();
  await expect(plague.getByTestId("countdown-value")).toHaveText("10/10");
  await expect.poll(() => valueOf("Plague")).toBe(10);
  expect(await valueOf("Storm")).toBe(stormAfter);
  await context.close();
});
