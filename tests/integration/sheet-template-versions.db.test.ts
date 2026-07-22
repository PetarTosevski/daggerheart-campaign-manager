// @vitest-environment node
//
// Database integration tests for Task 011A: sheet_template_versions, the
// active-version pointer, version RPCs, RLS, cross-campaign integrity, safe
// deletion (deferred FK), and storage-object authorization.
//
// Requires a running local Supabase database. Skipped unless
// RUN_SUPABASE_DB_E2E=1. Connection string can be overridden with SUPABASE_DB_URL.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const enabled = process.env.RUN_SUPABASE_DB_E2E === "1";

let client: Client;
let userA: string;
let userB: string;

async function createAuthUser(email: string): Promise<string> {
  const res = await client.query(
    `insert into auth.users (instance_id, id, aud, role, email)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
             'authenticated', 'authenticated', $1)
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

async function seedTemplate(
  c: Client,
  userId: string,
  name: string,
): Promise<{ campaignId: string; templateId: string }> {
  const campaign = await c.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
    [userId, name],
  );
  const campaignId = campaign.rows[0].id as string;
  const template = await c.query(
    `insert into public.sheet_templates (campaign_id, name, is_blank_template)
     values ($1, 'Blank', true) returning id`,
    [campaignId],
  );
  return { campaignId, templateId: template.rows[0].id as string };
}

async function createVersion(
  c: Client,
  campaignId: string,
  templateId: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const versionId = randomUUID();
  const path = `${campaignId}/${templateId}/${versionId}/source.pdf`;
  const res = await c.query(
    `select version_id, returned_version_number
     from public.create_sheet_template_version($1, $2, $3, $4, $5, $6, $7)`,
    [templateId, versionId, path, "source.pdf", 1000, "checksum-abc", 2],
  );
  return {
    versionId: res.rows[0].version_id as string,
    versionNumber: res.rows[0].returned_version_number as number,
  };
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Sheet template versions (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`stv-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`stv-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [[userA, userB]]);
      await client.end();
    }
  });

  it("creates versions with incrementing numbers and updates the active pointer", async () => {
    await asUser(userA, async (c) => {
      const { campaignId, templateId } = await seedTemplate(c, userA, "Incr");
      const v1 = await createVersion(c, campaignId, templateId);
      expect(v1.versionNumber).toBe(1);

      let active = await c.query(
        `select active_version_id from public.sheet_templates where id = $1`,
        [templateId],
      );
      expect(active.rows[0].active_version_id).toBe(v1.versionId);

      const v2 = await createVersion(c, campaignId, templateId);
      expect(v2.versionNumber).toBe(2);
      active = await c.query(
        `select active_version_id from public.sheet_templates where id = $1`,
        [templateId],
      );
      expect(active.rows[0].active_version_id).toBe(v2.versionId);
    });
  });

  it("rejects a mismatched storage path", async () => {
    await asUser(userA, async (c) => {
      const { templateId } = await seedTemplate(c, userA, "Bad path");
      const versionId = randomUUID();
      await expect(
        c.query(
          `select public.create_sheet_template_version($1, $2, $3, $4, $5, $6, $7)`,
          [templateId, versionId, "wrong/path/x/source.pdf", "s.pdf", 1000, "c", 2],
        ),
      ).rejects.toThrow(/storage path is invalid/i);
    });
  });

  it("rejects uploads to an archived template", async () => {
    await asUser(userA, async (c) => {
      const { campaignId, templateId } = await seedTemplate(c, userA, "Archived");
      await c.query(
        `update public.sheet_templates set status = 'archived' where id = $1`,
        [templateId],
      );
      const versionId = randomUUID();
      const path = `${campaignId}/${templateId}/${versionId}/source.pdf`;
      await expect(
        c.query(
          `select public.create_sheet_template_version($1, $2, $3, $4, $5, $6, $7)`,
          [templateId, versionId, path, "s.pdf", 1000, "c", 2],
        ),
      ).rejects.toThrow(/not active/i);
    });
  });

  it("cannot create a version on another user's template", async () => {
    const owned = await (async () => {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userA, role: "authenticated" }),
      ]);
      const seed = await seedTemplate(client, userA, `CrossTmpl ${Date.now()}`);
      await client.query("commit");
      return seed;
    })();

    try {
      await expect(
        asUser(userB, (c) => {
          const versionId = randomUUID();
          const path = `${owned.campaignId}/${owned.templateId}/${versionId}/source.pdf`;
          return c.query(
            `select public.create_sheet_template_version($1, $2, $3, $4, $5, $6, $7)`,
            [owned.templateId, versionId, path, "s.pdf", 1000, "c", 2],
          );
        }),
      ).rejects.toThrow(/not found or access denied/i);
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        owned.campaignId,
      ]);
    }
  });

  it("blocks silent deletion of the active version (deferred FK)", async () => {
    await asUser(userA, async (c) => {
      const { campaignId, templateId } = await seedTemplate(c, userA, "SafeDelete");
      const v1 = await createVersion(c, campaignId, templateId);
      await c.query(`delete from public.sheet_template_versions where id = $1`, [
        v1.versionId,
      ]);
      // The deferred foreign key fires when constraints are forced immediate.
      await expect(c.query("set constraints all immediate")).rejects.toThrow();
    });
  });

  it("allows deleting a non-active version", async () => {
    await asUser(userA, async (c) => {
      const { campaignId, templateId } = await seedTemplate(c, userA, "DeleteOld");
      const v1 = await createVersion(c, campaignId, templateId);
      await createVersion(c, campaignId, templateId); // v2 becomes active
      const del = await c.query(
        `delete from public.sheet_template_versions where id = $1`,
        [v1.versionId],
      );
      expect(del.rowCount).toBe(1);
      await expect(c.query("set constraints all immediate")).resolves.toBeDefined();
    });
  });

  it("archives the active version and moves the pointer, then clears it", async () => {
    await asUser(userA, async (c) => {
      const { campaignId, templateId } = await seedTemplate(c, userA, "Archive");
      const v1 = await createVersion(c, campaignId, templateId);
      const v2 = await createVersion(c, campaignId, templateId);

      await c.query(`select public.archive_sheet_template_version($1)`, [v2.versionId]);
      let active = await c.query(
        `select active_version_id from public.sheet_templates where id = $1`,
        [templateId],
      );
      expect(active.rows[0].active_version_id).toBe(v1.versionId);

      await c.query(`select public.archive_sheet_template_version($1)`, [v1.versionId]);
      active = await c.query(
        `select active_version_id from public.sheet_templates where id = $1`,
        [templateId],
      );
      expect(active.rows[0].active_version_id).toBeNull();
    });
  });

  it("blocks a direct cross-campaign version via the composite FK", async () => {
    // Runs as the table owner (bypasses RLS/grants) so the composite foreign
    // key is what rejects the cross-campaign reference.
    await client.query("begin");
    try {
      const a = await client.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'FK A') returning id`,
        [userA],
      );
      const campaignA = a.rows[0].id as string;
      const b = await client.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'FK B') returning id`,
        [userA],
      );
      const campaignB = b.rows[0].id as string;
      const tmplB = await client.query(
        `insert into public.sheet_templates (campaign_id, name) values ($1, 'B tmpl') returning id`,
        [campaignB],
      );
      await expect(
        client.query(
          `insert into public.sheet_template_versions
             (campaign_id, template_id, version_number, source_bucket,
              source_object_path, original_filename, mime_type, size_bytes,
              checksum, page_count, created_by)
           values ($1, $2, 1, 'character-sheet-templates', $3, 's.pdf',
                   'application/pdf', 1000, 'c', 2, $4)`,
          [campaignA, tmplB.rows[0].id, `${campaignA}/x/y/source.pdf`, userA],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("rollback");
    }
  });

  it("enforces RLS: user B cannot read or mutate user A's versions", async () => {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const seed = await seedTemplate(client, userA, `RLS ${Date.now()}`);
    const v1 = await createVersion(client, seed.campaignId, seed.templateId);
    await client.query("commit");

    try {
      await asUser(userA, async (c) => {
        const r = await c.query(
          `select 1 from public.sheet_template_versions where id = $1`,
          [v1.versionId],
        );
        expect(r.rowCount).toBe(1);
      });

      await asUser(userB, async (c) => {
        const r = await c.query(
          `select 1 from public.sheet_template_versions where id = $1`,
          [v1.versionId],
        );
        expect(r.rowCount).toBe(0);

        await expect(
          c.query(`select public.archive_sheet_template_version($1)`, [v1.versionId]),
        ).rejects.toThrow(/not found or access denied/i);
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        seed.campaignId,
      ]);
    }
  });

  it("authorizes storage objects by campaign folder", async () => {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const a = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Storage A') returning id`,
      [userA],
    );
    const campaignA = a.rows[0].id as string;
    await client.query("commit");

    const b = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Storage B') returning id`,
      [userB],
    );
    const campaignB = b.rows[0].id as string;

    try {
      // User A may write under their own campaign folder.
      await asUser(userA, async (c) => {
        const ok = await c.query(
          `insert into storage.objects (bucket_id, name, owner)
           values ('character-sheet-templates', $1, $2) returning id`,
          [`${campaignA}/t/v/source.pdf`, userA],
        );
        expect(ok.rowCount).toBe(1);
      });

      // User A may not write under another campaign's folder.
      await expect(
        asUser(userA, (c) =>
          c.query(
            `insert into storage.objects (bucket_id, name, owner)
             values ('character-sheet-templates', $1, $2)`,
            [`${campaignB}/t/v/source.pdf`, userA],
          ),
        ),
      ).rejects.toThrow();
    } finally {
      // The storage.objects inserts above run inside rolled-back asUser
      // transactions, so only the committed campaigns need cleanup here.
      await client.query(`delete from public.campaigns where id = any($1)`, [
        [campaignA, campaignB],
      ]);
    }
  });
});
