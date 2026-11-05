import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { expectNoSeriousA11yViolations } from "./a11y";
import { HUD_MAP_W, hudScene } from "./hud/helpers";

// Plan combat-hud H3.3 (docs/tasks/TASK-HUD-H3.3.md; CmpPicking 'Area · pick a square'): with the HUD on, a feature's Use
// on the sheet panel runs through the HUD's picking. The GM plays for Vex (a Nightwalker, levelled to the specialization:
// Dark Cloud, CB p.42 "a temporary dark cloud that covers any area within Close range"): Use opens square picking (the
// banner "Pick the centre of Dark Cloud within Close · Esc cancels", the crosshair with the radius); Esc cancels; the
// keyboard places it (arrows + Enter, Enter again confirms); a click lands on the square under the pointer while the map
// is shifted for the open sheet (H2.2). Shadow Stepper (CB p.42, a Stress and a situation to confirm) opens the picking
// panel: its primary waits for the situation switch, then the use goes out and Vex marks the Stress.

/** Levels 2-5 with the upgraded subclass (the specialization) at level 5 (CB p.42 Nightwalker), as area-overlay.spec.ts. */
const TO_SPECIALIZATION = [
  { picks: [{ option: "traits" as const, tier: 2, targets: ["agility", "finesse"] }, { option: "hp" as const, tier: 2 }], experienceName: "Night Runs" },
  { picks: [{ option: "stress" as const, tier: 2 }, { option: "evasion" as const, tier: 2 }] },
  { picks: [{ option: "traits" as const, tier: 2, targets: ["strength", "instinct"] }, { option: "hp" as const, tier: 2 }] },
  { picks: [{ option: "subclass" as const, tier: 3 }, { option: "hp" as const, tier: 3 }], experienceName: "Shadow Steps" },
];

async function levelRogue(gm: ConvexHttpClient, characterId: Id<"characters">) {
  const cards = cardsForDomains(getClass("rogue")!.domains, TO_SPECIALIZATION.length + 1);
  const owned = new Set((await gm.query(api.charactersReads.get, { characterId }))!.sheet.domainCards.owned);
  for (const [i, level] of TO_SPECIALIZATION.entries()) {
    const card = cards.find((c) => c.level <= i + 2 && !owned.has(c.id))!;
    owned.add(card.id);
    await gm.mutation(api.levelUp.apply, { characterId, choice: { ...level, cardId: card.id }, idempotencyKey: crypto.randomUUID() });
  }
}

const partyBanner = (page: Page, name: string) => page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${name}'s sheet` });

/** Dark Cloud's Use: straight to the square, or (a rider on its roll) through the panel's "Pick the square". */
async function useDarkCloud(page: Page) {
  await page.getByRole("complementary", { name: "Vex’s sheet" }).getByRole("button", { name: /^Use Dark Cloud/ }).click();
  const panel = page.getByRole("dialog", { name: "Dark Cloud" });
  const bar = page.getByTestId("hud-area-bar");
  await expect(panel.or(bar)).toBeVisible();
  if (await panel.isVisible()) await panel.getByRole("button", { name: "Pick the square" }).click();
  await expect(bar).toBeVisible();
}

test("the GM plays for Vex: Dark Cloud by keyboard and by pointer on a shifted map, Esc cancels; Shadow Stepper through the panel", async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId, mapId } = s;
  const vex = s.pcs.find((p) => p.name === "Vex")!;
  try {
    await levelRogue(client, vex.characterId);
    expect((await client.query(api.charactersReads.get, { characterId: vex.characterId }))!.sheet).toMatchObject({ level: 5, subclassRank: "specialization" });
    const vexToken = (await client.query(api.combatTokensReads.list, { campaignId, mapId })).find((t) => t._id === vex.tokenId)!;
    const areas = async () => (await client.query(api.combatAreas.list, { campaignId, mapId })).filter((a) => a.label === "Dark Cloud");

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await partyBanner(gm, "Vex").click();
    const sheet = gm.getByRole("complementary", { name: "Vex’s sheet" });
    await expect(sheet.getByTestId("hud-sheet-trackers")).toBeVisible();
    await sheet.getByRole("switch", { name: "Play for this character" }).click();
    await expect(sheet.getByRole("switch", { name: "Play for this character" })).toHaveAttribute("aria-checked", "true");

    // ---- Area: the banner and the radius; Esc cancels.
    await useDarkCloud(gm);
    const bar = gm.getByTestId("hud-area-bar");
    await expect(bar.getByTestId("hud-area-banner")).toContainText("Pick the centre of Dark Cloud within Close");
    await expect(bar.getByTestId("hud-area-progress")).toHaveText("Esc cancels");
    await expect(bar.getByTestId("hud-area-summary")).toHaveText("Radius: Close (6 squares)");
    await expect(bar.getByRole("button", { name: "Place Dark Cloud here" })).toBeDisabled();
    await expectNoSeriousA11yViolations(gm);
    await gm.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);

    // ---- Keyboard: the crosshair starts on Vex; two squares right, Enter places, Enter confirms.
    await useDarkCloud(gm);
    await expect(bar.getByTestId("hud-area-banner")).toBeFocused();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowRight"]) await gm.keyboard.press(key);
    await expect(gm.getByTestId("hud-area-aim")).toHaveAttribute("data-x", String(vexToken.x + 2));
    await gm.keyboard.press("Enter");
    await expect(gm.getByTestId("hud-area-point")).toHaveAttribute("data-x", String(vexToken.x + 2));
    await gm.keyboard.press("Enter");
    await expect(gm.getByTestId("hud-area-line")).toHaveText(/Dark Cloud (is on the map|failed)/);
    if (/is on the map/.test((await gm.getByTestId("hud-area-line").textContent()) ?? "")) {
      await expect.poll(async () => (await areas()).map((a) => a.centre)).toContainEqual({ kind: "square", x: vexToken.x + 2, y: vexToken.y });
    }

    // ---- Pointer, with the map shifted and scaled for the open sheet (H2.2): the click lands on the square under it.
    await useDarkCloud(gm);
    const layer = gm.getByTestId("hud-area-layer");
    const box = (await layer.boundingBox())!;
    const square = box.width / HUD_MAP_W;
    const target = { x: vexToken.x + 1, y: vexToken.y + 2 };
    await gm.mouse.move(box.x + (target.x + 0.5) * square, box.y + (target.y + 0.5) * square);
    await expect(gm.getByTestId("hud-area-aim")).toHaveAttribute("data-x", String(target.x));
    await gm.mouse.click(box.x + (target.x + 0.5) * square, box.y + (target.y + 0.5) * square);
    await expect(gm.getByTestId("hud-area-point")).toHaveAttribute("data-x", String(target.x));
    await expect(gm.getByTestId("hud-area-point")).toHaveAttribute("data-y", String(target.y));
    await bar.getByRole("button", { name: "Place Dark Cloud here" }).click();
    await expect(gm.getByTestId("hud-area-line")).toHaveText(/Dark Cloud (is on the map|failed)/);
    if (/is on the map/.test((await gm.getByTestId("hud-area-line").textContent()) ?? "")) {
      await expect.poll(async () => (await areas()).map((a) => a.centre)).toContainEqual({ kind: "square", x: target.x, y: target.y });
    }

    // ---- Shadow Stepper: the picking panel; the primary waits for the situation; then Vex marks a Stress.
    const stressBefore = (await client.query(api.charactersReads.get, { characterId: vex.characterId }))!.sheet.stress;
    await sheet.getByRole("button", { name: /^Use Shadow Stepper/ }).click();
    const panel = gm.getByRole("dialog", { name: "Shadow Stepper" });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("hud-pick-rule")).toHaveText("On yourself");
    await expect(panel.getByTestId("hud-pick-pay")).toHaveText("Marks 1 Stress");
    const go = panel.getByTestId("hud-pick-go");
    await expect(go).toBeDisabled();
    await expect(panel.getByTestId("hud-pick-why")).toContainText("Confirm:");
    await expectNoSeriousA11yViolations(gm);
    await panel.getByRole("switch", { name: /shadow/i }).click();
    await expect(go).toBeEnabled();
    await go.click();
    await expect(panel).toHaveCount(0);
    // dcm-bxp.99.32.26: a feature use's result shows in the result panel (not the square-picking bar).
    const result = gm.getByTestId("hud-result");
    await expect(result).toHaveAttribute("data-kind", "feature");
    await expect(result).toContainText("Shadow Stepper");
    await expect(gm.getByTestId("hud-area-line").filter({ hasText: "Shadow Stepper" })).toHaveCount(0);
    await expect.poll(async () => (await client.query(api.charactersReads.get, { characterId: vex.characterId }))!.sheet.stress).toBe(stressBefore + 1);
  } finally {
    await s.close();
  }
});
