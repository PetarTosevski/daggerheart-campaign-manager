import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// D11 N9: Notes accessibility (.omc/plans/d11-notes.yaml, TE13). axe on the page view, the threads view, the sharing
// dialog, the @ picker, a Shared tab, a journal view and the bin: zero serious or critical violations inside the Notes
// page (`.bj-root`; the campaign shell around it is checked by its own boards). Keyboard only (Tab / arrows / Enter /
// Escape, never a click): add an entry with a mention, cycle its bullet, open the sharing dialog and pick an option,
// switch Shared tabs, tear out a page and undo it. At 1440x900 and 390x844 (at 390 the index is behind 'Pages').
//
// axe-core is not a direct dependency (no new dependency in D11); the copy pnpm installs for eslint-plugin-jsx-a11y is
// injected as a script. Follow-up: bead dcm-bxp.112 adds @axe-core/playwright as a devDependency.

const PLAYER = "e2e-player@example.test";

function axeScript(): string {
  const store = path.join(process.cwd(), "node_modules", ".pnpm");
  const dir = readdirSync(store).find((name) => name.startsWith("axe-core@"));
  if (!dir) throw new Error("axe-core is not installed (pnpm install)");
  return path.join(store, dir, "node_modules", "axe-core", "axe.min.js");
}

type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

/** Serious and critical axe violations inside the Notes page. */
async function axe(page: Page, label: string) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: axeScript() });
  const violations = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe.run;
    const result = await run({ include: [".bj-root"] }, { resultTypes: ["violations"] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target) }));
  });
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  // Minor and moderate findings are recorded (task doc), not failed.
  test.info().annotations.push({ type: `axe ${label}`, description: JSON.stringify(violations.map((v) => `${v.impact} ${v.id} x${v.nodes.length}`)) });
  expect(serious, `${label}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

/** Presses Tab (Shift+Tab when `back`) until the locator has focus; fails when it is not reachable. */
async function tabTo(page: Page, target: Locator, { back = false, max = 150 } = {}) {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error(`not reachable by keyboard: ${target.toString()}`);
}

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });
const ownPaper = (page: Page) => paperColumn(page).getByRole("article", { name: "Page" });

/** At 390 px opens the 'Pages' disclosure by keyboard (wider, the index is always shown). */
async function keyOpenIndex(page: Page) {
  const toggle = index(page).getByRole("button", { name: /^Pages/ });
  await expect(index(page)).toBeVisible();
  if (!(await toggle.isVisible()) || (await toggle.getAttribute("aria-expanded")) === "true") return;
  await tabTo(page, toggle, { back: true });
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test("axe finds no serious issue in any Notes view; the main tasks work by keyboard alone", async ({ page, browser }) => {
      test.setTimeout(300_000);
      await signInAsTestGm(page);
      await expect(page).toHaveURL("/");
      const name = `A11y ${crypto.randomUUID().slice(0, 8)}`;
      await page.goto("/frames/witherwild");
      await page.getByRole("button", { name: "Choose this Frame" }).click();
      await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
      await page.getByRole("button", { name: "Start campaign" }).last().click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
      const gm = await convexAs(page);
      const { entryId: npc } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
      await gm.mutation(api.codex.update, { entryId: npc, patch: { name: "Marlow", role: "Ferryman" } });

      // A player with a page the GM reads (default 'gm') and one shared with everyone (for the Shared tab).
      const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
      const context = await browser.newContext({ viewport });
      try {
        const player = await context.newPage();
        await signInAsTestGm(player, PLAYER);
        await expect(player).toHaveURL("/");
        await player.goto(`/join/${code}`);
        await player.getByRole("button", { name: "Join campaign" }).click();
        await expect(player.getByRole("heading", { level: 1, name })).toBeVisible();
        const client = await convexAs(player);
        await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
        await client.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "event", text: "we crossed the river" });
        const { pageId: met } = await client.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "note", text: "Old Mag runs the ferry" });
        await client.mutation(api.notesSharing.setVisibility, { campaignId, page: met, visibility: "everyone" });

        // ---- Page view; add an entry with a mention by keyboard (the @ picker open for axe).
        await page.goto(`/campaigns/${campaignId}/notes`);
        await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
        await expect(ownPaper(page).getByLabel("Page title")).toHaveValue("Session 1");
        await axe(page, "page view");
        const input = ownPaper(page).getByRole("textbox", { name: "New entry" });
        await tabTo(page, input);
        await page.keyboard.type("* ask @mar");
        const listbox = ownPaper(page).getByRole("listbox", { name: "Characters & Locations" });
        await expect(listbox.getByRole("option", { name: /Marlow/ })).toHaveAttribute("aria-selected", "true");
        await axe(page, "@ picker");
        await page.keyboard.press("Enter");
        await expect(listbox).toHaveCount(0);
        await page.keyboard.type("about the toll");
        await page.keyboard.press("Enter");
        await expect(input).toHaveText("");
        const row = ownPaper(page).getByRole("listitem").filter({ hasText: "about the toll" });
        await expect(row.getByRole("link")).toHaveText("Marlow");
        // The first write creates the journal: the page ref changes from 'template-0' to the new id and the entries
        // subscription reloads, but the add row stays mounted, so focus stays in the input (dcm-bxp.102).
        await expect.poll(async () => (await gm.query(api.notes.journal, { campaignId })).journal !== null).toBe(true);
        await expect(row.getByRole("button", { name: "Task: open. Click to change." })).toBeVisible();
        await expect(input).toBeFocused();
        await page.keyboard.type("^ wither spreads");
        await page.keyboard.press("Enter");
        await expect(ownPaper(page).getByRole("listitem").filter({ hasText: "wither spreads" })).toBeVisible();

        // Cycle the task's bullet: open -> done.
        await tabTo(page, row.getByRole("button", { name: "Task: open. Click to change." }), { back: true });
        await page.keyboard.press("Enter");
        await expect(row.getByRole("button", { name: "Task: done. Click to change." })).toBeFocused();
        await expect
          .poll(async () => (await gm.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => [e.text, e.state]))
          .toEqual([
            [`ask @[Marlow](${npc}) about the toll`, "done"],
            ["wither spreads", "open"],
          ]);

        // ---- Sharing dialog: open it, pick 'Everyone' with the arrow keys, close it.
        const chip = ownPaper(page).getByRole("button", { name: "Sharing: Private" });
        await tabTo(page, chip, { back: true });
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Share this page" });
        await expect(dialog).toBeVisible();
        await axe(page, "sharing dialog");
        await tabTo(page, dialog.getByRole("radio", { name: /^Private/ }));
        await page.keyboard.press("ArrowDown");
        await expect(dialog.getByRole("radio", { name: /^Everyone/ })).toBeChecked();
        await expect
          .poll(async () => {
            const view = await gm.query(api.notes.journal, { campaignId });
            return view.journal === null ? null : view.pages[0]?.visibility;
          })
          .toBe("everyone");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(ownPaper(page).getByRole("button", { name: "Sharing: Everyone" })).toBeFocused();

        // ---- Threads view.
        const threads = page.getByRole("button", { name: /Open threads/ });
        await tabTo(page, threads, { back: true });
        await page.keyboard.press("Enter");
        await expect(threads).toHaveAttribute("aria-pressed", "true");
        await expect(paperColumn(page).getByText("wither spreads")).toBeVisible();
        await axe(page, "threads view");
        await page.keyboard.press("Enter");
        await expect(threads).toHaveAttribute("aria-pressed", "false");

        // ---- Shared tabs: the arrow keys switch them.
        await keyOpenIndex(page);
        const tabs = index(page).getByRole("tablist", { name: "Shared pages" });
        await tabTo(page, tabs.getByRole("tab", { name: "Shared by players" }));
        await expect(index(page).getByRole("tabpanel")).toContainText("People we met");
        await axe(page, "Shared by players");
        await page.keyboard.press("ArrowRight");
        await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toBeFocused();
        await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toHaveAttribute("aria-selected", "true");
        await expect(index(page).getByRole("tabpanel")).toContainText("Session 1");
        await page.keyboard.press("ArrowLeft");
        await expect(tabs.getByRole("tab", { name: "Shared by players" })).toHaveAttribute("aria-selected", "true");

        // ---- A journal view (the GM opens Ash's journal).
        const ash = index(page).getByRole("region", { name: "Players’ journals" }).getByRole("button", { name: /^Ash/ });
        await tabTo(page, ash);
        await page.keyboard.press("Enter");
        await expect(paperColumn(page).getByText("we crossed the river")).toBeVisible();
        await axe(page, "journal view");

        // ---- Tear out a page and undo it by keyboard; then the bin.
        await page.goto(`/campaigns/${campaignId}/notes?page=template-1`);
        await expect(ownPaper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
        const tear = ownPaper(page).getByRole("button", { name: "Tear out page" });
        await tabTo(page, tear);
        await page.keyboard.press("Enter");
        await expect(ownPaper(page).getByRole("button", { name: "Click again to tear out" })).toBeFocused();
        await page.keyboard.press("Enter");
        const undo = page.getByRole("status").filter({ hasText: "Page torn out" }).getByRole("button", { name: "Undo" });
        await expect(undo).toBeVisible();
        await tabTo(page, undo, { max: 80 });
        await page.keyboard.press("Enter");
        await expect(ownPaper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
        await expect
          .poll(async () => {
            const view = await gm.query(api.notes.journal, { campaignId });
            return view.journal === null ? [] : view.pages.map((p) => p.title);
          })
          .toContain("Rumors & hooks");

        await tabTo(page, ownPaper(page).getByRole("button", { name: "Tear out page" }), { back: true });
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await expect(undo).toBeVisible();
        await keyOpenIndex(page);
        const torn = index(page).getByRole("list", { name: "Torn-out pages" }).getByRole("button", { name: /^Rumors & hooks/ });
        await tabTo(page, torn);
        await page.keyboard.press("Enter");
        await expect(paperColumn(page).getByRole("article", { name: "Torn-out page" })).toBeVisible();
        await axe(page, "bin");
      } finally {
        await context.close();
      }
    });
  });
}
