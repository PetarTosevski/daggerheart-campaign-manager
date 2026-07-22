import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail = process.env.E2E_FEAR_TEST_EMAIL ?? "gm-fear-e2e@example.com";
const testPassword =
  process.env.E2E_FEAR_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const campaignName = "Fear Tracker E2E";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let campaignId = "";
let database: Client;

test.describe("Fear Tracker", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error(
        "E2E_FEAR_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
      );
    }

    const { data: users, error: usersError } =
      await admin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) throw usersError;
    const existingUser = users.users.find(
      (candidate) => candidate.email === testEmail,
    );
    let userId: string;

    if (existingUser) {
      const { error: updateError } = await admin.auth.admin.updateUserById(
        existingUser.id,
        { password: testPassword, email_confirm: true },
      );
      if (updateError) throw updateError;
      userId = existingUser.id;
    } else {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email: testEmail,
          password: testPassword,
          email_confirm: true,
        });
      if (createError) throw createError;
      userId = created.user.id;
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    // This account is dedicated to E2E. Remove stale campaigns so the
    // dashboard's oldest-campaign selection always resolves to this fixture.
    await database.query(`delete from public.campaigns where owner_id = $1`, [
      userId,
    ]);
    const campaign = await database.query(
      `insert into public.campaigns (owner_id, name) values ($1, $2)
       returning id`,
      [userId, campaignName],
    );
    campaignId = campaign.rows[0].id as string;
  });

  test.afterAll(async () => {
    if (database) {
      if (campaignId) {
        await database.query(`delete from public.campaigns where id = $1`, [
          campaignId,
        ]);
      }
      await database.end();
    }
  });

  test("persists consecutive increases and decreases with ordered history", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const total = page.getByLabel("Current Fear: 0 out of 12");
    await expect(total).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Decrease Fear by 1" }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Increase Fear by 1" }).click();

    await expect(page.getByLabel("Current Fear: 1 out of 12")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Fear updated to 1" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Recent Fear changes" })
        .getByRole("listitem"),
    ).toContainText("0 → 1", { timeout: persistenceTimeout });

    await page.getByRole("button", { name: "Increase Fear by 1" }).click();

    await expect(page.getByLabel("Current Fear: 2 out of 12")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Fear updated to 2" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Decrease Fear by 1" }).click();

    await expect(page.getByLabel("Current Fear: 1 out of 12")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Fear updated to 1" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Current Fear: 1 out of 12")).toBeVisible();

    await page.getByRole("button", { name: "Decrease Fear by 1" }).click();

    await expect(page.getByLabel("Current Fear: 0 out of 12")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Fear updated to 0" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Decrease Fear by 1" }),
    ).toBeDisabled();

    const history = page.getByRole("list", { name: "Recent Fear changes" });
    await expect(history.getByRole("listitem")).toHaveCount(4, {
      timeout: persistenceTimeout,
    });
    await expect(history.getByRole("listitem").first()).toContainText("1 → 0");
  });
});
