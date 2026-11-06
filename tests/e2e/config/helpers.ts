// Shared helpers for the config plan's e2e specs (Campaign settings and Preferences; plan .omc/plans/config.yaml).
import { expect, type Locator, type Page } from "@playwright/test";

/** The tall art header (every campaign page but the Combat Map on tablet and desktop). */
export const artHeader = (page: Page) => page.getByRole("region", { name: "Campaign header" });

/** The Combat Map's app bar (tablet and desktop). */
export const appBar = (page: Page) => page.getByTestId("app-bar");

/** The gear inside `scope` (art header or app bar). */
export const gear = (scope: Locator) => scope.getByRole("button", { name: "Campaign settings" });

/** The avatar inside `scope`. */
export const avatar = (scope: Locator) => scope.getByRole("button", { name: "Your preferences" });

/** The Campaign settings slide-over. */
export const settingsPanel = (page: Page) => page.getByRole("dialog", { name: "Campaign settings" });

/** The Preferences popover. */
export const preferences = (page: Page) => page.getByRole("dialog", { name: "Your preferences" });

/** The settings section nav item `label` (Table, House rules, Players, Lorekeeper, Sessions). */
export const sectionNav = (page: Page, label: string) =>
  settingsPanel(page).getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: label, exact: true });

/** Opens Campaign settings from `scope`'s gear and waits for the panel and the URL (`?settings=table`). */
export async function openCampaignSettings(page: Page, scope: Locator): Promise<Locator> {
  await gear(scope).click();
  const panel = settingsPanel(page);
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/[?&]settings=table\b/);
  return panel;
}

/**
 * Opens Campaign settings at Players from the header's Players button (config SX, Q10 b: the button is a shortcut to the
 * one Players UI) and waits for the panel and the URL (`?settings=players`).
 */
export async function openPlayers(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Players", exact: true }).click();
  const panel = settingsPanel(page);
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/[?&]settings=players\b/);
  await expect(panel.getByRole("heading", { level: 3, name: "Players" })).toBeVisible();
  return panel;
}

/** Closes Campaign settings with its ✕ and waits for it to go. */
export async function closeCampaignSettings(page: Page): Promise<void> {
  await settingsPanel(page).getByRole("button", { name: "Close campaign settings" }).click();
  await expect(settingsPanel(page)).toBeHidden();
}

/**
 * The campaign's join code as people read it (`ABCD-EFGH`), from Settings › Players (the header's Players button). Makes
 * the link when the campaign has none yet. Uses the panel when it is already open at Players. Closes the panel unless
 * `keepOpen`.
 */
export async function gmJoinCode(page: Page, { keepOpen = false }: { keepOpen?: boolean } = {}): Promise<string> {
  const open = await settingsPanel(page).locator('[data-section="players"]').isVisible();
  const panel = open ? settingsPanel(page) : await openPlayers(page);
  const link = panel.getByTestId("settings-join-link");
  const make = panel.getByRole("button", { name: "Make a link" });
  await expect(link.or(make)).toBeVisible();
  if (await make.isVisible()) await make.click();
  await expect(link).toHaveText(/\/join\/[A-Z0-9]{8}$/);
  const code = (await link.textContent())!.split("/join/")[1];
  if (!keepOpen) await closeCampaignSettings(page);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Opens the settings at `section` through the URL (as a shared link would). */
export async function gotoSettings(page: Page, path: string, section: string): Promise<void> {
  await page.goto(`${path}?settings=${section}`);
}

/** The width and height of `locator`'s box, rounded. */
export async function boxSize(locator: Locator): Promise<{ width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, "a visible box").toBeTruthy();
  return { width: Math.round(box!.width), height: Math.round(box!.height) };
}
