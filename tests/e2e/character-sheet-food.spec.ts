import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail = process.env.E2E_SHEETFOOD_TEST_EMAIL ?? "gm-sheetfood-e2e@example.com";
const testPassword =
  process.env.E2E_SHEETFOOD_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const persistenceTimeout = 20_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";
const referencePdf = "reference/official/Daggerheart - Gillus - Character Sheets US.pdf";
const BUCKET = "character-sheet-templates";

let database: Client;
let admin: ReturnType<typeof createClient>;
let userId = "";
let campaignId = "";
let characterId = "";
let objectPath = "";

test.describe("Character sheet food projection", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");
    test.skip(!existsSync(referencePdf), "Requires the reference PDF.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
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

    campaignId = (await database.query(`insert into public.campaigns (owner_id, name) values ($1,'Sheet Food') returning id`, [userId])).rows[0].id;
    const templateId = (await database.query(`insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'Sheet',false,'active') returning id`, [campaignId])).rows[0].id;
    const versionId = randomUUID();
    objectPath = `${campaignId}/${templateId}/${versionId}/source.pdf`;
    await database.query(
      `insert into public.sheet_template_versions
         (id, campaign_id, template_id, version_number, source_bucket, source_object_path,
          original_filename, mime_type, size_bytes, checksum, page_count, status, layout_status, published_at, created_by)
       values ($1,$2,$3,1,'character-sheet-templates',$4,'s.pdf','application/pdf',1024,'x',1,'active','published',now(),$5)`,
      [versionId, campaignId, templateId, objectPath, userId],
    );
    await database.query(`update public.sheet_templates set active_version_id=$1 where id=$2`, [versionId, templateId]);
    // A reserved food field and an ordinary editable field on page 1.
    await database.query(
      `insert into public.sheet_template_fields (campaign_id, template_version_id, field_key, label, field_type, page_number, x, y, width, height)
       values ($1,$2,'food_rations','Rations','number',1,0.15,0.15,0.2,0.05),
              ($1,$2,'strength','Strength','text',1,0.15,0.30,0.2,0.05)`,
      [campaignId, versionId],
    );
    characterId = (await database.query(
      `insert into public.characters (campaign_id, name, sheet_template_id, sheet_template_version_id, status)
       values ($1,'Kodak',$2,$3,'active') returning id`,
      [campaignId, templateId, versionId],
    )).rows[0].id;
    // 14 portions -> 2 rations.
    await database.query(
      `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
       values ($1,'Rations','preserved',1,14,14)`,
      [campaignId],
    );

    const uploaded = await admin.storage.from(BUCKET).upload(objectPath, readFileSync(referencePdf), { contentType: "application/pdf", upsert: true });
    if (uploaded.error) throw uploaded.error;
  });

  test.afterAll(async () => {
    if (admin && objectPath) await admin.storage.from(BUCKET).remove([objectPath]);
    if (database) {
      if (campaignId) await database.query(`delete from public.campaigns where id=$1`, [campaignId]);
      await database.end();
    }
  });

  test("renders reserved food field as a read-only domain value that updates with the store", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto(`/characters/${characterId}`);
    await page.getByRole("button", { name: "Character Sheet" }).click();

    // Reserved food field shows the projected rations (14 / 7 = 2), read-only.
    const rationsField = page.getByTitle("Rations (food store)");
    await expect(rationsField).toBeVisible({ timeout: persistenceTimeout });
    await expect(rationsField).toHaveText("2");
    // It is not an editable control.
    expect(await page.getByRole("spinbutton", { name: "Rations" }).count()).toBe(0);

    // The ordinary field remains editable and autosaves.
    const strength = page.getByLabel("Strength");
    await strength.fill("16");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: persistenceTimeout });

    // Changing the shared food store updates the projection after a refresh.
    await database.query(
      `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
       values ($1,'More','preserved',1,7,7)`,
      [campaignId],
    );
    await page.reload();
    await page.getByRole("button", { name: "Character Sheet" }).click();
    await expect(page.getByTitle("Rations (food store)")).toHaveText("3", { timeout: persistenceTimeout }); // 21 / 7
  });
});
