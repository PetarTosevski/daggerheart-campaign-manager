import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { COUNTDOWN_VISIBILITY_PRESETS, type CountdownVisibility } from "../../src/lib/domain/countdowns";
import type { RestTick } from "../../src/lib/domain/countdowns/rest-ticks";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/**
 * Plan rest-ticks RT1 (bead dcm-674k): countdowns tick on rests. countdowns.setRestTick per role; a finished long rest
 * fires "On long rest", a short rest and an interrupted long rest (Q1) "On short rest"; each active dashboard countdown
 * (a chase pair once) is rolled once on the server, Automatic ticks, Reminder is stored with its roll for the GM's
 * one-click tick (countdownTracks.afterRest / tickOnRest); undoing the rest takes every tick back; the feed follows the
 * countdown's visibility (Public -> everyone, Private / Partly hidden -> GM only; a Reminder's roll stays GM-only, Q2).
 *
 * Dice: every die the server rolls comes from a mocked CSPRNG that always gives `face` (default 3), so the rest's Fear
 * d4 and a countdown's d6 both roll 3; changing `face` after the rest shows nothing is rerolled.
 */

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

let face = 3;
function mockDice() {
  face = 3;
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  // Only `rollDie`'s one-number draws are fixed; ids and join codes keep real randomness.
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array && buf.length === 1) {
      buf[0] = face - 1;
      return buf;
    }
    return real(buf as never) as T;
  });
}
afterEach(() => {
  vi.restoreAllMocks();
});

const auto = (amount: RestTick["amount"]): RestTick => ({ amount, mode: "auto" });
const remind = (amount: RestTick["amount"]): RestTick => ({ amount, mode: "remind" });
const D6 = { kind: "die", sides: 6 } as const;

type CreateArgs = { name?: string; startingValue?: number; mode?: "standard" | "progress" | "consequence" | "longTerm"; visibility?: CountdownVisibility; onLongRest?: RestTick; onShortRest?: RestTick };

/** A campaign with a GM, two players with one resting PC each, and an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: "p1@example.com", emailVerificationTime: 1 }),
    p2: await ctx.db.insert("users", { email: "p2@example.com", emailVerificationTime: 1 }),
    out: await ctx.db.insert("users", { email: "out@example.com", emailVerificationTime: 1 }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  mockDice();

  type Caller = typeof gm;
  const create = async (extra: CreateArgs = {}) =>
    (
      await gm.mutation(api.countdowns.create, {
        campaignId,
        name: extra.name ?? "Storm",
        description: "",
        category: "threat",
        consequence: "The storm breaks",
        startingValue: extra.startingValue ?? 12,
        ...(extra.mode !== undefined ? { mode: extra.mode } : {}),
        ...(extra.visibility !== undefined ? { visibility: extra.visibility } : {}),
        ...(extra.onLongRest !== undefined ? { onLongRest: extra.onLongRest } : {}),
        ...(extra.onShortRest !== undefined ? { onShortRest: extra.onShortRest } : {}),
        idempotencyKey: key(),
      })
    ).countdownId;
  const setRestTick = (countdownId: Id<"countdowns">, rest: "long" | "short", setting: RestTick | null, who: Caller | typeof t = gm) =>
    who.mutation(api.countdowns.setRestTick, { campaignId, countdownId, rest, setting, idempotencyKey: key() });
  const row = (id: Id<"countdowns">) => t.run(async (ctx) => (await ctx.db.get("countdowns", id))!);
  const value = async (id: Id<"countdowns">) => (await row(id)).currentValue;
  const restRow = (id: Id<"rests">) => t.run(async (ctx) => (await ctx.db.get("rests", id))!);
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const interrupt = (restId: Id<"rests">) => gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() });
  const undo = (restId: Id<"rests">) => gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
  const rest = async (kind: "short" | "long") => {
    const { restId } = await start(kind);
    return { restId, result: await finish(restId) };
  };
  const afterRest = () => gm.query(api.countdownTracks.afterRest, { campaignId });
  const tickOnRest = (restId: Id<"rests">, countdownId: Id<"countdowns">, who: Caller | typeof t = gm) =>
    who.mutation(api.countdownTracks.tickOnRest, { campaignId, restId, countdownId, idempotencyKey: key() });
  const op = (countdownId: Id<"countdowns">, action: "pause" | "cancel") => gm.mutation(api.countdowns.operate, { countdownId, action, idempotencyKey: key() });
  const feed = async (who: Caller) =>
    (await who.query(api.feed.list, { campaignId, paginationOpts: { numItems: 100, cursor: null } })).page.filter((r) => r.kind === "countdown");
  return { t, gm, p1, out, campaignId, create, setRestTick, row, value, restRow, start, finish, interrupt, undo, rest, afterRest, tickOnRest, op, feed };
}

describe("countdown rest ticks (rest-ticks RT1)", () => {
  useAllowlist();

  describe("countdowns.setRestTick", () => {
    it("anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN; the GM's setting shows to the GM, null to players", async () => {
      const ctx = await setup();
      const id = await ctx.create();
      const setting = remind(D6);
      expect(await codeOf(ctx.setRestTick(id, "short", setting, ctx.t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.setRestTick(id, "short", setting, ctx.out))).toBe("NOT_FOUND");
      expect(await codeOf(ctx.setRestTick(id, "short", setting, ctx.p1))).toBe("FORBIDDEN");
      expect(await ctx.setRestTick(id, "short", setting)).toEqual({ rest: "short", setting });
      expect((await ctx.row(id)).onShortRest).toEqual(setting);
      const [gmView] = await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect([gmView.onShortRest, gmView.onLongRest]).toEqual([setting, null]);
      const [playerView] = await ctx.p1.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      expect([playerView.onShortRest, playerView.onLongRest]).toEqual([null, null]);
      expect(await ctx.setRestTick(id, "short", null)).toEqual({ rest: "short", setting: null });
      expect((await ctx.row(id)).onShortRest).toBeUndefined();
    });

    it("INVALID for a fixed amount outside 1..20; COUNTDOWN_RULE when cancelled; NOT_FOUND for frame-owned and foreign", async () => {
      const ctx = await setup();
      const id = await ctx.create();
      expect(await codeOf(ctx.setRestTick(id, "long", auto({ kind: "fixed", n: 0 })))).toBe("INVALID");
      expect(await codeOf(ctx.setRestTick(id, "long", auto({ kind: "fixed", n: 21 })))).toBe("INVALID");
      expect((await ctx.row(id)).onLongRest).toBeUndefined();
      const owned = await ctx.t.run((c) =>
        c.db.insert("countdowns", { campaignId: ctx.campaignId, name: "Obj", description: "", category: "threat", consequence: "", startingValue: 4, currentValue: 4, status: "active", createdAt: 0, ownerKey: "objective:x" }),
      );
      expect(await codeOf(ctx.setRestTick(owned, "long", auto(D6)))).toBe("NOT_FOUND");
      const { campaignId: theirs } = await ctx.out.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
      const foreign = await ctx.t.run((c) =>
        c.db.insert("countdowns", { campaignId: theirs, name: "X", description: "", category: "threat", consequence: "", startingValue: 4, currentValue: 4, status: "active", createdAt: 0 }),
      );
      expect(await codeOf(ctx.setRestTick(foreign, "long", auto(D6)))).toBe("NOT_FOUND");
      await ctx.op(id, "cancel");
      expect(await codeOf(ctx.setRestTick(id, "long", auto(D6)))).toBe("COUNTDOWN_RULE");
    });

    it("create takes both settings on any type", async () => {
      const ctx = await setup();
      for (const mode of ["standard", "progress", "consequence", "longTerm"] as const) {
        const id = await ctx.create({ mode, onLongRest: auto({ kind: "pcs" }), onShortRest: remind({ kind: "diePlusPcs", sides: 4 }) });
        const r = await ctx.row(id);
        expect([r.onLongRest, r.onShortRest, r.armed, r.restMode]).toEqual([auto({ kind: "pcs" }), remind({ kind: "diePlusPcs", sides: 4 }), undefined, undefined]);
      }
    });
  });

  describe("amounts (each kind, server dice)", () => {
    it("fixed, PCs who rested, a die and a die plus PCs, stored on the rest row", async () => {
      const ctx = await setup();
      const fixed = await ctx.create({ name: "Fixed", onShortRest: auto({ kind: "fixed", n: 2 }) });
      const pcs = await ctx.create({ name: "Pcs", onShortRest: auto({ kind: "pcs" }) });
      const die = await ctx.create({ name: "Die", onShortRest: auto(D6) });
      const both = await ctx.create({ name: "Both", onShortRest: auto({ kind: "diePlusPcs", sides: 6 }) });
      const { restId, result } = await ctx.rest("short");
      expect([await ctx.value(fixed), await ctx.value(pcs), await ctx.value(die), await ctx.value(both)]).toEqual([10, 10, 9, 7]);
      expect(result.countdownLines).toEqual(["Fixed ticks 2", "Pcs ticks 2 (2 PCs)", "Die ticks 3 (1d6 3)", "Both ticks 5 (1d6 3 + 2 PCs)"]);
      expect((await ctx.restRow(restId)).restTicks).toEqual([
        { countdownId: fixed, mode: "auto", amount: 2 },
        { countdownId: pcs, mode: "auto", amount: 2, pcs: 2 },
        { countdownId: die, mode: "auto", amount: 3, die: { sides: 6, rolled: 3 } },
        { countdownId: both, mode: "auto", amount: 5, pcs: 2, die: { sides: 6, rolled: 3 } },
      ]);
      const ticks = await ctx.t.run((c) => c.db.query("countdownTicks").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect());
      expect(ticks.map((tk) => [tk.source, tk.amount])).toEqual([
        ["rest", 2],
        ["rest", 2],
        ["rest", 3],
        ["rest", 5],
      ]);
    });

    it("a d20 rolls the server's die; an amount past the value stops at 0 and triggers", async () => {
      const ctx = await setup();
      const id = await ctx.create({ startingValue: 3, onLongRest: auto({ kind: "die", sides: 20 }) });
      face = 4; // the rest's Fear d4 and the d20 both roll 4
      await ctx.rest("long");
      expect(await ctx.row(id)).toMatchObject({ currentValue: 0, status: "completed" });
    });
  });

  describe("which rest fires which setting", () => {
    it("finished long -> On long rest; short -> On short rest; interrupted long -> On short rest (Q1); interrupted short -> nothing", async () => {
      const ctx = await setup();
      const long = await ctx.create({ name: "Long", onLongRest: auto({ kind: "fixed", n: 1 }) });
      const short = await ctx.create({ name: "Short", onShortRest: auto({ kind: "fixed", n: 1 }) });
      await ctx.rest("long");
      expect([await ctx.value(long), await ctx.value(short)]).toEqual([11, 12]);
      await ctx.rest("short");
      expect([await ctx.value(long), await ctx.value(short)]).toEqual([11, 11]);
      const { restId: cut } = await ctx.start("long");
      const interrupted = await ctx.interrupt(cut);
      expect(interrupted.countdownLines).toEqual(["Short ticks 1"]);
      expect([await ctx.value(long), await ctx.value(short)]).toEqual([11, 10]);
      expect(await ctx.afterRest()).toMatchObject({ restId: cut, kind: "short" });
      const { restId: cutShort } = await ctx.start("short");
      await ctx.interrupt(cutShort);
      expect([await ctx.value(long), await ctx.value(short)]).toEqual([11, 10]);
      expect(await ctx.afterRest()).toBeNull();
    });

    it("paused, completed and cancelled countdowns are skipped", async () => {
      const ctx = await setup();
      const paused = await ctx.create({ name: "Paused", onLongRest: auto(D6) });
      await ctx.op(paused, "pause");
      const done = await ctx.create({ name: "Done", onLongRest: auto(D6) });
      await ctx.t.run((c) => c.db.patch("countdowns", done, { currentValue: 0, status: "completed" }));
      const gone = await ctx.create({ name: "Gone", onLongRest: auto(D6) });
      await ctx.op(gone, "cancel");
      const { restId, result } = await ctx.rest("long");
      expect(result.countdownLines).toBeUndefined();
      expect([await ctx.value(paused), await ctx.value(done), await ctx.value(gone)]).toEqual([12, 0, 12]);
      expect((await ctx.restRow(restId)).restTicks).toBeUndefined();
    });
  });

  describe("Reminder", () => {
    it("stores the roll, ticks nothing, shows 'Tick X?' with the amount; one click ticks exactly that amount once", async () => {
      const ctx = await setup();
      const id = await ctx.create({ onLongRest: remind({ kind: "diePlusPcs", sides: 6 }) });
      const { restId, result } = await ctx.rest("long");
      expect(result.countdownLines).toBeUndefined();
      expect(await ctx.value(id)).toBe(12);
      face = 1; // a reload never rerolls
      expect(await ctx.afterRest()).toEqual({
        restId,
        kind: "long",
        lines: [],
        reminders: [{ countdownId: id, name: "Storm", currentValue: 12, amount: 5, rollText: "1d6 3 + 2 PCs" }],
      });
      expect(await ctx.tickOnRest(restId, id)).toEqual({ currentValue: 7, status: "active", line: "Storm: 7 left" });
      expect(await codeOf(ctx.tickOnRest(restId, id))).toBe("COUNTDOWN_RULE");
      expect(await ctx.afterRest()).toEqual({
        restId,
        kind: "long",
        lines: [{ countdownId: id, name: "Storm", currentValue: 7, line: "Storm ticks 5 (1d6 3 + 2 PCs)" }],
        reminders: [],
      });
    });

    it("tickOnRest per role and its refusals: no stored reminder, an Automatic one, not active, an older rest, another campaign's", async () => {
      const ctx = await setup();
      const id = await ctx.create({ name: "Reminded", onLongRest: remind(D6) });
      const automatic = await ctx.create({ name: "Auto", onLongRest: auto(D6) });
      const plain = await ctx.create({ name: "Plain" });
      const { restId } = await ctx.rest("long");
      expect(await codeOf(ctx.tickOnRest(restId, id, ctx.t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(ctx.tickOnRest(restId, id, ctx.out))).toBe("NOT_FOUND");
      expect(await codeOf(ctx.tickOnRest(restId, id, ctx.p1))).toBe("FORBIDDEN");
      expect(await codeOf(ctx.p1.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId }))).toBe("FORBIDDEN");
      expect(await codeOf(ctx.tickOnRest(restId, plain))).toBe("COUNTDOWN_RULE");
      expect(await codeOf(ctx.tickOnRest(restId, automatic))).toBe("COUNTDOWN_RULE");
      await ctx.op(id, "pause");
      expect(await codeOf(ctx.tickOnRest(restId, id))).toBe("COUNTDOWN_RULE");
      await ctx.gm.mutation(api.countdowns.operate, { countdownId: id, action: "resume", idempotencyKey: key() });
      await ctx.rest("short");
      expect(await codeOf(ctx.tickOnRest(restId, id))).toBe("COUNTDOWN_RULE");
      expect(await ctx.value(id)).toBe(12);
    });

    it("a Public reminder's roll stays GM-only until the click; the click writes the tick publicly", async () => {
      const ctx = await setup();
      const id = await ctx.create({ onLongRest: remind(D6) });
      const { restId } = await ctx.rest("long");
      expect((await ctx.feed(ctx.gm)).map((r) => [r.visibility, r.summary])).toEqual([["gm", "Long rest: Reminder: tick Storm 3 (1d6 3)?"]]);
      expect(await ctx.feed(ctx.p1)).toEqual([]);
      await ctx.tickOnRest(restId, id);
      expect((await ctx.feed(ctx.p1)).map((r) => r.summary)).toEqual(["Long rest: Storm ticks 3 (1d6 3)"]);
    });
  });

  describe("chase pairs", () => {
    async function chase(ctx: Awaited<ReturnType<typeof setup>>, extra: { onShortRest?: RestTick } = {}) {
      return ctx.gm.mutation(api.countdowns.createChase, {
        campaignId: ctx.campaignId,
        name: "The thief",
        description: "",
        startingValue: 10,
        lead: "decent",
        party: "pursuing",
        ...extra,
        idempotencyKey: key(),
      });
    }

    it("the setting is shared (createChase and setRestTick write both rows); one roll moves both by the same amount", async () => {
      const ctx = await setup();
      const { partyId, rivalsId } = await chase(ctx, { onShortRest: auto(D6) });
      expect([(await ctx.row(partyId)).onShortRest, (await ctx.row(rivalsId)).onShortRest]).toEqual([auto(D6), auto(D6)]);
      await ctx.setRestTick(rivalsId, "long", remind({ kind: "pcs" }));
      expect([(await ctx.row(partyId)).onLongRest, (await ctx.row(rivalsId)).onLongRest]).toEqual([remind({ kind: "pcs" }), remind({ kind: "pcs" })]);
      const { restId, result } = await ctx.rest("short");
      expect([await ctx.value(partyId), await ctx.value(rivalsId)]).toEqual([7, 4]);
      expect(result.countdownLines).toEqual(["The thief chase ticks 3 (1d6 3)"]);
      const stored = (await ctx.restRow(restId)).restTicks!;
      expect(stored.map((s) => s.amount)).toEqual([3, 3]);
    });

    it("one reminder per pair ticks both rows; undoing the rest takes both back", async () => {
      const ctx = await setup();
      const { partyId, rivalsId } = await chase(ctx);
      await ctx.setRestTick(partyId, "long", remind({ kind: "fixed", n: 2 }));
      const { restId } = await ctx.rest("long");
      const panel = await ctx.afterRest();
      expect(panel?.reminders).toEqual([{ countdownId: partyId, name: "The thief chase", currentValue: 10, amount: 2, rollText: null }]);
      await ctx.tickOnRest(restId, rivalsId);
      expect([await ctx.value(partyId), await ctx.value(rivalsId)]).toEqual([8, 5]);
      expect(await codeOf(ctx.tickOnRest(restId, partyId))).toBe("COUNTDOWN_RULE");
      expect((await ctx.afterRest())?.reminders).toEqual([]);
      await ctx.undo(restId);
      expect([await ctx.value(partyId), await ctx.value(rivalsId)]).toEqual([10, 7]);
    });
  });

  it("undoing a rest takes back Automatic and clicked-Reminder ticks and clears the stored rolls", async () => {
    const ctx = await setup();
    const a = await ctx.create({ name: "Auto", onLongRest: auto(D6) });
    const r = await ctx.create({ name: "Remind", onLongRest: remind({ kind: "fixed", n: 4 }) });
    const { restId } = await ctx.rest("long");
    await ctx.tickOnRest(restId, r);
    expect([await ctx.value(a), await ctx.value(r)]).toEqual([9, 8]);
    await ctx.undo(restId);
    expect([await ctx.value(a), await ctx.value(r)]).toEqual([12, 12]);
    expect((await ctx.restRow(restId)).restTicks).toBeUndefined();
    expect((await ctx.feed(ctx.gm)).every((row) => row.undone)).toBe(true);
    expect(await ctx.afterRest()).toBeNull();
    // Finishing the reopened rest rolls and ticks again, once.
    await ctx.finish(restId);
    expect(await ctx.value(a)).toBe(9);
  });

  it("feed rows follow visibility: Public in the player's feed; Partly hidden and Private only in the GM's", async () => {
    const ctx = await setup();
    await ctx.create({ name: "Open", onShortRest: auto(D6) });
    await ctx.create({ name: "Veiled", visibility: COUNTDOWN_VISIBILITY_PRESETS.partly, onShortRest: auto(D6) });
    await ctx.create({ name: "Secret", visibility: COUNTDOWN_VISIBILITY_PRESETS.private, onShortRest: auto({ kind: "pcs" }) });
    await ctx.rest("short");
    const gmRows = (await ctx.feed(ctx.gm)).map((r) => [r.visibility, r.summary]).sort();
    expect(gmRows).toEqual([
      ["gm", "Short rest: Veiled ticks 3 (1d6 3); Secret ticks 2 (2 PCs)"],
      ["public", "Short rest: Open ticks 3 (1d6 3)"],
    ]);
    const playerRows = (await ctx.feed(ctx.p1)).map((r) => r.summary);
    expect(playerRows).toEqual(["Short rest: Open ticks 3 (1d6 3)"]);
    expect(JSON.stringify(await ctx.p1.query(api.feed.list, { campaignId: ctx.campaignId, paginationOpts: { numItems: 100, cursor: null } }))).not.toMatch(
      /Veiled|Secret/,
    );
  });
});
