import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_COUNTDOWN_TEST_EMAIL ?? "gm-countdown-e2e@example.com";
const testPassword =
  process.env.E2E_COUNTDOWN_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const campaignName = "Countdown Tracker E2E";
const countdownName = "The refuge is discovered";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let campaignId = "";
let database: Client;

test.describe("Countdown Tracker", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error(
        "E2E_COUNTDOWN_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
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

  test("creates, operates, completes, and preserves a countdown", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByLabel("Name").fill(countdownName);
    await page.getByLabel("Category").selectOption("threat");
    await page.getByLabel("Starting value").fill("2");
    await page.getByLabel("Description").fill("Scouts draw closer.");
    await page
      .getByLabel("Narrative consequence")
      .fill("The refuge must be abandoned.");
    await page.getByRole("button", { name: "Create countdown" }).click();

    let card = page.getByTestId("countdown-card").filter({
      has: page.locator('[data-slot="card-title"]', {
        hasText: countdownName,
      }),
    });
    await expect(card).toBeVisible({ timeout: persistenceTimeout });
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );

    await card.getByLabel("Reason").fill("The scouts found a trail.");
    await card
      .getByRole("button", { name: `Advance ${countdownName} by 1` })
      .click();
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
      { timeout: persistenceTimeout },
    );

    await card.getByRole("button", { name: `Pause ${countdownName}` }).click();
    await expect(
      card.getByRole("button", { name: `Resume ${countdownName}` }),
    ).toBeEnabled({ timeout: persistenceTimeout });

    await card.getByRole("button", { name: `Resume ${countdownName}` }).click();
    await expect(
      card.getByRole("button", { name: `Pause ${countdownName}` }),
    ).toBeEnabled({ timeout: persistenceTimeout });

    await card
      .getByRole("button", { name: `Advance ${countdownName} by 1` })
      .click();

    card = page.getByTestId("countdown-card").filter({
      has: page.locator('[data-slot="card-title"]', {
        hasText: countdownName,
      }),
    });
    await expect(page.getByText("Completed and cancelled")).toBeVisible();
    await expect(card.getByText("completed", { exact: true })).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    await card.locator("summary").click();
    await expect(
      card.getByRole("list", { name: `${countdownName} event history` }),
    ).toBeVisible();
    await expect(
      card.getByRole("list", { name: `${countdownName} event history` })
        .getByRole("listitem"),
    ).toHaveCount(4);
    await expect(card.getByText("The scouts found a trail.")).toBeVisible();

    await page.reload();
    card = page.getByTestId("countdown-card").filter({
      has: page.locator('[data-slot="card-title"]', {
        hasText: countdownName,
      }),
    });
    await expect(card.getByText("completed", { exact: true })).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
