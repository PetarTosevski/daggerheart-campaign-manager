import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H4.3 (docs/tasks/TASK-HUD-H4.3.md): with the HUD on, marking Moss's last Hit Point opens 'Choose a
// death move' over the dimmed map (Blaze of Glory / Avoid Death / Risk It All, core wording, the footer). The pick waits
// for the GM (HD4, answer 15b): 'Waiting for the GM to confirm' with Take it back; the banner and token are grey; the
// GM gets the confirm popup and both see the outcome. Send it back opens the choice again. The player's "Just now" feed
// hangs bottom-left, live from feed.list. axe on the modal, the popup and the feed.

const OUT = "test-results/visual/HUD-H4.3";

async function lastHitPoint(s: HudScene, characterId: Id<"characters">) {
  const party = await s.client.query(api.combatHud.party, { campaignId: s.campaignId, mapId: s.mapId });
  const me = party.find((m) => m.characterId === characterId)!;
  await s.client.mutation(api.characters.adjustResource, { characterId, resource: "hp", delta: me.hp.max - me.hp.marked });
}

test("last Hit Point: the player chooses, the GM confirms, both see the outcome; the feed is live", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await gm.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    // "Just now" on the player view only (the GM's column is the queue's).
    const feed = player.getByRole("region", { name: "Just now" });
    await expect(feed).toBeVisible();
    await expect(gm.getByRole("region", { name: "Just now" })).toHaveCount(0);
    const feedBox = await feed.boundingBox();
    expect(feedBox!.x).toBeLessThan(40);
    expect(feedBox!.y + feedBox!.height).toBeGreaterThan(900 - 40);

    await lastHitPoint(s, moss.characterId);
    const choose = player.getByRole("dialog", { name: "Choose a death move" });
    await expect(choose).toBeVisible({ timeout: 30_000 });
    await expect(choose).toContainText("Moss marked their last Hit Point");
    await expect(choose).toContainText("Your table can see this choice. The GM confirms the outcome.");
    for (const move of ["Blaze of Glory", "Avoid Death", "Risk It All"]) await expect(choose.getByRole("button", { name: move })).toBeVisible();
    await expect(choose.getByRole("button", { name: "Avoid Death" })).toHaveAccessibleDescription(/the party finishes a long rest/);
    // The banner and the portrait go grey (every Hit Point marked), on both views.
    await expect(player.getByTestId(`hud-banner-${moss.characterId}`)).toHaveClass(/hbn-down/);
    await expect(gm.getByTestId(`hud-banner-${moss.characterId}`)).toHaveClass(/hbn-down/);
    await expectNoSeriousA11yViolations(player, { include: "dialog.hud-dm" });
    await player.screenshot({ path: `${OUT}/last-hit-point-1440.png`, animations: "disabled" });

    await choose.getByRole("button", { name: "Avoid Death" }).click();
    const waiting = player.getByRole("dialog", { name: "Waiting for the GM to confirm" });
    await expect(waiting).toBeVisible();
    await expect(waiting.getByRole("status")).toHaveText(/Waiting for the GM to confirm Avoid Death\./);
    await expect(waiting.getByRole("button", { name: "Take it back" })).toBeVisible();
    await expect(feed).toContainText("Moss chooses Avoid Death. Waiting for the GM to confirm.");
    await expectNoSeriousA11yViolations(player, { include: "dialog.hud-dm" });
    await player.screenshot({ path: `${OUT}/waiting-1440.png`, animations: "disabled" });

    // The GM's popup; the dice roll only now.
    const confirm = gm.getByRole("dialog", { name: "Death move to confirm" });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await expect(confirm).toContainText("Moss chose Avoid Death");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-death-confirm]" });
    await gm.screenshot({ path: `${OUT}/gm-confirm-1440.png`, animations: "disabled" });
    await confirm.getByRole("button", { name: "Confirm the death move" }).click();

    // Both sides see the outcome.
    const gmOutcome = gm.getByTestId("hud-death-outcome");
    await expect(gmOutcome.getByRole("status")).toHaveText(/Hope Die \d+ against level 1: (a scar|no scar)\./);
    const outcome = player.getByTestId("hud-death-outcome");
    await expect(outcome.getByRole("status")).toContainText(/avoids death and drops unconscious\. Hope Die \d+ against level 1/, { timeout: 30_000 });
    await expect(waiting).toHaveCount(0);
    await expect(feed).toContainText("avoids death and drops unconscious");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-feed]" });
    await player.screenshot({ path: `${OUT}/outcome-1440.png`, animations: "disabled" });
    await outcome.getByRole("button", { name: "Got it" }).click();
    await expect(outcome).toHaveCount(0);
    await gmOutcome.getByRole("button", { name: "Done" }).click();
    await expect(gmOutcome).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("Send it back: the player chooses again; Take it back withdraws a pick before the GM answers", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await player.goto(s.url);
    await gm.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await lastHitPoint(s, moss.characterId);

    const choose = player.getByRole("dialog", { name: "Choose a death move" });
    await choose.getByRole("button", { name: "Risk It All" }).click();
    const waiting = player.getByRole("dialog", { name: "Waiting for the GM to confirm" });
    await expect(waiting).toBeVisible();

    // Take it back: the choice is open again and the GM's popup goes.
    const confirm = gm.getByRole("dialog", { name: "Death move to confirm" });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await waiting.getByRole("button", { name: "Take it back" }).click();
    await expect(choose).toBeVisible();
    await expect(confirm).toHaveCount(0, { timeout: 30_000 });

    // Pick again; the GM sends it back.
    await choose.getByRole("button", { name: "Risk It All" }).click();
    await expect(waiting).toBeVisible();
    await expect(confirm).toContainText("Moss chose Risk It All", { timeout: 30_000 });
    await confirm.getByRole("button", { name: "Send it back" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(choose).toBeVisible({ timeout: 30_000 });
    await expect(choose).toContainText("The GM sent back Risk It All. Choose again.");
    await expect(player.getByRole("region", { name: "Just now" })).toContainText("The GM sends back Moss's Risk It All: choose again.");
    await expect(player.getByTestId("hud-death-outcome")).toHaveCount(0);

    // Closing the modal leaves a way back.
    await choose.getByRole("button", { name: "Close choose a death move" }).click();
    await expect(choose).toHaveCount(0);
    await player.getByRole("button", { name: "Moss: choose a death move" }).click();
    await expect(choose).toBeVisible();
  } finally {
    await s.close();
  }
});
