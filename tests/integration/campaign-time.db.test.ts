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

async function asUser<T>(
  userId: string,
  callback: (connection: Client) => Promise<T>,
): Promise<T> {
  await beginAsUserOn(client, userId);
  try {
    return await callback(client);
  } finally {
    await client.query("rollback");
  }
}

async function createCampaign(
  connection: Client,
  ownerId: string,
  name = "Campaign Time Test",
): Promise<string> {
  const result = await connection.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2)
     returning id`,
    [ownerId, name],
  );
  return result.rows[0].id as string;
}

async function createPersistedCampaign(
  ownerId: string,
  name: string,
): Promise<string> {
  await beginAsUserOn(client, ownerId);
  try {
    const campaignId = await createCampaign(client, ownerId, name);
    await client.query("commit");
    return campaignId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function changeCampaignTime(
  connection: Client,
  campaignId: string,
  options: {
    key?: string;
    intent?: "advance" | "correction";
    targetWeek?: number | null;
    targetCycle?: "DAY" | "NIGHT" | null;
    targetCycleDay?: number | null;
    note?: string | null;
    correctsEventId?: string | null;
  } = {},
): Promise<QueryResult> {
  return connection.query(
    `select * from public.change_campaign_time(
       $1, $2, $3, $4, $5, $6, $7, $8
     )`,
    [
      campaignId,
      options.key ?? randomUUID(),
      options.intent ?? "advance",
      options.targetWeek ?? null,
      options.targetCycle ?? null,
      options.targetCycleDay ?? null,
      options.note ?? null,
      options.correctsEventId ?? null,
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

maybeDescribe("campaign time (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`campaign-time-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`campaign-time-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("atomically advances one day and records its operation and event", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const key = randomUUID();
      const result = await changeCampaignTime(connection, campaignId, {
        key,
        note: "The expedition made progress.",
      });

      expect(result.rows[0]).toMatchObject({
        returned_event_type: "advance",
        previous_week: 1,
        previous_cycle: "DAY",
        previous_cycle_day: 1,
        new_week: 1,
        new_cycle: "DAY",
        new_cycle_day: 2,
        returned_note: "The expedition made progress.",
        returned_corrects_event_id: null,
        was_applied: true,
      });

      const persisted = await connection.query(
        `select
           state.current_week,
           state.current_cycle,
           state.current_cycle_day,
           event.operation_id,
           operation.idempotency_key,
           operation.operation_type,
           operation.created_by,
           operation.metadata
         from public.campaign_state as state
         join public.campaign_time_events as event
           on event.campaign_id = state.campaign_id
         join public.operations as operation on operation.id = event.operation_id
         where state.campaign_id = $1`,
        [campaignId],
      );
      expect(persisted.rows[0]).toMatchObject({
        current_week: 1,
        current_cycle: "DAY",
        current_cycle_day: 2,
        idempotency_key: key,
        operation_type: "campaign_time_advance",
        created_by: userA,
        metadata: {
          intent: "advance",
          target_week: null,
          target_cycle: null,
          target_cycle_day: null,
          note: "The expedition made progress.",
          corrects_event_id: null,
        },
      });
    });
  });

  it("enforces both Day-to-Night and Night-to-Day week boundaries", async () => {
    const campaignId = await createPersistedCampaign(userA, "Cycle Boundaries");
    try {
      await client.query(
        `update public.campaign_state
         set current_week = 4, current_cycle = 'DAY', current_cycle_day = 7
         where campaign_id = $1`,
        [campaignId],
      );

      await beginAsUserOn(client, userA);
      const dayBoundary = await changeCampaignTime(client, campaignId);
      expect(dayBoundary.rows[0]).toMatchObject({
        previous_week: 4,
        previous_cycle: "DAY",
        previous_cycle_day: 7,
        new_week: 5,
        new_cycle: "NIGHT",
        new_cycle_day: 1,
      });
      await client.query("commit");

      await client.query(
        `update public.campaign_state
         set current_week = 9, current_cycle = 'NIGHT', current_cycle_day = 7
         where campaign_id = $1`,
        [campaignId],
      );
      await beginAsUserOn(client, userA);
      const nightBoundary = await changeCampaignTime(client, campaignId);
      expect(nightBoundary.rows[0]).toMatchObject({
        previous_week: 9,
        previous_cycle: "NIGHT",
        previous_cycle_day: 7,
        new_week: 10,
        new_cycle: "DAY",
        new_cycle_day: 1,
      });
      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("advances every one of the 14 valid states correctly through the RPC", async () => {
    const campaignId = await createPersistedCampaign(userA, "All 14 States");
    try {
      for (const cycle of ["DAY", "NIGHT"] as const) {
        for (let day = 1; day <= 7; day += 1) {
          // Canonical writes are revoked from authenticated, so seed the state
          // on the default (superuser) connection before advancing as the owner.
          await client.query(
            `update public.campaign_state
               set current_week = 4, current_cycle = $2, current_cycle_day = $3
             where campaign_id = $1`,
            [campaignId, cycle, day],
          );

          await beginAsUserOn(client, userA);
          const result = await changeCampaignTime(client, campaignId);
          await client.query("commit");

          const expected =
            day < 7
              ? { new_week: 4, new_cycle: cycle, new_cycle_day: day + 1 }
              : {
                  new_week: 5,
                  new_cycle: cycle === "DAY" ? "NIGHT" : "DAY",
                  new_cycle_day: 1,
                };

          expect(result.rows[0]).toMatchObject({
            returned_event_type: "advance",
            previous_week: 4,
            previous_cycle: cycle,
            previous_cycle_day: day,
            ...expected,
            was_applied: true,
          });
        }
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("returns an identical retry without advancing twice and rejects a conflict", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const key = randomUUID();
      const input = { key, note: "One day passes." };
      const first = await changeCampaignTime(connection, campaignId, input);
      const retry = await changeCampaignTime(connection, campaignId, input);

      expect(retry.rows[0]).toMatchObject({
        event_id: first.rows[0].event_id,
        operation_id: first.rows[0].operation_id,
        new_cycle_day: 2,
        was_applied: false,
      });
      await expectFailureWithoutAborting(
        connection,
        () =>
          changeCampaignTime(connection, campaignId, {
            key,
            note: "A different payload.",
          }),
        /different operation/i,
      );

      const counts = await connection.query(
        `select
           (select count(*)::integer from public.campaign_time_events
             where campaign_id = $1) as event_count,
           (select count(*)::integer from public.operations
             where campaign_id = $1) as operation_count,
           (select current_cycle_day from public.campaign_state
             where campaign_id = $1) as current_cycle_day`,
        [campaignId],
      );
      expect(counts.rows[0]).toEqual({
        event_count: 1,
        operation_count: 1,
        current_cycle_day: 2,
      });
    });
  });

  it("serializes concurrent duplicate advancement requests", async () => {
    const campaignId = await createPersistedCampaign(userA, "Concurrent Time");
    const firstConnection = new Client({ connectionString: DB_URL });
    const retryConnection = new Client({ connectionString: DB_URL });

    try {
      await Promise.all([firstConnection.connect(), retryConnection.connect()]);
      await Promise.all([
        beginAsUserOn(firstConnection, userA),
        beginAsUserOn(retryConnection, userA),
      ]);
      const key = randomUUID();
      const first = await changeCampaignTime(firstConnection, campaignId, { key });
      const retryPromise = changeCampaignTime(retryConnection, campaignId, { key });

      await firstConnection.query("commit");
      const retry = await retryPromise;
      await retryConnection.query("commit");

      expect(first.rows[0].was_applied).toBe(true);
      expect(retry.rows[0]).toMatchObject({
        event_id: first.rows[0].event_id,
        was_applied: false,
      });
      const state = await client.query(
        `select current_week, current_cycle, current_cycle_day
         from public.campaign_state where campaign_id = $1`,
        [campaignId],
      );
      expect(state.rows[0]).toEqual({
        current_week: 1,
        current_cycle: "DAY",
        current_cycle_day: 2,
      });
    } finally {
      await firstConnection.query("rollback").catch(() => undefined);
      await retryConnection.query("rollback").catch(() => undefined);
      await Promise.all([firstConnection.end(), retryConnection.end()]);
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("records a linked compensating correction without deleting history", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const original = await changeCampaignTime(connection, campaignId);
      const correction = await changeCampaignTime(connection, campaignId, {
        intent: "correction",
        targetWeek: 3,
        targetCycle: "NIGHT",
        targetCycleDay: 6,
        note: "Correct the accidentally recorded date.",
        correctsEventId: original.rows[0].event_id as string,
      });

      expect(correction.rows[0]).toMatchObject({
        returned_event_type: "correction",
        previous_week: 1,
        previous_cycle: "DAY",
        previous_cycle_day: 2,
        new_week: 3,
        new_cycle: "NIGHT",
        new_cycle_day: 6,
        returned_corrects_event_id: original.rows[0].event_id,
        was_applied: true,
      });

      const history = await connection.query(
        `select event.id, event.corrects_event_id,
                operation.reverses_operation_id
         from public.campaign_time_events as event
         join public.operations as operation on operation.id = event.operation_id
         where event.campaign_id = $1
         order by event.created_at, event.id`,
        [campaignId],
      );
      expect(history.rowCount).toBe(2);
      expect(history.rows[0]).toMatchObject({
        id: original.rows[0].event_id,
        corrects_event_id: null,
        reverses_operation_id: null,
      });
      expect(history.rows[1]).toMatchObject({
        id: correction.rows[0].event_id,
        corrects_event_id: original.rows[0].event_id,
        reverses_operation_id: original.rows[0].operation_id,
      });
    });
  });

  it("enforces owner reads, RPC authorization, and append-only mutation paths", async () => {
    const campaignId = await createPersistedCampaign(userA, "Private Time");
    let eventId = "";
    try {
      await beginAsUserOn(client, userA);
      const result = await changeCampaignTime(client, campaignId);
      eventId = result.rows[0].event_id as string;
      await client.query("commit");

      await asUser(userA, async (connection) => {
        const visible = await connection.query(
          `select id from public.campaign_time_events where id = $1`,
          [eventId],
        );
        expect(visible.rowCount).toBe(1);

        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(
              `update public.campaign_state set current_cycle_day = 3
               where campaign_id = $1`,
              [campaignId],
            ),
          /permission denied/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () => connection.query(`delete from public.campaign_time_events where id = $1`, [eventId]),
          /permission denied/i,
        );
      });

      await asUser(userB, async (connection) => {
        const hidden = await connection.query(
          `select id from public.campaign_time_events where id = $1`,
          [eventId],
        );
        expect(hidden.rowCount).toBe(0);
        await expectFailureWithoutAborting(
          connection,
          () => changeCampaignTime(connection, campaignId),
          /access denied/i,
        );
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });

  it("rejects no-op and cross-campaign corrections plus malformed direct events", async () => {
    const campaignA = await createPersistedCampaign(userA, "Correction A");
    const campaignB = await createPersistedCampaign(userA, "Correction B");
    try {
      await beginAsUserOn(client, userA);
      const original = await changeCampaignTime(client, campaignA);
      await client.query("commit");

      await asUser(userA, async (connection) => {
        await expectFailureWithoutAborting(
          connection,
          () =>
            changeCampaignTime(connection, campaignA, {
              intent: "correction",
              targetWeek: 1,
              targetCycle: "DAY",
              targetCycleDay: 2,
            }),
          /must change/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () =>
            changeCampaignTime(connection, campaignB, {
              intent: "correction",
              targetWeek: 2,
              targetCycle: "NIGHT",
              targetCycleDay: 1,
              correctsEventId: original.rows[0].event_id as string,
            }),
          /does not belong/i,
        );
      });

      const operationId = randomUUID();
      await client.query("begin");
      await client.query(
        `insert into public.operations (
           id, campaign_id, idempotency_key, operation_type, summary, created_by
         ) values ($1, $2, $3, 'malformed_test', 'Malformed event test.', $4)`,
        [operationId, campaignA, randomUUID(), userA],
      );
      await expectFailureWithoutAborting(
        client,
        () =>
          client.query(
            `insert into public.campaign_time_events (
               campaign_id, operation_id, event_type,
               previous_week, previous_cycle, previous_cycle_day,
               new_week, new_cycle, new_cycle_day
             ) values ($1, $2, 'advance', 1, 'DAY', 1, 2, 'NIGHT', 7)`,
            [campaignA, operationId],
          ),
        /campaign_time_events_advance_valid/i,
      );
      await client.query("rollback");
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query(`delete from public.campaigns where id = any($1)`, [
        [campaignA, campaignB],
      ]);
    }
  });
});
