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
  name = "Countdown Test Campaign",
): Promise<string> {
  const result = await connection.query(
    `insert into public.campaigns (owner_id, name) values ($1, $2)
     returning id`,
    [ownerId, name],
  );
  return result.rows[0].id as string;
}

function createCountdown(
  connection: Client,
  campaignId: string,
  options: {
    name?: string;
    category?: string;
    startingValue?: number;
    key?: string;
  } = {},
): Promise<QueryResult> {
  return connection.query(
    `select * from public.create_campaign_countdown($1, $2, $3, $4, $5, $6, $7)`,
    [
      campaignId,
      options.name ?? "The storm arrives",
      "A developing threat.",
      options.category ?? "threat",
      options.startingValue ?? 3,
      "The refuge loses shelter.",
      options.key ?? randomUUID(),
    ],
  );
}

function operateCountdown(
  connection: Client,
  countdownId: string,
  action: string,
  amount: number,
  options: { reason?: string; key?: string } = {},
): Promise<QueryResult> {
  return connection.query(
    `select * from public.operate_countdown($1, $2, $3, $4, $5)`,
    [
      countdownId,
      action,
      amount,
      options.reason ?? "Test operation",
      options.key ?? randomUUID(),
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

maybeDescribe("countdown operations (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`countdown-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`countdown-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [
        [userA, userB],
      ]);
      await client.end();
    }
  });

  it("creates a constrained countdown idempotently", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const key = randomUUID();
      const first = await createCountdown(connection, campaignId, { key });
      const retry = await createCountdown(connection, campaignId, { key });

      expect(first.rows[0]).toMatchObject({
        returned_category: "threat",
        returned_starting_value: 3,
        returned_current_value: 3,
        returned_status: "active",
        was_applied: true,
      });
      expect(retry.rows[0]).toMatchObject({
        countdown_id: first.rows[0].countdown_id,
        was_applied: false,
      });

      await expectFailureWithoutAborting(
        connection,
        () =>
          createCountdown(connection, campaignId, {
            key,
            name: "Different countdown",
          }),
        /different countdown/i,
      );

      const stored = await connection.query(
        `select direction, target_value, visibility from public.countdowns
         where id = $1`,
        [first.rows[0].countdown_id],
      );
      expect(stored.rows[0]).toEqual({
        direction: "down",
        target_value: 0,
        visibility: "gm",
      });
    });
  });

  it("atomically advances, completes once, and reopens on reversal", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const created = await createCountdown(connection, campaignId, {
        startingValue: 2,
      });
      const countdownId = created.rows[0].countdown_id as string;

      const first = await operateCountdown(connection, countdownId, "advance", -1);
      const completionKey = randomUUID();
      const completion = await operateCountdown(
        connection,
        countdownId,
        "advance",
        -1,
        { key: completionKey },
      );
      const retry = await operateCountdown(
        connection,
        countdownId,
        "advance",
        -1,
        { key: completionKey },
      );

      expect(first.rows[0]).toMatchObject({
        previous_value: 2,
        new_value: 1,
        new_status: "active",
      });
      expect(completion.rows[0]).toMatchObject({
        previous_value: 1,
        new_value: 0,
        previous_status: "active",
        new_status: "completed",
        was_applied: true,
      });
      expect(retry.rows[0].was_applied).toBe(false);

      await expectFailureWithoutAborting(
        connection,
        () => operateCountdown(connection, countdownId, "advance", -1),
        /must be reversed/i,
      );

      const reopened = await operateCountdown(
        connection,
        countdownId,
        "reverse",
        1,
      );
      expect(reopened.rows[0]).toMatchObject({
        previous_value: 0,
        new_value: 1,
        previous_status: "completed",
        new_status: "active",
      });

      const stored = await connection.query(
        `select current_value, status, completed_at from public.countdowns
         where id = $1`,
        [countdownId],
      );
      const count = await connection.query(
        `select count(*)::integer as count from public.countdown_events
         where countdown_id = $1`,
        [countdownId],
      );
      expect(stored.rows[0]).toEqual({
        current_value: 1,
        status: "active",
        completed_at: null,
      });
      expect(count.rows[0].count).toBe(3);
    });
  });

  it("validates pause, resume, and terminal cancellation transitions", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const created = await createCountdown(connection, campaignId);
      const countdownId = created.rows[0].countdown_id as string;

      const paused = await operateCountdown(connection, countdownId, "pause", 0);
      expect(paused.rows[0]).toMatchObject({
        previous_status: "active",
        new_status: "paused",
        change_amount: 0,
      });
      await expectFailureWithoutAborting(
        connection,
        () => operateCountdown(connection, countdownId, "advance", -1),
        /resume the countdown/i,
      );

      const resumed = await operateCountdown(connection, countdownId, "resume", 0);
      expect(resumed.rows[0].new_status).toBe("active");
      const cancelled = await operateCountdown(connection, countdownId, "cancel", 0);
      expect(cancelled.rows[0].new_status).toBe("cancelled");
      await expectFailureWithoutAborting(
        connection,
        () => operateCountdown(connection, countdownId, "reverse", 1),
        /cancelled countdowns/i,
      );
    });
  });

  it("rejects boundary violations without partial state or history", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const created = await createCountdown(connection, campaignId, {
        startingValue: 1,
      });
      const countdownId = created.rows[0].countdown_id as string;

      await expectFailureWithoutAborting(
        connection,
        () => operateCountdown(connection, countdownId, "reverse", 1),
        /between 0 and its starting value/i,
      );

      const stored = await connection.query(
        `select current_value, status from public.countdowns where id = $1`,
        [countdownId],
      );
      const count = await connection.query(
        `select count(*)::integer as count from public.countdown_events
         where countdown_id = $1`,
        [countdownId],
      );
      expect(stored.rows[0]).toEqual({ current_value: 1, status: "active" });
      expect(count.rows[0].count).toBe(0);
    });
  });

  it("records corrections as compensating events", async () => {
    await asUser(userA, async (connection) => {
      const campaignId = await createCampaign(connection, userA);
      const created = await createCountdown(connection, campaignId);
      const countdownId = created.rows[0].countdown_id as string;

      const correction = await operateCountdown(
        connection,
        countdownId,
        "correction",
        -1,
        { reason: "Corrected the prior table state." },
      );
      expect(correction.rows[0]).toMatchObject({
        returned_event_type: "correction",
        previous_value: 3,
        new_value: 2,
        returned_reason: "Corrected the prior table state.",
      });
    });
  });

  it("enforces owner authorization and blocks direct authenticated writes", async () => {
    await beginAsUser(userA);
    const campaignId = await createCampaign(client, userA, "Private countdowns");
    const created = await createCountdown(client, campaignId);
    const countdownId = created.rows[0].countdown_id as string;
    await client.query("commit");

    try {
      await expect(
        asUser(userB, (connection) =>
          operateCountdown(connection, countdownId, "advance", -1),
        ),
      ).rejects.toThrow(/access denied/i);

      await asUser(userB, async (connection) => {
        const rows = await connection.query(
          `select id from public.countdowns where id = $1`,
          [countdownId],
        );
        expect(rows.rowCount).toBe(0);
      });

      await asUser(userA, async (connection) => {
        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(
              `update public.countdowns set current_value = 1 where id = $1`,
              [countdownId],
            ),
          /permission denied/i,
        );
        await expectFailureWithoutAborting(
          connection,
          () =>
            connection.query(
              `insert into public.countdown_events (
                 countdown_id, change_amount, event_type, previous_value,
                 new_value, created_by
               ) values ($1, -1, 'advance', 3, 2, $2)`,
              [countdownId, userA],
            ),
          /permission denied/i,
        );
      });
    } finally {
      await client.query(`delete from public.campaigns where id = $1`, [
        campaignId,
      ]);
    }
  });
});
