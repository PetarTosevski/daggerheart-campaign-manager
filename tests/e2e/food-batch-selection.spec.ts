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
const batchIds: Record<string, string> = {};

test.describe("Food batch-selection override", () => {
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
      `insert into public.campaigns (owner_id, name) values ($1,'Food Selection E2E') returning id`,
      [userId],
    );
    campaignId = campaign.rows[0].id as string;
    // One active character -> 7 portions required per week.
    await database.query(`insert into public.characters (campaign_id, name) values ($1,'Solo')`, [campaignId]);
    // Three preserved batches of 7 portions each, distinct acquisition weeks so
    // FIFO order is Oldest -> Middle -> Newest.
    for (const [label, week] of [["Oldest", 1], ["Middle", 2], ["Newest", 3]] as const) {
      const r = await database.query(
        `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
         values ($1,$2,'preserved',$3,7,7) returning id`,
        [campaignId, label, week],
      );
      batchIds[label] = r.rows[0].id as string;
    }
  });

  test.afterAll(async () => {
    if (database) {
      if (campaignId) await database.query(`delete from public.campaigns where id=$1`, [campaignId]);
      await database.end();
    }
  });

  test("excludes the oldest batch, reorders, previews, commits, and audits", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Food" }).click();
    await expect(page).toHaveURL(/\/food$/);

    // Open the GM override, then enable the explicit batch selection.
    await page.getByText("GM override", { exact: true }).click();
    await page.getByLabel("Override FIFO batch selection").check();

    const editor = page.getByRole("group", { name: "Batch selection override" });
    await expect(editor).toBeVisible();

    // Commit is blocked without a reason while an override is active.
    await expect(page.getByRole("button", { name: "Process weekly food" })).toBeDisabled();

    // Exclude the FIFO-oldest batch.
    await editor.getByRole("listitem").filter({ hasText: "Oldest" }).getByRole("button", { name: "Exclude" }).click();

    // Reorder: move Newest above Middle so the custom order is Newest, then Middle.
    await editor.getByRole("button", { name: "Move Newest up" }).click();

    await page.locator("#food-reason").fill("Spend the newest stores first");

    // Preview follows the custom order: Newest is consumed first.
    await page.getByRole("button", { name: "Update preview" }).click();
    await expect(page.getByText(/FIFO overridden/i)).toBeVisible();

    // Commit.
    await page.getByRole("button", { name: "Process weekly food" }).click();

    // Newest depleted first (7 consumed); Middle and excluded Oldest untouched.
    await expect
      .poll(async () => {
        const r = await database.query(
          `select remaining_portions from public.food_batches where id=$1`,
          [batchIds.Newest],
        );
        return r.rows[0].remaining_portions;
      }, { timeout: persistenceTimeout })
      .toBe(0);

    const remaining = await database.query(
      `select id, remaining_portions from public.food_batches where campaign_id=$1`,
      [campaignId],
    );
    const byId = Object.fromEntries(remaining.rows.map((r) => [r.id, r.remaining_portions]));
    expect(byId[batchIds.Middle]).toBe(7); // requirement met before reaching it
    expect(byId[batchIds.Oldest]).toBe(7); // excluded, untouched

    // Exactly one process row, recording the override, reason, and ordered ids.
    const proc = await database.query(
      `select used_custom_selection, override_reason, consumed_portions, selected_batch_ids
       from public.food_week_processes where campaign_id=$1`,
      [campaignId],
    );
    expect(proc.rowCount).toBe(1);
    expect(proc.rows[0].used_custom_selection).toBe(true);
    expect(proc.rows[0].override_reason).toBe("Spend the newest stores first");
    expect(proc.rows[0].consumed_portions).toBe(7);
    expect(proc.rows[0].selected_batch_ids).toEqual([batchIds.Newest, batchIds.Middle]);
  });
});
