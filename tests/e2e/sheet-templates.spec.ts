import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_TEMPLATE_TEST_EMAIL ?? "gm-template-e2e@example.com";
const testPassword =
  process.env.E2E_TEMPLATE_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const campaignName = "Sheet Template E2E";
const persistenceTimeout = 20_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

const referenceDir = join(process.cwd(), "reference", "official");
const referencePdf =
  existsSync(referenceDir) &&
  readdirSync(referenceDir).find((name) => name.toLowerCase().endsWith(".pdf"));

let campaignId = "";
let database: Client;

test.describe("Sheet Template PDF", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");
    test.skip(!referencePdf, "Requires the reference character-sheet PDF.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error(
        "E2E_TEMPLATE_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
      );
    }

    const { data: users, error: usersError } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (usersError) throw usersError;
    const existing = users.users.find((u) => u.email === testEmail);
    let userId: string;
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password: testPassword,
        email_confirm: true,
      });
      if (error) throw error;
      userId = existing.id;
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
    await database.query(`delete from public.campaigns where owner_id = $1`, [userId]);
    const campaign = await database.query(
      `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
      [userId, campaignName],
    );
    campaignId = campaign.rows[0].id as string;
    await database.query(
      `insert into public.sheet_templates (campaign_id, name, is_blank_template)
       values ($1, 'Blank sheet', true)`,
      [campaignId],
    );
  });

  test.afterAll(async () => {
    if (database) {
      if (campaignId) {
        await database.query(`delete from public.campaigns where id = $1`, [campaignId]);
      }
      await database.end();
    }
  });

  test("uploads a PDF, previews it, and archives the version", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/characters/templates");
    await page.getByRole("link", { name: /blank sheet/i }).click();
    await expect(page).toHaveURL(/\/characters\/templates\/[0-9a-f-]{36}$/);

    await page
      .locator('input[type="file"]')
      .setInputFiles(join(referenceDir, referencePdf as string));
    await page.getByRole("button", { name: "Upload version" }).click();

    await expect(page.getByText(/Page 1 of/)).toBeVisible({
      timeout: persistenceTimeout,
    });
    await expect(page.getByText(/Version 1/)).toBeVisible();

    await page.getByRole("button", { name: /archive/i }).click();
    // Archiving the only active version clears the pointer, so the preview falls
    // back to its empty state.
    await expect(page.getByText("No PDF to preview")).toBeVisible({
      timeout: persistenceTimeout,
    });
  });
});
