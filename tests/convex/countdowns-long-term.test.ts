import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

/**
 * countdowns-advanced K4: long-term countdowns (CB p.164). countdownTracks.setStep / setRestMode / afterRest / tickOnRest
 * and the changed rests.finish per role; a finished long rest ticks each armed, active long-term countdown set to
 * Automatic once (Q3), Reminder only reminds; undoing the rest takes the ticks back (D11); step text stays GM-only (D12).
 */

const BASE = { name: "Invasion", description: "", category: "threat" as const, consequence: "The city falls" };
const STEPS = [
  { value: 7, text: "The theocracy's troops gather at the border", news: true },
  { value: 4, text: "Refugees arrive" },
  { value: 0, text: "The city falls" },
];

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function setup() {
  const ctx = await setupWithCampaign();
  const { campaignId, gm } = ctx;
  const create = async (extra: Record<string, unknown> = {}) =>
    (await gm.mutation(api.countdowns.create, {
      campaignId,
      ...BASE,
      startingValue: 8,
      mode: "longTerm",
      armed: true,
      ...extra,
      idempotencyKey: key(),
    } as never)) as { countdownId: Id<"countdowns"> };
  const row = (id: Id<"countdowns">) => ctx.t.run(async (c) => (await c.db.get("countdowns", id))!);
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">, who = gm) => who.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const interrupt = (restId: Id<"rests">) => gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() });
  const undo = (restId: Id<"rests">) => gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
  const longRest = async () => {
    const { restId } = await start("long");
    return { restId, result: await finish(restId) };
  };
  const setStep = (countdownId: Id<"countdowns">, value: number, text: string, news?: boolean, who = gm) =>
    who.mutation(api.countdownTracks.setStep, { campaignId, countdownId, value, text, news, idempotencyKey: key() });
  const setRestMode = (countdownId: Id<"countdowns">, restMode: "auto" | "remind", who = gm) =>
    who.mutation(api.countdownTracks.setRestMode, { campaignId, countdownId, restMode, idempotencyKey: key() });
  const tickOnRest = (restId: Id<"rests">, countdownId: Id<"countdowns">, who = gm) =>
    who.mutation(api.countdownTracks.tickOnRest, { campaignId, restId, countdownId, idempotencyKey: key() });
  const log = () =>
    ctx.t.run((c) => c.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const invite = () => gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  const frameOwned = () =>
    ctx.t.run((c) =>
      c.db.insert("countdowns", {
        campaignId, ...BASE, startingValue: 4, currentValue: 4, status: "active", createdAt: 0, ownerKey: "objective:x", mode: "longTerm",
      }),
    );
  const foreign = async () => {
    const { campaignId: theirs } = await ctx.other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    return ctx.t.run((c) =>
      c.db.insert("countdowns", { campaignId: theirs, ...BASE, startingValue: 4, currentValue: 4, status: "active", createdAt: 0, mode: "longTerm" }),
    );
  };
  return { ...ctx, create, row, start, finish, interrupt, undo, longRest, setStep, setRestMode, tickOnRest, log, invite, frameOwned, foreign };
}

describe("long-term countdowns (countdowns-advanced K4)", () => {
  useAllowlist();

  describe("countdownTracks.setStep", () => {
    it("anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create();
      const args = { campaignId: ctx.campaignId, countdownId, value: 5, text: "Scouts" };
      expect(await codeOf(ctx.t.mutation(api.countdownTracks.setStep, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.countdownTracks.setStep, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.mutation(api.countdownTracks.setStep, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await ctx.setStep(countdownId, 5, "Scouts")).toEqual({ steps: [{ value: 5, text: "Scouts" }] });
    });

    it("writes, replaces and removes one step at a time, highest value first", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ steps: STEPS });
      await ctx.setStep(countdownId, 5, "  Scouts sighted  ", true);
      await ctx.setStep(countdownId, 4, "Refugees flood the gates");
      await ctx.setStep(countdownId, 7, "   ");
      expect((await ctx.row(countdownId)).steps).toEqual([
        { value: 5, text: "Scouts sighted", news: true },
        { value: 4, text: "Refugees flood the gates" },
        { value: 0, text: "The city falls" },
      ]);
    });

    it("COUNTDOWN_RULE for a countdown that is not long-term or a value outside 0..start; NOT_FOUND for frame-owned or foreign", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create();
      expect(await codeOf(ctx.setStep(countdownId, 9, "Too far"))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.setStep(countdownId, -1, "Too low"))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.setStep(countdownId, 2, "x".repeat(201)))).toBe("COUNTDOWN_RULE");
      const { countdownId: standard } = await ctx.create({ mode: "standard" });
      expect(await codeOf(ctx.setStep(standard, 2, "No track"))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.setStep(await ctx.frameOwned(), 2, "Owned"))).toBe("NOT_FOUND");
      expect(await codeOf(ctx.setStep(await ctx.foreign(), 2, "Theirs"))).toBe("NOT_FOUND");
      expect((await ctx.row(countdownId)).steps).toBeUndefined();
    });
  });

  describe("countdownTracks.setRestMode", () => {
    it("per role, and the GM's list shows it while players get null", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create();
      const args = { campaignId: ctx.campaignId, countdownId, restMode: "remind" as const };
      expect(await codeOf(ctx.t.mutation(api.countdownTracks.setRestMode, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.countdownTracks.setRestMode, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.mutation(api.countdownTracks.setRestMode, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
      const [before] = await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect(before.restMode).toBe("auto");
      expect(await ctx.setRestMode(countdownId, "remind")).toEqual({ restMode: "remind" });
      expect((await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId }))[0].restMode).toBe("remind");
      expect((await ctx.other.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId }))[0].restMode).toBeNull();
      const { countdownId: standard } = await ctx.create({ mode: "standard" });
      expect(await codeOf(ctx.setRestMode(standard, "remind"))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.setRestMode(await ctx.frameOwned(), "remind"))).toBe("NOT_FOUND");
    });
  });

  describe("rests.finish of a long rest", () => {
    it("per role: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok with countdownLines", async () => {
      const ctx = await setup();
      await ctx.create({ steps: STEPS });
      const { restId } = await ctx.start("long");
      expect(await codeOf(ctx.t.mutation(api.rests.finish, { campaignId: ctx.campaignId, restId, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.finish(restId, ctx.other))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.finish(restId, ctx.other))).toBe("FORBIDDEN");
      const result = await ctx.finish(restId);
      expect(result.countdownLines).toEqual(["Invasion: 7 left - The theocracy's troops gather at the border (news reaches the party)"]);
    });

    it("ticks an armed long-term countdown once; unarmed, paused, standard and reminder ones not at all", async () => {
      const ctx = await setup();
      const { countdownId: armed } = await ctx.create({ steps: STEPS });
      const { countdownId: unarmed } = await ctx.create({ name: "Unarmed", armed: false });
      const { countdownId: paused } = await ctx.create({ name: "Paused" });
      await ctx.gm.mutation(api.countdowns.operate, { countdownId: paused, action: "pause", idempotencyKey: key() });
      const { countdownId: standard } = await ctx.create({ name: "Roll clock", mode: "standard", startingValue: 4 });
      const { countdownId: remind } = await ctx.create({ name: "Plague", restMode: "remind" });
      const { result } = await ctx.longRest();
      expect(result.countdownLines).toHaveLength(1);
      expect((await ctx.row(armed)).currentValue).toBe(7);
      for (const id of [unarmed, paused, remind]) expect((await ctx.row(id)).currentValue).toBe(8);
      expect((await ctx.row(standard)).currentValue).toBe(4);
      const ticks = await ctx.t.run((c) => c.db.query("countdownTicks").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect());
      expect(ticks.map((t) => [t.countdownId, t.source, t.amount])).toEqual([[armed, "rest", 1]]);
    });

    it("an interrupted long rest and a short rest tick nothing", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create();
      const { restId: long } = await ctx.start("long");
      const interrupted = await ctx.interrupt(long);
      expect("countdownLines" in interrupted).toBe(false);
      const { restId: short } = await ctx.start("short");
      const shortResult = await ctx.finish(short);
      expect(shortResult.countdownLines).toBeUndefined();
      expect((await ctx.row(countdownId)).currentValue).toBe(8);
    });

    it("the step text stays in GM-only rows; the public rest rows and the player's feed and list never carry it", async () => {
      const ctx = await setup();
      await ctx.invite();
      await ctx.create({ steps: STEPS });
      await ctx.longRest();
      const rows = await ctx.log();
      const notice = rows.find((r) => r.kind === "countdown")!;
      expect(notice).toMatchObject({ visibility: "gm", undoable: true });
      expect(notice.summary).toContain("The theocracy's troops gather at the border");
      expect(rows.filter((r) => r.visibility === "public").some((r) => r.summary.includes("theocracy"))).toBe(false);
      const feed = await ctx.other.query(api.feed.list, { campaignId: ctx.campaignId, paginationOpts: { numItems: 50, cursor: null } });
      expect(feed.page.some((r) => r.summary.includes("theocracy"))).toBe(false);
      const [view] = await ctx.other.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect(view.steps).toBeNull();
      expect(view.currentValue).toBe(7);
    });

    it("a tick to 0 completes it with the final step in the notice", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 1, steps: [{ value: 0, text: "The city falls" }] });
      const { result } = await ctx.longRest();
      expect(result.countdownLines).toEqual(["Invasion: final event - The city falls"]);
      expect((await ctx.row(countdownId)).status).toBe("completed");
      const summaries = (await ctx.log()).filter((r) => r.kind === "countdown").map((r) => r.summary);
      expect(summaries).toContain("Long rest: Invasion: final event - The city falls");
      expect(summaries).toContain("Invasion triggered: The city falls");
    });

    it("rests.undo restores the value and marks the GM notice undone", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 1 });
      const { restId } = await ctx.longRest();
      expect((await ctx.row(countdownId)).status).toBe("completed");
      await ctx.undo(restId);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 1, status: "active" });
      expect((await ctx.log()).filter((r) => r.kind === "countdown").every((r) => r.undoneAt !== undefined)).toBe(true);
      // Finishing the reopened rest ticks again, once.
      await ctx.finish(restId);
      expect((await ctx.row(countdownId)).currentValue).toBe(0);
    });
  });

  describe("Reminder (Q3)", () => {
    it("afterRest and tickOnRest per role", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ restMode: "remind" });
      const { restId } = await ctx.longRest();
      expect(await codeOf(ctx.t.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId }))).toBe("NOT_FOUND");
      const tickArgs = { campaignId: ctx.campaignId, restId, countdownId };
      expect(await codeOf(ctx.t.mutation(api.countdownTracks.tickOnRest, { ...tickArgs, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.tickOnRest(restId, countdownId, ctx.other))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId }))).toBe("FORBIDDEN");
      expect(await codeOf(ctx.tickOnRest(restId, countdownId, ctx.other))).toBe("FORBIDDEN");
      expect(await ctx.gm.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId })).toEqual({
        restId,
        lines: [],
        reminders: [{ countdownId, name: "Invasion", currentValue: 8 }],
      });
      expect(await ctx.tickOnRest(restId, countdownId)).toEqual({ currentValue: 7, status: "active", line: "Invasion: 7 left" });
    });

    it("finishing only reminds; the one-click tick ticks once, shows in the panel and the rest's undo takes it back", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ restMode: "remind", steps: STEPS });
      const { restId, result } = await ctx.longRest();
      expect(result.countdownLines).toBeUndefined();
      expect((await ctx.row(countdownId)).currentValue).toBe(8);
      expect((await ctx.log()).find((r) => r.kind === "countdown")?.summary).toBe("Long rest: Reminder: tick Invasion?");
      await ctx.tickOnRest(restId, countdownId);
      expect(await codeOf(ctx.tickOnRest(restId, countdownId))).toBe("COUNTDOWN_RULE");
      const panel = await ctx.gm.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId });
      expect(panel?.reminders).toEqual([]);
      expect(panel?.lines.map((l) => l.line)).toEqual(["Invasion: 7 left - The theocracy's troops gather at the border (news reaches the party)"]);
      await ctx.undo(restId);
      expect((await ctx.row(countdownId)).currentValue).toBe(8);
      expect(await ctx.gm.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId })).toBeNull();
    });

    it("refuses an older or interrupted rest, a non-long-term or foreign countdown", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ restMode: "remind" });
      const { restId: older } = await ctx.longRest();
      const { restId: short } = await ctx.start("short");
      await ctx.finish(short);
      expect(await codeOf(ctx.tickOnRest(older, countdownId))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.tickOnRest(short, countdownId))).toBe("COUNTDOWN_RULE");
      const { restId: interrupted } = await ctx.start("long");
      await ctx.interrupt(interrupted);
      expect(await codeOf(ctx.tickOnRest(interrupted, countdownId))).toBe("COUNTDOWN_RULE");
      const { restId } = await ctx.longRest();
      const { countdownId: standard } = await ctx.create({ mode: "standard" });
      expect(await codeOf(ctx.tickOnRest(restId, standard))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.tickOnRest(restId, await ctx.foreign()))).toBe("NOT_FOUND");
      expect((await ctx.row(countdownId)).currentValue).toBe(8);
    });
  });

  it("a long-term countdown with a dice start is refused (INVALID)", async () => {
    const ctx = await setup();
    expect(await codeOf(ctx.create({ startingValue: undefined, startDice: { count: 1, sides: 6 } }))).toBe("INVALID");
  });
});
