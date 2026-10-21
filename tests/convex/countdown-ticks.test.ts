import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { applyTick, revertTicks, type TickCause } from "../../convex/lib/countdownTicks";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

/**
 * countdowns-advanced K0: the new create fields per role, the view and its player redaction, and the one server tick
 * path (applyTick / revertTicks, hooked into undoEntry) driven through t.run, since K1-K4 add its public callers.
 */

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;

const BASE = { name: "Doom", description: "", category: "threat" as const, consequence: "The dam breaks" };

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => "ok",
    // t.run has no wrapper, so a domain RuleError arrives unconverted; the wrappers turn its `code` into ConvexError.data.code.
    (e: unknown) => errorCode(e) ?? (e as { code?: unknown }).code,
  );
}

async function setup() {
  const ctx = await setupWithCampaign();
  const gmId = await ctx.t.run(async (db) => (await db.db.get("campaigns", ctx.campaignId))!.ownerId);
  const create = (extra: Record<string, unknown>) =>
    ctx.gm.mutation(api.countdowns.create, { campaignId: ctx.campaignId, ...BASE, ...extra, idempotencyKey: key() } as never) as Promise<{
      countdownId: Id<"countdowns">;
    }>;
  const row = (id: Id<"countdowns">) => ctx.t.run(async (c) => (await c.db.get("countdowns", id))!);
  /** A log row a tick can hang on: an undoable GM row without a character, so actionLog.undo needs nothing else. */
  const entry = () =>
    ctx.t.run((c) => logAction(c, { campaignId: ctx.campaignId, actorId: gmId, kind: "feature", visibility: "gm", summary: "x", undoable: true }));
  const tick = (id: Id<"countdowns">, amount: number, cause: Partial<TickCause> = {}) =>
    ctx.t.run(async (c) => applyTick(c, (await c.db.get("countdowns", id))!, amount, { source: "advance", actorId: gmId, ...cause } as TickCause));
  const history = (id: Id<"countdowns">) =>
    ctx.t.run(async (c) =>
      (await c.db.query("history").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect()).filter(
        (h) => h.kind === "countdown" && h.countdownId === id,
      ),
    );
  const notices = () =>
    ctx.t.run(async (c) =>
      (await c.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect()).filter((r) => r.kind === "countdown"),
    );
  const undo = (entryId: Id<"actionLog">) => ctx.gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { ...ctx, gmId, create, row, entry, tick, history, notices, undo };
}

async function withPlayer(ctx: Setup) {
  await ctx.gm.mutation(api.members.invite, { campaignId: ctx.campaignId, email: OTHER_EMAIL });
}

describe("countdown ticks (countdowns-advanced K0)", () => {
  useAllowlist();

  describe("create with the new fields", () => {
    const variants: [string, Record<string, unknown>][] = [
      ["mode", { startingValue: 6, mode: "progress" }],
      ["repeat", { startingValue: 5, repeat: "loop" }],
      ["startDice", { startDice: { count: 1, sides: 6 } }],
      ["armed", { startingValue: 4, armed: true }],
      ["steps", { startingValue: 8, mode: "longTerm", steps: [{ value: 0, text: "War" }], restMode: "remind" }],
    ];

    it.each(variants)("%s: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async (_, extra) => {
      const ctx = await setup();
      const args = { campaignId: ctx.campaignId, ...BASE, ...extra, idempotencyKey: key() } as never;
      expect(await codeOf(ctx.t.mutation(api.countdowns.create, args))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.countdowns.create, args))).toBe("NOT_FOUND");
      await withPlayer(ctx);
      expect(await codeOf(ctx.other.mutation(api.countdowns.create, { ...(args as object), idempotencyKey: key() } as never))).toBe("FORBIDDEN");
      expect(await codeOf(ctx.gm.mutation(api.countdowns.create, args))).toBe("ok");
    });

    it("stores and lists each field for the GM; dice are rolled on the server and kept", async () => {
      const ctx = await setup();
      const { countdownId: dice } = await ctx.create({ startDice: { count: 1, sides: 6 }, repeat: "loop", armed: true, mode: "consequence" });
      const { countdownId: long } = await ctx.create({ startingValue: 8, mode: "longTerm", steps: [{ value: 0, text: " War " }, { value: 6, text: "Troops", news: true }] });
      const list = await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      const d = list.find((c) => c._id === dice)!;
      expect(d.startingValue).toBeGreaterThanOrEqual(1);
      expect(d.startingValue).toBeLessThanOrEqual(6);
      expect(d).toMatchObject({ mode: "consequence", repeat: "loop", armed: true, startDice: { count: 1, sides: 6 }, initialValue: d.startingValue, triggerCount: 0, steps: null, restMode: null });
      expect(d.currentValue).toBe(d.startingValue);
      expect(list.find((c) => c._id === long)).toMatchObject({
        mode: "longTerm",
        armed: false,
        repeat: null,
        steps: [{ value: 6, text: "Troops", news: true }, { value: 0, text: "War" }],
        restMode: "auto",
      });
    });

    it("refuses shapes the schema rejects with INVALID", async () => {
      const ctx = await setup();
      expect(await codeOf(ctx.create({}))).toBe("INVALID");
      expect(await codeOf(ctx.create({ startingValue: 4, startDice: { count: 1, sides: 6 } }))).toBe("INVALID");
      expect(await codeOf(ctx.create({ startingValue: 8, mode: "longTerm", repeat: "loop" }))).toBe("INVALID");
      expect(await codeOf(ctx.create({ startingValue: 4, mode: "longTerm", steps: [{ value: 5, text: "x" }] }))).toBe("INVALID");
      expect(await codeOf(ctx.create({ startDice: { count: 9, sides: 6 } }))).toBe("INVALID");
    });

    it("a player's list carries no steps, armed or dice; progress-bound fields go with hidden progress", async () => {
      const ctx = await setup();
      await withPlayer(ctx);
      await ctx.create({ startDice: { count: 2, sides: 4 }, armed: true, repeat: "increasing" });
      await ctx.create({ startingValue: 6, mode: "longTerm", steps: [{ value: 3, text: "Secret step" }], visibility: { mode: "public", hidden: ["progress"] } });
      const seen = await ctx.other.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect(seen).toHaveLength(2);
      for (const c of seen) expect(c).toMatchObject({ armed: null, startDice: null, steps: null, restMode: null });
      expect(seen[0]).toMatchObject({ repeat: "increasing", mode: "standard" });
      expect(seen[1]).toMatchObject({ mode: null, repeat: null, triggerCount: null, currentValue: null });
      expect(JSON.stringify(seen)).not.toContain("Secret step");
    });
  });

  describe("applyTick", () => {
    it("a standard tick moves 1, writes one history row and, with an entry, one tick row", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 4 });
      const entryId = await ctx.entry();
      const r = await ctx.tick(countdownId, 1, { source: "roll", entryId });
      expect(r).toMatchObject({ changed: true, triggered: false, after: { currentValue: 3 } });
      expect((await ctx.row(countdownId)).currentValue).toBe(3);
      const history = await ctx.history(countdownId);
      expect(history.map((h) => h.action)).toEqual(["create", "roll"]);
      const ticks = await ctx.t.run((c) => c.db.query("countdownTicks").withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId)).collect());
      expect(ticks).toHaveLength(1);
      expect(ticks[0]).toMatchObject({ source: "roll", amount: 1, before: { currentValue: 4 }, after: { currentValue: 3 } });
    });

    it("a tick of 0 writes nothing", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 4, mode: "progress" });
      expect(await ctx.tick(countdownId, 0, { source: "roll", entryId: await ctx.entry() })).toMatchObject({ changed: false, tickId: null });
      expect(await ctx.history(countdownId)).toHaveLength(1);
    });

    it("a dynamic tick of 3 on 2 left stops at 0, completes and logs the GM-only notice", async () => {
      const ctx = await setup();
      await withPlayer(ctx);
      const { countdownId } = await ctx.create({ startingValue: 6, mode: "consequence" });
      await ctx.tick(countdownId, 4);
      const r = await ctx.tick(countdownId, 3, { source: "roll", entryId: await ctx.entry() });
      expect(r).toMatchObject({ triggered: true, finished: true, after: { currentValue: 0, status: "completed", triggerCount: 1 } });
      const row = await ctx.row(countdownId);
      expect(row).toMatchObject({ currentValue: 0, status: "completed", triggerCount: 1 });
      expect(row.completedAt).toBeTypeOf("number");
      expect((await ctx.history(countdownId)).map((h) => h.action)).toEqual(["create", "advance", "trigger"]);
      const [notice] = await ctx.notices();
      expect(notice).toMatchObject({ visibility: "gm", undoable: false, summary: "Doom triggered: The dam breaks" });
      expect(notice!.groupId).toBeUndefined();
      const playerFeed = await ctx.other.query(api.feed.list, { campaignId: ctx.campaignId, paginationOpts: { numItems: 20, cursor: null } });
      expect(playerFeed.page.some((p) => p.kind === "countdown")).toBe(false);
    });

    it("a loop resets to its start and keeps counting", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 2, repeat: "loop" });
      await ctx.tick(countdownId, 1);
      const r = await ctx.tick(countdownId, 1);
      expect(r).toMatchObject({ triggered: true, reset: true, after: { currentValue: 2, startingValue: 2, status: "active", triggerCount: 1 } });
      await ctx.tick(countdownId, 2);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 2, status: "active", triggerCount: 2 });
      expect((await ctx.notices()).map((n) => n.summary)).toEqual(["Doom triggered: The dam breaks", "Doom triggered (2nd time): The dam breaks"]);
      const reset = (await ctx.history(countdownId)).find((h) => h.action === "trigger")!;
      expect(reset).toMatchObject({ before: { currentValue: 1, startingValue: 2 }, after: { currentValue: 2, startingValue: 2 } });
    });

    it("increasing 8 resets to 9", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 8, repeat: "increasing" });
      await ctx.tick(countdownId, 8);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 9, startingValue: 9, initialValue: 8, status: "active" });
    });

    it("decreasing at a start of 1 ends with the major event", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 2, repeat: "decreasing" });
      await ctx.tick(countdownId, 2);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 1, startingValue: 1, status: "active" });
      const r = await ctx.tick(countdownId, 1);
      expect(r).toMatchObject({ finished: true, after: { status: "completed", currentValue: 0, triggerCount: 2 } });
      expect((await ctx.notices()).at(-1)!.summary).toBe("Doom: major event: The dam breaks");
    });

    it("a rolled start is reused on reset (Q4)", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startDice: { count: 2, sides: 6 }, repeat: "loop" });
      const rolled = (await ctx.row(countdownId)).startingValue;
      await ctx.tick(countdownId, rolled);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: rolled, startingValue: rolled, startDice: { count: 2, sides: 6 } });
    });

    it("refuses a second tick of the same (row, countdown) pair, a paused countdown and a frame-owned one", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 4 });
      const entryId = await ctx.entry();
      await ctx.tick(countdownId, 1, { source: "roll", entryId });
      expect(await codeOf(ctx.tick(countdownId, 1, { source: "feed", entryId }))).toBe("COUNTDOWN_RULE");
      expect((await ctx.row(countdownId)).currentValue).toBe(3);
      await ctx.gm.mutation(api.countdowns.operate, { countdownId, action: "pause", idempotencyKey: key() });
      expect(await codeOf(ctx.tick(countdownId, 1))).toBe("COUNTDOWN_RULE");
      const owned = await ctx.t.run((c) =>
        c.db.insert("countdowns", { ...BASE, campaignId: ctx.campaignId, startingValue: 4, currentValue: 4, status: "active", createdAt: 1, ownerKey: "objective:x" }),
      );
      expect(await codeOf(ctx.tick(owned, 1))).toBe("NOT_FOUND");
    });
  });

  describe("revert (undo, D11)", () => {
    it("undoing the row takes back a trigger: value, start, status, count; the notice is undone; one undo history row", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 3, repeat: "increasing" });
      await ctx.tick(countdownId, 2);
      const entryId = await ctx.entry();
      await ctx.tick(countdownId, 1, { source: "roll", entryId });
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 4, startingValue: 4, triggerCount: 1 });
      await ctx.undo(entryId);
      const row = await ctx.row(countdownId);
      expect(row).toMatchObject({ currentValue: 1, startingValue: 3, status: "active" });
      expect(row.triggerCount).toBeUndefined();
      expect(row.lastTriggeredAt).toBeUndefined();
      const [notice] = await ctx.notices();
      expect(notice!.undoneAt).toBeTypeOf("number");
      const history = await ctx.history(countdownId);
      expect(history.map((h) => h.action)).toEqual(["create", "advance", "trigger", "undo"]);
      expect(history.at(-1)).toMatchObject({ before: { currentValue: 4, startingValue: 4 }, after: { currentValue: 1, startingValue: 3 } });
      const ticks = await ctx.t.run((c) => c.db.query("countdownTicks").withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId)).collect());
      expect(ticks[0]!.revertedAt).toBeTypeOf("number");
    });

    it("a completion taken back clears completedAt", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 1 });
      const entryId = await ctx.entry();
      await ctx.tick(countdownId, 1, { source: "roll", entryId });
      await ctx.undo(entryId);
      const row = await ctx.row(countdownId);
      expect(row).toMatchObject({ currentValue: 1, status: "active" });
      expect(row.completedAt).toBeUndefined();
    });

    it("a countdown changed since the tick keeps its value", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 5 });
      const entryId = await ctx.entry();
      await ctx.tick(countdownId, 1, { source: "roll", entryId });
      await ctx.gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: key() });
      expect(await ctx.t.run((c) => revertTicks(c, [entryId], ctx.gmId))).toEqual({ reverted: [], kept: [countdownId] });
      expect((await ctx.row(countdownId)).currentValue).toBe(3);
      await ctx.undo(entryId);
      expect((await ctx.row(countdownId)).currentValue).toBe(3);
      expect((await ctx.history(countdownId)).map((h) => h.action)).toEqual(["create", "roll", "advance"]);
    });

    it("takes back several ticks of one row newest first", async () => {
      const ctx = await setup();
      const { countdownId: a } = await ctx.create({ startingValue: 5, mode: "progress" });
      const { countdownId: b } = await ctx.create({ startingValue: 5, mode: "consequence" });
      const entryId = await ctx.entry();
      await ctx.tick(a, 1, { source: "roll", entryId });
      await ctx.tick(b, 1, { source: "roll", entryId });
      const result = await ctx.t.run((c) => revertTicks(c, [entryId], ctx.gmId));
      expect(result).toEqual({ reverted: [b, a], kept: [] });
      expect((await ctx.row(a)).currentValue).toBe(5);
      expect((await ctx.row(b)).currentValue).toBe(5);
    });
  });

  describe("a stored countdown without the new fields", () => {
    async function legacy(ctx: Awaited<ReturnType<typeof setup>>) {
      return ctx.t.run((c) =>
        c.db.insert("countdowns", { ...BASE, campaignId: ctx.campaignId, startingValue: 3, currentValue: 3, status: "active", createdAt: 1 } satisfies Omit<Doc<"countdowns">, "_id" | "_creationTime">),
      );
    }

    it("lists with the defaults and operates as before", async () => {
      const ctx = await setup();
      const id = await legacy(ctx);
      const [view] = await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect(view).toMatchObject({ _id: id, mode: "standard", armed: false, repeat: null, initialValue: null, startDice: null, triggerCount: 0, lastTriggeredAt: null, chase: null, steps: null, restMode: null });
      expect(await ctx.gm.mutation(api.countdowns.operate, { countdownId: id, action: "advance", idempotencyKey: key() })).toEqual({
        previousValue: 3,
        newValue: 2,
        status: "active",
      });
      await ctx.tick(id, 2);
      expect(await ctx.row(id)).toMatchObject({ currentValue: 0, status: "completed", triggerCount: 1 });
    });

    it("a create without the new args stores none of them (D4: unarmed standard)", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 4 });
      const row = await ctx.row(countdownId);
      for (const field of ["mode", "armed", "repeat", "initialValue", "startDice", "triggerCount", "chase", "steps", "restMode"] as const) {
        expect(row[field], field).toBeUndefined();
      }
    });
  });
});
