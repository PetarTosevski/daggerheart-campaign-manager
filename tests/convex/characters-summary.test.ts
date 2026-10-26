import { convexToJson, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// PF9 (.omc/plans/performance.yaml): the dashboard's party cards read `characters.partySummary`, a projection of
// `characters.listByCampaign` with only what a card shows. Same access and same reads; a much smaller result, so an HP
// tick re-sends a few hundred bytes per character instead of the whole sheet.
//
// Measured below (4 level-1 bards, the PF0 bench party), wire JSON bytes / documents read / database queries:
// - before, the dashboard's `listByCampaign`: 5,902 B / 6 / 3 (GM)
// - after, `partySummary`:                    1,259 B / 6 / 3 (GM)
// Full table: docs/tasks/TASK-PF-PF9.md.

const GM = "gm@example.com";
const PLAYERS = ["p1@example.com", "p2@example.com", "p3@example.com"] as const;
const STRANGER = "stranger@example.com";

/** The PF0 bench character (scripts/perf/lib.mjs): a level-1 Troubadour bard. */
const bard = (name: string) => ({
  classId: "bard",
  subclassId: "troubadour",
  ancestry: { kind: "single" as const, id: "elf" },
  communityId: "loreborne",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  name,
  pronouns: "she/her",
  description: "",
  primaryWeaponId: "rapier",
  armorId: "gambeson-armor",
  potion: "Minor Health Potion",
  classItem: "",
  background: [],
  experiences: ["Wandering minstrel", "Silver tongue"],
  domainCards: ["deft-deceiver", "book-of-ava"],
  connections: [],
});

/** The sheet fields a party card may get, and nothing else. */
const CARD_SHEET_FIELDS = new Set([
  "name",
  "level",
  "classId",
  "subclassId",
  "ancestry",
  "communityId",
  "portrait",
  "hp",
  "hpMax",
  "stress",
  "stressMax",
  "hope",
  "scars",
  "armorMarked",
  "hopeSlotBonus",
  "levelUpPending",
  "conditions",
  "wither",
  "journeyEnds",
]);

/** Bytes the Convex WebSocket sends for a result (the PF0 harness measures `JSON.stringify` of the wire value). */
const wireBytes = (value: unknown) => JSON.stringify(convexToJson(value as Value)).length;

const codeOf = (p: Promise<unknown>) => p.then(
  () => "ok",
  (e: unknown) => errorCode(e),
);

/** A Witherwild campaign: the GM, three players with a bard each, the GM's own bard, and a stranger. */
async function party() {
  const t = makeTest();
  const users = await t.run(async (ctx) => {
    const insert = (email: string) => ctx.db.insert("users", { email, emailVerificationTime: 1 });
    return { gm: await insert(GM), p1: await insert(PLAYERS[0]), p2: await insert(PLAYERS[1]), p3: await insert(PLAYERS[2]), stranger: await insert(STRANGER) };
  });
  const as = (who: keyof typeof users) => t.withIdentity({ subject: `${users[who]}|s` });
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
  const characters: Record<string, Id<"characters">> = {};
  for (const [who, name] of [
    ["p1", "Ash"],
    ["p2", "Brin"],
    ["p3", "Cael"],
  ] as const) {
    await as(who).mutation(api.members.joinByCode, { code });
    characters[who] = (await as(who).mutation(api.characters.create, { campaignId, draft: bard(name), idempotencyKey: key() })).characterId;
  }
  characters.gm = (await as("gm").mutation(api.characters.create, { campaignId, draft: bard("Dov"), idempotencyKey: key() })).characterId;
  return { t, users, as, campaignId, characters };
}

type T = ReturnType<typeof makeTest>;
type RunCtx = Parameters<Parameters<T["run"]>[0]>[0];

/** Documents read and database queries of one query call, as `who`, in a transaction of its own. */
async function reads(t: T, who: Id<"users">, run: (ctx: RunCtx) => Promise<unknown>) {
  return t.withIdentity({ subject: `${who}|s` }).run(async (ctx) => {
    const before = await ctx.meta.getTransactionMetrics();
    const result = await run(ctx);
    const after = await ctx.meta.getTransactionMetrics();
    return {
      bytes: wireBytes(result),
      documentsRead: after.documentsRead.used - before.documentsRead.used,
      databaseQueries: after.databaseQueries.used - before.databaseQueries.used,
    };
  });
}

describe("characters.partySummary", () => {
  useAllowlist([GM, ...PLAYERS, STRANGER].join(","));

  it("refuses anonymous callers and outsiders", async () => {
    const { t, as, campaignId } = await party();
    expect(await codeOf(t.query(api.characters.partySummary, { campaignId }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(as("stranger").query(api.characters.partySummary, { campaignId }))).toBe("NOT_FOUND");
  });

  it("shows every member every card, editable by its owner and the GM only", async () => {
    const { as, campaignId, characters } = await party();
    const gm = await as("gm").query(api.characters.partySummary, { campaignId });
    expect(gm.map((c) => c.sheet.name).sort()).toEqual(["Ash", "Brin", "Cael", "Dov"]);
    expect(gm.every((c) => c.canEdit)).toBe(true);

    const p1 = await as("p1").query(api.characters.partySummary, { campaignId });
    expect(p1).toHaveLength(4);
    expect(p1.filter((c) => c.canEdit).map((c) => c._id)).toEqual([characters.p1]);
  });

  it("returns only the card's fields, matching listByCampaign", async () => {
    const { as, campaignId } = await party();
    const full = await as("p2").query(api.characters.listByCampaign, { campaignId });
    const summary = await as("p2").query(api.characters.partySummary, { campaignId });
    expect(summary.map((c) => c._id)).toEqual(full.map((c) => c._id));
    for (const [i, c] of summary.entries()) {
      expect(Object.keys(c).sort()).toEqual(["_id", "canEdit", "portraitUrl", "sheet", "status"]);
      for (const field of Object.keys(c.sheet)) expect(CARD_SHEET_FIELDS.has(field), field).toBe(true);
      const f = full[i]!;
      expect(c).toMatchObject({ status: f.status, canEdit: f.canEdit, portraitUrl: f.portraitUrl });
      const { name, level, classId, subclassId, ancestry, communityId, hp, hpMax, stress, stressMax, hope, scars, armorMarked } = f.sheet;
      expect(c.sheet).toEqual({ name, level, classId, subclassId, ancestry, communityId, hp, hpMax, stress, stressMax, hope, scars, armorMarked });
    }
  });

  it("sends the badges' fields only when they show something, and follows resource changes", async () => {
    const { t, as, campaignId, characters } = await party();
    await as("p1").mutation(api.characters.adjustResource, { characterId: characters.p1!, resource: "hp", delta: 2 });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get("characters", characters.p2!))!;
      await ctx.db.patch("characters", row._id, { sheet: { ...(row.sheet as object), wither: 3, levelUpPending: true, conditions: ["unconscious"], journeyEnds: true } });
    });
    await as("gm").mutation(api.characters.setStatus, { characterId: characters.p3!, status: "away" });
    const byId = new Map((await as("p1").query(api.characters.partySummary, { campaignId })).map((c) => [c._id, c]));
    expect(byId.get(characters.p1!)!.sheet.hp).toBe(2);
    expect(byId.get(characters.p2!)!.sheet).toMatchObject({ wither: 3, levelUpPending: true, conditions: ["unconscious"], journeyEnds: true });
    expect(byId.get(characters.p3!)).toMatchObject({ status: "away", benched: true });
    expect(byId.get(characters.gm!)!.sheet).not.toHaveProperty("wither");
  });

  it("hides an uploaded portrait's storage id from everyone but the sheet's editors", async () => {
    const { t, as, campaignId, characters } = await party();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })));
    await t.run(async (ctx) => {
      const row = (await ctx.db.get("characters", characters.p1!))!;
      await ctx.db.patch("characters", row._id, { sheet: { ...(row.sheet as object), portrait: { kind: "upload", storageId } } });
    });
    const portraitOf = async (who: "p1" | "p2" | "gm") =>
      (await as(who).query(api.characters.partySummary, { campaignId })).find((c) => c._id === characters.p1)!.sheet.portrait;
    expect(await portraitOf("p1")).toEqual({ kind: "upload", storageId });
    expect(await portraitOf("gm")).toEqual({ kind: "upload", storageId });
    expect(await portraitOf("p2")).toEqual({ kind: "upload", storageId: "hidden" });
  });

  it("marks a sheet that fails to read as corrupt instead of failing the party", async () => {
    const { t, as, campaignId, characters } = await party();
    await t.run((ctx) => ctx.db.patch("characters", characters.p2!, { sheet: { name: "Brin", hp: "lots" } }));
    const summary = await as("gm").query(api.characters.partySummary, { campaignId });
    expect(summary.find((c) => c._id === characters.p2)).toMatchObject({ corrupt: true, canEdit: false, sheet: { name: "Brin" } });
    expect(summary).toHaveLength(4);
  });

  it("is a fraction of listByCampaign's bytes for the same reads (PF0: <= 1.5 KB for 4 characters)", async () => {
    const { t, users, campaignId } = await party();
    const full = await reads(t, users.gm, (c) => c.runQuery(api.characters.listByCampaign, { campaignId }));
    const summary = await reads(t, users.gm, (c) => c.runQuery(api.characters.partySummary, { campaignId }));
    console.info("PF9 listByCampaign vs partySummary (GM, 4 bards)", { full, summary });
    expect(summary.bytes).toBeLessThanOrEqual(1_536);
    expect(summary.bytes * 3).toBeLessThan(full.bytes);
    expect(summary.documentsRead).toBeLessThanOrEqual(full.documentsRead);
    expect(summary.databaseQueries).toBeLessThanOrEqual(full.databaseQueries);
  });
});
