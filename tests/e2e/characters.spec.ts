import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const liveEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail =
  process.env.E2E_CHARACTER_TEST_EMAIL ?? "gm-character-e2e@example.com";
const testPassword =
  process.env.E2E_CHARACTER_TEST_PASSWORD ?? process.env.E2E_TEST_PASSWORD ?? "";
const campaignName = "Character Workspace E2E";
const characterName = "Kodak the Steadfast";
const persistenceTimeout = 15_000;
const databaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let campaignId = "";
let database: Client;

test.describe("Character Workspace", () => {
  test.beforeAll(async () => {
    test.skip(!liveEnabled, "Requires a running local Supabase instance.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (!testPassword) {
      throw new Error(
        "E2E_CHARACTER_TEST_PASSWORD or E2E_TEST_PASSWORD must be configured.",
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
      `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
      [userId, campaignName],
    );
    campaignId = campaign.rows[0].id as string;

    // Seed a class with a default template and a blank fallback template so the
    // guided builder can suggest a template.
    const guardian = await database.query(
      `insert into public.character_classes (campaign_id, name, is_active)
       values ($1, 'Guardian', true) returning id`,
      [campaignId],
    );
    await database.query(
      `insert into public.sheet_templates
         (campaign_id, name, is_blank_template, status)
       values ($1, 'Blank sheet', true, 'active')`,
      [campaignId],
    );
    const guardianTemplate = await database.query(
      `insert into public.sheet_templates (campaign_id, name, class_id, status)
       values ($1, 'Guardian sheet', $2, 'active') returning id`,
      [campaignId, guardian.rows[0].id],
    );
    await database.query(
      `update public.character_classes set default_template_id = $2 where id = $1`,
      [guardian.rows[0].id, guardianTemplate.rows[0].id],
    );
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

  test("creates a character, opens the workspace, and persists notes", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Characters" }).click();
    await expect(page).toHaveURL(/\/characters$/);

    await page.getByRole("link", { name: /new character/i }).first().click();
    await expect(page).toHaveURL(/\/characters\/new$/);

    await page.getByLabel("Name").fill(characterName);
    await page.getByLabel("Class").selectOption({ label: "Guardian" });
    await page.getByRole("button", { name: "Create character" }).click();

    // Create -> open the new character workspace.
    await expect(page).toHaveURL(/\/characters\/[0-9a-f-]{36}$/, {
      timeout: persistenceTimeout,
    });
    await expect(
      page.getByRole("heading", { name: characterName, level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Notes" }).click();
    const notesField = page.getByPlaceholder(
      "Record plot hooks, secrets, and reminders.",
    );
    await notesField.fill("Guards the north gate.");
    await page.getByRole("button", { name: "Save notes" }).click();

    // A successful save reloads the workspace, resetting it to Overview. Wait for
    // that before re-opening Notes so the assertion reflects persisted state.
    await expect(
      page.getByRole("button", { name: "Save overview" }),
    ).toBeVisible({ timeout: persistenceTimeout });
    await page.getByRole("button", { name: "Notes" }).click();
    await expect(
      page.getByPlaceholder("Record plot hooks, secrets, and reminders."),
    ).toHaveValue("Guards the north gate.", { timeout: persistenceTimeout });
  });
});
