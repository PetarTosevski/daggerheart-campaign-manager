import { expect, test, type Locator, type Page } from "@playwright/test";

import { hudScene } from "./hud/helpers";

// The HUD hand with a mouse (user 2026-11-09): only one card is raised at a time (a clicked card sinks when another is
// hovered), the full card's Use and Close take clicks and its text scrolls (the hand's wrapper lets the pointer through
// to the map, and the dialog used to inherit that), and dragging a card to the middle of the screen plays it like Use.

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const top = async (l: Locator) => (await l.boundingBox())!.y;

test("the HUD hand by mouse: one raised card, a clickable full card, drag to play", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    const entangle = fanCard(player, "Vicious Entangle");
    const chaos = fanCard(player, "Unleash Chaos");
    const resting = await top(chaos);

    // Click one card, then hover the other: only the hovered one is up.
    await entangle.hover();
    await entangle.getByRole("heading", { name: "Vicious Entangle" }).click();
    await chaos.hover();
    await expect.poll(() => top(chaos)).toBeLessThan(resting - 50);
    await expect.poll(async () => (await top(entangle)) - resting).toBeGreaterThan(-5);

    // More by mouse: the full card's Close and Use take clicks; its text box scrolls.
    await entangle.hover();
    await entangle.getByRole("button", { name: "More about Vicious Entangle" }).click();
    const full = player.getByTestId("hud-full-card");
    await expect(full).toBeVisible();
    expect(await full.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("auto");
    expect(await full.locator(".cmh-text").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await full.getByRole("button", { name: "Close" }).click();
    await expect(full).toBeHidden();
    await entangle.hover();
    await entangle.getByRole("button", { name: "More about Vicious Entangle" }).click();
    await full.getByRole("button", { name: "Use" }).click();
    const pick = player.getByTestId("hud-pick");
    await expect(pick).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(pick).toBeHidden();

    // Drag the card to the middle of the screen: it plays like Use (the picking panel asks for the target).
    await entangle.hover();
    const face = await entangle.getByRole("heading", { name: "Vicious Entangle" }).boundingBox();
    await player.mouse.move(face!.x + face!.width / 2, face!.y + face!.height / 2);
    await player.mouse.down();
    await player.mouse.move(720, 500, { steps: 12 });
    await expect(player.locator(".hud-drop-zone.is-over")).toBeVisible();
    await player.mouse.up();
    await expect(player.locator(".hud-drop-zone")).toHaveCount(0);
    await expect(pick).toBeVisible();
    await expect(entangle).toHaveAttribute("data-wash", "play");
    await player.keyboard.press("Escape");
    await expect(pick).toBeHidden();

    // A drag that ends outside the middle snaps back and plays nothing.
    await entangle.hover();
    const again = await entangle.getByRole("heading", { name: "Vicious Entangle" }).boundingBox();
    await player.mouse.move(again!.x + again!.width / 2, again!.y + again!.height / 2);
    await player.mouse.down();
    await player.mouse.move(60, 860, { steps: 8 });
    await player.mouse.up();
    await expect(pick).toBeHidden();
    await expect(entangle).not.toHaveAttribute("data-wash", "play");
  } finally {
    await s.close();
  }
});
