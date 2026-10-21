import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseCountdownLabel } from "../../src/lib/domain/countdowns/labels";
import { environmentsFor, featureCountdownLabels } from "../../src/lib/domain/environments/index";
import { ENVIRONMENTS } from "../../src/lib/srd/environments";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

/**
 * countdowns-advanced K2: setArmed, operate through the one tick path (a manual tick to 0 triggers and resets like a
 * roll, D7 / Q2) and environment countdowns built from their label (parseCountdownLabel), per role.
 */

const BASE = { name: "Doom", description: "", category: "threat" as const, consequence: "The dam breaks" };

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function setup() {
  const ctx = await setupWithCampaign();
  await ctx.gm.mutation(api.campaigns.setOption, { campaignId: ctx.campaignId, option: "hopeAndFear", enabled: true });
  const create = async (extra: Record<string, unknown>) =>
    (await ctx.gm.mutation(api.countdowns.create, { campaignId: ctx.campaignId, ...BASE, ...extra, idempotencyKey: key() } as never)) as {
      countdownId: Id<"countdowns">;
    };
  const row = (id: Id<"countdowns">) => ctx.t.run(async (c) => (await c.db.get("countdowns", id))!);
  const op = (countdownId: Id<"countdowns">, action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "correction", amount?: number) =>
    ctx.gm.mutation(api.countdowns.operate, { countdownId, action, amount, idempotencyKey: key() });
  const arm = (countdownId: Id<"countdowns">, armed: boolean, who = ctx.gm) =>
    who.mutation(api.countdowns.setArmed, { campaignId: ctx.campaignId, countdownId, armed, idempotencyKey: key() });
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
  const start = (environmentId: string, featureName: string, label?: string, who = ctx.gm) =>
    who.mutation(api.environmentActions.startCountdown, { campaignId: ctx.campaignId, environmentId, featureName, label, idempotencyKey: key() });
  const invite = () => ctx.gm.mutation(api.members.invite, { campaignId: ctx.campaignId, email: OTHER_EMAIL });
  return { ...ctx, create, row, op, arm, history, notices, start, invite };
}

describe("countdown types on the dashboard (countdowns-advanced K2)", () => {
  useAllowlist();

  describe("setArmed", () => {
    it("anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 4 });
      const args = { campaignId: ctx.campaignId, countdownId, armed: true };
      expect(await codeOf(ctx.t.mutation(api.countdowns.setArmed, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.countdowns.setArmed, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.mutation(api.countdowns.setArmed, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await ctx.arm(countdownId, true)).toEqual({ armed: true });
      expect((await ctx.row(countdownId)).armed).toBe(true);
    });

    it("arms and disarms without a history row; the GM's list shows it; players get null", async () => {
      const ctx = await setup();
      await ctx.invite();
      const { countdownId } = await ctx.create({ startingValue: 4 });
      await ctx.arm(countdownId, true);
      expect((await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId }))[0]).toMatchObject({ armed: true });
      expect((await ctx.other.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId }))[0]).toMatchObject({ armed: null });
      await ctx.arm(countdownId, false);
      expect((await ctx.row(countdownId)).armed).toBe(false);
      expect((await ctx.history(countdownId)).map((h) => h.action)).toEqual(["create"]);
    });

    it("NOT_FOUND for a frame-owned or another campaign's countdown; COUNTDOWN_RULE for a cancelled one", async () => {
      const ctx = await setup();
      const owned = await ctx.t.run((c) =>
        c.db.insert("countdowns", {
          campaignId: ctx.campaignId, ...BASE, startingValue: 4, currentValue: 4, status: "active", createdAt: 0, ownerKey: "objective:x",
        }),
      );
      expect(await codeOf(ctx.arm(owned, true))).toBe("NOT_FOUND");
      const { campaignId: theirs } = await ctx.other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
      const foreign = await ctx.t.run((c) =>
        c.db.insert("countdowns", { campaignId: theirs, ...BASE, startingValue: 4, currentValue: 4, status: "active", createdAt: 0 }),
      );
      expect(await codeOf(ctx.arm(foreign, true))).toBe("NOT_FOUND");
      const { countdownId } = await ctx.create({ startingValue: 4 });
      await ctx.op(countdownId, "cancel");
      expect(await codeOf(ctx.arm(countdownId, true))).toBe("COUNTDOWN_RULE");
    });

    it("a chase row arms its partner too (D9)", async () => {
      const ctx = await setup();
      const { countdownId: party } = await ctx.create({ startingValue: 6, mode: "progress" });
      const { countdownId: rivals } = await ctx.create({ startingValue: 6, mode: "consequence" });
      await ctx.t.run(async (c) => {
        await c.db.patch("countdowns", party, { chase: { partnerId: rivals, side: "party", party: "pursuing" } });
        await c.db.patch("countdowns", rivals, { chase: { partnerId: party, side: "rivals", party: "pursuing" }, currentValue: 3 });
      });
      await ctx.arm(party, true);
      expect([(await ctx.row(party)).armed, (await ctx.row(rivals)).armed]).toEqual([true, true]);
      await ctx.arm(rivals, false);
      expect([(await ctx.row(party)).armed, (await ctx.row(rivals)).armed]).toEqual([false, false]);
    });
  });

  describe("create of each type", () => {
    const variants: [string, Record<string, unknown>][] = [
      ["standard fixed", { startingValue: 4, mode: "standard", armed: true }],
      ["progress fixed", { startingValue: 6, mode: "progress", armed: true }],
      ["consequence dice", { startDice: { count: 2, sides: 4 }, mode: "consequence", armed: true }],
      ["loop dice", { startDice: { count: 1, sides: 6 }, mode: "standard", repeat: "loop", armed: true }],
      ["increasing fixed", { startingValue: 8, repeat: "increasing", armed: false }],
      ["decreasing fixed", { startingValue: 8, repeat: "decreasing" }],
    ];
    it.each(variants)("%s", async (_, extra) => {
      const ctx = await setup();
      const { countdownId } = await ctx.create(extra);
      const view = (await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).find((c) => c._id === countdownId)!;
      expect(view).toMatchObject({
        mode: (extra.mode as string | undefined) ?? "standard",
        repeat: (extra.repeat as string | undefined) ?? null,
        armed: (extra.armed as boolean | undefined) ?? false,
        startDice: (extra.startDice as object | undefined) ?? null,
        triggerCount: 0,
      });
      const dice = extra.startDice as { count: number; sides: number } | undefined;
      if (dice) {
        expect(view.startingValue).toBeGreaterThanOrEqual(dice.count);
        expect(view.startingValue).toBeLessThanOrEqual(dice.count * dice.sides);
      } else expect(view.startingValue).toBe(extra.startingValue);
      expect(view.initialValue).toBe(extra.repeat ? view.startingValue : null);
    });
  });

  describe("operate through the tick path", () => {
    it("operate per role is unchanged: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 2, repeat: "loop" });
      const args = { countdownId, action: "advance" as const };
      expect(await codeOf(ctx.t.mutation(api.countdowns.operate, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.countdowns.operate, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.mutation(api.countdowns.operate, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await ctx.op(countdownId, "advance")).toEqual({ previousValue: 2, newValue: 1, status: "active" });
    });

    it("a manual tick of a loop at 1 triggers, resets it and writes the GM-only notice", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 2, repeat: "loop" });
      await ctx.op(countdownId, "advance");
      expect(await ctx.op(countdownId, "advance")).toEqual({ previousValue: 1, newValue: 2, status: "active" });
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 2, startingValue: 2, status: "active", triggerCount: 1, lastTriggeredAt: expect.any(Number) });
      expect((await ctx.history(countdownId)).map((h) => h.action)).toEqual(["create", "advance", "trigger"]);
      const notices = await ctx.notices();
      expect(notices.map((n) => [n.visibility, n.summary, n.undoable])).toEqual([["gm", "Doom triggered: The dam breaks", false]]);
      // Twice more: the second trigger is counted.
      await ctx.op(countdownId, "advance");
      await ctx.op(countdownId, "advance");
      expect((await ctx.row(countdownId)).triggerCount).toBe(2);
      expect((await ctx.notices()).at(-1)?.summary).toBe("Doom triggered (2nd time): The dam breaks");
    });

    it("a correction to 0 triggers an active loop; a paused one stays paused at 0 and triggers on Resume (K6, dcm-bxp.74)", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 5, repeat: "loop" });
      expect(await ctx.op(countdownId, "correction", -5)).toEqual({ previousValue: 5, newValue: 5, status: "active" });
      expect((await ctx.row(countdownId)).triggerCount).toBe(1);
      await ctx.op(countdownId, "pause");
      expect(await ctx.op(countdownId, "correction", -2)).toEqual({ previousValue: 5, newValue: 3, status: "paused" });
      // Nothing triggers while paused: it stays paused at 0, no trigger, no reset, no notice.
      expect(await ctx.op(countdownId, "correction", -3)).toEqual({ previousValue: 3, newValue: 0, status: "paused" });
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 0, startingValue: 5, status: "paused", triggerCount: 1 });
      expect((await ctx.row(countdownId)).completedAt).toBeUndefined();
      expect(await ctx.notices()).toHaveLength(1);
      // A correction up while paused stays paused too.
      expect(await ctx.op(countdownId, "correction", 2)).toEqual({ previousValue: 0, newValue: 2, status: "paused" });
      await ctx.op(countdownId, "correction", -2);
      // Resume brings the trigger: it resets, active, with the notice.
      expect(await ctx.op(countdownId, "resume")).toEqual({ previousValue: 0, newValue: 5, status: "active" });
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 5, status: "active", triggerCount: 2 });
      expect((await ctx.notices()).at(-1)?.summary).toBe("Doom triggered (2nd time): The dam breaks");
      expect((await ctx.history(countdownId)).map((h) => h.action)).toEqual([
        "create",
        "trigger",
        "pause",
        "correction",
        "correction",
        "correction",
        "correction",
        "trigger",
      ]);
    });

    it("a paused countdown that doesn't repeat stays paused at 0 and completes on Resume without a notice", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 3 });
      await ctx.op(countdownId, "pause");
      expect(await ctx.op(countdownId, "correction", -3)).toEqual({ previousValue: 3, newValue: 0, status: "paused" });
      expect((await ctx.row(countdownId)).completedAt).toBeUndefined();
      expect(await ctx.op(countdownId, "resume")).toEqual({ previousValue: 0, newValue: 0, status: "completed" });
      expect(await ctx.row(countdownId)).toMatchObject({ status: "completed", completedAt: expect.any(Number) });
      expect((await ctx.row(countdownId)).triggerCount).toBeUndefined();
      expect(await ctx.notices()).toHaveLength(0);
      const rows = await ctx.history(countdownId);
      expect(rows.at(-1)).toMatchObject({ action: "resume", before: { currentValue: 0, status: "paused" }, after: { currentValue: 0, status: "completed" } });
    });

    it("a paused decreasing countdown at its last loop brings the major event on Resume", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 1, repeat: "decreasing" });
      await ctx.op(countdownId, "pause");
      await ctx.op(countdownId, "correction", -1);
      expect(await ctx.op(countdownId, "resume")).toEqual({ previousValue: 0, newValue: 0, status: "completed" });
      expect((await ctx.notices()).at(-1)?.summary).toBe("Doom: major event: The dam breaks");
    });

    it("decreasing at 1 ends with the major event and completes", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 2, repeat: "decreasing" });
      await ctx.op(countdownId, "correction", -2); // triggers, start 2 -> 1
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: 1, startingValue: 1, status: "active", triggerCount: 1 });
      expect(await ctx.op(countdownId, "advance")).toEqual({ previousValue: 1, newValue: 0, status: "completed" });
      expect(await ctx.row(countdownId)).toMatchObject({ status: "completed", triggerCount: 2, completedAt: expect.any(Number) });
      expect((await ctx.notices()).at(-1)?.summary).toBe("Doom: major event: The dam breaks");
      expect(await codeOf(ctx.op(countdownId, "advance"))).toBe("COUNTDOWN_RULE");
    });

    it("increasing goes past 20", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 20, repeat: "increasing" });
      expect(await ctx.op(countdownId, "correction", -20)).toEqual({ previousValue: 20, newValue: 21, status: "active" });
      expect(await ctx.row(countdownId)).toMatchObject({ startingValue: 21, currentValue: 21, initialValue: 20, triggerCount: 1 });
      // Borrowed Time is bounded by the current cycle's start.
      expect(await codeOf(ctx.op(countdownId, "reverse"))).toBe("COUNTDOWN_RULE");
      await ctx.op(countdownId, "advance");
      expect(await ctx.op(countdownId, "reverse")).toMatchObject({ newValue: 21 });
    });

    it("a rolled loop resets to the value first rolled (Q4)", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startDice: { count: 1, sides: 6 }, repeat: "loop" });
      const rolled = (await ctx.row(countdownId)).startingValue;
      await ctx.op(countdownId, "correction", -rolled);
      expect(await ctx.row(countdownId)).toMatchObject({ currentValue: rolled, startingValue: rolled, triggerCount: 1 });
    });

    it("a countdown that doesn't repeat completes once with a trigger notice; reverse reopens it as before", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 1 });
      expect(await ctx.op(countdownId, "advance")).toEqual({ previousValue: 1, newValue: 0, status: "completed" });
      expect((await ctx.notices()).map((n) => n.summary)).toEqual(["Doom triggered: The dam breaks"]);
      expect(await ctx.op(countdownId, "reverse")).toEqual({ previousValue: 0, newValue: 1, status: "active" });
      expect((await ctx.row(countdownId)).completedAt).toBeUndefined();
    });

    it("refusals stay as before: out of range, paused advance, cancelled", async () => {
      const ctx = await setup();
      const { countdownId } = await ctx.create({ startingValue: 3, repeat: "loop" });
      expect(await codeOf(ctx.op(countdownId, "correction", -4))).toBe("COUNTDOWN_RULE");
      await ctx.op(countdownId, "pause");
      expect(await codeOf(ctx.op(countdownId, "advance"))).toBe("COUNTDOWN_RULE");
      await ctx.op(countdownId, "cancel");
      expect(await codeOf(ctx.op(countdownId, "correction", -1))).toBe("COUNTDOWN_RULE");
      expect((await ctx.row(countdownId)).currentValue).toBe(3);
    });
  });

  describe("environment countdowns from their label", () => {
    it("startCountdown per role: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
      const ctx = await setup();
      const args = { campaignId: ctx.campaignId, environmentId: "mountain-pass", featureName: "Icy Winds" };
      expect(await codeOf(ctx.t.mutation(api.environmentActions.startCountdown, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.other.mutation(api.environmentActions.startCountdown, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
      await ctx.invite();
      expect(await codeOf(ctx.other.mutation(api.environmentActions.startCountdown, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await codeOf(ctx.start("mountain-pass", "Icy Winds"))).toBe("ok");
    });

    // Every countdown label the SRD environments name, as the campaign sees them.
    const cases = environmentsFor(ENVIRONMENTS, { hopeAndFear: true, frameId: "witherwild" }).flatMap((environment) =>
      environment.features.flatMap((feature) => featureCountdownLabels(feature).map((label) => [label, environment.id, feature.name] as const)),
    );

    it("covers the label forms (loop with dice, long-term, progress, consequence)", () => {
      const labels = cases.map(([label]) => label);
      expect(labels).toContain("Countdown (Loop 1d4)");
      expect(labels.some((l) => /Long-Term Countdown \(8\)/.test(l))).toBe(true);
      expect(labels.some((l) => /^Progress Countdown/.test(l))).toBe(true);
      expect(labels.some((l) => /^Consequence Countdown/.test(l))).toBe(true);
    });

    it.each(cases)("%s (%s: %s) creates the countdown its label describes", async (label, environmentId, featureName) => {
      const ctx = await setup();
      const parsed = parseCountdownLabel(label)!;
      expect(parsed).not.toBeNull();
      const result = await ctx.start(environmentId, featureName, label);
      const c = await ctx.row(result.countdownId);
      expect(c).toMatchObject({ armed: true, status: "active", visibility: { mode: "private" }, startingValue: result.startingValue, currentValue: result.startingValue });
      expect(c.mode ?? "standard").toBe(parsed.mode);
      expect(c.repeat ?? null).toBe(parsed.repeat);
      if (parsed.start.kind === "fixed") {
        expect(c.startingValue).toBe(parsed.start.value);
        expect(c.startDice).toBeUndefined();
      } else {
        expect(c.startDice).toEqual({ count: parsed.start.count, sides: parsed.start.sides });
        expect(c.startingValue).toBeGreaterThanOrEqual(parsed.start.count);
        expect(c.startingValue).toBeLessThanOrEqual(parsed.start.count * parsed.start.sides);
      }
      expect(c.initialValue).toBe(parsed.repeat ? c.startingValue : undefined);
    });

    it("the result keeps its shape and the loop resets when ticked to 0 by hand", async () => {
      const ctx = await setup();
      const result = await ctx.start("mountain-pass", "Icy Winds");
      expect(Object.keys(result).sort()).toEqual(["countdownId", "name", "startingValue"]);
      expect(result.name).toBe("Mountain Pass: Icy Winds");
      const c = await ctx.row(result.countdownId);
      expect(c).toMatchObject({ repeat: "loop", startingValue: 4 });
      await ctx.op(result.countdownId, "correction", -4);
      expect(await ctx.row(result.countdownId)).toMatchObject({ currentValue: 4, triggerCount: 1, status: "active" });
    });
  });
});
