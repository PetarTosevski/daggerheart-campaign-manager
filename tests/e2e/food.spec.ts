import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail = process.env.E2E_FOOD_TEST_EMAIL ?? "gm-food-e2e@example.com";
const testPassword =
  process.env.E2E_FOOD_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

let database: Client;
let userId = "";
let campaignId = "";

test.describe("Food system", () => {
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
      `insert into public.campaigns (owner_id, name) values ($1,'Food E2E') returning id`,
      [userId],
    );
    campaignId = campaign.rows[0].id as string;
    // Two active characters -> 14 portions required per week.
    await database.query(`insert into public.characters (campaign_id, name) values ($1,'Kodak'),($1,'Zane')`, [campaignId]);
  });

  test.afterAll(async () => {
    if (database) {
      if (campaignId) await database.query(`delete from public.campaigns where id=$1`, [campaignId]);
      await database.end();
    }
  });

  test("adds batches, previews, commits weekly processing, and persists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Food" }).click();
    await expect(page).toHaveURL(/\/food$/);

    // Add a preserved batch of 20 portions.
    await page.getByLabel("Label", { exact: true }).fill("Trail rations");
    await page.getByLabel("Type", { exact: true }).selectOption("preserved");
    await page.getByLabel("Portions", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Add batch" }).click();

    await expect
      .poll(async () => {
        const r = await database.query(
          `select coalesce(sum(remaining_portions),0)::int n from public.food_batches where campaign_id=$1 and status='active'`,
          [campaignId],
        );
        return r.rows[0].n;
      }, { timeout: persistenceTimeout })
      .toBe(20);

    // Total shows 2 rations, 6 portions (20 / 7).
    await expect(page.getByText(/2\s+rations/i).first()).toBeVisible();

    // Preview shows the default requirement (14) for 2 active characters.
    await expect(page.getByText("Required").first()).toBeVisible();

    // Commit the weekly process.
    await page.getByRole("button", { name: "Process weekly food" }).click();

    // 20 - 14 consumed = 6 remaining.
    await expect
      .poll(async () => {
        const r = await database.query(
          `select coalesce(sum(remaining_portions),0)::int n from public.food_batches where campaign_id=$1 and status='active'`,
          [campaignId],
        );
        return r.rows[0].n;
      }, { timeout: persistenceTimeout })
      .toBe(6);

    // History records the consumption.
    await expect(page.getByText("Consumed").first()).toBeVisible({ timeout: persistenceTimeout });

    // A weekly process row exists (audit).
    const proc = await database.query(
      `select consumed_portions from public.food_week_processes where campaign_id=$1`,
      [campaignId],
    );
    expect(proc.rows[0].consumed_portions).toBe(14);
  });
});
