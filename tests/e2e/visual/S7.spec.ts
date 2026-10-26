import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { cardsForDomains, getClass } from "../../../src/lib/srd/index";
import { expectNoHorizontalScroll, openSheet, VIEWPORTS, visual, type Draft } from "./helpers";

// S7: class extras (Beastform / Companion launchers and their parchment overlay sheets) and the frame extras
// (Motherboard, Beast Feast) at 1440 and 390. The board has no Druid or Beastbound seed and no region for its
// overlays in scripts/board-shots.mjs, so the last test shoots the board's csBeast and csComp overlays itself
// into test-results/visual/board/.

const BOARD = pathToFileURL(join(process.cwd(), "reference/designs/project/Party.dc.html")).href;

/** A level-1 character of `classId` with its first two level-1 domain cards. */
function classDraft(name: string, classId: string, subclassId: string): Partial<Draft> {
  const cls = getClass(classId)!;
  return {
    name,
    classId,
    subclassId,
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

/** Screenshots an open dialog whole: the viewport grows to the dialog's scroll height, then is restored. */
async function shootDialog(page: Page, dialog: Locator, path: string) {
  const viewport = page.viewportSize()!;
  const height = await dialog.evaluate((d) => d.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.min(height + 64, 16000) });
  await dialog.screenshot({ path, animations: "disabled" });
  await page.setViewportSize(viewport);
}

/** For each viewport: open the sheet overlay from its launcher, check it, shoot it, close it. */
async function shootOverlay(page: Page, launch: string, name: string, file: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: launch, exact: true }).click();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    if (viewport.width < 640) await expectNoHorizontalScroll(page);
    await shootDialog(page, dialog, `test-results/visual/S7/${file}-${viewport.width}.png`);
    await dialog.getByRole("button", { name: `Close ${name.toLowerCase()}` }).click();
    await expect(dialog).toBeHidden();
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("S7 Druid Beastform launcher and sheet", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page, { draft: classDraft("Thorn", "druid", "warden-of-the-elements") });
  const extras = sheet.getByTestId("class-extras");
  await visual(page, "S7").shoot(extras, "beast-launcher");
  await shootOverlay(page, "Beastform", "Druid Beastform", "beast-sheet");

  // Choose a Tier 1 form, transform, and drop out again; Tier 2 forms are locked at level 1.
  await page.getByRole("button", { name: "Beastform", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Druid Beastform" });
  await expect(dialog.getByRole("region", { name: "Tier 2 (Level 2–4)" }).getByText("Unlocks at a higher tier")).toBeVisible();
  await dialog.getByRole("button", { name: "Choose Agile Scout" }).click();
  await expect(dialog.getByRole("button", { name: "Choose Agile Scout" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Transform" }).click();
  await expect(dialog.getByTestId("active-beastform")).toContainText("Agile Scout");
  await dialog.getByRole("button", { name: "Drop beastform" }).click();
  await expect(dialog.getByText("Not transformed.")).toBeVisible();
});

test("S7 Ranger Companion launcher and sheet", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page, { draft: classDraft("Wren", "ranger", "beastbound") });
  await visual(page, "S7").shoot(sheet.getByTestId("class-extras"), "comp-launcher");
  await shootOverlay(page, "Companion", "Ranger Companion", "comp-sheet");

  // Stress diamonds save at once.
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ranger Companion" });
  await dialog.getByRole("button", { name: "Companion Stress 2 of 3" }).click();
  await expect(dialog.getByRole("group", { name: "Companion Stress: 2 of 3 marked" })).toBeVisible();
});

test("S7 Motherboard frame extras", { tag: "@visual" }, async ({ page }) => {
  const warrior = getClass("warrior")!;
  const { sheet } = await openSheet(page, {
    frame: "motherboard",
    draft: {
      name: "Vex",
      classId: "warrior",
      subclassId: "call-of-the-brave",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      primaryWeaponId: "",
      domainCards: cardsForDomains(warrior.domains, 1)
        .filter((c) => c.level === 1)
        .slice(0, 2)
        .map((c) => c.id),
    },
    extra: { ikonis: { name: "Spark rod", description: "", trait: "strength", range: "Melee", damageType: "physical" } },
  });
  const box = sheet.getByRole("region", { name: "Ikonis Module" });
  await expect(box.getByTestId("ikonis-augments")).toHaveText(/Installed augments: Force/);
  await expect(box.getByTestId("ikonis-damage")).toContainText("Melee");
  await visual(page, "S7").shoot(sheet.getByTestId("character-extras"), "motherboard");
});

test("S7 Beast Feast frame extras", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page, { frame: "beast-feast" });
  const box = sheet.getByRole("region", { name: "Ingredients & Cookbook" });
  await box.getByLabel("Ingredient name").fill("Mushroom caps");
  await box.getByRole("button", { name: "Add ingredient" }).click();
  await expect(box.getByRole("region", { name: "Ingredients" }).getByText("Mushroom caps")).toBeVisible();
  await visual(page, "S7").shoot(sheet.getByTestId("character-extras"), "beast-feast");
});

// The board's overlays: its Test Bard becomes a Druid (class index 1) or a Beastbound Ranger (index 3).
for (const { cls, clsName, subclass, launch, label, file } of [
  { cls: 1, clsName: "Druid", subclass: "Warden of the Elements", launch: "Beastform", label: "Druid Beastform", file: "csBeast" },
  { cls: 3, clsName: "Ranger", subclass: "Beastbound", launch: "Companion", label: "Ranger Companion", file: "csComp" },
]) {
  test(`S7 board overlay ${file}`, { tag: "@visual" }, async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(BOARD);
      await page.waitForLoadState("networkidle");
      await page.evaluate(
        ({ cls, clsName, subclass }) => {
          const key = "dh.witherwild.party";
          const list = JSON.parse(localStorage.getItem(key) || "[]");
          list[0] = { ...list[0], cls, clsName, f: { ...list[0].f, subclass } };
          localStorage.setItem(key, JSON.stringify(list));
        },
        { cls, clsName, subclass },
      );
      await page.reload();
      await page.getByRole("button", { name: "Open character sheet" }).first().click();
      await page.getByRole("button", { name: launch, exact: true }).click();
      const dialog = page.locator(`[role="dialog"][aria-label="${label}"]`);
      await expect(dialog).toBeVisible();
      const height = await dialog.evaluate((d) => d.parentElement!.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height: Math.min(height + 60, 16000) });
      await dialog.screenshot({ path: `test-results/visual/board/${file}-${viewport.width}.png`, animations: "disabled" });
    }
  });
}
