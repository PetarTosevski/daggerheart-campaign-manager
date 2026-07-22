// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type QueryResult } from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const enabled = process.env.RUN_SUPABASE_DB_E2E === "1";
const maybeDescribe = enabled ? describe : describe.skip;

let client: Client;
let userA: string;
let userB: string;

async function createAuthUser(email: string): Promise<string> {
  const result = await client.query(
    `insert into auth.users (instance_id, id, aud, role, email)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
             'authenticated', 'authenticated', $1)
     returning id`,
    [email],
  );
  return result.rows[0].id as string;
}

async function beginAsUser(userId: string): Promise<void> {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function asUser<T>(
  userId: string,
  callback: (connection: Client) => Promise<T>,
): Promise<T> {
  await beginAsUser(userId);
  try {
    return await callback(client);
  } finally {
    await client.query("rollback");
  }
}

async function createCampaign(
  connection: Client,
  ownerId: string,
  name = "Fear Test Campaign",
): Promise<string> {
  const result = await connection.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2)
     returning id`,
    [ownerId, name],
  );
  return result.rows[0].id as string;
}

function adjustFear(
  connection: Client,
  campaignId: string,
  amount: number,
  eventType = "adjustment",
  idempotencyKey = randomUUID(),
): Promise<QueryResult> {
  return connection.query(
    `select * from public.adjust_campaign_fear($1, $2, $3, $4)`,
    [campaignId, amount, eventType, idempotencyKey],
  );
}

async function expectFailureWithoutAborting(
  connection: Client,
  operation: () => Promise<unknown>,
): Promise<void> {
  await connection.query("savepoint expected_failure");
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await connection.query("rollback to savepoint expected_failure");
  expect(failure).toBeInstanceOf(Error);
}

maybeDescribe("adjust_campaign_fear (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`fear-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`fear-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("atomically changes the total and creates exactly one complete event", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const adjustment = await adjustFear(connection, campaignId, 1);

      expect(adjustment.rows[0]).toMatchObject({
        previous_value: 0,
        new_value: 1,
        change_amount: 1,
        returned_event_type: "adjustment",
        was_applied: true,
      });

      const state = await connection.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      const events = await connection.query(
        `select amount, previous_value, new_value, event_type
         from public.fear_events where campaign_id = $1`,
        [campaignId],
      );

      expect(state.rows[0].current_fear).toBe(1);
      expect(events.rowCount).toBe(1);
      expect(events.rows[0]).toMatchObject({
        amount: 1,
        previous_value: 0,
        new_value: 1,
        event_type: "adjustment",
      });
    });
  });

  it("does not apply a retried idempotency key twice", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const key = randomUUID();

      const first = await adjustFear(
        connection,
        campaignId,
        1,
        "adjustment",
        key,
      );
      const retry = await adjustFear(
        connection,
        campaignId,
        1,
        "adjustment",
        key,
      );

      expect(first.rows[0].was_applied).toBe(true);
      expect(retry.rows[0]).toMatchObject({
        was_applied: false,
        previous_value: 0,
        new_value: 1,
      });

      const state = await connection.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      const count = await connection.query(
        `select count(*)::integer as count from public.fear_events
         where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0].current_fear).toBe(1);
      expect(count.rows[0].count).toBe(1);
    });
  });

  it("rejects values below 0 and above 12 without partial writes", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);

      await expectFailureWithoutAborting(connection, () =>
        adjustFear(connection, campaignId, -1),
      );

      let state = await connection.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      let count = await connection.query(
        `select count(*)::integer as count from public.fear_events
         where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0].current_fear).toBe(0);
      expect(count.rows[0].count).toBe(0);

      await adjustFear(connection, campaignId, 12);
      await expectFailureWithoutAborting(connection, () =>
        adjustFear(connection, campaignId, 1),
      );

      state = await connection.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      count = await connection.query(
        `select count(*)::integer as count from public.fear_events
         where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0].current_fear).toBe(12);
      expect(count.rows[0].count).toBe(1);
    });
  });

  it("records correction as a compensating event without editing history", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      await adjustFear(connection, campaignId, 2);
      await adjustFear(connection, campaignId, -1, "correction");

      const events = await connection.query(
        `select amount, previous_value, new_value, event_type
         from public.fear_events where campaign_id = $1
         order by created_at, id`,
        [campaignId],
      );

      expect(events.rows).toEqual([
        {
          amount: 2,
          previous_value: 0,
          new_value: 2,
          event_type: "adjustment",
        },
        {
          amount: -1,
          previous_value: 2,
          new_value: 1,
          event_type: "correction",
        },
      ]);
    });
  });

  it("denies another user without changing total or history", async () => {
    await beginAsUser(userA);
    const campaignId = await createCampaign(client, userA, "Private Fear");
    await client.query("commit");

    try {
      await expect(
        asUser(userB, (connection) =>
          adjustFear(connection, campaignId, 1),
        ),
      ).rejects.toThrow(/access denied/i);

      const state = await client.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      const count = await client.query(
        `select count(*)::integer as count from public.fear_events
         where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0].current_fear).toBe(0);
      expect(count.rows[0].count).toBe(0);
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("blocks authenticated direct writes that would bypass audit history", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);

      await expectFailureWithoutAborting(connection, () =>
        connection.query(
          `update public.campaign_state set current_fear = 5
           where campaign_id = $1`,
          [campaignId],
        ),
      );
      await expectFailureWithoutAborting(connection, () =>
        connection.query(
          `insert into public.fear_events (
             campaign_id, amount, event_type, created_by,
             previous_value, new_value, idempotency_key
           ) values ($1, 1, 'adjustment', $2, 0, 1, $3)`,
          [campaignId, userA, randomUUID()],
        ),
      );

      const state = await connection.query(
        `select current_fear from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      const count = await connection.query(
        `select count(*)::integer as count from public.fear_events
         where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0].current_fear).toBe(0);
      expect(count.rows[0].count).toBe(0);
     });
   });
 });
