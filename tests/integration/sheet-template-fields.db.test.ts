// @vitest-environment node
//
// Database integration tests for Task 011B: field definitions, the draft/publish
// layout lifecycle, immutability of published layouts, revisions, validation,
// RLS, and cross-campaign isolation.
//
// Requires a running local Supabase database. Skipped unless RUN_SUPABASE_DB_E2E=1.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

const enabled = process.env.RUN_SUPABASE_DB_E2E === "1";

let client: Client;
let userA: string;
let userB: string;

async function createAuthUser(email: string): Promise<string> {
  // Empty (not NULL) token columns keep GoTrue's admin/listUsers healthy even if
  // a run is interrupted before cleanup.
  const res = await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email,
       confirmation_token, recovery_token, email_change, email_change_token_new
     )
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
             'authenticated', 'authenticated', $1, '', '', '', '')
     returning id`,
    [email],
  );
  return res.rows[0].id as string;
}

async function asUser<T>(userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

type Setup = { campaignId: string; templateId: string; versionId: string };

/** Creates a campaign, a blank template, and a draft version (2 pages). */
async function setup(c: Client, userId: string, name: string): Promise<Setup> {
  const campaign = await c.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
    [userId, name],
  );
  const campaignId = campaign.rows[0].id as string;

  const template = await c.query(
    `insert into public.sheet_templates (campaign_id, name, is_blank_template, status)
     values ($1, 'Blank', true, 'active') returning id`,
    [campaignId],
  );
  const templateId = template.rows[0].id as string;

  const versionId = randomUUID();
  const path = `${campaignId}/${templateId}/${versionId}/source.pdf`;
  await c.query(
    `select version_id from public.create_sheet_template_version($1,$2,$3,$4,$5,$6,$7)`,
    [templateId, versionId, path, "sheet.pdf", 1024, "abc123", 2],
  );

  return { campaignId, templateId, versionId };
}

function field(overrides: Record<string, unknown> = {}) {
  return {
    field_key: "character_name",
    label: "Name",
    field_type: "text",
    page_number: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    configuration: {},
    display_order: 0,
    is_required: false,
    is_active: true,
    ...overrides,
  };
}

async function saveFields(c: Client, versionId: string, fields: unknown[]) {
  return c.query(
    `select public.save_sheet_template_fields($1, $2::jsonb) as saved`,
    [versionId, JSON.stringify(fields)],
  );
}

/**
 * Runs a query expected to fail inside a savepoint so the surrounding
 * transaction survives (a failed statement otherwise aborts it), and asserts the
 * error message.
 */
async function expectFail(
  c: Client,
  run: () => Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  await c.query("savepoint sp");
  let message: string | null = null;
  try {
    await run();
  } catch (error) {
    message = (error as Error).message;
  }
  await c.query("rollback to savepoint sp");
  expect(message, "expected the query to fail").not.toBeNull();
  expect(message ?? "").toMatch(matcher);
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Sheet template fields (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`field-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`field-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [[userA, userB]]);
      await client.end();
    }
  });

  it("saves a draft version's fields", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Save fields");
      const result = await saveFields(c, s.versionId, [
        field(),
        field({ field_key: "class_name", label: "Class", page_number: 2 }),
      ]);
      expect(result.rows[0].saved).toBe(2);

      const rows = await c.query(
        `select field_key from public.sheet_template_fields where template_version_id=$1 order by field_key`,
        [s.versionId],
      );
      expect(rows.rows.map((r) => r.field_key)).toEqual(["character_name", "class_name"]);
    });
  });

  it("allows reserved keys as ordinary fields", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Reserved keys");
      const result = await saveFields(c, s.versionId, [
        field({ field_key: "food_rations", field_type: "counter" }),
        field({ field_key: "wither_tokens", field_type: "number", y: 0.3 }),
      ]);
      expect(result.rows[0].saved).toBe(2);
    });
  });

  it("rejects invalid page, type, coordinates, and duplicate keys", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Invalid");
      await expectFail(c, () => saveFields(c, s.versionId, [field({ page_number: 3 })]), /invalid page/i);
      await expectFail(c, () => saveFields(c, s.versionId, [field({ field_type: "bogus" })]), /Unsupported field type/i);
      await expectFail(c, () => saveFields(c, s.versionId, [field({ x: 0.9, width: 0.5 })]), /coords_valid|check constraint/i);
      await expectFail(c, () => saveFields(c, s.versionId, [field(), field({ label: "dup" })]), /Duplicate field key/i);
    });
  });

  it("publishes a draft, sets it active, and blocks further edits", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Publish");
      await saveFields(c, s.versionId, [field()]);
      await c.query(`select public.publish_sheet_template_version($1)`, [s.versionId]);

      const version = await c.query(
        `select layout_status, published_at from public.sheet_template_versions where id=$1`,
        [s.versionId],
      );
      expect(version.rows[0].layout_status).toBe("published");
      expect(version.rows[0].published_at).not.toBeNull();

      const template = await c.query(
        `select active_version_id from public.sheet_templates where id=$1`,
        [s.templateId],
      );
      expect(template.rows[0].active_version_id).toBe(s.versionId);

      await expectFail(
        c,
        () => saveFields(c, s.versionId, [field()]),
        /Published layouts cannot be edited/i,
      );
    });
  });

  it("creates a draft revision from a published version, copying fields", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Revise");
      await saveFields(c, s.versionId, [field(), field({ field_key: "notes", field_type: "multiline_text", y: 0.4 })]);
      await c.query(`select public.publish_sheet_template_version($1)`, [s.versionId]);

      const newVersionId = randomUUID();
      const newPath = `${s.campaignId}/${s.templateId}/${newVersionId}/source.pdf`;
      const rev = await c.query(
        `select * from public.create_sheet_template_revision($1,$2,$3)`,
        [s.versionId, newVersionId, newPath],
      );
      expect(rev.rows[0].returned_layout_status).toBe("draft");
      expect(rev.rows[0].returned_version_number).toBe(2);

      const copied = await c.query(
        `select field_key from public.sheet_template_fields where template_version_id=$1 order by field_key`,
        [newVersionId],
      );
      expect(copied.rows.map((r) => r.field_key)).toEqual(["character_name", "notes"]);

      // The new draft is editable again.
      const saved = await saveFields(c, newVersionId, [field({ field_key: "level", field_type: "number" })]);
      expect(saved.rows[0].saved).toBe(1);
    });
  });

  it("rejects revising a draft version", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Revise draft");
      const newVersionId = randomUUID();
      const newPath = `${s.campaignId}/${s.templateId}/${newVersionId}/source.pdf`;
      await expectFail(
        c,
        () =>
          c.query(`select * from public.create_sheet_template_revision($1,$2,$3)`, [
            s.versionId,
            newVersionId,
            newPath,
          ]),
        /Only a published version can be revised/i,
      );
    });
  });

  it("enforces owner authorization and RLS", async () => {
    // Persist an owned version for A (committed) then confirm B is blocked.
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const s = await setup(client, userA, `RLS ${Date.now()}`);
    await saveFields(client, s.versionId, [field()]);
    await client.query("commit");

    try {
      await asUser(userB, async (c) => {
        await expectFail(
          c,
          () => saveFields(c, s.versionId, [field()]),
          /not found or access denied/i,
        );
        const read = await c.query(
          `select 1 from public.sheet_template_fields where template_version_id=$1`,
          [s.versionId],
        );
        expect(read.rowCount).toBe(0);
      });
      await asUser(userA, async (c) => {
        const read = await c.query(
          `select 1 from public.sheet_template_fields where template_version_id=$1`,
          [s.versionId],
        );
        expect(read.rowCount).toBe(1);
      });
    } finally {
      await client.query(`delete from public.campaigns where id=$1`, [s.campaignId]);
    }
  });

  it("blocks direct authenticated field writes (writes go through functions)", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Direct write");
      // Authenticated users have no INSERT grant; fields are written only by the
      // owner-authorized functions. This blocks arbitrary/cross-campaign inserts.
      await expectFail(
        c,
        () =>
          c.query(
            `insert into public.sheet_template_fields
               (campaign_id, template_version_id, field_key, label, field_type,
                page_number, x, y, width, height)
             values ($1, $2, 'x', 'X', 'text', 1, 0.1, 0.1, 0.1, 0.1)`,
            [s.campaignId, s.versionId],
          ),
        /permission denied/i,
      );
    });
  });

  it("rejects a cross-campaign field at the composite foreign key", async () => {
    // Run as the table owner (bypasses grants/RLS) to exercise the FK directly.
    const a = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
      [userA, `FKa ${Date.now()}`],
    );
    const b = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
      [userA, `FKb ${Date.now()}`],
    );
    const aId = a.rows[0].id as string;
    const bId = b.rows[0].id as string;
    try {
      const tpl = await client.query(
        `insert into public.sheet_templates (campaign_id, name, is_blank_template, status)
         values ($1, 'B', true, 'active') returning id`,
        [bId],
      );
      const bTemplate = tpl.rows[0].id as string;
      const bVersion = randomUUID();
      await client.query(
        `insert into public.sheet_template_versions
           (id, campaign_id, template_id, version_number, source_bucket,
            source_object_path, original_filename, mime_type, size_bytes, checksum, page_count, created_by)
         values ($1,$2,$3,1,'character-sheet-templates',$4,'s.pdf','application/pdf',1024,'x',1,$5)`,
        [bVersion, bId, bTemplate, `${bId}/${bTemplate}/${bVersion}/source.pdf`, userA],
      );
      // Field claims campaign A but references campaign B's version -> FK error.
      await expect(
        client.query(
          `insert into public.sheet_template_fields
             (campaign_id, template_version_id, field_key, label, field_type,
              page_number, x, y, width, height)
           values ($1, $2, 'x', 'X', 'text', 1, 0.1, 0.1, 0.1, 0.1)`,
          [aId, bVersion],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await client.query(`delete from public.campaigns where id = any($1)`, [[aId, bId]]);
    }
  });
});
