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

async function beginAsUserOn(
  connection: Client,
  userId: string,
): Promise<void> {
  await connection.query("begin");
  await connection.query("set local role authenticated");
  await connection.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function beginAsUser(userId: string): Promise<void> {
  await beginAsUserOn(client, userId);
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
  name = "Operations Test Campaign",
): Promise<string> {
  const result = await connection.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2)
     returning id`,
    [ownerId, name],
  );
  return result.rows[0].id as string;
}

function recordOperation(
  connection: Client,
  campaignId: string,
  options: {
    key?: string;
    operationType?: string;
    summary?: string;
    metadata?: Record<string, unknown> | null;
    reversesOperationId?: string | null;
  } = {},
): Promise<QueryResult> {
  return connection.query(
    `select * from public.record_operation($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      campaignId,
      options.key ?? randomUUID(),
      options.operationType ?? "test_operation",
      options.summary ?? "Recorded a test operation.",
      options.metadata === undefined
        ? null
        : JSON.stringify(options.metadata),
      options.reversesOperationId ?? null,
    ],
  );
}

async function expectFailureWithoutAborting(
  connection: Client,
  operation: () => Promise<unknown>,
  message?: RegExp,
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
  if (message) expect((failure as Error).message).toMatch(message);
}

async function createPersistedCampaign(
  ownerId: string,
  name: string,
): Promise<string> {
  await beginAsUser(ownerId);
  try {
    const campaignId = await createCampaign(client, ownerId, name);
    await client.query("commit");
    return campaignId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

maybeDescribe("operations foundation (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`operations-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`operations-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("records a first operation and returns the original row for an identical retry", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const key = randomUUID();
      const input = {
        key,
        operationType: "  WEEK_PREVIEW  ",
        summary: "  Previewed a future week operation.  ",
        metadata: { source: "integration-test", count: 1 },
      };

      const first = await recordOperation(connection, campaignId, input);
      const retry = await recordOperation(connection, campaignId, input);

      expect(first.rows[0]).toMatchObject({
        returned_campaign_id: campaignId,
        returned_idempotency_key: key,
        returned_operation_type: "week_preview",
        returned_summary: "Previewed a future week operation.",
        returned_created_by: userA,
        returned_metadata: { source: "integration-test", count: 1 },
        returned_reverses_operation_id: null,
        was_applied: true,
      });
      expect(retry.rows[0]).toMatchObject({
        operation_id: first.rows[0].operation_id,
        was_applied: false,
      });

      await expectFailureWithoutAborting(
        connection,
        () =>
          recordOperation(connection, campaignId, {
            ...input,
            summary: "Different request payload.",
          }),
        /different operation/i,
      );

      const count = await connection.query(
        `select count(*)::integer as count
         from public.operations
         where campaign_id = $1 and idempotency_key = $2`,
        [campaignId, key],
      );
      expect(count.rows[0].count).toBe(1);
    });
  });

  it("serializes concurrent duplicate requests and stores one operation", async () => {
    const campaignId = await createPersistedCampaign(
      userA,
      "Concurrent Operations",
    );
    const firstConnection = new Client({ connectionString: DB_URL });
    const retryConnection = new Client({ connectionString: DB_URL });

    try {
      await Promise.all([firstConnection.connect(), retryConnection.connect()]);
      await Promise.all([
        beginAsUserOn(firstConnection, userA),
        beginAsUserOn(retryConnection, userA),
      ]);

      const key = randomUUID();
      const options = {
        key,
        operationType: "concurrent_test",
        summary: "Concurrent duplicate request.",
      };
      const first = await recordOperation(
        firstConnection,
        campaignId,
        options,
      );
      const retryPromise = recordOperation(
        retryConnection,
        campaignId,
        options,
      );

      await firstConnection.query("commit");
      const retry = await retryPromise;
      await retryConnection.query("commit");

      expect(first.rows[0].was_applied).toBe(true);
      expect(retry.rows[0]).toMatchObject({
        operation_id: first.rows[0].operation_id,
        was_applied: false,
      });

      const count = await client.query(
        `select count(*)::integer as count
         from public.operations
         where campaign_id = $1 and idempotency_key = $2`,
        [campaignId, key],
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      await firstConnection.query("rollback").catch(() => undefined);
      await retryConnection.query("rollback").catch(() => undefined);
      await Promise.all([firstConnection.end(), retryConnection.end()]);
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("allows the same idempotency key in different campaigns", async () => {
    await asUser(userA, async (connection) => {
      const campaignA = await createCampaign(connection, userA, "Campaign A");
      const campaignB = await createCampaign(connection, userA, "Campaign B");
      const key = randomUUID();

      const first = await recordOperation(connection, campaignA, { key });
      const second = await recordOperation(connection, campaignB, { key });

      expect(first.rows[0]).toMatchObject({
        returned_campaign_id: campaignA,
        was_applied: true,
      });
      expect(second.rows[0]).toMatchObject({
        returned_campaign_id: campaignB,
        was_applied: true,
      });
      expect(second.rows[0].operation_id).not.toBe(
        first.rows[0].operation_id,
      );
    });
  });

  it("allows owner reads while denying another user and all direct mutations", async () => {
    const campaignId = await createPersistedCampaign(userA, "Private Operations");
    let operationId = "";

    try {
      await beginAsUser(userA);
      const recorded = await recordOperation(client, campaignId);
      operationId = recorded.rows[0].operation_id as string;
      await client.query("commit");

      await asUser(userA, async (connection) => {
        const visible = await connection.query(
          `select id from public.operations where id = $1`,
          [operationId],
        );
        expect(visible.rowCount).toBe(1);
      });

      await asUser(userB, async (connection) => {
        const hidden = await connection.query(
          `select id from public.operations where id = $1`,
          [operationId],
        );
        expect(hidden.rowCount).toBe(0);

        await expectFailureWithoutAborting(
          connection,
          () => recordOperation(connection, campaignId),
          /access denied/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(
              `insert into public.operations (
                 campaign_id, idempotency_key, operation_type,
                 summary, created_by
               ) values ($1, $2, 'forbidden', 'Forbidden insert.', $3)`,
              [campaignId, randomUUID(), userB],
            ),
          /permission denied/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(
              `update public.operations set summary = 'Forbidden update.'
               where id = $1`,
              [operationId],
            ),
          /permission denied/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(`delete from public.operations where id = $1`, [
              operationId,
            ]),
          /permission denied/i,
        );
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("stores same-campaign reversal provenance without defining undo behavior", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const original = await recordOperation(connection, campaignId, {
        operationType: "original_test",
        summary: "Original operation.",
      });
      const reversal = await recordOperation(connection, campaignId, {
        operationType: "reversal_test",
        summary: "Recorded reversal provenance only.",
        reversesOperationId: original.rows[0].operation_id as string,
      });

      expect(reversal.rows[0]).toMatchObject({
        returned_reverses_operation_id: original.rows[0].operation_id,
        was_applied: true,
      });

      const stored = await connection.query(
        `select reverses_operation_id from public.operations where id = $1`,
        [reversal.rows[0].operation_id],
      );
      expect(stored.rows[0].reverses_operation_id).toBe(
        original.rows[0].operation_id,
      );
    });
  });

  it("rejects cross-campaign and self reversal references at the database level", async () => {
    const campaignA = await createPersistedCampaign(userA, "Reversal Campaign A");
    const campaignB = await createPersistedCampaign(userA, "Reversal Campaign B");
    let originalId = "";

    try {
      await beginAsUser(userA);
      const original = await recordOperation(client, campaignA);
      originalId = original.rows[0].operation_id as string;
      await client.query("commit");

      await asUser(userA, async (connection) => {
        await expectFailureWithoutAborting(
          connection,
          () =>
            recordOperation(connection, campaignB, {
              reversesOperationId: originalId,
            }),
          /does not belong to this campaign/i,
        );
      });

      await client.query("begin");
      await expectFailureWithoutAborting(
        client,
        () =>
          client.query(
            `insert into public.operations (
               campaign_id, idempotency_key, operation_type, summary,
               created_by, reverses_operation_id
             ) values ($1, $2, 'cross_campaign', 'Invalid cross-campaign link.',
                       $3, $4)`,
            [campaignB, randomUUID(), userA, originalId],
          ),
        /operations_reversal_same_campaign_fkey/i,
      );

      const selfId = randomUUID();
      await expectFailureWithoutAborting(
        client,
        () =>
          client.query(
            `insert into public.operations (
               id, campaign_id, idempotency_key, operation_type, summary,
               created_by, reverses_operation_id
             ) values ($1, $2, $3, 'self_reference', 'Invalid self link.',
                       $4, $1)`,
            [selfId, campaignA, randomUUID(), userA],
          ),
        /operations_not_self_reversing/i,
      );
      await client.query("rollback");
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query(`delete from public.campaigns where id = any($1)`, [
        [campaignA, campaignB],
      ]);
    }
  });

  it("adds event foreign keys without changing existing Fear and Countdown behavior", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const operation = await recordOperation(connection, campaignId);

      const fear = await connection.query(
        `select * from public.adjust_campaign_fear($1, 1, 'adjustment', $2)`,
        [campaignId, randomUUID()],
      );
      const countdown = await connection.query(
        `select * from public.create_campaign_countdown(
           $1, 'Foundation check', null, 'other', 2, null, $2
         )`,
        [campaignId, randomUUID()],
      );
      const countdownEvent = await connection.query(
        `select * from public.operate_countdown(
           $1, 'advance', -1, 'Foundation regression check', $2
         )`,
        [countdown.rows[0].countdown_id, randomUUID()],
      );

      expect(fear.rows[0]).toMatchObject({
        previous_value: 0,
        new_value: 1,
        was_applied: true,
      });
      expect(countdownEvent.rows[0]).toMatchObject({
        previous_value: 2,
        new_value: 1,
        was_applied: true,
      });

      const links = await connection.query(
        `select
           (select operation_id from public.fear_events where id = $1) as fear_operation_id,
           (select operation_id from public.countdown_events where id = $2) as countdown_operation_id`,
        [fear.rows[0].event_id, countdownEvent.rows[0].event_id],
      );
      expect(links.rows[0]).toEqual({
        fear_operation_id: null,
        countdown_operation_id: null,
      });

      const constraints = await connection.query(
        `select conname
         from pg_constraint
         where conname in (
           'fear_events_operation_id_fkey',
           'countdown_events_operation_id_fkey'
         )
         order by conname`,
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual([
        "countdown_events_operation_id_fkey",
        "fear_events_operation_id_fkey",
      ]);
      expect(operation.rows[0].was_applied).toBe(true);
    });
  });
});
