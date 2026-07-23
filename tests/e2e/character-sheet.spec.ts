import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_SHEET_TEST_EMAIL ?? "gm-sheet-e2e@example.com";
const testPassword =
  process.env.E2E_SHEET_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const persistenceTimeout = 20_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";
const referencePdf =
  "reference/official/Daggerheart - Gillus - Character Sheets US.pdf";
const BUCKET = "character-sheet-templates";

let database: Client;
let userId = "";
let campaignId = "";
let characterId = "";
let objectPath = "";
let admin: ReturnType<typeof createClient>;

test.describe("Character Sheet runtime", () => {
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

    // Direct inserts (as the DB superuser) build a character pinned to a
    // published version; the RPCs require an auth context, so setup bypasses them.
    const campaign = await database.query(
      `insert into public.campaigns (owner_id, name) values ($1,'Sheet E2E') returning id`,
      [userId],
    );
    campaignId = campaign.rows[0].id as string;
    const cls = await database.query(
      `insert into public.character_classes (campaign_id, name, is_active) values ($1,'Guardian',true) returning id`,
      [campaignId],
    );
    const template = await database.query(
      `insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'Guardian sheet',false,'active') returning id`,
      [campaignId],
    );
    const templateId = template.rows[0].id as string;
    const versionId = randomUUID();
    objectPath = `${campaignId}/${templateId}/${versionId}/source.pdf`;
    await database.query(
      `insert into public.sheet_template_versions
         (id, campaign_id, template_id, version_number, source_bucket, source_object_path,
          original_filename, mime_type, size_bytes, checksum, page_count, status, layout_status, published_at, created_by)
       values ($1,$2,$3,1,'character-sheet-templates',$4,'sheet.pdf','application/pdf',1024,'x',1,'active','published',now(),$5)`,
      [versionId, campaignId, templateId, objectPath, userId],
    );
    await database.query(`update public.sheet_templates set active_version_id=$1 where id=$2`, [versionId, templateId]);
    await database.query(
      `insert into public.sheet_template_fields
         (campaign_id, template_version_id, field_key, label, field_type, page_number, x, y, width, height)
       values ($1,$2,'strength','Strength','text',1,0.15,0.15,0.25,0.05)`,
      [campaignId, versionId],
    );
    const character = await database.query(
      `insert into public.characters (campaign_id, name, class_id, sheet_template_id, sheet_template_version_id, status)
       values ($1,'Kodak',$2,$3,$4,'active') returning id`,
      [campaignId, cls.rows[0].id, templateId, versionId],
    );
    characterId = character.rows[0].id as string;

    // Upload a real PDF so the runtime can render and sign a URL.
    const bytes = readFileSync(referencePdf);
    const uploaded = await admin.storage
      .from(BUCKET)
      .upload(objectPath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploaded.error) throw uploaded.error;
  });

  test.afterAll(async () => {
    if (admin && objectPath) {
      await admin.storage.from(BUCKET).remove([objectPath]);
    }
    if (database) {
      if (campaignId) await database.query(`delete from public.campaigns where id=$1`, [campaignId]);
      await database.end();
    }
  });

  test("renders the pinned sheet, autosaves an edit, and persists after reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto(`/characters/${characterId}`);
    await page.getByRole("button", { name: "Character Sheet" }).click();

    // The overlay field renders once the pinned PDF page has rendered.
    const field = page.getByLabel("Strength");
    await expect(field).toBeVisible({ timeout: persistenceTimeout });

    await field.fill("18");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: persistenceTimeout });

    // Value persisted in the database.
    await expect
      .poll(
        async () => {
          const r = await database.query(
            `select value from public.character_sheet_values where character_id=$1`,
            [characterId],
          );
          return r.rows[0]?.value;
        },
        { timeout: persistenceTimeout },
      )
      .toBe("18");

    // Survives a reload.
    await page.reload();
    await page.getByRole("button", { name: "Character Sheet" }).click();
    await expect(page.getByLabel("Strength")).toHaveValue("18", { timeout: persistenceTimeout });
  });
});
