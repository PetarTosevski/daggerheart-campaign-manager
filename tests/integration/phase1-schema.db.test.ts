// @vitest-environment node
//
// Database integration tests for the Phase 1 schema, constraints, triggers,
// cascades, and Row-Level Security.
//
// These require a running local Supabase database. They are skipped unless
// RUN_SUPABASE_DB_E2E=1 and the database is reachable. Connection string
// defaults to the standard local Supabase port and can be overridden with
// SUPABASE_DB_URL.
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

/**
 * Runs a callback inside a transaction impersonating the given user via RLS
 * (role authenticated + JWT sub claim), then rolls back so tests stay isolated.
 */
async function asUser<T>(
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: "authenticated" })],
    );
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Phase 1 schema (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`a-${Date.now()}@example.com`);
    userB = await createAuthUser(`b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("auto-creates exactly one campaign_state row with the correct defaults", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'Init Test')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id;
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

  it("rejects a current_week below 1", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'Week Test')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id;
      await expect(
        c.query(
          `update public.campaign_state set current_week = 0 where campaign_id = $1`,
          [campaignId],
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects an invalid cycle value", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'Cycle Test')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id;
      await expect(
        c.query(
          `update public.campaign_state set current_cycle = 'DUSK' where campaign_id = $1`,
          [campaignId],
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects a cycle day outside 1-7", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'Day Test')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id;
      await expect(
        c.query(
          `update public.campaign_state set current_cycle_day = 8 where campaign_id = $1`,
          [campaignId],
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects Fear values outside 0-12", async () => {
    // Use the database owner here so the check constraints—not Task 004's
    // authenticated-column grant—are what reject the invalid values.
    await client.query("begin");
    try {
      const campaign = await client.query(
        `insert into public.campaigns (owner_id, name)
         values ($1, 'Fear Constraint Test') returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id as string;

      await client.query("savepoint fear_too_high");
      await expect(
        client.query(
          `update public.campaign_state set current_fear = 13 where campaign_id = $1`,
          [campaignId],
        ),
      ).rejects.toThrow();
      await client.query("rollback to savepoint fear_too_high");

      await client.query("savepoint fear_too_low");
      await expect(
        client.query(
          `update public.campaign_state set current_fear = -1 where campaign_id = $1`,
          [campaignId],
        ),
      ).rejects.toThrow();
      await client.query("rollback to savepoint fear_too_low");
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects a zero-amount fear event", async () => {
    await client.query("begin");
    try {
      const campaign = await client.query(
        `insert into public.campaigns (owner_id, name)
         values ($1, 'Fear Event Constraint Test') returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id as string;
      await expect(
        client.query(
          `insert into public.fear_events (
             campaign_id, amount, event_type, created_by,
             previous_value, new_value, idempotency_key
           )
           values ($1, 0, 'adjustment', $2, 0, 0, gen_random_uuid())`,
          [campaignId, userA],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("rollback");
    }
  });

  it("updates updated_at automatically on campaign update", async () => {
    // now() is fixed at transaction start, so the insert and the update must
    // run in separate committed transactions to observe the trigger advancing
    // updated_at (this mirrors real application usage).
    const claims = JSON.stringify({ sub: userA, role: "authenticated" });

    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      claims,
    ]);
    const inserted = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Touch Test')
       returning id, updated_at`,
      [userA],
    );
    await client.query("commit");

    const campaignId = inserted.rows[0].id;
    const before = inserted.rows[0].updated_at;

    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        claims,
      ]);
      const updated = await client.query(
        `update public.campaigns set description = 'changed' where id = $1
         returning updated_at`,
        [campaignId],
      );
      await client.query("commit");

      expect(new Date(updated.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(before).getTime(),
      );
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("cascades deletion of a campaign to its children", async () => {
    await asUser(userA, async (c) => {
      const campaign = await c.query(
        `insert into public.campaigns (owner_id, name) values ($1, 'Cascade Test')
         returning id`,
        [userA],
      );
      const campaignId = campaign.rows[0].id;
      await c.query(
        `insert into public.characters (campaign_id, name) values ($1, 'Doomed')`,
        [campaignId],
      );
      await c.query(`delete from public.campaigns where id = $1`, [campaignId]);
      const state = await c.query(
        `select 1 from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      const chars = await c.query(
        `select 1 from public.characters where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rowCount).toBe(0);
      expect(chars.rowCount).toBe(0);
    });
  });

  it("enforces owner RLS across every Phase 1 table", async () => {
    // Persist a complete owned record graph as User A. Fear and countdown
    // state use their authoritative transactional functions.
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userA, role: "authenticated" }),
    ]);
    const campaign = await client.query(
      `insert into public.campaigns (owner_id, name) values ($1, 'Private A2')
       returning id`,
      [userA],
    );
    const campaignId = campaign.rows[0].id as string;
    const fearEvent = await client.query(
      `select event_id as id
       from public.adjust_campaign_fear(
         $1, 1, 'adjustment', gen_random_uuid()
       )`,
      [campaignId],
    );
    const countdown = await client.query(
      `select countdown_id as id
       from public.create_campaign_countdown(
         $1, 'RLS Countdown', '', 'threat', 4, '', gen_random_uuid()
       )`,
      [campaignId],
    );
    const countdownId = countdown.rows[0].id as string;
    const countdownEvent = await client.query(
      `select event_id as id
       from public.operate_countdown(
         $1, 'advance', -1, '', gen_random_uuid()
       )`,
      [countdownId],
    );
    const character = await client.query(
      `insert into public.characters (campaign_id, name)
       values ($1, 'RLS Character') returning id`,
      [campaignId],
    );
    await client.query("commit");

    try {
      const ids = {
        campaign: campaignId,
        fearEvent: fearEvent.rows[0].id as string,
        countdown: countdownId,
        countdownEvent: countdownEvent.rows[0].id as string,
        character: character.rows[0].id as string,
      };

      // User A can read the campaign and every related table.
      await asUser(userA, async (c) => {
        const reads = [
          await c.query(`select 1 from public.campaigns where id = $1`, [ids.campaign]),
          await c.query(`select 1 from public.campaign_state where campaign_id = $1`, [ids.campaign]),
          await c.query(`select 1 from public.fear_events where id = $1`, [ids.fearEvent]),
          await c.query(`select 1 from public.countdowns where id = $1`, [ids.countdown]),
          await c.query(`select 1 from public.countdown_events where id = $1`, [ids.countdownEvent]),
          await c.query(`select 1 from public.characters where id = $1`, [ids.character]),
        ];
        expect(reads.map((result) => result.rowCount)).toEqual([1, 1, 1, 1, 1, 1]);
      });

      // User B cannot read the campaign or any related row.
      await asUser(userB, async (c) => {
        const reads = [
          await c.query(`select 1 from public.campaigns where id = $1`, [ids.campaign]),
          await c.query(`select 1 from public.campaign_state where campaign_id = $1`, [ids.campaign]),
          await c.query(`select 1 from public.fear_events where id = $1`, [ids.fearEvent]),
          await c.query(`select 1 from public.countdowns where id = $1`, [ids.countdown]),
          await c.query(`select 1 from public.countdown_events where id = $1`, [ids.countdownEvent]),
          await c.query(`select 1 from public.characters where id = $1`, [ids.character]),
        ];
        expect(reads.map((result) => result.rowCount)).toEqual([0, 0, 0, 0, 0, 0]);

        await expect(
          c.query(
            `update public.campaign_state set current_week = 2
             where campaign_id = $1`,
            [ids.campaign],
          ),
        ).rejects.toThrow(/permission denied/i);
      });

      // Child-table insert policies reject attempts to attach records to
      // another user's campaign/countdown.
      await expect(
        asUser(userB, (c) =>
          c.query(
            `insert into public.fear_events
               (campaign_id, amount, event_type, created_by)
             values ($1, 1, 'adjustment', $2)`,
            [ids.campaign, userB],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        asUser(userB, (c) =>
          c.query(
            `insert into public.countdowns
               (campaign_id, name, category, direction, current_value,
                target_value, starting_value)
             values ($1, 'Unauthorized', 'test', 'up', 0, 4, 0)`,
            [ids.campaign],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        asUser(userB, (c) =>
          c.query(
            `insert into public.countdown_events
               (countdown_id, change_amount, event_type, previous_value,
                new_value, created_by)
             values ($1, 1, 'advance', 0, 1, $2)`,
            [ids.countdown, userB],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        asUser(userB, (c) =>
          c.query(
            `insert into public.characters (campaign_id, name)
             values ($1, 'Unauthorized')`,
            [ids.campaign],
          ),
        ),
      ).rejects.toThrow();
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });
});
