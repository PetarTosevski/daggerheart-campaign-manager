/**
 * TASK-CORE-CALENDAR (user decision 2026-11-02): a core campaign (no published frame, `frameId: "custom"`) has the
 * campaign calendar the frames have: "Week n · Day n" from Week 1, Day 1 (no row until its first End day, so existing
 * campaigns need no migration), the GM's End day, and undo of End day rolling the day back. The HUD disc reads it
 * through `combatHud.scene` (`day`, `canEndDay`).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

const CUSTOM = {
  pitch: "A drowned kingdom rises.",
  tones: ["Dark"],
  themes: "Grief",
  touchstones: "",
  partySize: 4,
  startingTier: 1,
  background: "custom",
};

async function coreCampaign() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|session` });
  const player = t.withIdentity({ subject: `${ids.player}|session` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "custom", name: "Core", custom: CUSTOM, idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code });
  const { characterId } = await player.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() });
  return { t, gm, player, campaignId, characterId };
}

type Core = Awaited<ReturnType<typeof coreCampaign>>;

const endDay = (c: Core) => c.gm.mutation(api.campaignTime.endDay, { campaignId: c.campaignId, idempotencyKey: key() });
const undo = (c: Core, entryId: Id<"actionLog">) => c.gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
const calendar = (c: Core) => c.player.query(api.campaignTime.calendar, { campaignId: c.campaignId });
const scene = (c: Core, who: "gm" | "player") => c[who].query(api.combatHud.scene, { campaignId: c.campaignId });

async function giveDailyUse(c: Core) {
  await c.t.run(async (ctx) => {
    const sheet = readSheet((await ctx.db.get("characters", c.characterId))!.sheet);
    await saveSheet(ctx, c.characterId, { ...sheet, featureUses: [{ key: "daily", until: "day" }] });
  });
}
const usesOf = (c: Core) =>
  c.t.run(async (ctx) => (readSheet((await ctx.db.get("characters", c.characterId))!.sheet).featureUses ?? []).map((u) => u.key));

describe("core campaign calendar", () => {
  it("starts on Week 1, Day 1 in daylight, with no time row yet", async () => {
    const c = await coreCampaign();
    expect(await c.t.run((ctx) => ctx.db.query("campaignTime").collect())).toEqual([]);
    expect(await calendar(c)).toEqual({ week: 1, day: 1, cycles: false });
    expect(await scene(c, "gm")).toEqual({
      fear: 0,
      light: "day",
      phase: null,
      day: { week: 1, day: 1, cycle: "DAY" },
      canSetLight: true,
      canOpenTimeArc: false,
      canEndDay: true,
    });
    expect(await scene(c, "player")).toMatchObject({ day: { week: 1, day: 1, cycle: "DAY" }, canEndDay: false, canSetLight: false });
  });

  it("End day advances the day, resets the light to Day and ends daily uses; day 7 starts a new week", async () => {
    const c = await coreCampaign();
    await giveDailyUse(c);
    await c.gm.mutation(api.campaigns.setTimeOfDay, { campaignId: c.campaignId, timeOfDay: "night" });
    const first = await endDay(c);
    expect(first).toMatchObject({ week: 1, day: 2, cycle: "DAY", newWeek: false, ended: 1 });
    expect(await usesOf(c)).toEqual([]);
    expect(await scene(c, "player")).toMatchObject({ light: "day", day: { week: 1, day: 2, cycle: "DAY" } });
    for (let day = 3; day <= 7; day++) await endDay(c);
    const week = await endDay(c);
    expect(week).toMatchObject({ week: 2, day: 1, cycle: "DAY", newWeek: true });
    expect(await calendar(c)).toEqual({ week: 2, day: 1, cycles: false });
  });

  it("undo of End day rolls the day, the light and the uses back", async () => {
    const c = await coreCampaign();
    await giveDailyUse(c);
    await c.gm.mutation(api.campaigns.setTimeOfDay, { campaignId: c.campaignId, timeOfDay: "dim" });
    const { entryId } = await endDay(c);
    await undo(c, entryId!);
    expect(await calendar(c)).toEqual({ week: 1, day: 1, cycles: false });
    expect(await usesOf(c)).toEqual(["daily"]);
    expect(await scene(c, "gm")).toMatchObject({ light: "dim", day: { week: 1, day: 1, cycle: "DAY" } });
  });

  it("only the GM ends the day", async () => {
    const c = await coreCampaign();
    const error = await c.player.mutation(api.campaignTime.endDay, { campaignId: c.campaignId, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect((await calendar(c)).day).toBe(1);
  });

  it("keeps the Witherwild arc to the Witherwild: get / advance stay disabled", async () => {
    const c = await coreCampaign();
    const error = await c.gm.query(api.campaignTime.get, { campaignId: c.campaignId }).catch((e) => e);
    expect(errorCode(error)).toBe("MECHANIC_DISABLED");
  });
});
