import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoHorizontalScroll, openSheet, visual } from "./helpers";

// GL5: in the guided level-up the traits option can be taken twice in one level (four different traits, a chooser
// per pick), and ticking the upgraded subclass card shows that card as the Heritage & Subclass tab's hero card.
// Shot at 1440 and 390 on a level-4 Bard levelling to 5 (tier 3 opens). Board counterpart: the tier boxes and the
// hero cards (.hc-card) of Party.dc.html.

/** Tickable boxes and chooser buttons under 44 px at 390, and no sideways scroll. */
async function expectPhoneTargets(page: Page, tiers: Locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const small = await tiers.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("label.adv-hit, .adv-picker button"))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width < 43.5 || r.height < 43.5).length,
  );
  expect(small).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("GL5 traits twice in one level and the upgraded subclass card at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  const { shoot } = visual(page, "GL5");
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 4, idempotencyKey: crypto.randomUUID() });

  await sheet.getByRole("button", { name: "Level up to 5" }).click();
  const ribbon = sheet.getByRole("region", { name: "Level-up to 5" });
  await ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("button", { name: /Advancements/ }).click();
  const tiers = sheet.locator("#lu-target-advancements");
  await expect(tiers.getByRole("heading", { name: "Level Up" })).toBeFocused();
  const tier3 = tiers.getByRole("region", { name: "Tier 3" });

  // Traits twice: each pick gets its own chooser; a trait raised by one pick is disabled in the other.
  await tier3.getByRole("checkbox", { name: "Tier 3: +1 to two unmarked traits for level 5", exact: true }).check();
  await tier3.getByRole("checkbox", { name: "Tier 3: +1 to two unmarked traits for level 5 (second pick)", exact: true }).check();
  const first = tier3.getByRole("group", { name: "Traits to raise for level 5", exact: true });
  const second = tier3.getByRole("group", { name: "Traits to raise for level 5 (second pick)" });
  await first.getByRole("button", { name: /Presence/ }).click();
  await first.getByRole("button", { name: /Knowledge/ }).click();
  await expect(second.getByRole("button", { name: /Presence/ })).toBeDisabled();
  await second.getByRole("button", { name: /Agility/ }).click();
  await second.getByRole("button", { name: /Finesse/ }).click();
  // Completing both picks jumps to the Domain Deck; come back to the tier boxes.
  await ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("button", { name: /Advancements/ }).click();
  await expect(tiers.getByText("Level 5: 2 / 2 picks")).toBeVisible();
  await expect(ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("listitem").filter({ hasText: "Advancements (2/2)" })).toHaveAttribute("data-done", "true");
  await shoot(tier3, "traits-twice");
  await expectPhoneTargets(page, tiers);

  // The upgraded subclass card: the Troubadour's specialization as a hero card under the ticked option.
  await tier3.getByRole("checkbox", { name: "Tier 3: +1 to two unmarked traits for level 5 (second pick)", exact: true }).uncheck();
  await tier3.getByRole("checkbox", { name: "Tier 3: Upgraded subclass card for level 5", exact: true }).click();
  // Completing both picks jumps to the Domain Deck; come back to the tier boxes.
  await ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("button", { name: /Advancements/ }).click();
  const card = tier3.getByRole("article", { name: "Subclass: Troubadour Specialization" });
  await expect(card.getByRole("heading", { name: "Troubadour" })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await shoot(card.locator("xpath=ancestor::li[1]"), "subclass-card");
  await expectPhoneTargets(page, tiers);

  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(tier3.getByRole("article")).toHaveCount(0);
});
