// @vitest-environment node
//
// Database integration tests for Task 010: character classes, sheet templates,
// the characters links, cross-campaign integrity, RLS, and the create/update
// character functions.
//
// Requires a running local Supabase database. Skipped unless
// RUN_SUPABASE_DB_E2E=1. Connection string defaults to the standard local
// Supabase port and can be overridden with SUPABASE_DB_URL.
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

async function asUser<T>(
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
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

type Seed = {
  campaignId: string;
  activeClassId: string;
  inactiveClassId: string;
  blankTemplateId: string;
  classTemplateId: string;
  archivedTemplateId: string;
};

/**
 * Creates a campaign owned by the given user with an active class (whose default
 * is a class template), an inactive class, a blank template, and an archived
 * template. Assumes it runs inside an asUser transaction.
 */
async function seedCampaign(
  c: Client,
  userId: string,
  name: string,
): Promise<Seed> {
  const campaign = await c.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2) returning id`,
    [userId, name],
  );
  const campaignId = campaign.rows[0].id as string;

  const activeClass = await c.query(
    `insert into public.character_classes (campaign_id, name, is_active)
     values ($1, 'Guardian', true) returning id`,
    [campaignId],
  );
  const activeClassId = activeClass.rows[0].id as string;

  const inactiveClass = await c.query(
    `insert into public.character_classes (campaign_id, name, is_active)
     values ($1, 'Retired', false) returning id`,
    [campaignId],
  );
  const inactiveClassId = inactiveClass.rows[0].id as string;

  const blankTemplate = await c.query(
    `insert into public.sheet_templates
       (campaign_id, name, is_blank_template, status)
     values ($1, 'Blank', true, 'active') returning id`,
    [campaignId],
  );
  const blankTemplateId = blankTemplate.rows[0].id as string;

  const classTemplate = await c.query(
    `insert into public.sheet_templates (campaign_id, name, class_id, status)
     values ($1, 'Guardian sheet', $2, 'active') returning id`,
    [campaignId, activeClassId],
  );
  const classTemplateId = classTemplate.rows[0].id as string;

  const archivedTemplate = await c.query(
    `insert into public.sheet_templates (campaign_id, name, status)
     values ($1, 'Old sheet', 'archived') returning id`,
    [campaignId],
  );
  const archivedTemplateId = archivedTemplate.rows[0].id as string;

  await c.query(
    `update public.character_classes set default_template_id = $2 where id = $1`,
    [activeClassId, classTemplateId],
  );

  return {
    campaignId,
    activeClassId,
    inactiveClassId,
    blankTemplateId,
    classTemplateId,
    archivedTemplateId,
  };
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Character workspace schema (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`char-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`char-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("creates a character with an active class and template", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Create OK");
      const result = await c.query(
        `select * from public.create_character($1, $2, $3, $4, $5)`,
        [seed.campaignId, "Kodak", seed.activeClassId, seed.classTemplateId, "note"],
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].returned_name).toBe("Kodak");
      expect(result.rows[0].returned_status).toBe("active");
      expect(result.rows[0].returned_class_id).toBe(seed.activeClassId);
      expect(result.rows[0].returned_sheet_template_id).toBe(
        seed.classTemplateId,
      );
    });
  });

  it("allows a null template (campaign without one)", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Null template");
      const result = await c.query(
        `select * from public.create_character($1, $2, $3, null, '')`,
        [seed.campaignId, "No Sheet", seed.activeClassId],
      );
      expect(result.rows[0].returned_sheet_template_id).toBeNull();
    });
  });

  it("rejects an inactive class", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Inactive class");
      await expect(
        c.query(`select * from public.create_character($1, $2, $3, $4, '')`, [
          seed.campaignId,
          "Bad",
          seed.inactiveClassId,
          seed.blankTemplateId,
        ]),
      ).rejects.toThrow(/class is unavailable/i);
    });
  });

  it("rejects a blank name", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Blank name");
      await expect(
        c.query(`select * from public.create_character($1, '   ', $2, $3, '')`, [
          seed.campaignId,
          seed.activeClassId,
          seed.blankTemplateId,
        ]),
      ).rejects.toThrow(/name must contain/i);
    });
  });

  it("rejects an archived template", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Archived template");
      await expect(
        c.query(`select * from public.create_character($1, $2, $3, $4, '')`, [
          seed.campaignId,
          "Bad",
          seed.activeClassId,
          seed.archivedTemplateId,
        ]),
      ).rejects.toThrow(/template is unavailable/i);
    });
  });

  it("rejects a class from a different campaign", async () => {
    await asUser(userA, async (c) => {
      const target = await seedCampaign(c, userA, "Target");
      const other = await seedCampaign(c, userA, "Other");
      await expect(
        c.query(`select * from public.create_character($1, $2, $3, null, '')`, [
          target.campaignId,
          "Leak",
          other.activeClassId,
        ]),
      ).rejects.toThrow(/class is unavailable/i);
    });
  });

  it("rejects a template from a different campaign", async () => {
    await asUser(userA, async (c) => {
      const target = await seedCampaign(c, userA, "Target 2");
      const other = await seedCampaign(c, userA, "Other 2");
      await expect(
        c.query(`select * from public.create_character($1, $2, $3, $4, '')`, [
          target.campaignId,
          "Leak",
          target.activeClassId,
          other.classTemplateId,
        ]),
      ).rejects.toThrow(/template is unavailable/i);
    });
  });

  it("cannot create a character in another user's campaign", async () => {
    const ownedByA = await (async () => {
      // Persist a campaign owned by A (committed) so B can attempt to target it.
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userA, role: "authenticated" }),
      ]);
      const seed = await seedCampaign(client, userA, `Cross ${Date.now()}`);
      await client.query("commit");
      return seed;
    })();

    try {
      await expect(
        asUser(userB, (c) =>
          c.query(`select * from public.create_character($1, $2, $3, null, '')`, [
            ownedByA.campaignId,
            "Intruder",
            ownedByA.activeClassId,
          ]),
        ),
      ).rejects.toThrow(/not found or access denied/i);
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        ownedByA.campaignId,
      ]);
    }
  });

  it("blocks a direct cross-campaign class reference via the composite FK", async () => {
    await asUser(userA, async (c) => {
      const target = await seedCampaign(c, userA, "FK target");
      const other = await seedCampaign(c, userA, "FK other");
      await expect(
        c.query(
          `insert into public.characters (campaign_id, name, class_id)
           values ($1, 'Direct', $2)`,
          [target.campaignId, other.activeClassId],
        ),
      ).rejects.toThrow();
    });
  });

  it("does not auto-change a character's template when the class default changes", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Immutable template");
      const created = await c.query(
        `select character_id, returned_sheet_template_id
         from public.create_character($1, $2, $3, $4, '')`,
        [seed.campaignId, "Fixed", seed.activeClassId, seed.classTemplateId],
      );
      const characterId = created.rows[0].character_id as string;

      // Point the class at a different default template.
      const newDefault = await c.query(
        `insert into public.sheet_templates (campaign_id, name, class_id, status)
         values ($1, 'New Guardian sheet', $2, 'active') returning id`,
        [seed.campaignId, seed.activeClassId],
      );
      await c.query(
        `update public.character_classes set default_template_id = $2 where id = $1`,
        [seed.activeClassId, newDefault.rows[0].id],
      );

      const after = await c.query(
        `select sheet_template_id from public.characters where id = $1`,
        [characterId],
      );
      expect(after.rows[0].sheet_template_id).toBe(seed.classTemplateId);
    });
  });

  it("updates name, status, and notes and stamps archived_at", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "Update");
      const created = await c.query(
        `select character_id from public.create_character($1, $2, $3, $4, '')`,
        [seed.campaignId, "Zane", seed.activeClassId, seed.blankTemplateId],
      );
      const characterId = created.rows[0].character_id as string;

      const updated = await c.query(
        `select * from public.update_character($1, $2, $3, $4)`,
        [characterId, "Zane the Bold", "archived", "  archived hero "],
      );
      expect(updated.rows[0].returned_name).toBe("Zane the Bold");
      expect(updated.rows[0].returned_status).toBe("archived");
      expect(updated.rows[0].returned_notes).toBe("archived hero");

      const row = await c.query(
        `select status, archived_at from public.characters where id = $1`,
        [characterId],
      );
      expect(row.rows[0].status).toBe("archived");
      expect(row.rows[0].archived_at).not.toBeNull();
    });
  });

  it("enforces RLS and campaign isolation for classes, templates, and characters", async () => {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const seed = await seedCampaign(client, userA, `Isolation ${Date.now()}`);
    const created = await client.query(
      `select character_id from public.create_character($1, $2, $3, $4, '')`,
      [seed.campaignId, "Private", seed.activeClassId, seed.blankTemplateId],
    );
    const characterId = created.rows[0].character_id as string;
    await client.query("commit");

    try {
      await asUser(userA, async (c) => {
        const reads = [
          await c.query(`select 1 from public.character_classes where id = $1`, [
            seed.activeClassId,
          ]),
          await c.query(`select 1 from public.sheet_templates where id = $1`, [
            seed.blankTemplateId,
          ]),
          await c.query(`select 1 from public.characters where id = $1`, [
            characterId,
          ]),
        ];
        expect(reads.map((r) => r.rowCount)).toEqual([1, 1, 1]);
      });

      await asUser(userB, async (c) => {
        const reads = [
          await c.query(`select 1 from public.character_classes where id = $1`, [
            seed.activeClassId,
          ]),
          await c.query(`select 1 from public.sheet_templates where id = $1`, [
            seed.blankTemplateId,
          ]),
          await c.query(`select 1 from public.characters where id = $1`, [
            characterId,
          ]),
        ];
        expect(reads.map((r) => r.rowCount)).toEqual([0, 0, 0]);

        await expect(
          c.query(`select * from public.update_character($1, $2, $3, $4)`, [
            characterId,
            "Hijack",
            "active",
            "",
          ]),
        ).rejects.toThrow(/not found or access denied/i);
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        seed.campaignId,
      ]);
    }
  });

  it("keeps at most one blank template per campaign", async () => {
    await asUser(userA, async (c) => {
      const seed = await seedCampaign(c, userA, "One blank");
      await expect(
        c.query(
          `insert into public.sheet_templates
             (campaign_id, name, is_blank_template, status)
           values ($1, 'Another blank', true, 'active')`,
          [seed.campaignId],
        ),
      ).rejects.toThrow();
    });
  });
});
