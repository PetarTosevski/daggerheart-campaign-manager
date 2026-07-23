// @vitest-environment node
//
// Database integration tests for Task 011C: version pinning, runtime value
// storage, validation, optimistic concurrency, RLS/isolation, and the invariant
// that publishing a new version does not change an existing character.
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

async function expectFail(c: Client, run: () => Promise<unknown>, matcher: RegExp) {
  await c.query("savepoint sp");
  let message: string | null = null;
  try {
    await run();
  } catch (e) {
    message = (e as Error).message;
  }
  await c.query("rollback to savepoint sp");
  expect(message, "expected the query to fail").not.toBeNull();
  expect(message ?? "").toMatch(matcher);
}

const FIELDS = [
  { field_key: "strength", label: "Strength", field_type: "text", page_number: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05, configuration: {}, is_active: true },
  { field_key: "level", label: "Level", field_type: "number", page_number: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05, configuration: { min: 1 }, is_active: true },
  { field_key: "stance", label: "Stance", field_type: "select", page_number: 1, x: 0.1, y: 0.3, width: 0.2, height: 0.05, configuration: { options: ["guard", "attack"] }, is_active: true },
  { field_key: "total", label: "Total", field_type: "computed", page_number: 1, x: 0.1, y: 0.4, width: 0.2, height: 0.05, configuration: {}, is_active: true },
  { field_key: "fixed", label: "Fixed", field_type: "text", page_number: 1, x: 0.1, y: 0.5, width: 0.2, height: 0.05, configuration: { readOnly: true }, is_active: true },
];

type Setup = {
  campaignId: string;
  templateId: string;
  versionId: string;
  characterId: string;
  fields: Record<string, string>;
};

async function publishedTemplateVersion(
  c: Client,
  userId: string,
  campaignId: string,
  templateId: string,
  fields = FIELDS,
): Promise<string> {
  const versionId = randomUUID();
  const path = `${campaignId}/${templateId}/${versionId}/source.pdf`;
  await c.query(
    `select public.create_sheet_template_version($1,$2,$3,'s.pdf',1024,'x',1)`,
    [templateId, versionId, path],
  );
  await c.query(`select public.save_sheet_template_fields($1, $2::jsonb)`, [
    versionId,
    JSON.stringify(fields),
  ]);
  await c.query(`select public.publish_sheet_template_version($1)`, [versionId]);
  return versionId;
}

async function fieldIds(c: Client, versionId: string): Promise<Record<string, string>> {
  const r = await c.query(
    `select id, field_key from public.sheet_template_fields where template_version_id = $1`,
    [versionId],
  );
  const map: Record<string, string> = {};
  for (const row of r.rows) map[row.field_key] = row.id;
  return map;
}

async function setup(c: Client, userId: string, name: string): Promise<Setup> {
  const campaign = await c.query(
    `insert into public.campaigns (owner_id, name) values ($1,$2) returning id`,
    [userId, name],
  );
  const campaignId = campaign.rows[0].id as string;
  const cls = await c.query(
    `insert into public.character_classes (campaign_id, name, is_active) values ($1,'Guardian',true) returning id`,
    [campaignId],
  );
  const template = await c.query(
    `insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'Sheet',true,'active') returning id`,
    [campaignId],
  );
  const templateId = template.rows[0].id as string;
  const versionId = await publishedTemplateVersion(c, userId, campaignId, templateId);
  const created = await c.query(
    `select character_id from public.create_character($1,'Kodak',$2,$3,'')`,
    [campaignId, cls.rows[0].id, templateId],
  );
  return {
    campaignId,
    templateId,
    versionId,
    characterId: created.rows[0].character_id,
    fields: await fieldIds(c, versionId),
  };
}

async function saveValue(c: Client, characterId: string, fieldId: string, value: string | null, expected: string | null) {
  // Return updated_at as text at full precision so it can be echoed back as the
  // optimistic-concurrency token (mirrors PostgREST's ISO serialization; the raw
  // pg driver would otherwise truncate microseconds via a JS Date).
  return c.query(
    `select value_id, returned_value, returned_updated_at::text as returned_updated_at
     from public.save_character_sheet_value($1,$2,$3,$4)`,
    [characterId, fieldId, value, expected],
  );
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Character sheet runtime (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`sheet-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`sheet-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [[userA, userB]]);
      await client.end();
    }
  });

  it("pins a new character to the current published version at creation", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Pin at create");
      const r = await c.query(
        `select sheet_template_version_id from public.characters where id = $1`,
        [s.characterId],
      );
      expect(r.rows[0].sheet_template_version_id).toBe(s.versionId);
    });
  });

  it("creates then updates a value with optimistic concurrency (one row per field)", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Values");
      const first = await saveValue(c, s.characterId, s.fields.strength, "16", null);
      const updatedAt = first.rows[0].returned_updated_at as string;
      expect(first.rows[0].returned_value).toBe("16");

      const second = await saveValue(c, s.characterId, s.fields.strength, "18", updatedAt);
      expect(second.rows[0].returned_value).toBe("18");

      const count = await c.query(
        `select count(*)::int as n from public.character_sheet_values where character_id=$1 and template_field_id=$2`,
        [s.characterId, s.fields.strength],
      );
      expect(count.rows[0].n).toBe(1);

      // A stale expected timestamp is rejected.
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.strength, "20", null), /changed since you last loaded/i);
    });
  });

  it("validates by field type and rejects computed/read-only writes", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Validation");
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.level, "abc", null), /must be a number/i);
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.level, "0", null), /below the allowed minimum/i);
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.stance, "flee", null), /not an allowed option/i);
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.total, "5", null), /computed and read-only/i);
      await expectFail(c, () => saveValue(c, s.characterId, s.fields.fixed, "x", null), /computed and read-only/i);
      // Valid option and number succeed.
      expect((await saveValue(c, s.characterId, s.fields.stance, "guard", null)).rows[0].returned_value).toBe("guard");
      expect((await saveValue(c, s.characterId, s.fields.level, "3", null)).rows[0].returned_value).toBe("3");
    });
  });

  it("rejects unknown fields, fields from another version, and another campaign", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Mismatch");
      // Field from a second version of the same template.
      const otherVersion = await publishedTemplateVersion(c, userA, s.campaignId, s.templateId);
      const otherFields = await fieldIds(c, otherVersion);
      await expectFail(c, () => saveValue(c, s.characterId, otherFields.strength, "1", null), /does not belong to the character/i);

      // Field from another campaign entirely.
      const other = await setup(c, userA, "Other campaign");
      await expectFail(c, () => saveValue(c, s.characterId, other.fields.strength, "1", null), /not found in this campaign/i);

      // Unknown field id.
      await expectFail(c, () => saveValue(c, s.characterId, randomUUID(), "1", null), /not found in this campaign/i);
    });
  });

  it("enforces owner-only access and RLS", async () => {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const s = await setup(client, userA, `RLS ${Date.now()}`);
    await saveValue(client, s.characterId, s.fields.strength, "12", null);
    await client.query("commit");

    try {
      await asUser(userB, async (c) => {
        await expectFail(c, () => saveValue(c, s.characterId, s.fields.strength, "99", null), /not found or access denied/i);
        const read = await c.query(`select 1 from public.character_sheet_values where character_id=$1`, [s.characterId]);
        expect(read.rowCount).toBe(0);
      });
      await asUser(userA, async (c) => {
        const read = await c.query(`select 1 from public.character_sheet_values where character_id=$1`, [s.characterId]);
        expect(read.rowCount).toBe(1);
      });
    } finally {
      await client.query(`delete from public.campaigns where id=$1`, [s.campaignId]);
    }
  });

  it("does not change an existing character's pin when a newer version is published", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Immutable pin");
      // Revise + publish a new version; the template's active version moves on.
      const newVersionId = randomUUID();
      const newPath = `${s.campaignId}/${s.templateId}/${newVersionId}/source.pdf`;
      await c.query(`select public.create_sheet_template_revision($1,$2,$3)`, [s.versionId, newVersionId, newPath]);
      await c.query(`select public.publish_sheet_template_version($1)`, [newVersionId]);

      const template = await c.query(`select active_version_id from public.sheet_templates where id=$1`, [s.templateId]);
      expect(template.rows[0].active_version_id).toBe(newVersionId);

      const character = await c.query(`select sheet_template_version_id from public.characters where id=$1`, [s.characterId]);
      expect(character.rows[0].sheet_template_version_id).toBe(s.versionId); // still v1

      // A brand-new character receives the current published version.
      const cls = await c.query(`select id from public.character_classes where campaign_id=$1 limit 1`, [s.campaignId]);
      const created = await c.query(
        `select character_id from public.create_character($1,'New Hero',$2,$3,'')`,
        [s.campaignId, cls.rows[0].id, s.templateId],
      );
      const fresh = await c.query(`select sheet_template_version_id from public.characters where id=$1`, [created.rows[0].character_id]);
      expect(fresh.rows[0].sheet_template_version_id).toBe(newVersionId);
    });
  });

  it("pin_character_sheet_version assigns a published version, but not a draft or when already pinned", async () => {
    await asUser(userA, async (c) => {
      const s = await setup(c, userA, "Pin action");
      // Already pinned -> rejected.
      await expectFail(c, () => c.query(`select public.pin_character_sheet_version($1)`, [s.characterId]), /already pinned/i);

      // Unpinned character on a published template -> assigns.
      const cls = await c.query(`select id from public.character_classes where campaign_id=$1 limit 1`, [s.campaignId]);
      const unpinned = await c.query(
        `insert into public.characters (campaign_id, name, class_id, sheet_template_id) values ($1,'Legacy',$2,$3) returning id`,
        [s.campaignId, cls.rows[0].id, s.templateId],
      );
      const pinned = await c.query(`select * from public.pin_character_sheet_version($1)`, [unpinned.rows[0].id]);
      expect(pinned.rows[0].returned_version_id).toBe(s.versionId);

      // Template whose active version is only a draft -> cannot assign.
      const draftTemplate = await c.query(
        `insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'Draft tpl',false,'active') returning id`,
        [s.campaignId],
      );
      const draftVersion = randomUUID();
      await c.query(
        `select public.create_sheet_template_version($1,$2,$3,'d.pdf',1024,'x',1)`,
        [draftTemplate.rows[0].id, draftVersion, `${s.campaignId}/${draftTemplate.rows[0].id}/${draftVersion}/source.pdf`],
      );
      const draftChar = await c.query(
        `insert into public.characters (campaign_id, name, class_id, sheet_template_id) values ($1,'Draftling',$2,$3) returning id`,
        [s.campaignId, cls.rows[0].id, draftTemplate.rows[0].id],
      );
      await expectFail(c, () => c.query(`select public.pin_character_sheet_version($1)`, [draftChar.rows[0].id]), /no published version/i);
    });
  });

  it("blocks a direct cross-campaign value via the composite foreign key", async () => {
    // As the table owner (bypasses grants/RLS) to exercise the FK directly.
    const campA = await client.query(`insert into public.campaigns (owner_id, name) values ($1,$2) returning id`, [userA, `vA ${Date.now()}`]);
    const campB = await client.query(`insert into public.campaigns (owner_id, name) values ($1,$2) returning id`, [userA, `vB ${Date.now()}`]);
    const aId = campA.rows[0].id as string;
    const bId = campB.rows[0].id as string;
    try {
      const cls = await client.query(`insert into public.character_classes (campaign_id, name, is_active) values ($1,'C',true) returning id`, [aId]);
      const charA = await client.query(`insert into public.characters (campaign_id, name, class_id) values ($1,'A',$2) returning id`, [aId, cls.rows[0].id]);
      // A field that lives in campaign B.
      const tplB = await client.query(`insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'B',true,'active') returning id`, [bId]);
      const verB = randomUUID();
      await client.query(
        `insert into public.sheet_template_versions (id, campaign_id, template_id, version_number, source_bucket, source_object_path, original_filename, mime_type, size_bytes, checksum, page_count, created_by)
         values ($1,$2,$3,1,'character-sheet-templates',$4,'s.pdf','application/pdf',1024,'x',1,$5)`,
        [verB, bId, tplB.rows[0].id, `${bId}/${tplB.rows[0].id}/${verB}/source.pdf`, userA],
      );
      const fieldB = await client.query(
        `insert into public.sheet_template_fields (campaign_id, template_version_id, field_key, label, field_type, page_number, x, y, width, height)
         values ($1,$2,'k','K','text',1,0.1,0.1,0.1,0.1) returning id`,
        [bId, verB],
      );
      await expect(
        client.query(
          `insert into public.character_sheet_values (campaign_id, character_id, template_field_id, field_key, value_type)
           values ($1,$2,$3,'k','text')`,
          [aId, charA.rows[0].id, fieldB.rows[0].id],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await client.query(`delete from public.campaigns where id = any($1)`, [[aId, bId]]);
    }
  });
});
