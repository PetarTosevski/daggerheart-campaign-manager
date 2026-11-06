import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { artHeader, avatar, gotoSettings, preferences, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";

// Plan rule-switches RU: Campaign settings > House rules lists every rule of the frame by area. The GM sets Interrupted
// rest (T4) to Manual; an interrupted rest then leaves a 'Manual' note in the GM's Roll Feed; the player reads the same
// list read-only from the Preferences popover; once a session is live every control is disabled with the lock hint.
// Axe on each surface; shots at 1440, 1024 and 390 go to test-results/rule-switches-ru/.

test.describe.configure({ timeout: 360_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/rule-switches-ru/${name}.png`, animations: "disabled" });
const uuid = () => crypto.randomUUID();
const WIDTHS = [1440, 1024, 390] as const;

test("House rules: the GM picks a mode, the note shows in the feed, the player reads it, a live session locks it", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, client } = table;
  const dashboard = `/campaigns/${campaignId}`;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(gm, dashboard, "rules");
    const rules = settingsPanel(gm).getByTestId("settings-rules");
    const rows = rules.getByTestId("rule-rows");
    await expect(rows).toBeVisible();
    await expect(rows.locator("details")).toHaveCount(14);
    await expect(rows.getByRole("list", { name: "Optional rules" })).toBeVisible();

    // Rests & downtime: T4 has the picker, T1 is a Book row with its page.
    await rows.getByText("Rests & downtime", { exact: true }).click();
    const t4 = rows.locator('[data-rule="interruptedRest"]');
    const picker = t4.getByRole("radiogroup", { name: "Interrupted rest" });
    await expect(picker.getByRole("radio", { name: "Book" })).toBeChecked();
    await expect(rows.locator('[data-rule="twoDowntimeMoves"]')).toContainText("Book · Core Rulebook p.105");
    // A rule the engine doesn't follow yet: read-only, 'Coming soon'.
    await rows.getByText("Rolls & dice", { exact: true }).click();
    await expect(rows.locator('[data-rule="hopeFearFromRolls"]')).toContainText("Coming soon");
    await expect(rows.locator('[data-rule="hopeFearFromRolls"]').getByRole("radio")).toHaveCount(0);

    await picker.getByRole("radio", { name: "Manual" }).check();
    await expect(picker.getByRole("radio", { name: "Manual" })).toBeChecked();
    await expect.poll(async () => (await client.query(api.ruleSettings.get, { campaignId })).modes.interruptedRest).toBe("manual");
    await t4.scrollIntoViewIfNeeded();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-house-rules-1440");

    // An interrupted rest in Manual: nothing applied, a 'Manual' note in the GM's feed.
    const { restId } = await client.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: uuid() });
    await client.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: uuid() });
    await gm.goto(dashboard);
    const note = gm.getByRole("list", { name: "Rolls" }).getByRole("listitem", { name: "Rest interrupted: decide what anyone keeps" });
    await expect(note).toContainText("Manual");
    await expect(note).toContainText("Interrupted rest");
    await note.scrollIntoViewIfNeeded();
    await shot(gm, "gm-feed-manual-note-1440");
    // The player never gets the GM's note.
    await player.goto(dashboard);
    await expect(player.getByRole("list", { name: "Rolls" }).or(player.getByText("No rolls yet.", { exact: false })).first()).toBeVisible();
    await expect(player.getByText("Rest interrupted: decide what anyone keeps")).toHaveCount(0);

    // The player: Preferences > House rules, read-only.
    for (const width of WIDTHS) {
      await player.setViewportSize({ width, height: 900 });
      await player.goto(dashboard);
      await avatar(artHeader(player)).click();
      const pop = preferences(player);
      await expect(pop).toBeVisible();
      await pop.getByRole("button", { name: "House rules" }).click();
      const list = pop.getByTestId("rule-rows");
      await expect(list).toBeVisible();
      await expect(list.getByRole("radio")).toHaveCount(0);
      await expect(list.getByRole("switch")).toHaveCount(0);
      await list.getByText("Rests & downtime", { exact: true }).click();
      await expect(list.locator('[data-rule="interruptedRest"]')).toContainText("Manual");
      await list.locator('[data-rule="interruptedRest"]').scrollIntoViewIfNeeded();
      if (width === 1440) await expectNoSeriousA11yViolations(player, { include: ".cfg-pop" });
      await shot(player, `player-house-rules-${width}`);
      await player.keyboard.press("Escape");
    }

    // A live session locks every switch, the campaign options too.
    const { sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
    await client.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: uuid() });
    for (const width of WIDTHS) {
      await gm.setViewportSize({ width, height: 900 });
      await gotoSettings(gm, dashboard, "rules");
      const locked = settingsPanel(gm).getByTestId("settings-rules");
      await expect(locked.getByTestId("rules-locked")).toHaveText("Rule switches change between sessions. End the session to change them.");
      await locked.getByText("Rests & downtime", { exact: true }).click();
      for (const radio of await locked.locator('[data-rule="interruptedRest"]').getByRole("radio").all()) await expect(radio).toBeDisabled();
      for (const sw of await locked.getByRole("list", { name: "Campaign options" }).getByRole("switch").all()) await expect(sw).toBeDisabled();
      if (width === 1440) await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
      await shot(gm, `gm-house-rules-locked-${width}`);
      if (width !== 1440) {
        await locked.locator('[data-rule="interruptedRest"]').scrollIntoViewIfNeeded();
        await shot(gm, `gm-house-rules-locked-rests-${width}`);
      }
    }
  } finally {
    await table.close();
  }
});
