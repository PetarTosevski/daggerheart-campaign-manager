import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer, type LiveTable } from "./live";

// Config JO1 (plan .omc/plans/config.yaml, docs/tasks/TASK-CONFIG-JO1.md): 'A new session opens on' (Campaign
// settings, Sessions). The GM starts a session from the Journal header: with Journal (the default) the Journal opens
// that session's Log & recap; with Combat Map the GM moves to the Combat Map. The player, on the Journal, is not moved.

let table: LiveTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await gmAndPlayer(browser);
});

test.afterAll(async () => {
  await table?.close();
});

const journal = () => `/campaigns/${table.campaignId}/journal`;

async function startFromJournal(n: number) {
  const { gm } = table;
  await gm.goto(journal());
  await expect(gm.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await gm.getByRole("button", { name: `Start session ${n}` }).click();
  const dialog = gm.getByRole("dialog", { name: `Start session ${n}?` });
  await dialog.getByRole("button", { name: "Start session", exact: true }).click();
}

async function openPlayerJournal() {
  const { player } = table;
  await player.goto(journal());
  await expect(player.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
}

test("Journal (default): the Start opens the new session's Log & recap; the player stays", async () => {
  const { gm, player } = table;
  await openPlayerJournal();
  await startFromJournal(1);
  await expect(gm).toHaveURL(/\/journal\?.*s=[^&]+/);
  await expect(gm).toHaveURL(/sv=log/);
  await expect(gm.getByTestId("journal-live-chip")).toContainText("Session 1 · live");
  // The player sees the session go live where they are.
  await expect(player.getByTestId("journal-live-chip")).toContainText("Session 1 · live");
  await expect(player).toHaveURL(new RegExp(`${journal()}$`));
});

test("Combat Map: the Start moves the GM to the Combat Map; the player stays", async () => {
  const { gm, player, client, campaignId } = table;
  await client.mutation(api.sessions.end, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.campaignSettings.set, { campaignId, change: { key: "sessionOpensOn", value: "combatMap" } });
  await openPlayerJournal();
  await startFromJournal(2);
  await expect(gm).toHaveURL(new RegExp(`/campaigns/${campaignId}/combat-map$`));
  await expect(player.getByTestId("journal-live-chip")).toContainText("Session 2 · live");
  await expect(player).toHaveURL(new RegExp(`${journal()}$`));
});
