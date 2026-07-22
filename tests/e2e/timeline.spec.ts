import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_TIMELINE_TEST_EMAIL ?? "gm-timeline-e2e@example.com";
const testPassword =
  process.env.E2E_TIMELINE_TEST_PASSWORD ??
  process.env.E2E_TEST_PASSWORD ??
  "";
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const campaignName = "Timeline E2E";
const refreshTimeout = 15_000;

let campaignId = "";
let database: Client;

test.describe("Persistent campaign timeline", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!testPassword) {
      throw new Error(
        "E2E_TIMELINE_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
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

  test("renders canonical state, marks the current phase, and refreshes after advancement", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const timeline = page.getByRole("region", { name: "Campaign timeline" });
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText("Week 1");
    await expect(timeline).toContainText("Day Cycle");

    // The active phase is exposed with aria-current and a status in its name.
    await expect(
      timeline.getByRole("listitem", { name: "Day 1, Dawn, current phase" }),
    ).toHaveAttribute("aria-current", "step");

    // Advancing one day (Task 008) must refresh the persistent timeline.
    await page.getByRole("button", { name: "Confirm advance one day" }).click();
    await expect(
      timeline.getByRole("listitem", { name: "Day 2, Sunrise, current phase" }),
    ).toHaveAttribute("aria-current", "step", { timeout: refreshTimeout });

    // The timeline stays mounted and accurate across a reload.
    await page.reload();
    await expect(timeline).toContainText("Sunrise");
  });
});
