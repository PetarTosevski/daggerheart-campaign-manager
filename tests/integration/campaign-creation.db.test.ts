// @vitest-environment node
//
// Database integration tests for authenticated campaign creation (the empty-state
// fix). Verifies owner-scoped RLS insert, the canonical initial state seeded by
// the trigger, cross-user isolation, and the name constraint.
//
// Requires a running local Supabase database. Skipped unless RUN_SUPABASE_DB_E2E=1.
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

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Campaign creation (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`camp-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`camp-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [[userA, userB]]);
      await client.end();
    }
  });

  it("lets an owner create a campaign with exactly one canonical initial state", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'My Campaign')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id as string;

      const state = await c.query(
        `select current_week, current_cycle, current_cycle_day, current_fear
         from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rowCount).toBe(1);
      expect(state.rows[0]).toMatchObject({
        current_week: 1,
        current_cycle: "DAY",
        current_cycle_day: 1,
        current_fear: 0,
      });
    });
  });

  it("rejects creating a campaign owned by another user", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `insert into public.campaigns (owner_id, name) values ($1, 'Not Mine')`,
          [userB],
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects a whitespace-only campaign name", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `insert into public.campaigns (owner_id, name) values ($1, '   ')`,
          [userA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects a duplicate campaign name for the same owner (case-insensitive)", async () => {
    await asUser(userA, async (c) => {
      await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'The Witherwild')`,
        [userA],
      );
      await expect(
        c.query(
          `insert into public.campaigns (owner_id, name) values ($1, 'the witherwild')`,
          [userA],
        ),
      ).rejects.toThrow(/campaigns_owner_name_unique|duplicate key/i);
    });
  });

  it("allows the same campaign name for different owners", async () => {
    // Persist for A, then confirm B can use the same name.
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const a = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Shared Name')
       returning id`,
      [userA],
    );
    const aId = a.rows[0].id as string;
    await client.query("commit");

    try {
      await asUser(userB, async (c) => {
        const b = await c.query(
          `insert into public.campaigns (owner_id, name) values ($1, 'Shared Name')
           returning id`,
          [userB],
        );
        expect(b.rowCount).toBe(1);
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [aId]);
    }
  });

  it("does not let a user read another user's campaign", async () => {
    // Persist a campaign owned by A (committed) then confirm B cannot see it.
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const campaign = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Private A')
       returning id`,
      [userA],
    );
    const campaignId = campaign.rows[0].id as string;
    await client.query("commit");

    try {
      await asUser(userA, async (c) => {
        const r = await c.query(`select 1 from public.campaigns where id = $1`, [
          campaignId,
        ]);
        expect(r.rowCount).toBe(1);
      });
      await asUser(userB, async (c) => {
        const r = await c.query(`select 1 from public.campaigns where id = $1`, [
          campaignId,
        ]);
        expect(r.rowCount).toBe(0);
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [campaignId]);
    }
  });
});
