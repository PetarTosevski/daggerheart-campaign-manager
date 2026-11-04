/**
 * Plan lanes-2 CT2 (dcm-jq4b): undoing End day (or a Witherwild day-icon jump forward) also moves the campaign day and
 * the time of day back, in the same undo group as the uses it gave back. User answer 2026-11-01: only undoing the LATEST
 * End day moves the calendar; undoing an older one gives back its uses only, with a feed line.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { FeatureUse } from "../../src/lib/validation/characters";
import { buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

async function giveUses(w: World, characterId: Id<"characters">, uses: FeatureUse[]) {
  await w.t.run(async (ctx) => {
    const sheet = readSheet((await ctx.db.get("characters", characterId))!.sheet);
    await saveSheet(ctx, characterId, { ...sheet, featureUses: uses });
  });
}

async function usesOf(w: World, characterId: Id<"characters">): Promise<string[]> {
  return w.t.run(async (ctx) => (readSheet((await ctx.db.get("characters", characterId))!.sheet).featureUses ?? []).map((u) => u.key));
}

const endDay = (w: World) => w.as("gm").mutation(api.campaignTime.endDay, { campaignId: w.campaignId, idempotencyKey: key() });
const undo = (w: World, entryId: Id<"actionLog">) => w.as("gm").mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
const calendar = (w: World) => w.as("player").query(api.campaignTime.calendar, { campaignId: w.campaignId });
const light = async (w: World) => (await w.as("player").query(api.campaigns.timeOfDay, { campaignId: w.campaignId })).light;

describe("undo of the latest End day moves the calendar back", () => {
  it("restores the day and the uses in one undo", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await giveUses(w, w.characterA, [{ key: "daily", until: "day" }]);
    const { entryId, day } = await endDay(w);
    expect(day).toBe(2);
    expect(await usesOf(w, w.characterA)).toEqual([]);
    await undo(w, entryId!);
    expect(await calendar(w)).toEqual({ week: 1, day: 1, cycles: false });
    expect(await usesOf(w, w.characterA)).toEqual(["daily"]);
    const history = await w.t.run((ctx) => ctx.db.query("history").collect());
    expect(history.find((h) => h.action === "undoEndDay")).toMatchObject({ before: { cycleDay: 2 }, after: { cycleDay: 1 } });
  });

  it("writes an undoable campaign row even when no use ended", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { entryId, ended } = await endDay(w);
    expect(ended).toBe(0);
    expect(entryId).not.toBeNull();
    const row = await w.t.run((ctx) => ctx.db.get("actionLog", entryId!));
    expect(row).toMatchObject({ kind: "session", undoable: true, summary: "Day 1 ended" });
    expect(row!.timeChange).toEqual({ before: { week: 1, cycle: "DAY", cycleDay: 1 }, after: { week: 1, cycle: "DAY", cycleDay: 2 } });
    await undo(w, entryId!);
    expect((await calendar(w)).day).toBe(1);
  });

  it("brings back the time of day End day reset", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" });
    const { entryId } = await endDay(w);
    expect(await light(w)).toBe("day");
    await undo(w, entryId!);
    expect(await light(w)).toBe("night");
  });

  it("leaves the time of day alone when it was already Day", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { entryId } = await endDay(w);
    const row = await w.t.run((ctx) => ctx.db.get("actionLog", entryId!));
    expect(row!.timeChange?.timeOfDayBefore).toBeUndefined();
    await undo(w, entryId!);
    expect(await w.t.run(async (ctx) => (await ctx.db.get("campaigns", w.campaignId))!.timeOfDay ?? null)).toBeNull();
  });

  it("undoes a passed week back to day 7 of the week before", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    for (let day = 2; day <= 7; day++) await endDay(w);
    await giveUses(w, w.characterA, [{ key: "weekly", until: "week" }]);
    const { entryId, newWeek } = await endDay(w);
    expect(newWeek).toBe(true);
    await undo(w, entryId!);
    expect(await calendar(w)).toEqual({ week: 1, day: 7, cycles: false });
    expect(await usesOf(w, w.characterA)).toEqual(["weekly"]);
  });

  it("steps back one End day at a time, newest first", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const first = await endDay(w);
    const second = await endDay(w);
    await undo(w, second.entryId!);
    expect((await calendar(w)).day).toBe(2);
    await undo(w, first.entryId!);
    expect((await calendar(w)).day).toBe(1);
  });

  it("keeps Witherwild's cycle: undoing the day-7 End day goes back to the Day week", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 7, idempotencyKey: key() });
    const { entryId, cycle } = await endDay(w);
    expect(cycle).toBe("NIGHT");
    await undo(w, entryId!);
    expect(await w.as("gm").query(api.campaignTime.get, { campaignId: w.campaignId })).toEqual({ week: 1, cycle: "DAY", cycleDay: 7 });
  });

  it("refuses a second undo of the same End day", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { entryId } = await endDay(w);
    await undo(w, entryId!);
    expect(errorCode(await undo(w, entryId!).catch((e) => e))).toBe("UNDO_STALE");
    expect((await calendar(w)).day).toBe(1);
  });

  it("is GM-only: a player cannot undo the GM's End day", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { entryId } = await endDay(w);
    const error = await w.as("player").mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect((await calendar(w)).day).toBe(2);
  });
});

describe("undo of an older End day (user answer 2026-11-01)", () => {
  it("gives back its uses only, keeps the calendar and writes a feed line", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await giveUses(w, w.characterA, [{ key: "daily", until: "day" }]);
    const first = await endDay(w);
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" });
    await endDay(w); // ends nothing on characterA, so the older day stays undoable for it
    await undo(w, first.entryId!);
    expect(await usesOf(w, w.characterA)).toEqual(["daily"]);
    expect(await calendar(w)).toEqual({ week: 1, day: 3, cycles: false });
    expect(await light(w)).toBe("day");
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    const line = rows.find((r) => r.summary.startsWith("End of Week 1 · Day 1 undone"));
    expect(line).toMatchObject({ kind: "session", visibility: "public", undoable: false });
    expect(line!.summary).toContain("the calendar stays on Week 1 · Day 3");
    expect(await w.t.run((ctx) => ctx.db.query("history").collect())).not.toContainEqual(expect.objectContaining({ action: "undoEndDay" }));
  });

  it("moves the calendar back once the later End day is undone first", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const first = await endDay(w);
    const second = await endDay(w);
    await undo(w, second.entryId!);
    await undo(w, first.entryId!);
    expect((await calendar(w)).day).toBe(1);
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.some((r) => r.summary.includes("a later day has passed"))).toBe(false);
  });
});

describe("Witherwild day-icon jump forward", () => {
  it("undo moves the arc back with the uses", async () => {
    const w = await buildWorld();
    await giveUses(w, w.characterA, [{ key: "daily", until: "day" }]);
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 4, idempotencyKey: key() });
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    const campaignRow = rows.find((r) => r.characterId === undefined)!;
    expect(campaignRow.timeChange).toEqual({ before: { week: 1, cycle: "DAY", cycleDay: 1 }, after: { week: 1, cycle: "DAY", cycleDay: 4 } });
    await undo(w, campaignRow._id);
    expect(await w.as("gm").query(api.campaignTime.get, { campaignId: w.campaignId })).toEqual({ week: 1, cycle: "DAY", cycleDay: 1 });
    expect(await usesOf(w, w.characterA)).toEqual(["daily"]);
  });

  it("a jump back writes no row; a jump forward with nothing to end is still undoable", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 3, idempotencyKey: key() });
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 2, idempotencyKey: key() });
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows).toHaveLength(1);
    // The arc moved back after the jump, so it no longer stands on the jump's day: an older day's undo, uses only.
    await undo(w, rows[0]!._id);
    expect((await w.as("gm").query(api.campaignTime.get, { campaignId: w.campaignId })).cycleDay).toBe(2);
  });
});
