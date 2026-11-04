/**
 * Plan lanes-2 CT (dcm-ztb8, dcm-gfk3; callers of dcm-55k / dcm-bc67): every campaign counts days and weeks, the GM's
 * End day ends once-per-day feature uses (and weekly ones after day 7), and ending a GM turn ends gmTurn uses.
 * Witherwild keeps its cycles (tests/convex/campaign-time.test.ts stays as it was).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { InstanceFeatureUse } from "../../convex/lib/validators/encounters";
import type { FeatureUse } from "../../src/lib/validation/characters";
import { buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

const USES: FeatureUse[] = [
  { key: "turn", until: "gmTurn" },
  { key: "daily", until: "day" },
  { key: "weekly", until: "week" },
  { key: "rest", until: "rest" },
];

async function giveUses(w: World, characterId: Id<"characters">, uses: FeatureUse[] = USES) {
  await w.t.run(async (ctx) => {
    const sheet = readSheet((await ctx.db.get("characters", characterId))!.sheet);
    await saveSheet(ctx, characterId, { ...sheet, featureUses: uses });
  });
}

async function usesOf(w: World, characterId: Id<"characters">): Promise<string[]> {
  return w.t.run(async (ctx) => (readSheet((await ctx.db.get("characters", characterId))!.sheet).featureUses ?? []).map((u) => u.key));
}

const endDay = (w: World) => w.as("gm").mutation(api.campaignTime.endDay, { campaignId: w.campaignId, idempotencyKey: key() });

/** A running encounter with one bear whose featureUses are `uses`; returns the ids. */
async function runningBear(w: World, uses: InstanceFeatureUse[]) {
  const gm = w.as("gm");
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId: w.campaignId, name: "Den", idempotencyKey: key() });
  await gm.mutation(api.encounters.addAdversary, { campaignId: w.campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, count: 1, summoned: false, idempotencyKey: key() });
  await gm.mutation(api.encounters.start, { campaignId: w.campaignId, encounterId });
  const instanceId = await w.t.run(async (ctx) => {
    const row = (await ctx.db.query("encounterAdversaries").withIndex("by_encounter_order", (q) => q.eq("encounterId", encounterId)).first())!;
    await ctx.db.patch("encounterAdversaries", row._id, { featureUses: uses });
    return row._id;
  });
  return { encounterId, instanceId };
}

describe("campaign days and weeks for every frame", () => {
  it("counts days and weeks in a frame without the Witherwild clock, which keeps its cycle", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    expect(await w.as("player").query(api.campaignTime.calendar, { campaignId: w.campaignId })).toEqual({ week: 1, day: 1, cycles: false });
    expect(await w.t.run((ctx) => ctx.db.query("campaignTime").collect())).toEqual([]);
    for (let day = 2; day <= 7; day++) expect((await endDay(w)).day).toBe(day);
    const out = await endDay(w);
    expect(out).toMatchObject({ week: 2, day: 1, cycle: "DAY", newWeek: true });
    expect(await w.as("player").query(api.campaignTime.calendar, { campaignId: w.campaignId })).toEqual({ week: 2, day: 1, cycles: false });
    // The Witherwild arc's functions stay Witherwild-only.
    expect(errorCode(await w.as("gm").query(api.campaignTime.get, { campaignId: w.campaignId }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    const history = await w.t.run((ctx) => ctx.db.query("history").collect());
    expect(history.filter((h) => h.kind === "campaignTime" && h.action === "endDay")).toHaveLength(7);
  });

  it("ends once-per-day uses on a day's end and weekly ones when the week passes", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await giveUses(w, w.characterA);
    const out = await endDay(w);
    expect(out).toMatchObject({ day: 2, newWeek: false, ended: 2 });
    // A day ends gmTurn and day uses (expiry.ts); week and rest stay.
    expect(await usesOf(w, w.characterA)).toEqual(["weekly", "rest"]);
    for (let day = 3; day <= 7; day++) await endDay(w);
    await giveUses(w, w.characterA);
    const week = await endDay(w);
    expect(week).toMatchObject({ week: 2, day: 1, newWeek: true, ended: 3 });
    expect(await usesOf(w, w.characterA)).toEqual(["rest"]);
  });

  it("logs one undoable group that gives the uses back", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await giveUses(w, w.characterA);
    await giveUses(w, w.characterB, [{ key: "daily", until: "day" }]);
    const { entryId } = await endDay(w);
    expect(entryId).not.toBeNull();
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    const group = rows.filter((r) => r.groupId === rows.find((x) => x._id === entryId)!.groupId);
    expect(group).toHaveLength(3); // two PCs and the campaign row
    expect(group.every((r) => r.kind === "session" && r.undoable)).toBe(true);
    await w.as("gm").mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey: key() });
    expect(await usesOf(w, w.characterA)).toEqual(USES.map((u) => u.key));
    expect(await usesOf(w, w.characterB)).toEqual(["daily"]);
  });

  // CT2 (dcm-jq4b, user answer 2026-10-31 Q4): End day always writes its campaign row (the day itself is undoable).
  it("writes only the campaign row when nothing ends", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    expect(await endDay(w)).toMatchObject({ ended: 0 });
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.characterId).toBeUndefined();
  });

  it("replays a retried End day", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const k = key();
    await w.as("gm").mutation(api.campaignTime.endDay, { campaignId: w.campaignId, idempotencyKey: k });
    await w.as("gm").mutation(api.campaignTime.endDay, { campaignId: w.campaignId, idempotencyKey: k });
    expect((await w.as("gm").query(api.campaignTime.calendar, { campaignId: w.campaignId })).day).toBe(2);
  });

  it("refuses a player's End day", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const error = await w.as("player").mutation(api.campaignTime.endDay, { campaignId: w.campaignId, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  it("ends the day / week uses of running encounters' instances, and undo gives them back", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const uses: InstanceFeatureUse[] = [
      { key: "a", until: "day", scene: 1 },
      { key: "b", until: "week", scene: 1 },
      { key: "c", until: "session", scene: 1 },
    ];
    const { instanceId } = await runningBear(w, uses);
    const { entryId, ended } = await endDay(w);
    expect(ended).toBe(1);
    const keys = async () => w.t.run(async (ctx) => ((await ctx.db.get("encounterAdversaries", instanceId))!.featureUses ?? []).map((u) => u.key));
    expect(await keys()).toEqual(["b", "c"]);
    await w.as("gm").mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey: key() });
    expect(await keys()).toEqual(["a", "b", "c"]);
    // CT2 (dcm-jq4b): the undo gave the use back and the day (day 1 again): six End days reach day 7, the seventh passes the week.
    for (let day = 2; day <= 7; day++) await endDay(w);
    expect(await keys()).toEqual(["b", "c"]);
    await endDay(w);
    expect(await keys()).toEqual(["c"]);
  });

  it("keeps Witherwild's cycles: End day on day 7 starts the next week's Night", async () => {
    const w = await buildWorld();
    expect(await w.as("gm").query(api.campaignTime.calendar, { campaignId: w.campaignId })).toEqual({ week: 1, day: 1, cycles: true });
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 7, idempotencyKey: key() });
    await giveUses(w, w.characterA);
    expect(await endDay(w)).toMatchObject({ week: 2, day: 1, cycle: "NIGHT", newWeek: true, ended: 3 });
    expect(await w.as("gm").query(api.campaignTime.get, { campaignId: w.campaignId })).toEqual({ week: 2, cycle: "NIGHT", cycleDay: 1 });
    expect(await w.t.run((ctx) => ctx.db.query("campaignTime").collect())).toHaveLength(1);
  });
});

describe("user answers 2026-10-31 (CT Q2, Q3)", () => {
  it("End day resets the time of day to Day outside the Witherwild", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" });
    await endDay(w);
    expect((await w.as("player").query(api.campaigns.timeOfDay, { campaignId: w.campaignId })).light).toBe("day");
  });

  it("a Witherwild day icon forward ends the day uses; a jump back ends nothing", async () => {
    const w = await buildWorld();
    await giveUses(w, w.characterA);
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 4, idempotencyKey: key() });
    expect(await usesOf(w, w.characterA)).toEqual(["weekly", "rest"]);
    const campaignRow = (await w.t.run((ctx) => ctx.db.query("actionLog").collect())).find((r) => r.characterId === undefined)!;
    expect(campaignRow.summary).toContain("Days 1-3 ended");
    await giveUses(w, w.characterA);
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 2, idempotencyKey: key() });
    expect(await usesOf(w, w.characterA)).toEqual(USES.map((u) => u.key));
  });
});

describe("the GM turn's end", () => {
  it("ends gmTurn uses only, in one undoable group", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { encounterId } = await runningBear(w, []);
    await giveUses(w, w.characterA);
    expect(await w.as("gm").mutation(api.encounterTracking.endGmTurn, { campaignId: w.campaignId, encounterId, idempotencyKey: key() })).toEqual({ gmTurn: 2 });
    expect(await usesOf(w, w.characterA)).toEqual(["daily", "weekly", "rest"]);
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    const campaignRow = rows.find((r) => r.characterId === undefined)!;
    expect(campaignRow.summary).toContain("GM turn 1 ended");
    await w.as("gm").mutation(api.actionLog.undo, { entryId: campaignRow._id, idempotencyKey: key() });
    expect(await usesOf(w, w.characterA)).toEqual(USES.map((u) => u.key));
  });

  it("writes nothing when no gmTurn use is held", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { encounterId } = await runningBear(w, []);
    await w.as("gm").mutation(api.encounterTracking.endGmTurn, { campaignId: w.campaignId, encounterId, idempotencyKey: key() });
    expect(await w.t.run((ctx) => ctx.db.query("actionLog").collect())).toEqual([]);
  });
});
