import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_CAMPAIGN_TIME_TEST_EMAIL ?? "gm-campaign-time-e2e@example.com";
const testPassword =
  process.env.E2E_CAMPAIGN_TIME_TEST_PASSWORD ??
  process.env.E2E_TEST_PASSWORD ??
  "";
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const campaignName = "Campaign Time E2E";
const persistenceTimeout = 15_000;

let campaignId = "";
let database: Client;

test.describe("Campaign time", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!testPassword) {
      throw new Error(
        "E2E_CAMPAIGN_TIME_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
      );
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: users, error: usersError } =
      await admin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) throw usersError;
    const existingUser = users.users.find(
      (candidate) => candidate.email === testEmail,
    );
    let userId: string;

    if (existingUser) {
      const { error } = await admin.auth.admin.updateUserById(existingUser.id, {
        password: testPassword,
        email_confirm: true,
      });
      if (error) throw error;
      userId = existingUser.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
      if (error) throw error;
      userId = data.user.id;
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
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

  test("previews, advances across a cycle boundary, and preserves a correction", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const currentTime = (label: string) =>
      page.locator("output").filter({ hasText: label });
    await expect(currentTime("Week 1 • Day Cycle • Dawn")).toBeVisible();
    await expect(page.getByText("Preview — no changes yet")).toBeVisible();
    await expect(
      page.getByText("Week 1 • Day Cycle • Sunrise", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Advance note").fill("The expedition leaves camp.");
    await page.getByRole("button", { name: "Confirm advance one day" }).click();
    await expect(currentTime("Week 1 • Day Cycle • Sunrise")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(page.getByText("The expedition leaves camp.")).toBeVisible();

    const expectedTimes = [
      "Week 1 • Day Cycle • Morning",
      "Week 1 • Day Cycle • Forenoon",
      "Week 1 • Day Cycle • Midday",
      "Week 1 • Day Cycle • Afternoon",
      "Week 1 • Day Cycle • Civil Twilight",
      "Week 2 • Night Cycle • Nautical Twilight",
    ];
    for (const expected of expectedTimes) {
      await page.getByRole("button", { name: "Confirm advance one day" }).click();
      await expect(currentTime(expected)).toBeVisible({
        timeout: persistenceTimeout,
      });
    }

    await expect(
      page.getByRole("list", { name: "Recent campaign-time changes" })
        .getByRole("listitem"),
    ).toHaveCount(7);

    await page.getByText("Correct campaign time", { exact: true }).click();
    await page.getByLabel("Week", { exact: true }).fill("1");
    await page.getByLabel("Cycle", { exact: true }).selectOption("DAY");
    await page.getByLabel("Cycle day", { exact: true }).fill("1");
    await page
      .getByLabel("Correction note")
      .fill("The boundary advance was entered accidentally.");
    await expect(
      page.getByText("Week 1 • Day Cycle • Dawn", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Commit correction" }).click();

    await expect(currentTime("Week 1 • Day Cycle • Dawn")).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByText("Compensating event", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The boundary advance was entered accidentally."),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Recent campaign-time changes" })
        .getByRole("listitem"),
    ).toHaveCount(8);

    await page.reload();
    await expect(currentTime("Week 1 • Day Cycle • Dawn")).toBeVisible();
    await expect(
      page.getByText("Compensating event", { exact: true }),
    ).toBeVisible();
  });
});
