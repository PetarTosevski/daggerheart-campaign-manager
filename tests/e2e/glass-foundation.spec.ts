// Plan glass-buttons G0 (docs/tasks/TASK-GLASS-G0.md): brandButton draws the arcane glass button and the campaign
// shell sets the viewer once (data-viewer gm / player), so the same confirm has a Hope rim for a player and a Fear
// rim for the GM; outside a campaign the player's colours apply. A hovered confirm and a keyboard-focused button pass
// axe; reduced motion has no transition; a small button is 44 px on touch widths; a long label wraps instead of
// clipping; layout utilities still apply to a glass button.
//
// The probe buttons carry the classes brandButton returns (tests/unit/brand/buttons.test.tsx pins that mapping) and
// are mounted inside the shell's root, so they inherit the page's data-viewer like any page button.

import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";

const HOPE_RIM = "rgb(227, 180, 90)"; // --gb-hope (--brand)
const FEAR_RIM = "rgb(143, 123, 209)"; // --gb-fear

/** Mounts a row of glass buttons (brandButton's classes) inside the page's viewer root, or the body outside one. */
async function mountProbe(page: Page, buttons: { label: string; className: string }[], width?: number) {
  await page.evaluate(
    ({ buttons, width }) => {
      document.getElementById("glass-probe")?.remove();
      const host = document.querySelector("[data-viewer]") ?? document.body;
      const row = document.createElement("div");
      row.id = "glass-probe";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Glass probe");
      row.style.cssText = `position:relative;z-index:50;display:flex;flex-wrap:wrap;gap:12px;padding:16px;background:#0d1417;${width ? `width:${width}px;` : ""}`;
      for (const b of buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = b.className;
        button.textContent = b.label;
        row.appendChild(button);
      }
      host.prepend(row);
    },
    { buttons, width },
  );
  return page.locator("#glass-probe");
}

const shadow = (page: Page, name: string) =>
  page.locator("#glass-probe").getByRole("button", { name, exact: true }).evaluate((el) => getComputedStyle(el).boxShadow);

test("the same confirm button has a Hope rim for a player and a Fear rim for the GM; cancel the other way round", async ({ browser }) => {
  test.setTimeout(180_000);
  const table = await gmAndPlayer(browser);
  try {
    await expect(table.gm.locator("[data-viewer]").first()).toHaveAttribute("data-viewer", "gm");
    await expect(table.player.locator("[data-viewer]").first()).toHaveAttribute("data-viewer", "player");

    for (const [page, confirmRim, cancelRim] of [
      [table.player, HOPE_RIM, FEAR_RIM],
      [table.gm, FEAR_RIM, HOPE_RIM],
    ] as const) {
      await mountProbe(page, [
        { label: "Save", className: "gb gb-confirm gb-wrap" },
        { label: "Cancel", className: "gb gb-cancel gb-wrap" },
        { label: "Delete", className: "gb gb-danger gb-wrap" },
      ]);
      expect(await shadow(page, "Save")).toContain(confirmRim);
      expect(await shadow(page, "Cancel")).toContain(cancelRim);
      expect(await shadow(page, "Delete")).toContain("rgb(168, 71, 58)"); // ember, for everyone
    }

    // A real one: the Players dialog (a native <dialog> inside the shell) inherits the GM's viewer. Invite (solid) is
    // a confirm in Fear; the close ✕ is a round cancel in Hope.
    await table.gm.getByRole("button", { name: "Players" }).click();
    const dialog = table.gm.getByRole("dialog", { name: "Players" });
    await expect(dialog).toBeVisible();
    const invite = dialog.getByRole("button", { name: "Invite", exact: true });
    await expect(invite).toHaveClass(/\bgb-confirm\b/);
    expect(await invite.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(FEAR_RIM);
    const close = dialog.getByRole("button", { name: "Close players" });
    await expect(close).toHaveClass(/\bgb-cancel\b.*\bgb-round\b/);
    expect(await close.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(HOPE_RIM);
    await expect(close).toHaveCSS("width", "44px");
    await expect(close).toHaveCSS("height", "44px");

    // Hovered: the fill comes up and the text swaps colour; axe checks the contrast of that state.
    await invite.hover();
    await expect(invite).toHaveCSS("color", "rgb(243, 207, 134)"); // --gb-fear-ink on the Fear fill
    await expectNoSeriousA11yViolations(table.gm, { include: 'dialog[open]' });
    // Keyboard focus on the close ✕.
    await close.focus();
    await expect(close).toBeFocused();
    await expectNoSeriousA11yViolations(table.gm, { include: 'dialog[open]' });
  } finally {
    await table.close();
  }
});

test("outside a campaign there is no viewer and the player's colours apply", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await expect(page.locator("[data-viewer]")).toHaveCount(0);
  await mountProbe(page, [
    { label: "Create", className: "gb gb-confirm gb-wrap" },
    { label: "Back", className: "gb gb-cancel gb-wrap" },
  ]);
  expect(await shadow(page, "Create")).toContain(HOPE_RIM);
  expect(await shadow(page, "Back")).toContain(FEAR_RIM);
  // A hovered confirm passes axe (gold fill, dark ink).
  await page.locator("#glass-probe").getByRole("button", { name: "Create" }).hover();
  await expectNoSeriousA11yViolations(page, { include: "#glass-probe" });
});

test("reduced motion: no transition on the button or its fill", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/signin");
  const probe = await mountProbe(page, [{ label: "Sign in", className: "gb gb-confirm gb-wrap" }]);
  const durations = await probe.getByRole("button").evaluate((el) => [
    getComputedStyle(el).transitionDuration,
    getComputedStyle(el, "::before").transitionDuration,
  ]);
  for (const d of durations) expect(d.split(",").every((part) => parseFloat(part) === 0)).toBe(true);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const moving = await probe.getByRole("button").evaluate((el) => getComputedStyle(el, "::before").transitionDuration);
  expect(parseFloat(moving)).toBeGreaterThan(0);
});

test("touch, wrapping and layout: a small button is 44 px on tablets, long labels wrap, layout classes apply", async ({ page }) => {
  await page.goto("/signin");
  const buttons = [
    { label: "Small", className: "gb gb-neutral gb-sm" },
    { label: "Small wrapped", className: "gb gb-neutral gb-sm gb-wrap" },
    { label: "Full width", className: "gb gb-confirm gb-wrap w-full" },
    { label: "Turn every Wither token on the table into Fear for the GM", className: "gb gb-confirm gb-wrap" },
  ];
  const height = (name: string) => page.locator("#glass-probe").getByRole("button", { name, exact: true }).evaluate((el) => el.getBoundingClientRect().height);

  await page.setViewportSize({ width: 1440, height: 900 });
  await mountProbe(page, buttons, 260);
  expect(await height("Small")).toBe(34);
  expect(await height("Small wrapped")).toBe(34);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await height("Small")).toBe(44);
    expect(await height("Small wrapped")).toBe(44);
  }

  // The long label wraps onto more lines instead of being clipped, inside a 260 px column.
  const long = page.locator("#glass-probe").getByRole("button", { name: /^Turn every Wither/ });
  const fits = await long.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height }));
  expect(fits.sw).toBeLessThanOrEqual(fits.cw);
  expect(fits.h).toBeGreaterThan(44);
  // w-full (a layout utility) still applies: the button fills the probe's content box (260 - 2 x 16 padding).
  const full = await page.locator("#glass-probe").getByRole("button", { name: "Full width" }).evaluate((el) => el.getBoundingClientRect().width);
  expect(full).toBe(228);
});
