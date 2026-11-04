import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { fromSrd, validateCustom } from "../../../src/lib/adversaries/custom";
import { ADVERSARIES } from "../../../src/lib/srd/adversaries";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";

// Shots for docs/tasks/TASK-GLASS-G8.md (E2E_VISUAL=1): the Adversaries page's buttons as glass buttons, those on the
// parchment stat blocks and the custom editor as ink buttons (bead dcm-jrju) (plan
// .omc/plans/glass-buttons.yaml, G8): the Catalogue (filter chips, stat block actions, custom adversaries), the
// Encounters builder (list, detail, Battle Points steppers, add dialog), the custom editor and the Environment tab
// (Fear and feature actions), as the GM at 1440 x 900, 1024 x 768 and 390 x 844, and the player's GM-only panel; a
// hovered confirm and a keyboard-focused button pass axe; every glass button is at least 44 px on touch widths.

const OUT = "test-results/visual/GLASS-G8";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage });
}

async function expectRole(button: Locator, role: string) {
  await expect(button).toHaveClass(new RegExp(`\\bgb-${role}\\b`));
}

/** Bead dcm-jrju: buttons on the parchment (stat blocks, the custom editor) are ink: "main" filled, "danger" wine. */
async function expectInk(button: Locator, tone?: "main" | "danger") {
  await expect(button).toHaveClass(tone ? new RegExp(`\\binkb\\b.*\\binkb-${tone}\\b`) : /\binkb\b/);
  await expect(button).not.toHaveClass(/\bgb\b/);
}

/** On tablet and phone widths, every visible glass or ink button inside `scope` is at least 44 px tall (and icons wide). */
async function expectTouchTargets(scope: Locator) {
  const small = await scope.locator(".gb, .inkb").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", ...el.getBoundingClientRect().toJSON() }))
      .filter((r: { width: number; height: number }) => r.height < 43.5 || r.width < 43.5),
  );
  expect(small).toEqual([]);
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

async function openTab(page: Page, name: "Catalogue" | "Encounters" | "Environment") {
  const tab = page.getByRole("tablist", { name: "Adversary views" }).getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test("GLASS-G8 the Adversaries page: catalogue, custom adversaries, encounters and environments", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, client } = table;
  try {
    // A custom adversary and an encounter with three rows (one Minion group).
    const bear = validateCustom(fromSrd(ADVERSARIES.find((a) => a.id === "bear")!));
    await client.mutation(api.customAdversaries.create, {
      campaignId,
      adversary: { ...bear, name: "Cave Bear", hp: 9, motives: "Guard the cave, maul intruders" },
      basedOn: "bear",
      idempotencyKey: crypto.randomUUID(),
    });
    const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Ambush at the ford", pcs: 4, idempotencyKey: crypto.randomUUID() });
    for (const [adversaryId, count] of [
      ["bear", 1],
      ["jagged-knife-lackey", 4],
      ["jagged-knife-bandit", 1],
    ] as const) {
      await client.mutation(api.encounters.addAdversary, {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        count,
        summoned: false,
        idempotencyKey: crypto.randomUUID(),
      });
    }
    const url = `/campaigns/${campaignId}/adversaries`;
    const root = gm.locator(".adv-root");

    for (const viewport of VIEWPORTS) {
      const w = viewport.width;
      await gm.setViewportSize(viewport);

      // ── Catalogue: chips, the stat block's actions, the custom section ──
      await gm.goto(url);
      await expect(gm.getByRole("heading", { level: 1, name: "Adversaries" })).toBeVisible();
      const block = gm.getByRole("complementary", { name: "Stat block" });
      const addSrd = block.getByRole("button", { name: /^Add .+ to an encounter$/ });
      await expectInk(addSrd, "main");
      await expectInk(block.getByRole("button", { name: /^Duplicate and edit / }));
      const tierAll = gm.getByRole("region", { name: "Adversary list" }).getByRole("group", { name: "Tier", exact: true }).getByRole("button", { name: "All", exact: true });
      await expectRole(tierAll, "neutral");
      await expect(tierAll).toHaveAttribute("aria-pressed", "true");
      const custom = gm.getByRole("region", { name: "Custom adversaries" });
      await expect(custom.getByRole("article", { name: "Cave Bear stat block" })).toBeVisible();
      await expectRole(custom.getByRole("button", { name: "New adversary" }), "confirm");
      await expectInk(custom.getByRole("button", { name: "Delete" }), "danger");
      await expectInk(custom.getByRole("button", { name: "Edit", exact: true }));
      await shoot(gm, `catalogue-gm-${w}`);
      if (w < 1100) await expectTouchTargets(root);

      // ── Encounters: list, detail and the Battle Points panel ──
      await openTab(gm, "Encounters");
      const panel = gm.getByRole("tabpanel", { name: "Encounters" });
      await panel.getByRole("navigation", { name: "Encounter list" }).getByRole("button", { name: /Ambush at the ford/ }).click();
      await expect(panel.getByTestId("bp-spent")).toBeVisible();
      await expectRole(panel.getByRole("button", { name: "+ New encounter" }), "confirm");
      await expectRole(panel.getByRole("button", { name: "Delete", exact: true }), "danger");
      await expectRole(panel.getByRole("button", { name: "▶ Start encounter" }), "confirm");
      await expectRole(panel.getByRole("button", { name: "+ Add adversary" }), "neutral");
      await expectRole(panel.getByRole("button", { name: "More player characters" }), "neutral");
      await expectRole(panel.getByRole("button", { name: /^Remove / }).first(), "danger");
      await expectRole(panel.getByRole("button", { name: /^Move .+ down$/ }).first(), "neutral");
      await shoot(gm, `encounters-gm-${w}`);
      if (w < 1100) await expectTouchTargets(root);

      // The add dialog: tier chips, Cancel (Hope for the GM), Add to encounter (Fear for the GM).
      await panel.getByRole("button", { name: "+ Add adversary" }).click();
      const dialog = gm.getByRole("dialog", { name: "Add to encounter" });
      await dialog.getByPlaceholder("Search by name or type").fill("bear");
      await dialog.getByRole("button", { name: "Bear, Tier 1 Bruiser" }).click();
      await expectRole(dialog.getByRole("button", { name: "Cancel" }), "cancel");
      await expectRole(dialog.getByRole("button", { name: "Add to encounter", exact: true }), "confirm");
      await expectRole(dialog.getByRole("button", { name: "All tiers" }), "neutral");
      await shoot(gm, `add-dialog-gm-${w}`, false);
      if (w < 1100) await expectTouchTargets(dialog);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      // ── Environment: + Fear, Spend N Fear (confirm), Start countdown, Undo ──
      await openTab(gm, "Environment");
      await gm.getByRole("region", { name: "Environment list" }).getByRole("button", { name: /^Raging River/ }).click();
      const env = gm.getByRole("complementary", { name: "Environment stat block" });
      await expectInk(env.getByRole("button", { name: "Gain 1 Fear" }));
      await expectInk(env.getByRole("button", { name: "Spend 1 Fear" }).first(), "main");
      await expectInk(env.getByRole("button", { name: "Start countdown" }).first());
      await shoot(gm, `environment-gm-${w}`);
      if (w < 1100) await expectTouchTargets(root);
    }

    // ── Hover and keyboard focus at 1440, with axe ──
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.goto(url);
    const block = gm.getByRole("complementary", { name: "Stat block" });
    const addSrd = block.getByRole("button", { name: /^Add .+ to an encounter$/ });
    await addSrd.hover();
    await gm.waitForTimeout(400);
    await block.screenshot({ path: `${OUT}/catalogue-gm-hover-add.png` });
    await expectNoSeriousA11yViolations(gm, { include: ".adv-main" });
    await gm.mouse.move(0, 0);
    const chip = gm.getByRole("region", { name: "Adversary list" }).getByRole("group", { name: "Tier", exact: true }).getByRole("button", { name: "2", exact: true });
    await keyboardFocus(gm, chip);
    await shoot(gm, "catalogue-gm-focus-chip", false);
    await expectNoSeriousA11yViolations(gm, { include: ".adv-main" });
    // A focused button on the parchment: the ink focus ring.
    await keyboardFocus(gm, addSrd);
    await block.screenshot({ path: `${OUT}/catalogue-gm-focus-add.png` });

    // The custom editor: parchment form with ink buttons, Cancel / Save adversary.
    const custom = gm.getByRole("region", { name: "Custom adversaries" });
    await custom.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = gm.getByRole("dialog", { name: "Edit Cave Bear" });
    await expectInk(editor.getByRole("button", { name: "Save adversary" }), "main");
    await expectInk(editor.getByRole("button", { name: "Cancel" }));
    await expectInk(editor.getByRole("button", { name: "Remove feature" }).first(), "danger");
    await shoot(gm, "editor-gm-1440", false);
    await editor.getByRole("button", { name: "Save adversary" }).hover();
    await gm.waitForTimeout(400);
    await shoot(gm, "editor-gm-hover-save", false);
    await expectNoSeriousA11yViolations(gm, { include: "dialog[open]" });
    await editor.getByRole("button", { name: "Cancel" }).click();

    // Encounters: hover Start encounter, then start it (End encounter = danger, Open in tracker = neutral).
    await openTab(gm, "Encounters");
    const panel = gm.getByRole("tabpanel", { name: "Encounters" });
    await panel.getByRole("navigation", { name: "Encounter list" }).getByRole("button", { name: /Ambush at the ford/ }).click();
    const start = panel.getByRole("button", { name: "▶ Start encounter" });
    await start.hover();
    await gm.waitForTimeout(400);
    await panel.getByRole("region", { name: "Encounter detail" }).screenshot({ path: `${OUT}/encounters-gm-hover-start.png` });
    await expectNoSeriousA11yViolations(gm, { include: "[aria-label='Encounter detail']" });
    await gm.mouse.move(0, 0);
    await keyboardFocus(gm, panel.getByRole("button", { name: "More player characters" }));
    await panel.getByTestId("bp-panel").screenshot({ path: `${OUT}/encounters-gm-focus-stepper.png` });
    await start.click();
    const end = panel.getByRole("button", { name: "■ End encounter" });
    await expectRole(end, "danger");
    await expectRole(panel.getByRole("button", { name: "Open in tracker" }), "neutral");
    await end.hover();
    await gm.waitForTimeout(400);
    await panel.getByRole("region", { name: "Encounter detail" }).screenshot({ path: `${OUT}/encounters-gm-running-hover-end.png` });
    await expectNoSeriousA11yViolations(gm, { include: "[aria-label='Encounter detail']" });
    await gm.mouse.move(0, 0);

    // Environment: gain Fear, spend it (Undo appears as a cancel), hover the confirm.
    await openTab(gm, "Environment");
    await gm.getByRole("region", { name: "Environment list" }).getByRole("button", { name: /^Raging River/ }).click();
    const env = gm.getByRole("complementary", { name: "Environment stat block" });
    await env.getByRole("button", { name: "Gain 1 Fear" }).click();
    await expect(env.getByRole("img", { name: /^GM Fear [1-9]/ })).toBeVisible();
    const spend = env.getByRole("button", { name: "Spend 1 Fear" }).first();
    await expect(spend).toBeEnabled();
    await spend.hover();
    await gm.waitForTimeout(400);
    await env.screenshot({ path: `${OUT}/environment-gm-hover-spend.png` });
    await expectNoSeriousA11yViolations(gm, { include: ".adv-main" });
    await spend.click();
    const undo = env.getByRole("button", { name: "Undo" });
    await expectInk(undo);
    await undo.scrollIntoViewIfNeeded();
    await env.locator(".env-sb-top").screenshot({ path: `${OUT}/environment-gm-undo.png` });

    // ── The player: the GM-only panel (no buttons) ──
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(url);
      await expect(player.getByText("Only the GM can see adversaries and encounters.")).toBeVisible();
      await shoot(player, `player-${viewport.width}`);
    }
  } finally {
    await table.close();
  }
});
