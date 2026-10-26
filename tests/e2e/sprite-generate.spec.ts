import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Sprite packs P7 (.omc/plans/sprite-packs.yaml): the Scene card's Setting picker. The e2e backend has no
// ANTHROPIC_API_KEY, so "Let Claude choose" resolves with the keyword picker and every layout is the keyword
// fallback, mapped to the setting on a Sprites map. The Sprites painter (P6) and the style switch are other tracers,
// so the map is switched to Sprites through the API and the sprites are checked on the server's map rows.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** The built-in folders of a map's sprite and texture refs (`tavern/keg` -> `tavern`). */
function folders(map: { objects: { sprite?: { builtin: string } | { uploaded: string } }[]; areas: { texture?: { builtin: string } | { uploaded: string } }[] }) {
  const refs = [...map.objects.map((o) => o.sprite), ...map.areas.map((a) => a.texture)];
  return [...new Set(refs.flatMap((r) => (r && "builtin" in r ? [r.builtin.split("/")[0]!] : [])))].sort();
}

async function sceneCard(page: Page) {
  const tools = page.getByRole("complementary", { name: "Map tools" });
  return { tools, scene: tools.getByRole("region", { name: "Scene" }), maps: tools.getByRole("list", { name: "Campaign maps" }) };
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test("the GM picks Tavern and generates a Sprites map with tavern sprites", async ({ page }) => {
      const { client, campaignId } = await openCombatMap(page);
      const { tools, scene, maps } = await sceneCard(page);
      const setting = scene.getByLabel("Setting");

      // Default: Let Claude choose; the settings are listed by label, then nothing else (no packs yet).
      await expect(setting).toHaveValue("");
      await expect(setting.locator("option", { hasText: "Let Claude choose" })).toHaveText("Let Claude choose");
      await expect(setting.locator("option", { hasText: "Mushroom cavern (Underdark)" })).toHaveCount(1);

      // A first map from a description (Classic, as every new map, Q4).
      await scene.getByLabel("Describe the battlefield").fill("A brawl breaks out at night");
      await scene.getByRole("button", { name: "✦ Generate map" }).click();
      await expect(maps.getByRole("listitem")).toHaveCount(1);
      await expect(maps.getByRole("listitem")).toContainText("Generated");
      const list = await client.query(api.combatMaps.list, { campaignId });
      const mapId = list[0]!._id as Id<"combatMaps">;
      await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });

      // Pick Tavern: saved at once (optimistic), and kept on the server.
      await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
      await setting.selectOption({ label: "Tavern" });
      await expect(setting).toHaveValue("b:tavern");
      await expect
        .poll(async () => {
          const map = await client.query(api.combatMaps.get, { campaignId, mapId });
          return map && { setting: map.setting, picked: map.settingPicked };
        })
        .toEqual({ setting: { builtin: "tavern" }, picked: true });

      // Regenerate: the keyword fallback, mapped to the tavern's sprites and textures.
      await scene.getByRole("button", { name: "✦ Regenerate map" }).click();
      await expect(scene.getByText(/^Drawn from keywords in your description\./)).toBeVisible();
      await expect(setting).toHaveValue("b:tavern");
      await expect
        .poll(async () => {
          const map = await client.query(api.combatMaps.get, { campaignId, mapId });
          return map ? { style: map.style, setting: map.setting, picked: map.settingPicked, folders: folders(map) } : null;
        })
        .toMatchObject({ style: "sprites", setting: { builtin: "tavern" }, picked: true, folders: expect.arrayContaining(["tavern"]) });
      const map = (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
      expect(folders(map).every((f) => f === "tavern" || f === "common")).toBe(true);
      expect(map.objects.some((o) => o.kind === "tree")).toBe(false);
      await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
      if (viewport.width < 640) await expectNoHorizontalScroll(page);

      // Back to Let Claude choose: saved as not picked.
      await setting.selectOption({ value: "" });
      await expect(setting).toHaveValue("");
      await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.settingPicked).toBe(false);
    });

    test("Let Claude choose on 'a frozen lake ambush' resolves to Snow and tundra", async ({ page }) => {
      const { client, campaignId } = await openCombatMap(page);
      const { tools, scene, maps } = await sceneCard(page);
      const setting = scene.getByLabel("Setting");

      await scene.getByLabel("Describe the battlefield").fill("a frozen lake ambush");
      await scene.getByRole("button", { name: "✦ Generate map" }).click();
      await expect(maps.getByRole("listitem")).toHaveCount(1);
      await expect(maps.getByRole("listitem")).toContainText("Generated");
      await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
      await expect(setting).toHaveValue("");
      await expect(setting.locator("option[value='']")).toHaveText("Let Claude choose (chose: Snow and tundra)");

      const mapId = (await client.query(api.combatMaps.list, { campaignId }))[0]!._id as Id<"combatMaps">;
      const map = (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
      expect(map).toMatchObject({ setting: { builtin: "snow-and-tundra" }, settingPicked: false });
      if (viewport.width < 640) await expectNoHorizontalScroll(page);
    });
  });
}
