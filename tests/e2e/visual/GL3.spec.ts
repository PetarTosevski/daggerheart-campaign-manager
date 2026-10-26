import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, openSheet, visual } from "./helpers";

// GL3: the Domain Deck in guided level-up mode at 1440 and 390. The Domain card step opens the deck; a card is
// chosen for level 2 (green "Chosen for level 2" with Undo choice), and a hand card is exchanged for a deck card.
// Board counterpart: none (the board has no guided mode); the deck keeps the board's dkc cards.

test("GL3 Domain Deck level-up: choose a card, exchange, 44 px controls at 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "GL3");

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  const ribbon = sheet.getByRole("region", { name: "Level-up to 2" });
  await ribbon.getByRole("button", { name: /Domain card/ }).click();
  const deck = sheet.getByRole("region", { name: "Domain Deck" });
  await expect(deck).toBeInViewport();
  await expect(deck.getByText("Level 2: choose 1 domain card below.")).toBeVisible();
  await expect(deck.getByRole("button", { name: /^Take / })).toHaveCount(0);

  const choose = deck.getByRole("button", { name: /^Choose .+ for level 2$/ });
  const label = (await choose.first().getAttribute("aria-label"))!;
  const cardName = label.replace(/^Choose (.+) for level 2$/, "$1");
  await choose.first().click();
  const chosen = deck.getByRole("article", { name: cardName });
  await expect(chosen.getByText("Chosen for level 2")).toBeVisible();
  await expect(chosen.getByRole("button", { name: `Undo choice of ${cardName}` })).toBeVisible();

  // Exchange Deft Deceiver (level 1) for a level-1 deck card.
  const hand = sheet.getByRole("list", { name: "Loadout cards" });
  await hand.getByRole("button", { name: "Exchange Deft Deceiver at level-up" }).click();
  await expect(deck.getByText(/Exchanging Deft Deceiver/)).toBeVisible();
  await deck.getByRole("button", { name: /in exchange for Deft Deceiver$/ }).first().click();
  await expect(deck.getByText("Exchange for Deft Deceiver at level 2")).toBeVisible();
  await shoot(deck, "deck-chosen");
  await shoot(sheet.getByRole("region", { name: "Loadout and vault" }), "hand-exchange");

  await ribbon.getByRole("button", { name: /Finish/ }).first().click();
  const choices = ribbon.getByRole("list", { name: "Your choices" });
  await expect(choices).toContainText(`Domain card: ${cardName}`);
  await expect(choices).toContainText("Exchange Deft Deceiver for");

  // 390: the deck's and the felt's controls are 44 px and the page does not scroll sideways.
  await ribbon.getByRole("button", { name: /Domain card/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const small = await sheet.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("#lu-target-deck button, .dk-felt button"))
      .filter((b) => !b.closest("[aria-hidden=true]") && b.getClientRects().length > 0)
      .map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent ?? "", r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
      .map(({ name, r }) => `${name} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });

  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(deck.getByRole("button", { name: /for level 2$/ })).toHaveCount(0);
});
