import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal JD5: the recap every member writes (Q4), 'After the session' (sessionWrap.after) and 'Campaign so far'
// (sessionRecords.summary: sessions played, hours at the table from live time (Q3), party level).

const EMAILS = "gm@example.com,p1@example.com,out@example.com,grant@example.com";
const HOUR = 3_600_000;

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
    grant: await ctx.db.insert("users", { email: "grant@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out, grant] = [as(ids.gm), as(ids.p1), as(ids.out), as(ids.grant)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Journal", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  // A grant-only caller: an edit grant on the campaign, but not a member.
  await t.run((ctx) =>
    ctx.db.insert("grants", {
      resourceType: "campaign",
      resourceId: campaignId,
      principalKind: "user",
      principalId: ids.grant,
      permission: "edit",
      createdBy: ids.gm,
      createdAt: Date.now(),
    }),
  );
  const create = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const character = async (name: string) => (await gm.mutation(api.characters.create, { campaignId, draft: draft(name), idempotencyKey: key() })).characterId;
  return { t, gm, p1, out, grant, ids, campaignId, create, character };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

describe("Journal JD5: recap, after the session, campaign so far", () => {
  useAllowlist(EMAILS);

  describe("setRecap (Q4: everyone writes, always visible)", () => {
    it("a player writes a live session's recap; the GM and the dashboard read it", async () => {
      const env = await setup();
      const sessionId = await env.create();
      await env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, sessionId, idempotencyKey: key() });
      await env.p1.mutation(api.sessionWrap.setRecap, { campaignId: env.campaignId, sessionId, recap: "We found the Warden." });
      expect((await env.gm.query(api.sessionWrap.get, { campaignId: env.campaignId, sessionId }))?.recap).toBe("We found the Warden.");
      await env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });
      const dashboard = await env.p1.query(api.sessionWrap.dashboard, { campaignId: env.campaignId });
      expect(dashboard.lastPlayed?.recap).toBe("We found the Warden.");
      // The player clears it: an empty text clears for everyone.
      await env.p1.mutation(api.sessionWrap.setRecap, { campaignId: env.campaignId, sessionId, recap: "  " });
      expect((await env.gm.query(api.sessionWrap.get, { campaignId: env.campaignId, sessionId }))?.recap).toBeUndefined();
    });

    it("refuses a player on a planned session (SESSION_NOT_FOUND), a grant-only caller (FORBIDDEN) and an outsider (NOT_FOUND)", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = { campaignId: env.campaignId, sessionId, recap: "x" };
      expect(await failure(env.p1.mutation(api.sessionWrap.setRecap, args))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.grant.mutation(api.sessionWrap.setRecap, args))).toBe("FORBIDDEN");
      expect(await failure(env.out.mutation(api.sessionWrap.setRecap, args))).toBe("NOT_FOUND");
      await env.gm.mutation(api.sessionRecords.setPlayed, { campaignId: env.campaignId, sessionId, played: true });
      expect(await failure(env.grant.mutation(api.sessionWrap.setRecap, args))).toBe("FORBIDDEN");
      expect(await failure(env.p1.mutation(api.sessionWrap.setRecap, { ...args, recap: "x".repeat(6001) }))).toBe("INVALID");
      expect(await env.p1.mutation(api.sessionWrap.setRecap, args)).toBeNull();
    });
  });

  describe("sessionRecords.summary", () => {
    it("counts played sessions, hours from playedMs and legacy start → end, the live window, and the party level", async () => {
      const env = await setup();
      const summary = (as = env.gm) => as.query(api.sessionRecords.summary, { campaignId: env.campaignId });
      const empty = await summary();
      expect(empty).toMatchObject({ sessionsPlayed: 0, hoursAtTable: 0, live: false });
      const startingLevel = empty.partyLevel;
      expect(startingLevel).toBeGreaterThanOrEqual(1);

      const legacy = await env.create();
      const tracked = await env.create();
      const next = await env.create();
      await env.t.run(async (ctx) => {
        await ctx.db.patch("sessions", legacy, { status: "played", startedAt: 1_000, endedAt: 1_000 + 2 * HOUR });
        await ctx.db.patch("sessions", tracked, { status: "played", startedAt: 1_000, endedAt: 1_000 + 5 * HOUR, playedMs: HOUR });
      });
      expect(await summary()).toMatchObject({ sessionsPlayed: 2, hoursAtTable: 3, live: false, partyLevel: startingLevel });

      await env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, sessionId: next, idempotencyKey: key() });
      const live = await summary(env.p1);
      expect(live).toMatchObject({ sessionsPlayed: 2, live: true });
      expect(live.hoursAtTable).toBeGreaterThanOrEqual(3);
      expect(live.asOf).toBeGreaterThan(0);

      const vex = await env.character("Vex");
      const oriel = await env.character("Oriel");
      await env.t.run(async (ctx) => {
        await saveSheet(ctx, vex, { ...readSheet((await ctx.db.get("characters", vex))!.sheet), level: 4 });
        await saveSheet(ctx, oriel, { ...readSheet((await ctx.db.get("characters", oriel))!.sheet), level: 7 });
        await ctx.db.patch("characters", oriel, { status: "retired" });
      });
      expect((await summary()).partyLevel).toBe(4);
    });

    it("anonymous UNAUTHENTICATED, outsider NOT_FOUND, player and GM read", async () => {
      const env = await setup();
      const args = { campaignId: env.campaignId };
      expect(await failure(env.t.query(api.sessionRecords.summary, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.query(api.sessionRecords.summary, args))).toBe("NOT_FOUND");
      expect((await env.p1.query(api.sessionRecords.summary, args)).sessionsPlayed).toBe(0);
    });
  });

  describe("sessionWrap.after", () => {
    it("lists each character's latest level-up in the live windows (not undone, not outside), the milestone and the loot", async () => {
      const env = await setup();
      const vex = await env.character("Vex");
      const brannoc = await env.character("Brannoc");
      const moss = await env.character("Moss");
      const sessionId = await env.create();
      await env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, sessionId, idempotencyKey: key() });
      await env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });
      await env.gm.mutation(api.sessionWrap.setLoot, { campaignId: env.campaignId, sessionId, loot: "A silver key." });
      const session = (await env.t.run((ctx) => ctx.db.get("sessions", sessionId)))!;
      const from = session.startedAt!;
      const to = session.endedAt!;
      const row = (characterId: Id<"characters">, summary: string, at: number, extra: { undoneAt?: number } = {}) =>
        env.t.run((ctx) =>
          ctx.db.insert("actionLog", { campaignId: env.campaignId, characterId, actorId: env.ids.gm, kind: "levelUp", visibility: "public", summary, undoable: false, at, ...extra }),
        );
      await row(vex, "Vex can level up to 2.", from);
      await row(vex, "Vex reached level 2.", to);
      await row(brannoc, "Brannoc reached level 2.", from, { undoneAt: to });
      await row(moss, "Moss reached level 2.", to + 60_000);
      await row(moss, "Moss reached level 1.", from - 60_000);
      await env.t.run((ctx) =>
        ctx.db.insert("actionLog", { campaignId: env.campaignId, characterId: moss, actorId: env.ids.gm, kind: "rest", visibility: "public", summary: "Short rest", undoable: false, at: from }),
      );

      const after = await env.gm.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId });
      expect(after).toEqual({
        sessionId,
        levelUps: [{ characterId: vex, summary: "Vex reached level 2.", at: to }],
        milestoneAt: null,
        loot: "A silver key.",
        truncated: false,
      });

      const { milestoneAt } = await env.gm.mutation(api.sessionWrap.callMilestone, { campaignId: env.campaignId, sessionId, idempotencyKey: key() });
      expect((await env.gm.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId }))?.milestoneAt).toBe(milestoneAt);
    });

    it("a planned session has no level-ups; a stale id is null; players are refused", async () => {
      const env = await setup();
      const sessionId = await env.create();
      expect(await env.gm.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId })).toEqual({
        sessionId,
        levelUps: [],
        milestoneAt: null,
        loot: null,
        truncated: false,
      });
      expect(await env.gm.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId: "nope" })).toBeNull();
      expect(await failure(env.p1.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId }))).toBe("FORBIDDEN");
      expect(await failure(env.grant.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId }))).toBe("FORBIDDEN");
    });
  });
});
