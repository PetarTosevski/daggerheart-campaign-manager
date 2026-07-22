import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_EDITOR_TEST_EMAIL ?? "gm-editor-e2e@example.com";
const testPassword =
  process.env.E2E_EDITOR_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

let userId = "";
let templateId = "";
let versionId = "";
let database: Client;

test.describe("Sheet Template Editor", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error("E2E_EDITOR_TEST_PASSWORD or E2E_TEST_PASSWORD must be set.");
    }

    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = users.users.find((u) => u.email === testEmail);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        password: testPassword,
        email_confirm: true,
      });
      userId = existing.id;
    } else {
      const { data } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
      userId = data.user!.id;
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query(`delete from public.campaigns where owner_id = $1`, [userId]);

    const campaign = await database.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Editor E2E') returning id`,
      [userId],
    );
    const campaignId = campaign.rows[0].id as string;
    const template = await database.query(
      `insert into public.sheet_templates (campaign_id, name, is_blank_template, status)
       values ($1, 'Editor Template', true, 'active') returning id`,
      [campaignId],
    );
    templateId = template.rows[0].id as string;
    versionId = randomUUID();
    await database.query(
      `insert into public.sheet_template_versions
         (id, campaign_id, template_id, version_number, source_bucket,
          source_object_path, original_filename, mime_type, size_bytes, checksum, page_count, created_by)
       values ($1,$2,$3,1,'character-sheet-templates',$4,'s.pdf','application/pdf',1024,'x',2,$5)`,
      [
        versionId,
        campaignId,
        templateId,
        `${campaignId}/${templateId}/${versionId}/source.pdf`,
        userId,
      ],
    );
  });

  test.afterAll(async () => {
    if (database) {
      if (userId) {
        await database.query(`delete from public.campaigns where owner_id = $1`, [userId]);
      }
      await database.end();
    }
  });

  test("adds a field, saves the layout, and publishes it", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto(`/characters/templates/${templateId}/edit/${versionId}`);
    await expect(page.getByText("Add field")).toBeVisible();
    await expect(page.getByText("Draft")).toBeVisible();

    // Add a text field via the toolbar (does not depend on the PDF canvas).
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await expect(page.getByText("Field", { exact: true })).toBeVisible();
    // The inspector opens with the generated key for the new field.
    await expect(page.getByLabel("Key")).toHaveValue("text_field");

    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText(/Saved 1 field/i)).toBeVisible({
      timeout: persistenceTimeout,
    });

    // The field persisted.
    const fields = await database.query(
      `select field_key from public.sheet_template_fields where template_version_id = $1`,
      [versionId],
    );
    expect(fields.rows.map((r) => r.field_key)).toContain("text_field");

    // Publish becomes available once changes are saved.
    await page.getByRole("button", { name: "Publish layout" }).click();

    // The database is the source of truth for the published state.
    await expect
      .poll(
        async () => {
          const version = await database.query(
            `select layout_status from public.sheet_template_versions where id = $1`,
            [versionId],
          );
          return version.rows[0]?.layout_status;
        },
        { timeout: persistenceTimeout },
      )
      .toBe("published");

    // After the soft refresh the editor reflects the read-only published state.
    await expect(
      page.getByRole("button", { name: /create draft revision/i }),
    ).toBeVisible({ timeout: persistenceTimeout });
  });
});
