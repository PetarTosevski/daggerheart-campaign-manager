import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { COUNTDOWN_VISIBILITY_PRESETS, type CountdownVisibility } from "../../src/lib/domain/countdowns";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/**
 * countdowns-advanced K3: chase countdowns (CB p.163, D9). countdowns.createChase starts a linked pair (the pursuers at N,
 * the escapee N - lead; the PCs' row progress, the rivals' consequence); setVisibility, setArmed and operate's pause /
 * resume / cancel act on both rows; real manual action rolls move the pair by R4 until one side reaches 0; undo and
 * Borrowed Time reopen it.
 */

const EMAILS = "gm@example.com,p1@example.com,out@example.com";
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;

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
    primaryWeaponId: PRIMARY.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** Manual Duality dice [Hope, Fear] and a Difficulty for each outcome (agility +2). */
const OUTCOMES = {
  critical: { values: [5, 5] },
  successHope: { values: [8, 3], difficulty: 10 },
  successFear: { values: [3, 8], difficulty: 10 },
  failHope: { values: [8, 3], difficulty: 30 },
  failFear: { values: [3, 8], difficulty: 30 },
} as const;
type Outcome = keyof typeof OUTCOMES;

type ChaseArgs = { startingValue?: number; lead?: "small" | "decent" | "substantial" | number; party?: "pursuing" | "escaping"; armed?: boolean; visibility?: CountdownVisibility; name?: string };

/** A campaign with a GM, a player who owns a character, and an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;

  type Caller = typeof gm;
  const chaseArgs = (extra: ChaseArgs = {}) => ({
    campaignId,
    name: extra.name ?? "The thief",
    description: "Through the market",
    startingValue: extra.startingValue ?? 6,
    lead: extra.lead ?? "decent",
    party: extra.party ?? "pursuing",
    ...(extra.armed !== undefined ? { armed: extra.armed } : {}),
    ...(extra.visibility !== undefined ? { visibility: extra.visibility } : {}),
  });
  const createChase = (extra: ChaseArgs = {}, who: Caller | typeof t = gm) =>
    who.mutation(api.countdowns.createChase, { ...chaseArgs(extra), idempotencyKey: key() });
  const row = (id: Id<"countdowns">) => t.run(async (ctx) => (await ctx.db.get("countdowns", id))!);
  const values = async (p: Id<"countdowns">, r: Id<"countdowns">) => [(await row(p)).currentValue, (await row(r)).currentValue];
  const op = (countdownId: Id<"countdowns">, action: "advance" | "reverse" | "pause" | "resume" | "cancel", who: Caller | typeof t = gm) =>
    who.mutation(api.countdowns.operate, { countdownId, action, idempotencyKey: key() });
  const setVisibility = (countdownId: Id<"countdowns">, visibility: CountdownVisibility, who: Caller | typeof t = gm) =>
    who.mutation(api.countdowns.setVisibility, { campaignId, countdownId, visibility, idempotencyKey: key() });
  const arm = (countdownId: Id<"countdowns">, armed: boolean) =>
    gm.mutation(api.countdowns.setArmed, { campaignId, countdownId, armed, idempotencyKey: key() });
  const roll = async (outcome: Outcome) => {
    const { values: dice, ...rest } = OUTCOMES[outcome] as { values: readonly number[]; difficulty?: number };
    return (await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [...dice], roll: { ...agility, ...rest }, idempotencyKey: key() })) as {
      entryId: Id<"actionLog">;
    };
  };
  const undo = (entryId: Id<"actionLog">) => p1.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const history = (id: Id<"countdowns">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("history").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect()).filter(
        (h) => h.kind === "countdown" && h.countdownId === id,
      ),
    );
  const list = (who: Caller) => who.query(api.countdowns.listByCampaign, { campaignId });
  return { t, gm, p1, out, campaignId, createChase, row, values, op, setVisibility, arm, roll, undo, history, list };
}

describe("chase countdowns (countdowns-advanced K3)", () => {
  useAllowlist(EMAILS);

  describe("createChase", () => {
    it("anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
      const { t, p1, out, createChase } = await setup();
      expect(await codeOf(createChase({}, t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(createChase({}, out))).toBe("NOT_FOUND");
      expect(await codeOf(createChase({}, p1))).toBe("FORBIDDEN");
      expect(await codeOf(createChase())).toBe("ok");
    });

    it("the PCs pursuing: the party at N (progress), the escapee at N - lead (consequence), linked, two history rows", async () => {
      const { createChase, row, history, list, gm } = await setup();
      const { partyId, rivalsId } = await createChase({ startingValue: 6, lead: "decent", party: "pursuing", armed: true });
      const party = await row(partyId);
      const rivals = await row(rivalsId);
      expect(party).toMatchObject({
        name: "The party",
        mode: "progress",
        startingValue: 6,
        currentValue: 6,
        status: "active",
        armed: true,
        consequence: "The party catches The thief",
        chase: { partnerId: rivalsId, side: "party", party: "pursuing" },
      });
      expect(rivals).toMatchObject({
        name: "The thief",
        mode: "consequence",
        startingValue: 6,
        currentValue: 3,
        armed: true,
        consequence: "The thief gets away",
        chase: { partnerId: partyId, side: "rivals", party: "pursuing" },
      });
      expect(party.repeat).toBeUndefined();
      expect((await history(partyId)).map((h) => h.action)).toEqual(["create"]);
      expect((await history(rivalsId)).map((h) => h.action)).toEqual(["create"]);
      expect((await list(gm)).map((c) => c.chase?.side)).toEqual(["party", "rivals"]);
    });

    it("the PCs escaping: the rivals pursue from N, the party escapes from N - lead; leads small 1 and substantial 5; a typed lead", async () => {
      const { createChase, values } = await setup();
      const escaping = await createChase({ startingValue: 8, lead: "small", party: "escaping" });
      expect(await values(escaping.partyId, escaping.rivalsId)).toEqual([7, 8]);
      const big = await createChase({ startingValue: 10, lead: "substantial" });
      expect(await values(big.partyId, big.rivalsId)).toEqual([10, 5]);
      const typed = await createChase({ startingValue: 12, lead: 7, party: "escaping" });
      expect(await values(typed.partyId, typed.rivalsId)).toEqual([5, 12]);
    });

    it("absent armed is unarmed (D4); the visibility is stored on both rows", async () => {
      const { createChase, row } = await setup();
      const { partyId, rivalsId } = await createChase({ visibility: COUNTDOWN_VISIBILITY_PRESETS.private });
      expect([(await row(partyId)).armed, (await row(rivalsId)).armed]).toEqual([false, false]);
      expect((await row(partyId)).visibility).toEqual({ mode: "private" });
      expect((await row(rivalsId)).visibility).toEqual({ mode: "private" });
    });

    it("INVALID for a lead not below the start, a start outside 2..20, a lead below 1 or an empty name; nothing is written", async () => {
      const { t, createChase, campaignId } = await setup();
      expect(await codeOf(createChase({ startingValue: 4, lead: "substantial" }))).toBe("INVALID");
      expect(await codeOf(createChase({ startingValue: 6, lead: 6 }))).toBe("INVALID");
      expect(await codeOf(createChase({ startingValue: 6, lead: 0 }))).toBe("INVALID");
      expect(await codeOf(createChase({ startingValue: 6, lead: 1.5 }))).toBe("INVALID");
      expect(await codeOf(createChase({ startingValue: 1, lead: "small" }))).toBe("INVALID");
      expect(await codeOf(createChase({ startingValue: 21, lead: "small" }))).toBe("INVALID");
      expect(await codeOf(createChase({ name: "  " }))).toBe("INVALID");
      const rows = await t.run((ctx) => ctx.db.query("countdowns").withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaignId)).collect());
      expect(rows).toEqual([]);
    });
  });

  describe("pair-wide operations", () => {
    it("setVisibility: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN; the GM's change moves both rows", async () => {
      const { t, p1, out, createChase, setVisibility, row, list } = await setup();
      const { partyId, rivalsId } = await createChase();
      const hidden = COUNTDOWN_VISIBILITY_PRESETS.partly;
      expect(await codeOf(setVisibility(rivalsId, hidden, t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(setVisibility(rivalsId, hidden, out))).toBe("NOT_FOUND");
      expect(await codeOf(setVisibility(rivalsId, hidden, p1))).toBe("FORBIDDEN");
      await setVisibility(rivalsId, hidden);
      expect((await row(partyId)).visibility).toEqual(hidden);
      expect((await row(rivalsId)).visibility).toEqual(hidden);
      expect((await list(p1)).map((c) => c.name)).toEqual([null, null]);
      await setVisibility(partyId, COUNTDOWN_VISIBILITY_PRESETS.private);
      expect(await list(p1)).toEqual([]);
    });

    it("setArmed on either row arms and disarms the pair (D9)", async () => {
      const { createChase, arm, row } = await setup();
      const { partyId, rivalsId } = await createChase();
      await arm(rivalsId, true);
      expect([(await row(partyId)).armed, (await row(rivalsId)).armed]).toEqual([true, true]);
      await arm(partyId, false);
      expect([(await row(partyId)).armed, (await row(rivalsId)).armed]).toEqual([false, false]);
    });

    it("operate pause / resume / cancel: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN; the GM's acts on both rows", async () => {
      const { t, p1, out, createChase, op, row, history, list, gm } = await setup();
      const { partyId, rivalsId } = await createChase();
      for (const who of [t, out, p1] as const) {
        for (const action of ["pause", "cancel"] as const) {
          const code = await codeOf(op(partyId, action, who));
          expect(code).toBe(who === t ? "UNAUTHENTICATED" : who === out ? "NOT_FOUND" : "FORBIDDEN");
        }
      }
      await op(partyId, "pause");
      expect([(await row(partyId)).status, (await row(rivalsId)).status]).toEqual(["paused", "paused"]);
      await op(rivalsId, "resume");
      expect([(await row(partyId)).status, (await row(rivalsId)).status]).toEqual(["active", "active"]);
      await op(rivalsId, "cancel");
      expect([(await row(partyId)).status, (await row(rivalsId)).status]).toEqual(["cancelled", "cancelled"]);
      expect((await history(partyId)).map((h) => h.action)).toEqual(["create", "pause", "resume", "cancel"]);
      expect((await history(rivalsId)).map((h) => h.action)).toEqual(["create", "pause", "resume", "cancel"]);
      expect(await list(gm)).toEqual([]);
      expect(await codeOf(op(partyId, "cancel"))).toBe("COUNTDOWN_RULE");
    });

    it("manual ticks move one side only; an ended chase is cancelled as a pair, the completed side included", async () => {
      const { createChase, op, row, values } = await setup();
      const { partyId, rivalsId } = await createChase({ startingValue: 4, lead: "small" });
      await op(rivalsId, "advance");
      expect(await values(partyId, rivalsId)).toEqual([4, 2]);
      await op(rivalsId, "advance");
      await op(rivalsId, "advance");
      expect((await row(rivalsId)).status).toBe("completed");
      // The ended chase can't be paused as a pair: only the open side pauses.
      await op(partyId, "pause");
      expect([(await row(partyId)).status, (await row(rivalsId)).status]).toEqual(["paused", "completed"]);
      await op(partyId, "resume");
      await op(rivalsId, "cancel");
      expect([(await row(partyId)).status, (await row(rivalsId)).status]).toEqual(["cancelled", "cancelled"]);
    });
  });

  describe("rolls move the pair (R4, R8)", () => {
    // CB p.163's example ticks the thief "from 3 to 1" on a failure with Fear, but the Dynamic Countdown Advancement
    // table it points to says a consequence countdown ticks 3 on a failure with Fear (2 on a failure with Hope). The app
    // follows the table (K0's rollTicks); see the K3 task doc, QUESTIONS.
    it("the book's example: d6, thief at 3; success with Hope moves the party 6 -> 4; a failure moves the thief by the R4 table", async () => {
      const { createChase, roll, values, undo } = await setup();
      const { partyId, rivalsId } = await createChase({ startingValue: 6, lead: "decent", party: "pursuing", armed: true });
      await roll("successHope");
      expect(await values(partyId, rivalsId)).toEqual([4, 3]);
      const fear = await roll("failFear");
      expect(await values(partyId, rivalsId)).toEqual([4, 0]);
      await undo(fear.entryId);
      await roll("failHope");
      expect(await values(partyId, rivalsId)).toEqual([4, 1]);
    });

    it("a success with Fear moves both; an unarmed pair doesn't move", async () => {
      const { createChase, roll, values, arm } = await setup();
      const { partyId, rivalsId } = await createChase({ armed: false });
      await roll("successFear");
      expect(await values(partyId, rivalsId)).toEqual([6, 3]);
      await arm(partyId, true);
      await roll("successFear");
      expect(await values(partyId, rivalsId)).toEqual([5, 2]);
    });

    it("the pair stops once the thief reaches 0; undoing that roll reopens it (D11); Borrowed Time reopens it too (D9)", async () => {
      const { createChase, roll, values, row, undo, op } = await setup();
      const { partyId, rivalsId } = await createChase({ armed: true });
      await roll("failHope"); // thief 3 -> 1
      const { entryId } = await roll("failFear"); // thief 1 -> 0: got away
      expect(await values(partyId, rivalsId)).toEqual([6, 0]);
      expect((await row(rivalsId)).status).toBe("completed");

      // Undo takes back only the newest group, so undo comes first.
      await undo(entryId);
      expect(await values(partyId, rivalsId)).toEqual([6, 1]);
      expect((await row(rivalsId)).status).toBe("active");
      await roll("successHope");
      expect(await values(partyId, rivalsId)).toEqual([4, 1]);

      await roll("failHope"); // thief 1 -> 0 again
      expect((await row(rivalsId)).status).toBe("completed");
      await roll("critical");
      await roll("failFear");
      expect(await values(partyId, rivalsId)).toEqual([4, 0]);
      await op(rivalsId, "reverse");
      expect(await values(partyId, rivalsId)).toEqual([4, 1]);
      await roll("critical");
      expect(await values(partyId, rivalsId)).toEqual([1, 1]);
    });

    it("a paused pair doesn't move", async () => {
      const { createChase, roll, values, op } = await setup();
      const { partyId, rivalsId } = await createChase({ armed: true });
      await op(partyId, "pause");
      await roll("successFear");
      expect(await values(partyId, rivalsId)).toEqual([6, 3]);
    });
  });

  it("players see the pair per its shared visibility, without armed (D12)", async () => {
    const { createChase, list, p1 } = await setup();
    await createChase({ armed: true, visibility: { mode: "public", hidden: ["progress"] } });
    const seen = await list(p1);
    expect(seen).toHaveLength(2);
    expect(seen.map((c) => [c.chase?.side, c.currentValue, c.armed])).toEqual([
      ["party", null, null],
      ["rivals", null, null],
    ]);
  });
});
