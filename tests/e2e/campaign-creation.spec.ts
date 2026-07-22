import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_CAMPAIGN_TEST_EMAIL ?? "gm-campaign-create-e2e@example.com";
const testPassword =
  process.env.E2E_CAMPAIGN_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const campaignName = "Fresh Reset Campaign";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

let userId = "";
let database: Client;

test.describe("Campaign creation empty state", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error(
        "E2E_CAMPAIGN_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
      );
    }

    const { data: users, error } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (error) throw error;
    const existing = users.users.find((u) => u.email === testEmail);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        password: testPassword,
        email_confirm: true,
      });
      userId = existing.id;
    } else {
      const { data, error: createError } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
      if (createError) throw createError;
      userId = data.user.id;
    }

    // Ensure this user starts with NO campaign so the empty state shows.
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query(`delete from public.campaigns where owner_id = $1`, [
      userId,
    ]);
  });

  test.afterAll(async () => {
    if (database) {
      if (userId) {
        await database.query(`delete from public.campaigns where owner_id = $1`, [
          userId,
        ]);
      }
      await database.end();
    }
  });

  test("a GM with no campaign creates one and reaches the controls", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Onboarding empty state: a clear create-campaign action, no dead end.
    await expect(page.getByText(/no campaigns yet/i)).toBeVisible();
    await expect(page.getByText(/no active campaign/i)).toBeHidden();

    await page.getByLabel(/campaign name/i).fill(campaignName);
    await page.getByRole("button", { name: /create campaign/i }).click();

    // After creation the empty state is gone and the controls + timeline render.
    await expect(page.getByText(/no campaigns yet/i)).toBeHidden({
      timeout: persistenceTimeout,
    });
    await expect(page.getByText(campaignName, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create countdown" }),
    ).toBeVisible();

    // The persistent timeline reflects the canonical starting state.
    await expect(page.getByText(/week\s*1/i).first()).toBeVisible();

    // Characters are now accessible (no dead end downstream).
    await page.getByRole("link", { name: "Characters" }).click();
    await expect(page).toHaveURL(/\/characters$/);
    await expect(
      page.getByRole("heading", { name: "Characters", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /new character/i }).first(),
    ).toBeVisible();

    // Revisiting does not create a second campaign.
    await page.goto("/dashboard");
    await expect(page.getByText(campaignName, { exact: true })).toBeVisible();
    const { rows } = await database.query(
      `select count(*)::int as n from public.campaigns where owner_id = $1`,
      [userId],
    );
    expect(rows[0].n).toBe(1);
  });
});
