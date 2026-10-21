import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, visual } from "./helpers";

// D11 N6 visual spec (E2E_VISUAL=1): the sharing dialog (GM and player), the Shared tabs and a shared page, at
// 1440x900 and 390x844. Not on the board: judged against the board's tokens (docs/tasks/TASK-D11-N6.md).

const PLAYER_A = "e2e-player@example.test";
// The e2e allowlist (scripts/e2e-setup.mjs) has two non-GM accounts; notes-shell.spec.ts also signs this one in by the test form.
const PLAYER_B = "e2e-password@example.test";

test("D11 N6 sharing dialog, Shared tabs and a shared page at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);

  await page.getByRole("button", { name: "Players" }).click();
  const players = page.getByRole("dialog", { name: "Players" });
  await expect(players.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await players.getByTestId("join-code").textContent())!;
  await players.getByRole("button", { name: "Close players" }).click();

  const contexts: BrowserContext[] = [];
  async function join(email: string, hero: string) {
    const context = await browser.newContext();
    contexts.push(context);
    const p = await context.newPage();
    await signInAsTestGm(p, email);
    await expect(p).toHaveURL("/");
    await p.goto(`/join/${code}`);
    await p.getByRole("button", { name: "Join campaign" }).click();
    await expect(p.getByRole("heading", { level: 1, name })).toBeVisible();
    const client = await convexAs(p);
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
    return { page: p, client };
  }
  const a = await join(PLAYER_A, "Ash");
  await join(PLAYER_B, "Bram");

  // Seed: the GM's 'Rumors & hooks' chosen for Ash, 'Loot & debts' for everyone; Ash's pages with entries, one
  // 'Players only', one chosen for the GM and Bram.
  await gm.mutation(api.notesSharing.setVisibility, { campaignId, page: { template: 1 }, visibility: "chosen" });
  const roster = await gm.query(api.notesSharing.recipients, { campaignId, page: { template: 1 } });
  await gm.mutation(api.notesSharing.addRecipient, { campaignId, page: { template: 1 }, userId: roster.find((r) => r.name === "Ash")!.userId });
  await gm.mutation(api.notesSharing.setVisibility, { campaignId, page: { template: 2 }, visibility: "everyone" });
  const { pageId: ashLog } = await a.client.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "event", text: "Crossed the river at dawn" });
  await a.client.mutation(api.notesEntries.add, { campaignId, page: ashLog, kind: "task", text: "Ask the ferryman about the well" });
  await gm.mutation(api.notesEntries.add, { campaignId, page: ashLog, kind: "note", text: "The ferryman lies" });
  await a.client.mutation(api.notesSharing.setVisibility, { campaignId, page: { template: 1 }, visibility: "players" });
  await a.client.mutation(api.notesSharing.setVisibility, { campaignId, page: { template: 2 }, visibility: "chosen" });
  for (const r of await a.client.query(api.notesSharing.recipients, { campaignId, page: { template: 2 } })) {
    await a.client.mutation(api.notesSharing.addRecipient, { campaignId, page: { template: 2 }, userId: r.userId });
  }

  async function openDialog(p: Page, pageParam: string) {
    await p.goto(`/campaigns/${campaignId}/notes?page=${pageParam}`);
    await p.getByRole("region", { name: "Journal page" }).getByRole("button", { name: /^Sharing: / }).click();
    const dialog = p.getByRole("dialog", { name: "Share this page" });
    await expect(dialog.getByRole("group", { name: "Chosen players" }).getByRole("checkbox", { name: "Bram" })).toBeVisible();
    return dialog;
  }

  const gmShots = visual(page, "D11-N6");
  await gmShots.shoot(await openDialog(page, "template-1"), "dialog-gm");
  await page.keyboard.press("Escape");

  const playerShots = visual(a.page, "D11-N6");
  await playerShots.shoot(await openDialog(a.page, "template-2"), "dialog-player");
  await a.page.keyboard.press("Escape");

  // The GM's Shared tabs: players' pages grouped by player, and their own shared pages.
  await page.goto(`/campaigns/${campaignId}/notes`);
  const shared = page.getByRole("complementary", { name: "Journal index" }).getByRole("region", { name: "Shared" });
  await expect(shared.getByRole("group", { name: "Ash" })).toBeVisible();
  await gmShots.shoot(shared, "shared-players-gm");
  await shared.getByRole("tab", { name: "Shared by GM" }).click();
  await expect(shared.getByRole("button", { name: /Rumors & hooks/ })).toBeVisible();
  await gmShots.shoot(shared, "shared-gm-gm");

  // A shared page read by the GM, with the add row.
  await page.goto(`/campaigns/${campaignId}/notes?view=shared-players&page=${ashLog}`);
  const view = page.getByRole("region", { name: "Journal page" });
  await expect(view.getByText("The ferryman lies - GM")).toBeVisible();
  await gmShots.shoot(view, "shared-page-gm");

  // Ash's Shared tab ('Shared by GM') and the GM's page read by Ash.
  await a.page.goto(`/campaigns/${campaignId}/notes`);
  const ashShared = a.page.getByRole("complementary", { name: "Journal index" }).getByRole("region", { name: "Shared" });
  await ashShared.getByRole("tab", { name: "Shared by GM" }).click();
  await expect(ashShared.getByRole("button", { name: /Rumors & hooks/ })).toBeVisible();
  await playerShots.shoot(ashShared, "shared-gm-player");
  await ashShared.getByRole("button", { name: /Rumors & hooks/ }).click();
  await expect(a.page.getByText("Game Master’s page · read only")).toBeVisible();
  await playerShots.shoot(a.page.getByRole("region", { name: "Journal page" }), "shared-page-player");

  for (const context of contexts) await context.close();
});
