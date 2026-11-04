import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "../a11y";
import { signInAsTestGm } from "../fixtures";
import { hudScene } from "../hud/helpers";
import { convexAs } from "./helpers";

// Shots for docs/tasks/TASK-GLASS-G1.md (E2E_VISUAL=1): every page outside a campaign (sign-in, main menu, Settings,
// Join, new campaign, a frame's intro, a join link, Load Campaign with its delete confirms) at 1440 x 900, 1024 x 768
// and 390 x 844 in the player's colours (no viewer, Q2 a), and the Combat Map app bar as the GM and as a player. Each
// page also checks its roles (confirm / cancel / danger / neutral / tool), 44 px touch targets at 1024 and 390, and
// axe with a button hovered (the hover fill swaps the text colour).

const OUT = "test-results/visual/GLASS-G1";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** Hover a button, wait for the fill, shoot, and run axe with it hovered. */
async function hoverShot(page: Page, button: Locator, name: string, include?: string) {
  await button.hover();
  await page.waitForTimeout(400);
  await shoot(page, name);
  await expectNoSeriousA11yViolations(page, include ? { include } : {});
  await page.mouse.move(0, 0);
}

/** Keyboard focus on a button (Tab into it, so :focus-visible applies), then shoot. */
async function focusShot(page: Page, button: Locator, name: string) {
  await button.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  await shoot(page, name);
}

const role = (button: Locator, r: string) => expect(button).toHaveClass(new RegExp(`\\bgb-${r}\\b`));

/** Every glass button visible on the page is at least 44 px (touch widths). */
async function glassTouchTargets(page: Page, width: number) {
  if (width > 1100) return;
  await expectTouchTargets(page.locator(".gb:visible"));
}

test("GLASS-G1 sign-in, the main menu, Settings and Join (no viewer: the player's colours)", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/signin");
    await expect(page.getByRole("form", { name: "Sign in with email" })).toBeVisible();
    await role(page.getByRole("button", { name: "Sign in", exact: true }), "confirm");
    await role(page.getByRole("button", { name: "Sign in with Google" }), "neutral");
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `signin-${viewport.width}`);
  }
  await page.setViewportSize(VIEWPORTS[0]);
  await hoverShot(page, page.getByRole("button", { name: "Sign in", exact: true }), "signin-hover-confirm");
  await focusShot(page, page.getByRole("button", { name: "Sign in with Google" }), "signin-focus-google");

  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await shoot(page, `menu-${viewport.width}`);

    // Settings: backup / restore neutral, Reset settings… danger; its confirm: Cancel = cancel, Reset = danger.
    await page.getByRole("button", { name: /Settings/ }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await role(settings.getByRole("button", { name: "Show backup" }), "neutral");
    await role(settings.getByRole("button", { name: "Restore from pasted backup" }), "neutral");
    await role(settings.getByRole("button", { name: "Sign out" }), "neutral");
    await settings.getByRole("button", { name: "Reset settings…" }).click();
    const reset = settings.getByRole("alertdialog", { name: "Confirm reset" });
    await role(reset.getByRole("button", { name: "Cancel" }), "cancel");
    await role(reset.getByRole("button", { name: "Reset", exact: true }), "danger");
    await reset.scrollIntoViewIfNeeded();
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `settings-reset-${viewport.width}`);
    if (viewport.width === 1440) {
      await hoverShot(page, reset.getByRole("button", { name: "Reset", exact: true }), "settings-hover-reset");
      await hoverShot(page, reset.getByRole("button", { name: "Cancel" }), "settings-hover-cancel");
    }
    await reset.getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    // Join: Cancel = cancel, Join = confirm.
    await page.getByRole("button", { name: /Join Campaign/ }).click();
    const join = page.getByRole("dialog", { name: "Join a campaign" });
    await expect(join).toBeVisible();
    await role(join.getByRole("button", { name: "Cancel" }), "cancel");
    await role(join.getByRole("button", { name: "Join", exact: true }), "confirm");
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `join-${viewport.width}`);
    if (viewport.width === 1440) {
      await hoverShot(page, join.getByRole("button", { name: "Join", exact: true }), "join-hover-confirm");
      await focusShot(page, join.getByRole("button", { name: "Cancel" }), "join-focus-cancel");
    }
    await join.getByRole("button", { name: "Cancel" }).click();
    await expect(join).toBeHidden();
  }
});

test("GLASS-G1 new campaign, a frame's intro and a join link", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsTestGm(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/new");
    const footer = page.locator("footer");
    await role(footer.getByRole("link", { name: "Back" }), "cancel");
    await role(footer.getByRole("button", { name: "Start campaign" }), "confirm");
    await role(page.getByRole("link", { name: "Preview full frame" }), "neutral");
    await role(page.getByRole("link", { name: "Back to main menu" }), "tool");
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `new-frame-${viewport.width}`);

    // Custom: the tone chips are neutral switches; a chosen one glows gold.
    await page.getByRole("radio", { name: /Custom/ }).click();
    const tone = page.getByRole("button", { pressed: false }).filter({ hasText: /\w/ }).first();
    await tone.click();
    await expect(page.getByRole("button", { pressed: true }).first()).toHaveClass(/\bgb-neutral\b/);
    await shoot(page, `new-custom-${viewport.width}`);
    await page.getByRole("button", { pressed: true }).first().click();

    // The name dialog: Cancel = cancel, Start campaign = confirm.
    await page.getByRole("radio", { name: /Existing Campaign Frame/ }).click();
    await footer.getByRole("button", { name: "Start campaign" }).click();
    const naming = page.getByRole("dialog", { name: "Name your campaign" });
    await expect(naming).toBeVisible();
    await role(naming.getByRole("button", { name: "Cancel" }), "cancel");
    await role(naming.getByRole("button", { name: "Start campaign" }), "confirm");
    await shoot(page, `new-name-${viewport.width}`);
    await naming.getByRole("button", { name: "Cancel" }).click();

    // A frame's intro: Choose this Frame = confirm (large), Overview / View full art = neutral.
    await page.goto("/frames/witherwild");
    const choose = page.getByRole("button", { name: "Choose this Frame" });
    await role(choose, "confirm");
    await expect(choose).toHaveClass(/\bgb-lg\b/);
    // Bead dcm-82nc: big buttons letter in Cinzel capitals.
    await expect(choose).toHaveCSS("text-transform", "uppercase");
    await expect(choose).toHaveCSS("font-family", /Cinzel/i);
    await role(page.getByRole("button", { name: "Overview" }), "neutral");
    await role(page.getByRole("button", { name: "View full art" }), "neutral");
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `frame-intro-${viewport.width}`);
    if (viewport.width === 1440) {
      await hoverShot(page, choose, "frame-intro-hover-choose");
      await focusShot(page, page.getByRole("button", { name: "Overview" }), "frame-intro-focus-overview");
    }

    // A join link: Not now = cancel, Join campaign = confirm.
    await page.goto("/join/ZZZZ-ZZZZ");
    await role(page.getByRole("link", { name: "Not now" }), "cancel");
    await role(page.getByRole("button", { name: "Join campaign" }), "confirm");
    await glassTouchTargets(page, viewport.width);
    await shoot(page, `join-link-${viewport.width}`);
  }
});

test("GLASS-G1 Load Campaign: Resume, Delete, Keep it, Restore, Delete permanently", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsTestGm(page);
  const client = await convexAs(page);
  const tag = crypto.randomUUID().slice(0, 6);
  const gone = `Glass gone ${tag}`;
  const { campaignId: goneId } = await client.mutation(api.campaigns.create, {
    frameId: "witherwild",
    name: gone,
    idempotencyKey: crypto.randomUUID(),
  });
  await client.mutation(api.campaigns.remove, { campaignId: goneId });
  const kept = `Glass kept ${tag}`;
  await client.mutation(api.campaigns.create, { frameId: "witherwild", name: kept, idempotencyKey: crypto.randomUUID() });

  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/campaigns");
      const resume = page.getByRole("link", { name: "Resume Campaign" });
      await expect(resume).toBeVisible();
      await role(resume, "confirm");
      const del = page.getByRole("button", { name: `Delete ${kept}`, exact: true });
      await role(del, "danger");
      await del.click();
      const confirm = page.getByRole("alertdialog", { name: "Confirm delete" });
      await role(confirm.getByRole("button", { name: "Keep it" }), "cancel");
      await role(confirm.getByRole("button", { name: "Delete", exact: true }), "danger");
      await glassTouchTargets(page, viewport.width);
      await shoot(page, `chronicle-delete-${viewport.width}`);
      if (viewport.width === 1440) {
        await hoverShot(page, resume, "chronicle-hover-resume");
        await hoverShot(page, confirm.getByRole("button", { name: "Delete", exact: true }), "chronicle-hover-delete");
        await focusShot(page, confirm.getByRole("button", { name: "Keep it" }), "chronicle-focus-keep");
      }
      await confirm.getByRole("button", { name: "Keep it" }).click();

      const row = page.getByRole("region", { name: "Deleted campaigns" }).getByRole("listitem").filter({ hasText: gone });
      await role(row.getByRole("button", { name: `Restore ${gone}` }), "confirm");
      await row.getByRole("button", { name: `Delete ${gone} permanently` }).click();
      const purge = row.getByRole("alertdialog", { name: "Confirm permanent delete" });
      await role(purge.getByRole("button", { name: "Keep it" }), "cancel");
      await role(purge.getByRole("button", { name: `Delete ${gone} forever` }), "danger");
      await row.scrollIntoViewIfNeeded();
      await glassTouchTargets(page, viewport.width);
      await shoot(page, `chronicle-purge-${viewport.width}`);
      await purge.getByRole("button", { name: "Keep it" }).click();
    }
  } finally {
    await client.mutation(api.campaigns.purge, { campaignId: goneId }).catch(() => undefined);
  }
});

test("GLASS-G1 the Combat Map app bar as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  try {
    for (const [who, page] of [
      ["gm", s.gm],
      ["player", s.player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(s.url);
        await expect(page.getByTestId("combat-hud")).toBeVisible();
        if (viewport.width > 760) {
          const bar = page.getByTestId("app-bar");
          await role(bar.getByRole("link", { name: "Back to main menu" }), "tool");
          await role(bar.getByRole("button", { name: "Full screen: hide the app bar" }), "tool");
          if (who === "gm") await role(bar.getByTestId("app-bar-settings"), "tool");
          await expectTouchTargets(bar.locator(".gb"));
        }
        await shoot(page, `app-bar-${who}-${viewport.width}`);
      }
      await page.setViewportSize(VIEWPORTS[0]);
      const bar = page.getByTestId("app-bar");
      await hoverShot(page, bar.getByRole("button", { name: "Full screen: hide the app bar" }), `app-bar-${who}-hover-full-screen`, "[data-testid=app-bar]");
      if (who === "gm") {
        // Config S1: the gear opens the Campaign settings dialog (src/components/config/shell); its ✕ is a round cancel.
        await bar.getByTestId("app-bar-settings").click();
        const settings = page.getByTestId("campaign-settings");
        await expect(settings).toBeVisible();
        await role(settings.getByRole("button", { name: "Close campaign settings" }), "cancel");
        await shoot(page, "app-bar-gm-campaign-settings");
        await page.keyboard.press("Escape");
      }
      await focusShot(page, bar.getByRole("link", { name: "Back to main menu" }), `app-bar-${who}-focus-back`);
      // Full screen: the way back is a neutral glass icon button.
      await bar.getByRole("button", { name: "Full screen: hide the app bar" }).click();
      const show = page.getByRole("button", { name: "Show the app bar" });
      await role(show, "neutral");
      await shoot(page, `app-bar-${who}-hidden`);
      await show.click();
      await expect(bar).toBeVisible();
    }
  } finally {
    await s.close();
  }
});
