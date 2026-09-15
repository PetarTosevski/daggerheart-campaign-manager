// @vitest-environment node

// Database integration tests for Task 012 (food system). Requires a running
// local Supabase database; skipped unless RUN_SUPABASE_DB_E2E=1.
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
     ) values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
               'authenticated', 'authenticated', $1, '', '', '', '') returning id`,
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

async function newCampaign(c: Client, userId: string, name: string): Promise<string> {
  const r = await c.query(
    `insert into public.campaigns (owner_id, name) values ($1,$2) returning id`,
    [userId, name],
  );
  return r.rows[0].id as string;
}

async function addCharacters(c: Client, campaignId: string, active: number, archived = 0) {
  for (let i = 0; i < active; i += 1) {
    await c.query(`insert into public.characters (campaign_id, name) values ($1,$2)`, [campaignId, `Active ${i}`]);
  }
  for (let i = 0; i < archived; i += 1) {
    await c.query(`insert into public.characters (campaign_id, name, status) values ($1,$2,'archived')`, [campaignId, `Archived ${i}`]);
  }
}

async function acquire(c: Client, campaignId: string, label: string, type: string, portions: number) {
  const r = await c.query(
    `select * from public.acquire_food_batch($1,$2,$3,$4,$5,null)`,
    [campaignId, randomUUID(), label, type, portions],
  );
  return r.rows[0];
}

async function processWeek(c: Client, campaignId: string, opts: { key?: string; week?: number | null; override?: number | null; skip?: boolean; reason?: string | null; selected?: string[] | null } = {}) {
  const r = await c.query(
    `select * from public.process_weekly_food($1,$2,$3,$4,$5,$6,$7)`,
    [campaignId, opts.key ?? randomUUID(), opts.week ?? null, opts.override ?? null, opts.skip ?? false, opts.reason ?? null, opts.selected ?? null],
  );
  return r.rows[0];
}

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("Food system (database)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    userA = await createAuthUser(`food-a-${Date.now()}@example.com`);
    userB = await createAuthUser(`food-b-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`delete from auth.users where id = any($1)`, [[userA, userB]]);
      await client.end();
    }
  });

  it("seeds food_settings defaults for a new campaign", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Settings");
      const r = await c.query(
        `select portions_per_ration, portions_per_active_character_per_week, default_spoilage_policy
         from public.food_settings where campaign_id=$1`,
        [id],
      );
      expect(r.rows[0]).toMatchObject({
        portions_per_ration: 7,
        portions_per_active_character_per_week: 7,
        default_spoilage_policy: "spoil_fresh",
      });
    });
  });

  it("acquires a batch with authoritative history", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Acquire");
      const batch = await acquire(c, id, "Rations", "preserved", 14);
      expect(batch.returned_remaining_portions).toBe(14);
      const tx = await c.query(
        `select transaction_type, portions_delta, before_portions, after_portions from public.food_transactions where campaign_id=$1`,
        [id],
      );
      expect(tx.rows[0]).toMatchObject({ transaction_type: "acquire", portions_delta: 14, before_portions: 0, after_portions: 14 });
    });
  });

  it("prevents invalid batch balances via check constraints", async () => {
    // As table owner (bypasses grants) so the CHECK — not a missing grant — fails.
    await client.query("begin");
    try {
      const id = (await client.query(`insert into public.campaigns (owner_id, name) values ($1,'Constraints') returning id`, [userA])).rows[0].id;
      await client.query("savepoint s1");
      await expect(client.query(
        `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
         values ($1,'B','preserved',1,10,11)`, [id],
      )).rejects.toThrow(/remaining_valid|check/i);
      await client.query("rollback to savepoint s1");
      await expect(client.query(
        `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
         values ($1,'B','preserved',1,0,0)`, [id],
      )).rejects.toThrow(/initial_positive|check/i);
    } finally {
      await client.query("rollback");
    }
  });

  it("consumes FIFO across batches and preserves a partial batch", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "FIFO");
      await addCharacters(c, id, 2); // 14 required
      const a = await acquire(c, id, "First", "preserved", 10);
      const b = await acquire(c, id, "Second", "preserved", 10);
      const result = await processWeek(c, id);
      expect(result.returned_consumed).toBe(14);
      expect(result.returned_shortage).toBe(0);
      const batches = await c.query(`select id, remaining_portions, status from public.food_batches where campaign_id=$1`, [id]);
      const byId = Object.fromEntries(batches.rows.map((r) => [r.id, r]));
      expect(byId[a.batch_id].remaining_portions).toBe(0);
      expect(byId[a.batch_id].status).toBe("depleted");
      expect(byId[b.batch_id].remaining_portions).toBe(6);
    });
  });

  it("reports and persists a shortage", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Shortage");
      await addCharacters(c, id, 2); // 14 required
      await acquire(c, id, "Little", "preserved", 5);
      const result = await processWeek(c, id);
      expect(result.returned_consumed).toBe(5);
      expect(result.returned_shortage).toBe(9);
      const proc = await c.query(`select shortage_portions, consumed_portions from public.food_week_processes where campaign_id=$1`, [id]);
      expect(proc.rows[0]).toMatchObject({ shortage_portions: 9, consumed_portions: 5 });
    });
  });

  it("spoils eligible fresh food but not preserved food", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Spoilage");
      await addCharacters(c, id, 1); // 7 required
      await acquire(c, id, "Fresh", "fresh", 7); // acquired week 1
      await acquire(c, id, "Preserved", "preserved", 7);
      const result = await processWeek(c, id, { week: 3 }); // 3 >= 1+2 -> fresh spoils
      expect(result.returned_spoiled).toBe(7);
      expect(result.returned_consumed).toBe(7); // from preserved
      const batches = await c.query(`select food_type, status, remaining_portions from public.food_batches where campaign_id=$1 order by food_type`, [id]);
      const fresh = batches.rows.find((r) => r.food_type === "fresh");
      const pres = batches.rows.find((r) => r.food_type === "preserved");
      expect(fresh.status).toBe("spoiled");
      expect(pres.remaining_portions).toBe(0);
      expect(pres.status).toBe("depleted");
    });
  });

  it("derives requirement from active characters only", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Roster");
      await addCharacters(c, id, 3, 2); // 3 active -> 21; 2 archived excluded
      await acquire(c, id, "Stock", "preserved", 50);
      const result = await processWeek(c, id);
      expect(result.returned_active_character_count).toBe(3);
      expect(result.returned_default_required).toBe(21);
      expect(result.returned_consumed).toBe(21);
    });
  });

  it("is idempotent on retry and rejects key reuse with different input", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Idempotent");
      await addCharacters(c, id, 1);
      await acquire(c, id, "Stock", "preserved", 30);
      const key = randomUUID();
      const first = await processWeek(c, id, { key, week: 5 });
      expect(first.was_applied).toBe(true);
      const retry = await processWeek(c, id, { key, week: 5 });
      expect(retry.was_applied).toBe(false);
      expect(retry.returned_consumed).toBe(first.returned_consumed);
      const total = await c.query(`select coalesce(sum(remaining_portions),0)::int n from public.food_batches where campaign_id=$1 and status='active'`, [id]);
      expect(total.rows[0].n).toBe(23); // 30 - 7, applied once
      await expectFail(c, () => processWeek(c, id, { key, week: 6 }), /different operation/i);
    });
  });

  it("rejects duplicate standard processing for the same week", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Duplicate");
      await addCharacters(c, id, 1);
      await acquire(c, id, "Stock", "preserved", 30);
      await processWeek(c, id, { week: 4 });
      await expectFail(c, () => processWeek(c, id, { week: 4 }), /already been processed/i);
    });
  });

  it("requires and preserves an override reason", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Override");
      await addCharacters(c, id, 5);
      await acquire(c, id, "Stock", "preserved", 30);
      await expectFail(c, () => processWeek(c, id, { override: 10 }), /override requires a reason/i);
      const result = await processWeek(c, id, { override: 10, reason: "half the party away" });
      expect(result.returned_used_override).toBe(true);
      expect(result.returned_consumed).toBe(10);
      const proc = await c.query(`select used_override, override_reason from public.food_week_processes where campaign_id=$1`, [id]);
      expect(proc.rows[0]).toMatchObject({ used_override: true, override_reason: "half the party away" });
    });
  });

  it("consumes a custom ordered selection, leaving excluded batches untouched", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Selection");
      await addCharacters(c, id, 1); // 7 required
      const a = await acquire(c, id, "Oldest", "preserved", 7);
      const b = await acquire(c, id, "Middle", "preserved", 7);
      const cc = await acquire(c, id, "Newest", "preserved", 7);
      // Select newest-first, excluding the FIFO-oldest 'a'.
      const result = await processWeek(c, id, {
        selected: [cc.batch_id, b.batch_id],
        reason: "use the newest first",
      });
      expect(result.returned_used_override).toBe(true);
      expect(result.returned_consumed).toBe(7);
      expect(result.returned_shortage).toBe(0);
      const batches = await c.query(`select id, remaining_portions, status from public.food_batches where campaign_id=$1`, [id]);
      const byId = Object.fromEntries(batches.rows.map((r) => [r.id, r]));
      expect(byId[cc.batch_id].remaining_portions).toBe(0); // consumed first
      expect(byId[cc.batch_id].status).toBe("depleted");
      expect(byId[b.batch_id].remaining_portions).toBe(7); // requirement met before reaching it
      expect(byId[a.batch_id].remaining_portions).toBe(7); // excluded, untouched
      // Audit records the override, submitted ids, and per-batch snapshot.
      const proc = await c.query(`select used_override, used_custom_selection, override_reason, selected_batch_ids, selection_detail from public.food_week_processes where campaign_id=$1`, [id]);
      expect(proc.rows[0].used_custom_selection).toBe(true);
      expect(proc.rows[0].override_reason).toBe("use the newest first");
      expect(proc.rows[0].selected_batch_ids).toEqual([cc.batch_id, b.batch_id]);
      const detail = proc.rows[0].selection_detail as Array<{ batch_id: string; position: number; consumed_portions: number }>;
      expect(detail).toHaveLength(2);
      expect(detail[0]).toMatchObject({ batch_id: cc.batch_id, position: 1, consumed_portions: 7 });
      expect(detail[1]).toMatchObject({ batch_id: b.batch_id, position: 2, consumed_portions: 0 });
    });
  });

  it("reports a shortage from the selected supply without falling back", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "SelectionShortage");
      await addCharacters(c, id, 3); // 21 required
      const a = await acquire(c, id, "A", "preserved", 7);
      const b = await acquire(c, id, "B", "preserved", 7);
      await acquire(c, id, "C", "preserved", 7);
      const result = await processWeek(c, id, { selected: [a.batch_id], reason: "only tin A" });
      expect(result.returned_consumed).toBe(7);
      expect(result.returned_shortage).toBe(14); // 21 - 7; never touched B/C
      const total = await c.query(`select coalesce(sum(remaining_portions),0)::int n from public.food_batches where campaign_id=$1 and status='active'`, [id]);
      expect(total.rows[0].n).toBe(14); // B and C intact
      expect(b.batch_id).toBeTruthy();
    });
  });

  it("rejects a selected batch that spoils before consumption", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "SelectionSpoil");
      await addCharacters(c, id, 1);
      const fresh = await acquire(c, id, "Fresh", "fresh", 7); // acquired week 1
      // Week 3 spoils the fresh batch first; selecting it must then fail.
      await expectFail(
        c,
        () => processWeek(c, id, { week: 3, selected: [fresh.batch_id], reason: "try spoiled" }),
        /not an available, consumable batch/i,
      );
    });
  });

  it("rejects a cross-campaign or duplicate selection and requires a reason", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "SelectionGuards");
      const other = await newCampaign(c, userA, "SelectionOther");
      await addCharacters(c, id, 1);
      const a = await acquire(c, id, "A", "preserved", 7);
      const foreign = await acquire(c, other, "Foreign", "preserved", 7);
      await expectFail(c, () => processWeek(c, id, { selected: [a.batch_id] }), /override requires a reason/i);
      await expectFail(c, () => processWeek(c, id, { selected: [a.batch_id, a.batch_id], reason: "dup" }), /only be selected once/i);
      await expectFail(c, () => processWeek(c, id, { selected: [foreign.batch_id], reason: "foreign" }), /not an available, consumable batch/i);
    });
  });

  it("does not double-consume a custom selection on idempotent retry", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "SelectionIdempotent");
      await addCharacters(c, id, 1); // 7 required
      const a = await acquire(c, id, "A", "preserved", 20);
      const key = randomUUID();
      const first = await processWeek(c, id, { key, selected: [a.batch_id], reason: "custom" });
      expect(first.was_applied).toBe(true);
      const retry = await processWeek(c, id, { key, selected: [a.batch_id], reason: "custom" });
      expect(retry.was_applied).toBe(false);
      expect(retry.returned_consumed).toBe(first.returned_consumed);
      const remaining = await c.query(`select remaining_portions from public.food_batches where id=$1`, [a.batch_id]);
      expect(remaining.rows[0].remaining_portions).toBe(13); // 20 - 7, applied once
      // Reusing the key with a changed selection fails.
      const b = await acquire(c, id, "B", "preserved", 7);
      await expectFail(c, () => processWeek(c, id, { key, selected: [b.batch_id], reason: "custom" }), /different operation/i);
    });
  });

  it("corrects a batch with compensating history and recomputes the total", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Correction");
      const batch = await acquire(c, id, "Stock", "preserved", 20);
      const corrected = await c.query(
        `select * from public.correct_food_batch($1,$2,$3,$4,$5)`,
        [id, randomUUID(), batch.batch_id, 12, "miscount"],
      );
      expect(corrected.rows[0].returned_remaining_portions).toBe(12);
      const tx = await c.query(`select transaction_type, portions_delta, reason from public.food_transactions where campaign_id=$1 and transaction_type='correction'`, [id]);
      expect(tx.rows[0]).toMatchObject({ transaction_type: "correction", portions_delta: -8, reason: "miscount" });
      await expectFail(c, () => c.query(`select * from public.correct_food_batch($1,$2,$3,$4,$5)`, [id, randomUUID(), batch.batch_id, 12, "x"]), /does not change/i);
      await expectFail(c, () => c.query(`select * from public.correct_food_batch($1,$2,$3,$4,$5)`, [id, randomUUID(), batch.batch_id, 999, "x"]), /between 0 and the batch total/i);
      await expectFail(c, () => c.query(`select * from public.correct_food_batch($1,$2,$3,$4,'  ')`, [id, randomUUID(), batch.batch_id, 3]), /requires a reason/i);
    });
  });

  it("enforces owner authorization and RLS across campaigns", async () => {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userA, role: "authenticated" })]);
    const id = await newCampaign(client, userA, `RLS ${Date.now()}`);
    await addCharacters(client, id, 1);
    const batch = await acquire(client, id, "Stock", "preserved", 20);
    await client.query("commit");

    try {
      await asUser(userB, async (c) => {
        await expectFail(c, () => processWeek(c, id, {}), /not found or access denied/i);
        await expectFail(c, () => acquire(c, id, "X", "preserved", 5), /not found or access denied/i);
        await expectFail(c, () => c.query(`select * from public.correct_food_batch($1,$2,$3,$4,$5)`, [id, randomUUID(), batch.batch_id, 3, "x"]), /not found or access denied/i);
        const read = await c.query(`select 1 from public.food_batches where campaign_id=$1`, [id]);
        expect(read.rowCount).toBe(0);
      });
    } finally {
      await client.query(`delete from public.campaigns where id=$1`, [id]);
    }
  });

  it("blocks a cross-campaign batch via the composite foreign key", async () => {
    // As table owner to reach the FK (authenticated cannot insert transactions at all).
    await client.query("begin");
    try {
      const a = await newCampaign(client, userA, `xA ${Date.now()}`);
      const b = await newCampaign(client, userA, `xB ${Date.now()}`);
      const batchB = (await client.query(
        `insert into public.food_batches (campaign_id, label, food_type, acquired_week, initial_portions, remaining_portions)
         values ($1,'B','preserved',1,10,10) returning id`, [b],
      )).rows[0].id;
      await expect(client.query(
        `insert into public.food_transactions (campaign_id, batch_id, transaction_type, portions_delta, before_portions, after_portions, created_by)
         values ($1,$2,'consume',-1,10,9,$3)`, [a, batchB, userA],
      )).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects saving reserved food keys through the sheet value function", async () => {
    await asUser(userA, async (c) => {
      const id = await newCampaign(c, userA, "Reserved");
      const tpl = (await c.query(`insert into public.sheet_templates (campaign_id, name, is_blank_template, status) values ($1,'S',true,'active') returning id`, [id])).rows[0].id;
      const versionId = randomUUID();
      await c.query(`select public.create_sheet_template_version($1,$2,$3,'s.pdf',1024,'x',1)`, [tpl, versionId, `${id}/${tpl}/${versionId}/source.pdf`]);
      await c.query(`select public.save_sheet_template_fields($1,$2::jsonb)`, [versionId, JSON.stringify([
        { field_key: "food_rations", label: "Rations", field_type: "number", page_number: 1, x: 0.1, y: 0.1, width: 0.1, height: 0.05, configuration: {}, is_active: true },
        { field_key: "strength", label: "Strength", field_type: "text", page_number: 1, x: 0.1, y: 0.2, width: 0.1, height: 0.05, configuration: {}, is_active: true },
      ])]);
      await c.query(`select public.publish_sheet_template_version($1)`, [versionId]);
      const character = (await c.query(`insert into public.characters (campaign_id, name, sheet_template_id, sheet_template_version_id) values ($1,'Hero',$2,$3) returning id`, [id, tpl, versionId])).rows[0].id;
      const fields = await c.query(`select id, field_key from public.sheet_template_fields where template_version_id=$1`, [versionId]);
      const foodField = fields.rows.find((f) => f.field_key === "food_rations").id;
      const strengthField = fields.rows.find((f) => f.field_key === "strength").id;

      await expectFail(c, () => c.query(`select * from public.save_character_sheet_value($1,$2,$3,null)`, [character, foodField, "9"]), /reserved food fields are read-only/i);
      // A non-reserved field still saves.
      const ok = await c.query(`select * from public.save_character_sheet_value($1,$2,$3,null)`, [character, strengthField, "16"]);
      expect(ok.rows[0].returned_value).toBe("16");
    });
  });
});
