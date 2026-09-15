import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail = process.env.E2E_INVENTORY_TEST_EMAIL ?? "gm-inventory-e2e@example.com";
const testPassword =
  process.env.E2E_INVENTORY_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

let database: Client;
let userId = "";
let campaignId = "";

test.describe("Inventory system", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) throw new Error("E2E password must be configured.");
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = users.users.find((u) => u.email === testEmail);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, { password: testPassword, email_confirm: true });
      userId = existing.id;
    } else {
      const { data } = await admin.auth.admin.createUser({ email: testEmail, password: testPassword, email_confirm: true });
      userId = data.user!.id;
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query(`delete from public.campaigns where owner_id = $1`, [userId]);
    const campaign = await database.query(
      `insert into public.campaigns (owner_id, name) values ($1,'Inventory E2E') returning id`,
      [userId],
    );
    campaignId = campaign.rows[0].id as string;
    await database.query(`insert into public.characters (campaign_id, name) values ($1,'Kodak')`, [campaignId]);
  });

  test.afterAll(async () => {
    if (database) {
      if (campaignId) await database.query(`delete from public.campaigns where id=$1`, [campaignId]);
      await database.end();
    }
  });

  test("defines an item, adds it to a backpack, and equips it", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Inventory" }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    // Define a non-stackable item.
    await page.getByPlaceholder("Torch").fill("Lantern");
    await page.getByRole("button", { name: "Create item" }).click();

    await expect
      .poll(async () => {
        const r = await database.query(
          `select count(*)::int n from public.item_definitions where campaign_id=$1 and name='Lantern'`,
          [campaignId],
        );
        return r.rows[0].n;
      }, { timeout: persistenceTimeout })
      .toBe(1);

    const itemId = (
      await database.query(`select id from public.item_definitions where campaign_id=$1 and name='Lantern'`, [campaignId])
    ).rows[0].id as string;
    const backpackId = (
      await database.query(
        `select ic.id from public.inventory_containers ic
         join public.characters ch on ch.id = ic.character_id
         where ic.campaign_id=$1 and ch.name='Kodak' and ic.is_default`,
        [campaignId],
      )
    ).rows[0].id as string;

    // Add one to the character's backpack.
    await page.getByLabel("Item", { exact: true }).selectOption(itemId);
    await page.getByLabel("Container", { exact: true }).selectOption(backpackId);
    await page.getByLabel("Quantity", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Add item" }).click();

    await expect
      .poll(async () => {
        const r = await database.query(
          `select coalesce(sum(quantity),0)::int n from public.inventory_entries where container_id=$1`,
          [backpackId],
        );
        return r.rows[0].n;
      }, { timeout: persistenceTimeout })
      .toBe(1);

    // The stack is visible in the holdings tree.
    const holdings = page.getByRole("region", { name: "Holdings" });
    await expect(holdings.getByText("Lantern").first()).toBeVisible();

    // Equip it into a slot via the per-entry actions.
    await holdings.getByText("Actions", { exact: true }).first().click();
    await holdings.getByPlaceholder("main hand").fill("main hand");
    await holdings.getByRole("button", { name: "Equip", exact: true }).click();

    await expect
      .poll(async () => {
        const r = await database.query(
          `select state, equipped_slot from public.inventory_entries where item_definition_id=$1`,
          [itemId],
        );
        return `${r.rows[0]?.state}:${r.rows[0]?.equipped_slot}`;
      }, { timeout: persistenceTimeout })
      .toBe("equipped:main hand");

    await expect(page.getByText("Equipped").first()).toBeVisible({ timeout: persistenceTimeout });
  });
});
