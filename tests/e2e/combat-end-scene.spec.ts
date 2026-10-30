import { expect, test } from "@playwright/test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { convexAs, openCombatMap } from "./visual/helpers";

// Plan drawer-answers DA4 (SD8 follow-up): the GM column of the Combat Map holds the End scene button
// (`combatScenes.end`). CB p.107, End of the Scene: "Sometimes certain effects, bonuses, or conditions state that they
// last until the end of the scene." A gnome's Flicker Step (HF p.25: "Once per scene, you can teleport to another point
// you can see within Far range") is spent, refused a second time, and comes back once the GM ends the scene on the map.

const PLAYER = "e2e-player@example.test";

/** A level-1 gnome Bard (Hope & Fear ancestry): Flicker Step, once per scene. */
function gnomeDraft(name: string) {
  const cls = getClass("bard")!;
  return {
    classId: cls.id,
    subclassId: "troubadour",
    ancestry: { kind: "single" as const, id: "gnome" },
    communityId: "loreborne",
    traits: { agility: 1, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 0 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Wanderer", "Tinkerer"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

const errorCode = (e: unknown) => (e instanceof ConvexError ? (e.data as { code?: string }).code : undefined);

test("the GM ends the scene from the Combat Map and a once-per-scene limit comes back", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { client: gm, campaignId, url } = await openCombatMap(page);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await context.newPage();
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const client = await convexAs(player);
    await client.mutation(api.members.joinByCode, { code });
    const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: gnomeDraft("Pip"), idempotencyKey: crypto.randomUUID() });
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });

    const flicker = () =>
      client.mutation(api.combatFeatures.useFeature, {
        campaignId,
        characterId,
        mapId,
        featureId: "ancestry:gnome:flicker-step",
        targetTokenIds: [],
        choices: [],
        idempotencyKey: crypto.randomUUID(),
      });
    const sceneLimits = async () => (await gm.query(api.characters.get, { characterId }))!.sheet.featureUses?.map((u) => u.key) ?? [];

    // ---- Flicker Step once; a second use in the same scene is refused.
    await flicker();
    expect(await sceneLimits()).toEqual(["feat:ancestry:gnome:flicker-step"]);
    expect(await flicker().then(() => "ok", errorCode)).toBe("FEATURE_EXHAUSTED");

    // ---- The GM ends the scene from the map's GM column, after a confirmation.
    await page.goto(url);
    await expect(page.getByRole("region", { name: "Resolutions" })).toBeVisible({ timeout: 30_000 });
    const scene = page.getByRole("region", { name: "Scene", exact: true });
    const endScene = scene.getByRole("button", { name: "End scene" });
    await expect(endScene).toBeVisible();
    await expectTouchTargets(endScene);
    await endScene.click();
    const confirm = page.getByRole("dialog", { name: "End the scene?" });
    await confirm.getByRole("button", { name: "End scene" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(scene.getByTestId("end-scene-status")).toHaveText("Scene ended: 1 scene effect and limit ended.");

    // ---- The limit is back: Flicker Step works again.
    await expect.poll(sceneLimits).toEqual([]);
    await flicker();
    expect(await sceneLimits()).toEqual(["feat:ancestry:gnome:flicker-step"]);
  } finally {
    await context.close();
  }
});
