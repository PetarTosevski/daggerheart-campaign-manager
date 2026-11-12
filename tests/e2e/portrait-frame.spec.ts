// Plan portrait-frame, PZ1 (user 2026-11-12: "let me zoom in if i want a close up shot of my character on the
// portrait"): the owner adjusts the sheet's portrait arch (zoom + drag), saves, and the close-up survives a reload; a
// player who does not own a character sees its close-up but no Adjust button. Tablet size, so the touch targets and axe
// run as the D12 bar asks (tests/e2e/a11y.ts).

import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { gmAndPlayer } from "./live";
import { bardDraft } from "./visual/helpers";

test.describe.configure({ timeout: 90_000 });

/** The arch's picture layer (the clipped inner layer that carries the close-up). */
const archLayer = (page: Page, name: string) => page.getByRole("img", { name: `Portrait of ${name}` });

/** The layer's inline transform and background position, as the style helper wrote them. */
const framing = (layer: Locator) => layer.evaluate((el: HTMLElement) => ({ transform: el.style.transform, position: el.style.backgroundPosition, origin: el.style.transformOrigin }));

test("the owner zooms and drags the portrait, saves, and the close-up stays after a reload", async ({ browser }) => {
  const { player, client, playerClient, campaignId, characterId, characterName: hero, close } = await gmAndPlayer(browser);
  try {
    await player.setViewportSize({ width: 1024, height: 768 });
    await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
    await expect(player.getByRole("heading", { level: 1, name: hero })).toBeVisible();
    const arch = archLayer(player, hero);
    await expect(arch).toBeVisible();
    // No frame yet: today's framing, no transform.
    expect((await framing(arch)).transform).toBe("");

    // Focus shows the arch's action overlay (as hover does).
    const adjust = player.getByRole("button", { name: `Adjust the portrait of ${hero}` });
    await adjust.focus();
    await expectTouchTargets(adjust);
    await adjust.click();
    const dialog = player.getByRole("dialog", { name: "Adjust portrait" });
    await expect(dialog).toBeVisible();
    await expectTouchTargets(dialog.getByRole("button"));
    await expectNoSeriousA11yViolations(player);

    // Zoom with the slider, then one step with the keyboard.
    const zoom = dialog.getByRole("slider", { name: "Zoom" });
    await zoom.fill("2");
    await zoom.press("ArrowRight");
    await expect(dialog.getByText("2.05x")).toBeVisible();

    // Drag the picture up and to the right.
    const preview = dialog.getByRole("button", { name: `Move the picture of ${hero}` });
    const previewLayer = preview.getByTestId("portrait-layer");
    const before = await framing(previewLayer);
    const box = (await preview.boundingBox())!;
    await player.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await player.mouse.down();
    await player.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20, { steps: 5 });
    await player.mouse.up();
    const dragged = await framing(previewLayer);
    expect(dragged.position).not.toBe(before.position);
    // Arrow keys move it too.
    await preview.press("ArrowLeft");
    const edited = await framing(previewLayer);
    expect(edited.position).not.toBe(dragged.position);
    expect(edited.transform).toBe("scale(2.05)");

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await framing(arch)).transform).toBe("scale(2.05)");
    expect((await framing(arch)).position).toBe(edited.position);

    const saved = (await playerClient.query(api.charactersReads.get, { characterId }))!.sheet.portraitFrame!;
    expect(saved.zoom).toBe(2.05);

    await player.reload();
    await expect(player.getByRole("heading", { level: 1, name: hero })).toBeVisible();
    const after = await framing(archLayer(player, hero));
    expect(after).toEqual({ transform: "scale(2.05)", position: `${saved.x}% ${saved.y}%`, origin: `${saved.x}% ${saved.y}%` });
    expect(after.position).toBe(edited.position);

    // A player who does not own a character sees its close-up and no Adjust button.
    const other = "Corwin";
    const { characterId: gmCharacter } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft(other), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.characters.setPortraitFrame, { characterId: gmCharacter, frame: { zoom: 1.5, x: 30, y: 20 } });
    await player.goto(`/campaigns/${campaignId}/party/${gmCharacter}`);
    await expect(player.getByRole("heading", { level: 1, name: other })).toBeVisible();
    const theirs = archLayer(player, other);
    await expect(theirs).toBeVisible();
    expect(await framing(theirs)).toEqual({ transform: "scale(1.5)", position: "30% 20%", origin: "30% 20%" });
    await expect(player.getByRole("button", { name: `Adjust the portrait of ${other}` })).toHaveCount(0);
  } finally {
    await close();
  }
});
