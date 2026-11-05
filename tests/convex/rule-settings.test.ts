import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ruleMode, ruleModesOf } from "../../convex/lib/ruleModes";
import { resolveRuleModes } from "../../src/lib/rules/resolve";
import { errorCode, GM_EMAIL, key, setupWithCampaign } from "./helpers";
import { makeTest } from "./setup";

/** Plan rule-switches RS0: `ruleSettings.get` / `.set`, the live-session lock (also on `campaigns.setOption`). */

async function withMembers(frameId: "witherwild" | "beast-feast" = "witherwild") {
  const setup = await setupWithCampaign(frameId);
  const { t, campaignId } = setup;
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
  const coGmId = await t.run((ctx) => ctx.db.insert("users", { email: "cogm@example.com", emailVerificationTime: 1 }));
  await t.run(async (ctx) => {
    await ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 });
    await ctx.db.insert("campaignMembers", { campaignId, userId: coGmId, joinedAt: 0, lastOpenedAt: 0, role: "coGm" });
  });
  return {
    ...setup,
    player: t.withIdentity({ subject: `${playerId}|session` }),
    coGm: t.withIdentity({ subject: `${coGmId}|session` }),
  };
}

const stored = (setup: { t: ReturnType<typeof makeTest>; campaignId: Id<"campaigns"> }) =>
  setup.t.run(async (ctx) => (await ctx.db.get("campaigns", setup.campaignId))?.ruleModes);

describe("ruleSettings.get", () => {
  it("gives every member the resolved defaults; only the GM and co-GM may edit", async () => {
    const { gm, coGm, player, campaignId } = await withMembers();
    const defaults = resolveRuleModes("witherwild", undefined);
    for (const [who, canEdit] of [[gm, true], [coGm, true], [player, false]] as const) {
      expect(await who.query(api.ruleSettings.get, { campaignId })).toEqual({ modes: defaults, locked: false, canEdit });
    }
    expect(defaults).toMatchObject({ hopeFearFromRolls: "book", massiveDamage: false, definedRanges: true, sharedDomainCards: "warn", spotlightTrackerTokens: 3 });
  });

  it("is locked while a session is live, and an archived campaign can't be edited", async () => {
    const { t, gm, player, campaignId } = await withMembers();
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await player.query(api.ruleSettings.get, { campaignId })).toMatchObject({ locked: true, canEdit: false });
    expect(await gm.query(api.ruleSettings.get, { campaignId })).toMatchObject({ locked: true, canEdit: true });
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { archivedAt: 1 }));
    expect(await gm.query(api.ruleSettings.get, { campaignId })).toMatchObject({ locked: false, canEdit: false });
  });
});

describe("ruleSettings.set", () => {
  it("patches one field per call; GM and co-GM; every member reads the change", async () => {
    const setup = await withMembers();
    const { gm, coGm, player, campaignId } = setup;
    expect(await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "hopeFearFromRolls", value: "manual" } })).toBeNull();
    await coGm.mutation(api.ruleSettings.set, { campaignId, change: { key: "massiveDamage", value: true } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "sharedDomainCards", value: "refuse" } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "spotlightTrackerTokens", value: 5 } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "witherTokens", value: "manual" } });
    expect(await stored(setup)).toEqual({ hopeFearFromRolls: "manual", massiveDamage: true, sharedDomainCards: "refuse", spotlightTrackerTokens: 5, witherTokens: "manual" });
    const { modes } = await player.query(api.ruleSettings.get, { campaignId });
    expect(modes).toMatchObject({ hopeFearFromRolls: "manual", massiveDamage: true, sharedDomainCards: "refuse", spotlightTrackerTokens: 5, witherTokens: "manual", fearFromRests: "book" });
  });

  it("writes nothing when the value equals the resolved one", async () => {
    const setup = await withMembers();
    const { t, gm, campaignId } = setup;
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "fearFromRests", value: "book" } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "definedRanges", value: true } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "spotlightTrackerTokens", value: 3 } });
    expect(await stored(setup)).toBeNull();
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "fearFromRests", value: "extendedDowntime" } });
    const doc = await t.run((ctx) => ctx.db.get("campaigns", campaignId));
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "fearFromRests", value: "extendedDowntime" } });
    expect(await t.run((ctx) => ctx.db.get("campaigns", campaignId))).toEqual(doc);
  });

  it("refuses a value that is not a mode of the rule at the args validator", async () => {
    const { gm, campaignId } = await withMembers();
    const bad = [
      { key: "hopeFearFromRolls", value: "extendedDowntime" },
      { key: "massiveDamage", value: "book" },
      { key: "rollOutcome", value: "manual" },
      { key: "unknown", value: true },
      { key: "darkness", value: "pitch" },
      { key: "spotlightTrackerTokens", value: "3" },
    ];
    for (const change of bad) {
      await expect(gm.mutation(api.ruleSettings.set, { campaignId, change } as never)).rejects.toThrow(/alidator/);
    }
  });

  it("refuses another frame's rule and a number out of range with SETTING_INVALID", async () => {
    const setup = await withMembers();
    const { gm, campaignId } = setup;
    const refused = [
      { key: "beastFeastFeast", value: "manual" },
      { key: "horizonEncounterBonuses", value: true },
      { key: "spotlightTrackerTokens", value: 0 },
      { key: "spotlightTrackerTokens", value: 7 },
      { key: "spotlightTrackerTokens", value: 2.5 },
      { key: "darknessDifficulty", value: 5 },
    ] as const;
    for (const change of refused) {
      expect(errorCode(await gm.mutation(api.ruleSettings.set, { campaignId, change }).catch((e: unknown) => e))).toBe("SETTING_INVALID");
    }
    expect(await stored(setup)).toBeNull();
  });

  it("keeps X2 read-only while X1 is Manual (Q8 a)", async () => {
    const setup = await withMembers();
    const { gm, campaignId } = setup;
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMovePrompt", value: "manual" } });
    expect((await gm.query(api.ruleSettings.get, { campaignId })).modes.deathMoveResolve).toBe("manual");
    expect(errorCode(await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMoveResolve", value: "book" } }).catch((e: unknown) => e))).toBe(
      "SETTING_INVALID",
    );
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMovePrompt", value: "book" } });
    expect((await gm.query(api.ruleSettings.get, { campaignId })).modes.deathMoveResolve).toBe("book");
  });

  it("refuses with RULES_LOCKED while a session is live, campaigns.setOption too (Q17 a)", async () => {
    const setup = await withMembers();
    const { gm, coGm, campaignId } = setup;
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    for (const who of [gm, coGm]) {
      expect(errorCode(await who.mutation(api.ruleSettings.set, { campaignId, change: { key: "massiveDamage", value: true } }).catch((e: unknown) => e))).toBe(
        "RULES_LOCKED",
      );
      expect(errorCode(await who.mutation(api.campaigns.setOption, { campaignId, option: "witherPersists", enabled: true }).catch((e: unknown) => e))).toBe(
        "RULES_LOCKED",
      );
    }
    expect(await stored(setup)).toBeNull();
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "massiveDamage", value: true } });
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "witherPersists", enabled: true });
    expect(await stored(setup)).toEqual({ massiveDamage: true });
  });

  it("refuses a player (FORBIDDEN) and an archived campaign (CAMPAIGN_ARCHIVED)", async () => {
    const setup = await withMembers();
    const { t, gm, player, campaignId } = setup;
    const change = { key: "massiveDamage", value: true } as const;
    expect(errorCode(await player.mutation(api.ruleSettings.set, { campaignId, change }).catch((e: unknown) => e))).toBe("FORBIDDEN");
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { archivedAt: 1 }));
    expect(errorCode(await gm.mutation(api.ruleSettings.set, { campaignId, change }).catch((e: unknown) => e))).toBe("CAMPAIGN_ARCHIVED");
    expect(await stored(setup)).toBeNull();
  });

  it("sets a frame rule in its own frame", async () => {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|session` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "journey-to-horizon", name: "Horizon", idempotencyKey: key() });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "horizonSanctuaryRest", value: "manual" } });
    await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "horizonEncounterBonuses", value: true } });
    expect((await gm.query(api.ruleSettings.get, { campaignId })).modes).toMatchObject({ horizonSanctuaryRest: "manual", horizonEncounterBonuses: true });
  });
});

describe("ruleModesOf / ruleMode", () => {
  it("read the campaign's stored modes over the defaults; another frame's stored rule stays Book", async () => {
    const campaign = { frameId: "witherwild" as const, ruleModes: { darkness: "both" as const, darknessDifficulty: 3, beastFeastFeast: "manual" as const } };
    expect(ruleMode(campaign, "darkness")).toBe("both");
    expect(ruleMode(campaign, "darknessDifficulty")).toBe(3);
    expect(ruleMode(campaign, "beastFeastFeast")).toBe("book");
    expect(ruleModesOf({ frameId: "witherwild", ruleModes: undefined })).toEqual(resolveRuleModes("witherwild", undefined));
  });
});
