// D12 H20 (.omc/plans/d12-hardening.yaml): accessibility and tablet pass for the entry flow, Settings, the campaign
// shell and every frame's dashboard. The bar (user, 2026-10-21, Q6/Q7): zero serious or critical axe findings on
// every page and open dialog, as the GM and as a player; at 768x1024 and 1024x768 no sideways scroll, the menu and
// the page's main button visible, primary controls at least 44 px, screenshots for review. Moderate and minor
// findings go to test annotations and docs/tasks/TASK-D12-H20.md, not fixed. Helpers: tests/e2e/a11y.ts (H1).

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PUBLISHED_FRAME_IDS, type FrameId } from "../../src/lib/frames";
import {
  expectFitsViewport,
  expectNoSeriousA11yViolations,
  expectTouchTargets,
  summarizeViolations,
  TABLET_VIEWPORTS,
  type A11yOptions,
} from "./a11y";
import { openSettings, signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";
import { convexAs } from "./visual/helpers";

// Two sign-ins, a campaign per frame and a production build on a loaded machine: give each test room.
test.setTimeout(180_000);

const SHOTS = "test-results/visual/D12-H20";

/** Scans the page and records the remaining moderate and minor findings as annotations (for the task doc). */
async function scan(page: Page, where: string, options?: A11yOptions) {
  const minor = await expectNoSeriousA11yViolations(page, options);
  test.info().annotations.push(...summarizeViolations(minor).map((line) => ({ type: `axe ${where}`, description: line })));
}

async function signIn(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
}

async function createCampaign(page: Page, frameId: FrameId) {
  const client = await convexAs(page);
  const name = `A11y ${crypto.randomUUID().slice(0, 8)}`;
  const custom =
    frameId === "custom"
      ? { pitch: "A drowned kingdom rises.", tones: ["Dark"], themes: "Grief", touchstones: "", partySize: 4, startingTier: 1, background: "custom" }
      : undefined;
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId, name, custom, idempotencyKey: crypto.randomUUID() });
  return { client, campaignId, name };
}

async function openDashboard(page: Page, campaignId: Id<"campaigns">, name: string) {
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTestId("hero-session")).toBeVisible();
}

test.describe("entry flow as the GM", () => {
  test("sign-in page", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await scan(page, "/signin");
  });

  test("title menu, Settings and Join dialogs", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: /Load Campaign/ })).toBeVisible();
    // The whole page, footer included (dcm-o95: H1's smoke spec scanned only the nav).
    await scan(page, "/");
    await openSettings(page);
    await expect(page.getByTestId("viewer-email")).toBeVisible();
    await scan(page, "/ Settings");
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("button", { name: /Join Campaign/ }).click();
    await expect(page.getByRole("dialog", { name: "Join a campaign" })).toBeVisible();
    await scan(page, "/ Join");
  });

  test("frame select, custom frame form and every frame intro", async ({ page }) => {
    await signIn(page);
    await page.goto("/new");
    await page.getByRole("button", { name: /The Witherwild/ }).click();
    await expect(page.getByRole("region", { name: "Frame details" })).toBeVisible();
    await scan(page, "/new");
    await page.getByRole("radio", { name: /Custom/ }).click();
    await expect(page.getByRole("region", { name: "Custom frame" })).toBeVisible();
    await scan(page, "/new custom");
    for (const frameId of PUBLISHED_FRAME_IDS) {
      await page.goto(`/frames/${frameId}`);
      await expect(page.getByRole("button", { name: "Choose this Frame" })).toBeVisible();
      await scan(page, `/frames/${frameId}`);
    }
    await page.getByRole("button", { name: "Choose this Frame" }).click();
    await expect(page.getByRole("dialog", { name: "Name your campaign" })).toBeVisible();
    await scan(page, "/frames name dialog");
  });

  test("load campaign and join by link", async ({ page }) => {
    await signIn(page);
    const { client, campaignId } = await createCampaign(page, "witherwild");
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { level: 1, name: "Load Campaign" })).toBeVisible();
    // Wait for the list itself: the scan and the shot must not catch "Loading campaigns…".
    await expect(page.locator("#campaign-1")).toBeVisible();
    await scan(page, "/campaigns");
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    // The GM's own link: the page and its button render the same for anyone signed in.
    await page.goto(`/join/${code}`);
    await expect(page.getByRole("button", { name: "Join campaign" })).toBeVisible();
    await scan(page, "/join/[code]");
  });
});

test.describe("campaign shell and dashboards", () => {
  test("Witherwild dashboard with the Tome, Players and New countdown dialogs", async ({ page }) => {
    await signIn(page);
    const { campaignId, name } = await createCampaign(page, "witherwild");
    await openDashboard(page, campaignId, name);
    await scan(page, "dashboard witherwild (GM)");
    await page.getByRole("button", { name: "Open the Tome" }).click();
    await expect(page.getByRole("dialog", { name: /tome$/ })).toBeVisible();
    await scan(page, "tome");
    await page.getByRole("button", { name: "Close tome" }).click();
    await page.getByRole("button", { name: "Players" }).click();
    await expect(page.getByRole("dialog", { name: "Players" })).toBeVisible();
    await scan(page, "Players dialog");
    await page.getByRole("button", { name: "Close players" }).click();
    await page.getByRole("button", { name: "+ New countdown" }).click();
    await expect(page.getByRole("dialog", { name: "New countdown" })).toBeVisible();
    await scan(page, "New countdown dialog");
    await page.getByRole("button", { name: "Close new countdown" }).click();
    await page.getByRole("button", { name: "Start Session" }).click();
    await expect(page.getByRole("dialog", { name: "Start the session?" })).toBeVisible();
    await scan(page, "Start session dialog");
  });

  for (const frameId of [...PUBLISHED_FRAME_IDS.filter((id) => id !== "witherwild"), "custom" as const]) {
    test(`${frameId} dashboard as the GM`, async ({ page }) => {
      await signIn(page);
      const { campaignId, name } = await createCampaign(page, frameId);
      await openDashboard(page, campaignId, name);
      await scan(page, `dashboard ${frameId} (GM)`);
    });
  }

  test("Witherwild dashboard as a player", async ({ browser }) => {
    const table = await gmAndPlayer(browser);
    try {
      await expect(table.player.getByTestId("hero-session")).toBeVisible();
      await scan(table.player, "dashboard witherwild (player)");
      await table.player.getByRole("button", { name: "Open the Tome" }).click();
      await expect(table.player.getByRole("dialog", { name: /tome$/ })).toBeVisible();
      await scan(table.player, "tome (player)");
    } finally {
      await table.close();
    }
  });
});

for (const viewport of TABLET_VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`tablet ${size}`, () => {
    test.use({ viewport });

    /** No sideways scroll; the primary control is reachable by scrolling down only (in view once scrolled to) and 44 px. */
    async function check(page: Page, shot: string, primary: ReturnType<Page["getByRole"]>) {
      await expectFitsViewport(page);
      await primary.scrollIntoViewIfNeeded();
      await expect(primary).toBeInViewport({ ratio: 1 });
      await expectTouchTargets(primary);
      await page.screenshot({ path: `${SHOTS}/${shot}-${size}.png`, fullPage: true });
    }

    test(`entry pages at ${size}`, async ({ page }) => {
      await page.goto("/signin");
      await check(page, "signin", page.getByRole("form", { name: "Sign in with email" }).getByRole("button").first());

      await signIn(page);
      const menu = page.getByRole("navigation", { name: "Main menu" });
      await check(page, "title-menu", menu.getByRole("link", { name: /Create New Campaign/ }));
      await expectTouchTargets(menu.locator("a, button"));
      await openSettings(page);
      await expect(page.getByTestId("viewer-email")).toBeVisible();
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expectFitsViewport(page);
      await expectTouchTargets(settings.getByRole("button", { name: "Close settings" }));
      await page.screenshot({ path: `${SHOTS}/settings-${size}.png`, fullPage: true });
      await settings.getByRole("button", { name: "Close settings" }).click();

      await page.goto("/new");
      await expectTouchTargets(page.getByRole("radio"));
      await page.getByRole("button", { name: /The Witherwild/ }).click();
      await check(page, "new", page.getByRole("button", { name: "Start campaign" }));
      await expectTouchTargets(page.getByRole("link", { name: "Back to main menu" }));

      await page.goto("/frames/witherwild");
      await check(page, "frame-intro", page.getByRole("button", { name: "Choose this Frame" }));

      const { client, campaignId } = await createCampaign(page, "witherwild");
      await page.goto("/campaigns");
      await expect(page.getByRole("heading", { level: 1, name: "Load Campaign" })).toBeVisible();
      // Wait for the list itself: the scan and the shot must not catch "Loading campaigns…".
      await expect(page.locator("#campaign-1")).toBeVisible();
      await check(page, "campaigns", page.getByRole("link", { name: "Back to main menu" }));

      const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
      await page.goto(`/join/${code}`);
      await check(page, "join", page.getByRole("button", { name: "Join campaign" }));
    });

    test(`dashboards at ${size}`, async ({ browser }) => {
      const table = await gmAndPlayer(browser);
      try {
        for (const [page, role] of [
          [table.gm, "gm"],
          [table.player, "player"],
        ] as const) {
          await page.setViewportSize(viewport);
          await page.goto(`/campaigns/${table.campaignId}`);
          await expect(page.getByTestId("hero-session")).toBeVisible();
          const nav = page.getByRole("navigation", { name: "Campaign sections" });
          await expect(nav).toBeInViewport();
          await expectTouchTargets(nav.getByRole("link"));
          await expectTouchTargets(page.getByRole("link", { name: "Back to main menu" }));
          const primary =
            role === "gm" ? page.getByRole("button", { name: "Start Session" }) : page.getByRole("button", { name: "Open the Tome" });
          await check(page, `dashboard-${role}`, primary);
          // The board's Fear spiral shrinks its tokens to 30-42 px here: WCAG 2.2 AA's 24 px holds; 44 px needs a
          // design change (bead dcm-hlj).
          await expectTouchTargets(page.getByRole("button", { name: /^Fear \d+ of \d+$/ }), 24);
        }
      } finally {
        await table.close();
      }
    });
  });
}
