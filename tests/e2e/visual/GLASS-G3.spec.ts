import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Shots for docs/tasks/TASK-GLASS-G3.md (E2E_VISUAL=1): the dashboard's Countdowns section (a standard countdown, a
// long-term track and a chase) as glass buttons in the viewer's colours, as the GM and as a player (read-only: no
// buttons) at 1440 x 900, 1024 x 768 and 390 x 844; the cancel confirm, the New countdown / New chase / Who can see
// this dialogs and the step editor; a hovered confirm and a keyboard-focused button, each with axe; 44 px at 1024 and
// 390. The chase's "Caught! / Got away!" call needs a roll that takes both sides to 0 (countdowns-chase.spec.ts).

const OUT = "test-results/visual/GLASS-G3";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;
const REGION = 'section[aria-labelledby="cd-h"]';
/** The sand grains are progress pips, not glass buttons (left alone, like HP pips); their size is the dashboard's, not G3's. */
const GRAINS_AXE = {
  include: REGION,
  exclude: '[role="group"][aria-label="Click a grain to correct the countdown"]',
  reason: "the sand grains are pips (out of scope for the glass buttons); axe target-size flags their spacing",
};

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function shoot(target: Locator, name: string) {
  await settle(target.page());
  await target.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

async function expectAtLeast44(buttons: Locator) {
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    expect(box!.height, name).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  }
}

test("GLASS-G3 the Countdowns section and its dialogs as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, client } = table;
  try {
    const seed = (name: string, extra: Record<string, unknown>) =>
      client.mutation(api.countdowns.create, {
        campaignId,
        name,
        description: "",
        category: "threat",
        consequence: `${name}: it happens.`,
        visibility: { mode: "public", hidden: [] },
        ...extra,
        idempotencyKey: crypto.randomUUID(),
      } as never) as Promise<{ countdownId: Id<"countdowns"> }>;
    const { countdownId: ritual } = await seed("The ritual", { startingValue: 6, armed: true });
    await client.mutation(api.countdowns.operate, { countdownId: ritual, action: "advance", idempotencyKey: crypto.randomUUID() });
    await seed("Invasion", {
      mode: "longTerm",
      armed: true,
      startingValue: 6,
      steps: [
        { value: 5, text: "Troops gather at the border", news: true },
        { value: 0, text: "The city falls" },
      ],
    });
    await client.mutation(api.countdowns.createChase, {
      campaignId,
      name: "The thief",
      description: "",
      visibility: { mode: "private" },
      armed: true,
      startingValue: 6,
      lead: "decent",
      party: "pursuing",
      idempotencyKey: crypto.randomUUID(),
    });

    // ── The section, both viewers, every width ──
    for (const [who, page] of [
      ["gm", gm],
      ["player", player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${campaignId}`);
        const region = page.getByRole("region", { name: "Countdowns" });
        await expect(region.getByRole("article", { name: "The ritual" })).toBeVisible();
        await region.scrollIntoViewIfNeeded();
        await shoot(region, `countdowns-${who}-${viewport.width}`);
        if (who === "gm" && viewport.width < 1440) await expectAtLeast44(region.locator("button.gb"));
      }
    }

    const page = gm;
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto(`/campaigns/${campaignId}`);
    const region = page.getByRole("region", { name: "Countdowns" });
    const ritualCard = region.getByRole("article", { name: "The ritual" });
    await expect(ritualCard).toBeVisible();

    // Roles.
    await expect(region.getByRole("button", { name: "+ New countdown" })).toHaveClass(/\bgb-confirm\b/);
    await expect(region.getByRole("button", { name: "+ New chase" })).toHaveClass(/\bgb-neutral\b/);
    const tick = ritualCard.getByRole("button", { name: "Tick −1" });
    await expect(tick).toHaveClass(/\bgb-confirm\b/);
    await expect(ritualCard.getByRole("button", { name: /^Borrowed time/ })).toHaveClass(/\bgb-neutral\b/);
    await expect(ritualCard.getByRole("button", { name: "Pause" })).toHaveClass(/\bgb-neutral\b/);
    const armed = ritualCard.getByRole("button", { name: /^Armed:/ });
    await expect(armed).toHaveClass(/\bgb-neutral\b/);
    await expect(armed).toHaveAttribute("aria-pressed", "true");
    await expect(ritualCard.getByRole("button", { name: /^Who can see/ })).toHaveClass(/\bgb-neutral\b.*\bgb-sm\b/);
    await expect(ritualCard.getByRole("button", { name: "Cancel countdown…" })).toHaveClass(/\bgb-danger\b/);
    // The GM's confirm wears Fear (purple): its rim is not the player's Hope gold.
    const gmRim = await tick.evaluate((el) => getComputedStyle(el).getPropertyValue("--rim").trim());
    const hopeRim = await tick.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gb-hope").trim());
    expect(gmRim).not.toBe(hopeRim);

    // A hovered confirm and a keyboard-focused button, axe on both.
    await ritualCard.scrollIntoViewIfNeeded();
    await tick.hover();
    await shoot(ritualCard, "card-gm-hover-tick");
    await expectNoSeriousA11yViolations(page, GRAINS_AXE);
    await page.mouse.move(0, 0);
    await keyboardFocus(page, ritualCard.getByRole("button", { name: /^Borrowed time/ }));
    await shoot(ritualCard, "card-gm-focus-borrowed");
    await expectNoSeriousA11yViolations(page, GRAINS_AXE);

    // The cancel confirm: Keep it = cancel (Hope for the GM), Cancel countdown = danger.
    await ritualCard.getByRole("button", { name: "Cancel countdown…" }).click();
    const confirm = ritualCard.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Keep it" })).toHaveClass(/\bgb-cancel\b/);
    await expect(confirm.getByRole("button", { name: "Cancel countdown" })).toHaveClass(/\bgb-danger\b/);
    await confirm.getByRole("button", { name: "Cancel countdown" }).hover();
    await shoot(ritualCard, "card-gm-cancel-confirm-hover-danger");
    await expectNoSeriousA11yViolations(page, GRAINS_AXE);
    await confirm.getByRole("button", { name: "Keep it" }).click();

    // The long-term track: rest switch and Edit steps.
    const invasion = region.getByRole("article", { name: "Invasion" });
    const automatic = invasion.getByRole("button", { name: "Automatic" });
    await expect(automatic).toHaveClass(/\bgb-neutral\b/);
    await expect(automatic).toHaveAttribute("aria-pressed", "true");
    await invasion.getByRole("button", { name: "Edit steps" }).click();
    await shoot(invasion, "track-gm-editing");
    await invasion.getByRole("button", { name: "Done editing" }).click();

    // The chase card.
    const chase = region.getByRole("article", { name: "Chase: The thief" });
    await expect(chase.getByRole("button", { name: "Tick The party down one" })).toHaveClass(/\bgb-confirm\b/);
    await expect(chase.getByRole("button", { name: "Pause chase" })).toHaveClass(/\bgb-neutral\b/);
    await shoot(chase, "chase-gm");

    // Dialogs.
    await region.getByRole("button", { name: "+ New countdown" }).click();
    const create = page.getByRole("dialog", { name: "New countdown" });
    await expect(create.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
    const submit = create.getByRole("button", { name: /^Start at/ });
    await expect(submit).toHaveClass(/\bgb-confirm\b/);
    await submit.scrollIntoViewIfNeeded();
    await submit.hover();
    await shoot(create, "new-countdown-gm-hover-start");
    await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
    await create.getByRole("button", { name: "Cancel" }).click();

    await region.getByRole("button", { name: "+ New chase" }).click();
    const newChase = page.getByRole("dialog", { name: "New chase" });
    await expect(newChase.getByRole("button", { name: "Start chase" })).toHaveClass(/\bgb-confirm\b/);
    await keyboardFocus(page, newChase.getByRole("button", { name: "Cancel" }));
    await shoot(newChase, "new-chase-gm-focus-cancel");
    await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
    await newChase.getByRole("button", { name: "Cancel" }).click();

    await ritualCard.getByRole("button", { name: /^Who can see/ }).click();
    const who = page.getByRole("dialog", { name: "Who can see this" });
    await expect(who.getByRole("button", { name: "Save" })).toHaveClass(/\bgb-confirm\b/);
    await shoot(who, "visibility-gm");
    await who.getByRole("button", { name: "Cancel" }).click();

    // A player sees no glass buttons in the section (read-only; the grains stay, disabled).
    await player.setViewportSize(VIEWPORTS[0]);
    await player.goto(`/campaigns/${campaignId}`);
    const seen = player.getByRole("region", { name: "Countdowns" });
    await expect(seen.getByRole("article", { name: "The ritual" })).toBeVisible();
    await expect(seen.locator("button.gb")).toHaveCount(0);
  } finally {
    await table.close();
  }
});
