import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";
import { expectNoHorizontalScroll, openSheet, openTab, VIEWPORTS } from "./visual/helpers";

// SC1 (dcm-bxp.126, dcm-bxp.127): every sheet card has 'More'; a hand card's buttons sit under its text, never over it;
// 'More' opens the large card (CardDialog) with the whole text, and Escape or Close puts focus back on 'More'.
// The GM's level-1 Bard starts with Deft Deceiver and Book of Ava; at level 2 a third card is taken into the hand and
// Deft Deceiver goes to the vault, so the hand holds Book of Ava (a long grimoire text) and the vault one card.

const codex2 = DOMAIN_CARDS.find((c) => c.domain === "codex" && c.level === 2 && c.source === "core")!;
const ava = DOMAIN_CARDS.find((c) => c.id === "book-of-ava")!;

/** The 'More' button's dialog opens, shows the whole card, closes with `how`, and focus is back on 'More'. */
async function openAndClose(page: Page, more: Locator, name: string, how: "Escape" | "Close") {
  await more.click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2, name })).toBeVisible();
  // The text never scrolls inside the card; only the dialog may scroll, and never sideways.
  const text = dialog.locator(".cd-text");
  await expect(text).toBeVisible();
  const box = await text.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, ov: getComputedStyle(el).overflowY }));
  expect(box.sh).toBeLessThanOrEqual(box.ch);
  expect(box.ov).toBe("visible");
  const wide = await dialog.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(wide.sw).toBeLessThanOrEqual(wide.cw);
  expect(wide.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expectNoHorizontalScroll(page);
  if (how === "Escape") await page.keyboard.press("Escape");
  else await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
}

test("sheet cards: hand buttons under the text, 'More' opens the large card on hand and vault cards", async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 2, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.takeCard, { characterId, cardId: codex2.id });
  await client.mutation(api.characters.moveCard, { characterId, cardId: "deft-deceiver", to: "vault" });
  await openTab(page, "Domains");
  const hand = sheet.getByRole("list", { name: "Loadout cards" });
  const vault = sheet.getByRole("list", { name: "Vault cards" });
  await expect(hand.getByRole("article", { name: ava.name })).toBeVisible();
  await expect(vault.getByRole("article", { name: "Deft Deceiver" })).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalScroll(page);

    // Hand cards: 'More' and Move to vault are visible and sit below the text box.
    for (const name of [ava.name, codex2.name]) {
      const card = hand.getByRole("article", { name });
      await card.scrollIntoViewIfNeeded();
      for (const label of [`More about ${name}`, "Move to vault"]) {
        const button = card.getByRole("button", { name: label });
        await expect(button).toBeVisible();
        // Layout offsets inside the card, which the fan's rotation does not skew: the button's top is at or below the
        // text box's bottom, and its footer is shown (not a hover overlay).
        const where = await button.evaluate((el) => {
          const face = el.closest("article")!;
          const text = face.querySelector<HTMLElement>(".dk-face-text")!;
          const top = (node: HTMLElement) => {
            let y = 0;
            for (let n: HTMLElement | null = node; n && n !== face; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
            return y;
          };
          const footer = el.parentElement!;
          return { button: top(el as HTMLElement), textBottom: top(text) + text.offsetHeight, position: getComputedStyle(footer).position, opacity: getComputedStyle(footer).opacity };
        });
        expect(where.button, `${label} on ${name} at ${viewport.width}`).toBeGreaterThanOrEqual(where.textBottom);
        expect(where.position).toBe("static");
        expect(where.opacity).toBe("1");
      }
    }

    await openAndClose(page, hand.getByRole("button", { name: `More about ${ava.name}` }), ava.name, "Escape");
    await openAndClose(page, hand.getByRole("button", { name: `More about ${codex2.name}` }), codex2.name, "Close");
    await openAndClose(page, vault.getByRole("button", { name: "More about Deft Deceiver" }), "Deft Deceiver", "Escape");
  }

  // The Domain Deck's 'More' opens the same dialog; the inline scroll ('Less') is gone.
  await page.setViewportSize(VIEWPORTS[0]);
  const grid = sheet.getByRole("region", { name: "Domain Deck" }).getByRole("list", { name: "Domain Deck cards" });
  await openAndClose(page, grid.getByRole("button", { name: `More about ${ava.name}` }), ava.name, "Close");
  await expect(grid.getByRole("button", { name: /^Less about/ })).toHaveCount(0);
});

// G3 (dcm-bxp.132): every hand card, and every vault card, has one height whatever its name and text length; the footer
// sits at the bottom of each face. At level 4 the Bard holds Book of Ava (a long grimoire text), Inspirational Words (a
// long name) and Troublemaker (a short text); the vault holds Deft Deceiver (the shortest text) and Book of Vagras (the
// longest).
test("sheet cards: every hand card and every vault card share one height", async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 4, idempotencyKey: crypto.randomUUID() });
  for (const cardId of ["inspirational-words", "troublemaker", "book-of-vagras"]) await client.mutation(api.characters.takeCard, { characterId, cardId });
  for (const cardId of ["deft-deceiver", "book-of-vagras"]) await client.mutation(api.characters.moveCard, { characterId, cardId, to: "vault" });
  await openTab(page, "Domains");
  const hand = sheet.getByRole("list", { name: "Loadout cards" });
  const vault = sheet.getByRole("list", { name: "Vault cards" });
  await expect(hand.getByRole("article")).toHaveCount(3);
  await expect(vault.getByRole("article")).toHaveCount(2);

  /** Each face's layout height and the gap under its footer (layout offsets, which the fan's rotation does not skew). */
  const measure = (list: Locator) =>
    list.locator("article.dk-face").evaluateAll((faces) =>
      faces.map((el) => {
        const face = el as HTMLElement;
        const footer = face.querySelector<HTMLElement>("footer")!;
        return { name: face.getAttribute("aria-label"), height: face.offsetHeight, gap: face.offsetHeight - (footer.offsetTop + footer.offsetHeight) };
      }),
    );

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalScroll(page);
    for (const [where, list] of [
      ["hand", hand],
      ["vault", vault],
    ] as const) {
      const faces = await measure(list);
      const heights = faces.map((f) => f.height);
      expect(Math.max(...heights) - Math.min(...heights), `${where} at ${viewport.width}: ${JSON.stringify(faces)}`).toBeLessThanOrEqual(1);
      for (const f of faces) expect(f.gap, `${where} ${f.name} footer at ${viewport.width}`).toBeLessThanOrEqual(1);
    }
  }
});
