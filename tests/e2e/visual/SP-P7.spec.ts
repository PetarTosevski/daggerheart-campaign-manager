import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the P7 task doc (E2E_VISUAL=1): the Scene card with the Setting picker before a map, after a Let Claude
// choose generation ("chose: …") and with Tavern picked on a Sprites map. There is no board for sprites; the
// counterpart is the C4 Scene card (tests/e2e/visual/C4.spec.ts). The e2e backend has no ANTHROPIC_API_KEY, so
// every layout is the keyword fallback.

test("SP-P7 Scene card Setting picker at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const scene = tools.getByRole("region", { name: "Scene" });
  const setting = scene.getByLabel("Setting");
  const { shoot } = visual(page, "SP-P7", D9_VIEWPORTS);

  await expect(setting).toHaveValue("");
  await shoot(scene, "scene-empty");

  await scene.getByLabel("Describe the battlefield").fill("a frozen lake ambush");
  await scene.getByRole("button", { name: "✦ Generate map" }).click();
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await expect(setting.locator("option[value='']")).toHaveText("Let Claude choose (chose: Snow and tundra)");
  await shoot(scene, "scene-claude-chose");

  const mapId = (await client.query(api.combatMaps.list, { campaignId }))[0]!._id as Id<"combatMaps">;
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await setting.selectOption({ label: "Tavern" });
  await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.settingPicked).toBe(true);
  await scene.getByRole("button", { name: "✦ Regenerate map" }).click();
  await expect(scene.getByText(/^Drawn from keywords in your description\./)).toBeVisible();
  await expect(setting).toHaveValue("b:tavern");
  await shoot(scene, "scene-tavern");
  await shoot(page.locator(".cm-root"), "gm-edit-tavern");
});
