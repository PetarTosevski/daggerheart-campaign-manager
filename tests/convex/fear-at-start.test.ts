/**
 * Config R3: GM Fear at the start of a session (table setting `fearAtStart`, Q1 a, CB p.154). "carry" leaves Fear as
 * it is; "pcs" sets it to the active PCs (not away, retired or dead: dcm-owkv), capped at 12, in the Start's undoable group.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { campaignFearState } from "../../convex/lib/fear";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com";

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

type Status = Doc<"characters">["status"];

/** A campaign with a GM and a player; `statuses` gives one PC per entry (the first made through the API, the rest copies of it). */
async function setup(statuses: Status[]) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const first = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...row } = (await ctx.db.get("characters", first))!;
    void _id;
    void _creationTime;
    await ctx.db.patch("characters", first, { status: statuses[0] });
    for (const status of statuses.slice(1)) await ctx.db.insert("characters", { ...row, status });
  });
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (value: number) => gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() });
  const setMode = (value: "carry" | "pcs") => gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "fearAtStart", value } });
  const start = (sessionId?: Id<"sessions">) =>
    gm.mutation(api.sessions.start, { campaignId, ...(sessionId === undefined ? {} : { sessionId }), idempotencyKey: key() });
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const startRow = () =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
          .order("desc")
          .take(50)
      ).find((r) => r.summary.startsWith("Session started"))!,
    );
  const startLines = (sessionId: Id<"sessions">) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("sessionLog")
          .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId))
          .take(50)
      )
        .filter((r) => r.event === "start")
        .map((r) => r.text),
    );
  const fearHistory = () =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("history")
          .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
          .take(50)
      ).flatMap((r) => (r.kind === "fear" ? [{ action: r.action, before: r.before, after: r.after }] : [])),
    );
  return { t, gm, campaignId, fear, setFear, setMode, start, end, startRow, startLines, fearHistory };
}

describe("Fear at the start of a session (config R3)", () => {
  useAllowlist(EMAILS);

  it("carry (the default) leaves GM Fear as it is", async () => {
    const env = await setup(["active", "active", "active", "active"]);
    await env.setFear(7);
    const started = await env.start();
    expect(await env.fear()).toBe(7);
    expect(started.fearReset).toBeUndefined();
    expect((await env.startRow()).summary).toBe("Session started");
    expect((await env.startRow()).fearDelta).toBeUndefined();
    expect((await env.startLines(started.sessionId!))[0]).not.toContain("Fear reset");
  });

  it("reset with 4 PCs sets Fear to 4, logged as a Fear change and on the start line", async () => {
    const env = await setup(["active", "active", "active", "active"]);
    await env.setMode("pcs");
    await env.setFear(9);
    const started = await env.start();
    expect(await env.fear()).toBe(4);
    expect(started.fearReset).toBe(4);
    expect(await env.fearHistory()).toContainEqual({ action: "reset", before: 9, after: 4 });
    const row = await env.startRow();
    expect(row.summary).toBe("Session started; Fear reset to 4");
    expect(row.fearDelta).toBe(-5);
    expect((await env.startLines(started.sessionId!))[0]).toContain("Fear reset to 4");
  });

  it("counts only active PCs: not away, retired or dead ones (dcm-owkv)", async () => {
    const env = await setup(["active", "active", "away", "away", "retired", "dead", "dead"]);
    await env.setMode("pcs");
    await env.setFear(0);
    await env.start();
    expect(await env.fear()).toBe(2);
  });

  it("caps the reset at 12", async () => {
    const env = await setup(Array.from({ length: 14 }, () => "active" as const));
    await env.setMode("pcs");
    await env.setFear(3);
    const started = await env.start();
    expect(await env.fear()).toBe(12);
    expect(started.fearReset).toBe(12);
  });

  it("Fear already at the count writes no Fear change but still says the reset", async () => {
    const env = await setup(["active", "active"]);
    await env.setMode("pcs");
    await env.setFear(2);
    const before = (await env.fearHistory()).length;
    const started = await env.start();
    expect(await env.fear()).toBe(2);
    expect((await env.fearHistory()).length).toBe(before);
    expect((await env.startRow()).fearDelta).toBeUndefined();
    expect((await env.startLines(started.sessionId!))[0]).toContain("Fear reset to 2");
  });

  it("undoing the Start restores the previous Fear", async () => {
    const env = await setup(["active", "active", "active"]);
    await env.setMode("pcs");
    await env.setFear(8);
    await env.start();
    expect(await env.fear()).toBe(3);
    const result = await env.gm.mutation(api.actionLog.undo, { entryId: (await env.startRow())._id, idempotencyKey: key() });
    expect(result.fearReverted).toBe(-5);
    expect(await env.fear()).toBe(8);
  });

  it("a restarted (played) session resets Fear again", async () => {
    const env = await setup(["active", "active", "active"]);
    await env.setMode("pcs");
    await env.setFear(10);
    const first = await env.start();
    expect(await env.fear()).toBe(3);
    await env.setFear(6);
    await env.end();
    expect(await env.fear()).toBe(6);
    const again = await env.start(first.sessionId);
    expect(again.alreadyStarted).toBe(false);
    expect(await env.fear()).toBe(3);
    expect(await env.startLines(first.sessionId!)).toHaveLength(2);
  });

  it("pressing Start for the live session changes nothing", async () => {
    const env = await setup(["active", "active", "active"]);
    await env.setMode("pcs");
    await env.setFear(10);
    const first = await env.start();
    await env.setFear(7);
    const again = await env.start(first.sessionId);
    expect(again.alreadyStarted).toBe(true);
    expect(await env.fear()).toBe(7);
  });
});
