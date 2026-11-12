// Plan portrait-frame, PZ2 (user 2026-11-12: the saved close-up shows everywhere a character's portrait is drawn): a
// frame set through the API shows on the dashboard's Party card and on the character's map token; a character without
// one draws as before (no transform).

import { expect, test, type Locator } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { bardDraft, openCombatMap } from "./visual/helpers";

test.describe.configure({ timeout: 90_000 });

const FRAME = { zoom: 2, x: 40, y: 25 };

/** The picture's inline transform and position (a background layer or an `<img>`), as the style helper wrote them. */
const framing = (picture: Locator) =>
  picture.evaluate((el: HTMLElement) => ({
    transform: el.style.transform,
    origin: el.style.transformOrigin,
    position: el.tagName === "IMG" ? el.style.objectPosition : el.style.backgroundPosition,
  }));

test("a saved close-up shows on the Party card and on the map token", async ({ page }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Corwin"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.setPortraitFrame, { characterId, frame: FRAME });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });

  // The dashboard's Party card: Liriel's portrait draws the close-up on its inner layer; Corwin's has none.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/campaigns/${campaignId}`);
  const card = (name: string) => page.locator("article").filter({ has: page.getByText(name, { exact: true }) });
  const layer = card("Liriel").getByTestId("character-portrait-layer");
  await expect(layer).toBeAttached();
  expect(await framing(layer)).toEqual({ transform: "scale(2)", origin: "40% 25%", position: "40% 25%" });
  await expect(card("Corwin")).toBeVisible();
  await expect(card("Corwin").getByTestId("character-portrait-layer")).toHaveCount(0);

  // The map: Liriel's token picture is scaled about the focal point; the token itself is not.
  await page.goto(url);
  const token = page.locator("[data-testid='combat-token']").filter({ hasText: "Liriel" }).first();
  await expect(token).toBeVisible();
  const picture = token.locator("img.tk-img, [data-testid='combat-token-picture'] > span").first();
  await expect(picture).toBeAttached();
  expect(await framing(picture)).toEqual({ transform: "scale(2)", origin: "40% 25%", position: "40% 25%" });
  expect(await token.evaluate((el: HTMLElement) => el.style.transform)).toBe("");
  const plain = page.locator("[data-testid='combat-token']").filter({ hasText: "Corwin" }).first();
  const plainPicture = plain.locator("img.tk-img").first();
  if ((await plainPicture.count()) > 0) expect((await framing(plainPicture)).transform).toBe("");
});
