import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_LOG_FEAR_ROWS } from "../../convex/journalLog";
import { MAX_LOG_OVERRIDES } from "../../convex/lib/validators/sessions";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal JD2 (plan .omc/plans/journal.yaml): the session log merges the feed, the Fear history, the encounters and
// the session's own lines inside the live windows; the GM hides and re-words lines without touching the feed rows;
// players read it too (user Q5) without hidden lines and GM-only rows.

const EMAILS = "gm@example.com,p1@example.com";
const NOW = new Date("2026-11-02T19:10:00Z").getTime();
const MIN = 60_000;

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

const roll = (total: number, outcome: "successHope" | "critical") => ({
  kind: "action" as const,
  dice: [
    { sides: 12, value: 9, role: "hope" as const },
    { sides: 12, value: 5, role: "fear" as const },
  ],
  modifier: 2,
  total,
  outcome,
  manual: false,
});

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Journal", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const vex = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Vex"), idempotencyKey: key() })).characterId;
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  const at = (ms: number) => vi.setSystemTime(NOW + ms);
  const start = () => gm.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: key() });
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const list = (who = gm) => who.query(api.journalLog.list, { campaignId, sessionId });
  const feed = (ms: number, fields: { summary: string; characterId?: Id<"characters">; visibility?: "public" | "gm"; undoneAt?: number; removedAt?: number; roll?: ReturnType<typeof roll> }) =>
    t.run((ctx) =>
      ctx.db.insert("actionLog", {
        campaignId,
        actorId: ids.gm,
        kind: fields.roll === undefined ? "feature" : "roll",
        visibility: "public",
        undoable: false,
        at: NOW + ms,
        ...fields,
      }),
    );
  const fear = (ms: number, action: string, before: number, after: number) =>
    t.run((ctx) => ctx.db.insert("history", { campaignId, kind: "fear", action, by: ids.gm, before, after, at: NOW + ms }));
  const encounter = (name: string, startedAt?: number, endedAt?: number) =>
    t.run((ctx) =>
      ctx.db.insert("encounters", {
        campaignId,
        name,
        status: endedAt === undefined ? "running" : "ended",
        pcs: 2,
        adjustments: [],
        gmTurn: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...(startedAt !== undefined ? { startedAt: NOW + startedAt } : {}),
        ...(endedAt !== undefined ? { endedAt: NOW + endedAt } : {}),
      }),
    );
  const addLog = (text: string) => gm.mutation(api.sessionPlay.addLog, { campaignId, sessionId, text, idempotencyKey: key() });
  return { t, ids, gm, p1, campaignId, sessionId, vex, at, start, end, list, feed, fear, encounter, addLog };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/**
 * A session played from NOW to NOW+30 and started again at NOW+60 (still live at NOW+70), with rows inside and outside
 * its windows.
 */
async function played() {
  const env = await setup();
  const before = await env.feed(-10 * MIN, { summary: "Before the session" });
  env.at(0);
  await env.start();
  const vexRoll = await env.feed(1 * MIN, { summary: "Vex: Presence roll 16, success with Hope", characterId: env.vex, roll: roll(16, "successHope") });
  const gmRoll = await env.feed(2 * MIN, { summary: "GM: hidden roll", visibility: "gm", roll: roll(20, "critical") });
  const undone = await env.feed(3 * MIN, { summary: "Undone", undoneAt: NOW + 4 * MIN });
  const removed = await env.feed(4 * MIN, { summary: "Removed from the feed", removedAt: NOW + 5 * MIN });
  const spent = await env.fear(5 * MIN, "spend", 4, 3);
  await env.fear(5.5 * MIN, "adjust", 3, 3);
  const encounterId = await env.encounter("Ambush at the Forest Camp", 6 * MIN, 20 * MIN);
  env.at(7 * MIN);
  const { logId } = await env.addLog("The bridge is out.");
  env.at(30 * MIN);
  await env.end();
  const gap = await env.feed(40 * MIN, { summary: "Between sessions" });
  await env.fear(45 * MIN, "set", 3, 6);
  env.at(60 * MIN);
  await env.start();
  const later = await env.feed(65 * MIN, { summary: "Brannoc: Mark a Stress" });
  const set = await env.fear(66 * MIN, "set", 6, 8);
  env.at(70 * MIN);
  return { ...env, before, vexRoll, gmRoll, undone, removed, spent, encounterId, logId, gap, later, set };
}

describe("journalLog", () => {
  useAllowlist(EMAILS);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("list merges the feed, Fear, encounters and the session's lines of every live window, oldest first", async () => {
    const env = await played();
    const { lines, truncated } = await env.list();
    expect(truncated).toBe(false);
    expect(lines.map((l) => [l.source, l.title, l.sub, l.icon, l.removable, l.at - NOW])).toEqual([
      ["auto", "Session started.", undefined, "start", false, 0],
      ["feed", "Session started", undefined, "session", false, 0],
      ["feed", "Vex: Presence roll 16, success with Hope", "Vex rolled 16 with Hope", "roll", false, 1 * MIN],
      ["feed", "GM: hidden roll", "The GM rolled 20 · critical success", "roll", false, 2 * MIN],
      ["feed", "Removed from the feed", undefined, "feature", false, 4 * MIN],
      ["fear", "The GM spent 1 Fear", "Fear 4 → 3", "fear", false, 5 * MIN],
      ["encounter", "Combat began: Ambush at the Forest Camp", undefined, "combatBegan", false, 6 * MIN],
      ["gm", "The bridge is out.", undefined, "note", true, 7 * MIN],
      ["encounter", "Combat ended: Ambush at the Forest Camp", undefined, "combatEnded", false, 20 * MIN],
      ["auto", expect.stringMatching(/^Session ended/), undefined, "end", false, 30 * MIN],
      ["feed", "Session ended", undefined, "session", false, 30 * MIN],
      ["auto", "Session started.", undefined, "start", false, 60 * MIN],
      ["feed", "Session started", undefined, "session", false, 60 * MIN],
      ["feed", "Brannoc: Mark a Stress", undefined, "feature", false, 65 * MIN],
      ["fear", "Fear 6 → 8", undefined, "fear", false, 66 * MIN],
    ]);
    expect(lines.every((l) => !l.hidden && !l.edited && l.key === `${l.source}:${l.sourceId}`)).toBe(true);
    expect(lines.find((l) => l.source === "encounter")!.sourceId).toBe(`${env.encounterId}:began`);
  });

  it("hide / unhide / setText write overrides only; the feed row is never patched or deleted", async () => {
    const env = await played();
    const { campaignId, sessionId, gm } = env;
    const original = await env.t.run((ctx) => ctx.db.get("actionLog", env.vexRoll));

    await gm.mutation(api.journalLog.hide, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll });
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll, text: "  Vex charms the guard  " });
    let line = (await env.list()).lines.find((l) => l.sourceId === env.vexRoll)!;
    expect([line.hidden, line.edited, line.title]).toEqual([true, true, "Vex charms the guard"]);
    expect(await env.t.run((ctx) => ctx.db.get("actionLog", env.vexRoll))).toEqual(original);

    await gm.mutation(api.journalLog.unhide, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll });
    line = (await env.list()).lines.find((l) => l.sourceId === env.vexRoll)!;
    expect([line.hidden, line.edited, line.title]).toEqual([false, true, "Vex charms the guard"]);

    // An empty text gives the generated title back; an override neither hidden nor re-worded is deleted.
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll, text: " " });
    line = (await env.list()).lines.find((l) => l.sourceId === env.vexRoll)!;
    expect([line.hidden, line.edited, line.title]).toEqual([false, false, "Vex: Presence roll 16, success with Hope"]);
    expect(await env.t.run((ctx) => ctx.db.query("sessionLogOverrides").collect())).toEqual([]);
    expect(await env.t.run((ctx) => ctx.db.get("actionLog", env.vexRoll))).toEqual(original);

    // Fear, encounter and automatic lines are hidden the same way.
    const autoId = (await env.list()).lines.find((l) => l.source === "auto")!.sourceId;
    for (const [source, sourceId] of [
      ["fear", env.spent],
      ["encounter", `${env.encounterId}:ended`],
      ["auto", autoId],
    ] as const) {
      await gm.mutation(api.journalLog.hide, { campaignId, sessionId, source, sourceId });
    }
    expect((await env.list()).lines.filter((l) => l.hidden).map((l) => l.source)).toEqual(["auto", "fear", "encounter"]);
    expect(await env.t.run((ctx) => ctx.db.get("history", env.spent))).not.toBeNull();
  });

  it("setText on a GM line edits the sessionLog row in place (editedAt); addLog / removeLog stay sessionPlay's", async () => {
    const env = await played();
    const { campaignId, sessionId, gm } = env;
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "gm", sourceId: env.logId, text: "The bridge was out." });
    const row = await env.t.run((ctx) => ctx.db.get("sessionLog", env.logId));
    expect([row!.text, row!.editedAt]).toEqual(["The bridge was out.", NOW + 70 * MIN]);
    const line = (await env.list()).lines.find((l) => l.source === "gm")!;
    expect([line.title, line.edited, line.removable]).toEqual(["The bridge was out.", true, true]);
    expect(await codeOf(gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "gm", sourceId: env.logId, text: "  " }))).toBe("INVALID");

    await gm.mutation(api.sessionPlay.removeLog, { campaignId, sessionId, logId: env.logId });
    expect((await env.list()).lines.some((l) => l.source === "gm")).toBe(false);
  });

  it("a source outside the session's windows is SESSION_LOG_SOURCE_NOT_FOUND", async () => {
    const env = await played();
    const { campaignId, sessionId, gm } = env;
    const other = (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
    const autoId = (await env.list()).lines.find((l) => l.source === "auto")!.sourceId;
    const notFound = [
      ["feed", env.before],
      ["feed", env.gap],
      ["feed", env.undone],
      ["feed", "not-an-id"],
      ["fear", env.vexRoll],
      ["encounter", env.encounterId],
      ["encounter", `${env.encounterId}:later`],
      ["auto", env.logId],
    ] as const;
    for (const [source, sourceId] of notFound) {
      expect(await codeOf(gm.mutation(api.journalLog.hide, { campaignId, sessionId, source, sourceId })), `${source} ${sourceId}`).toBe("SESSION_LOG_SOURCE_NOT_FOUND");
    }
    // Another session's lines are not this session's.
    expect(await codeOf(gm.mutation(api.journalLog.hide, { campaignId, sessionId: other, source: "auto", sourceId: autoId }))).toBe("SESSION_LOG_SOURCE_NOT_FOUND");
    expect(await codeOf(gm.mutation(api.journalLog.setText, { campaignId, sessionId: other, source: "gm", sourceId: env.logId, text: "x" }))).toBe(
      "SESSION_LOG_SOURCE_NOT_FOUND",
    );
    expect(await codeOf(gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "gm", sourceId: autoId, text: "x" }))).toBe("SESSION_LOG_SOURCE_NOT_FOUND");
    expect(await codeOf(gm.mutation(api.journalLog.hide, { campaignId, sessionId: "nope", source: "feed", sourceId: env.vexRoll }))).toBe("SESSION_NOT_FOUND");
  });

  it("past MAX_LOG_OVERRIDES a new override is SESSION_LOG_OVERRIDE_LIMIT; an existing one still changes", async () => {
    const env = await played();
    const { campaignId, sessionId, gm } = env;
    await gm.mutation(api.journalLog.hide, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll });
    await env.t.run(async (ctx) => {
      for (let i = 1; i < MAX_LOG_OVERRIDES; i++) {
        await ctx.db.insert("sessionLogOverrides", { campaignId, sessionId, source: "feed", sourceId: `filler-${i}`, hidden: true, updatedAt: NOW });
      }
    });
    expect(await codeOf(gm.mutation(api.journalLog.hide, { campaignId, sessionId, source: "fear", sourceId: env.spent }))).toBe("SESSION_LOG_OVERRIDE_LIMIT");
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll, text: "Still editable" });
    // Showing a line again frees its slot.
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll, text: "" });
    await gm.mutation(api.journalLog.unhide, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll });
    await gm.mutation(api.journalLog.hide, { campaignId, sessionId, source: "fear", sourceId: env.spent });
  });

  it("players read the log without hidden lines and GM-only rows; a planned session is SESSION_NOT_FOUND; writes are the GM's", async () => {
    const env = await played();
    const { campaignId, sessionId, gm, p1 } = env;
    await gm.mutation(api.journalLog.hide, { campaignId, sessionId, source: "feed", sourceId: env.removed });
    const lines = (await env.list(p1)).lines;
    expect(lines.map((l) => l.title)).not.toContain("GM: hidden roll");
    expect(lines.map((l) => l.title)).not.toContain("Removed from the feed");
    expect(lines.map((l) => l.title)).toContain("The bridge is out.");
    expect(lines.every((l) => !l.hidden && !l.removable)).toBe(true);
    expect((await env.list()).lines.find((l) => l.sourceId === env.removed)!.hidden).toBe(true);

    const planned = (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
    expect(await codeOf(p1.query(api.journalLog.list, { campaignId, sessionId: planned }))).toBe("SESSION_NOT_FOUND");
    expect((await gm.query(api.journalLog.list, { campaignId, sessionId: planned })).lines).toEqual([]);
    expect(await codeOf(p1.mutation(api.journalLog.hide, { campaignId, sessionId, source: "feed", sourceId: env.vexRoll }))).toBe("FORBIDDEN");
  });

  it("each source is read with a bounded take; a cut source marks the result truncated", async () => {
    const env = await setup();
    await env.start();
    await env.t.run(async (ctx) => {
      for (let i = 0; i <= MAX_LOG_FEAR_ROWS; i++) {
        await ctx.db.insert("history", { campaignId: env.campaignId, kind: "fear", action: "gain", by: env.ids.gm, before: 0, after: 1, at: NOW + i });
      }
    });
    vi.setSystemTime(NOW + MIN);
    const { lines, truncated } = await env.list();
    expect(truncated).toBe(true);
    expect(lines.filter((l) => l.source === "fear")).toHaveLength(MAX_LOG_FEAR_ROWS);
  });
});
