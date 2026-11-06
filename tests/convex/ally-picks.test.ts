/**
 * Per-ally picks (plan finish-hud-lk, tracer FH-AP; bead dcm-bxp.99.32.24; user decisions 2026-11-05;
 * convex/lib/allyPicks.ts). Book texts:
 * - Rousing Strike (CB p.342): "Once per rest, when you critically succeed on an attack, you and all allies who can see or
 *   hear you can clear a Hit Point or 1d4 Stress."
 * - Awesome Size (HF p.93): "When the Machine enters the battlefield, each PC must either lose a Hope or mark 1d4 Stress."
 *
 * The user's decisions: the whole card / feature waits until every chooser answered; the GM answers a no-show's pick;
 * only that chooser's player or the GM answers; Undo cancels outstanding picks; the encounter's end closes them as it
 * closes reaction windows (`closeEncounterRequests`). Dice: the server's own, pinned (`crypto.getRandomValues`).
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** The server's dice show `values` in turn while `fn` runs (rollDie draws from `crypto.getRandomValues`). */
async function pinnedDice<T>(values: readonly number[], fn: () => Promise<T>): Promise<T> {
  let i = 0;
  const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<A extends ArrayBufferView | null>(buf: A): A => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

const SOFT = { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 };

/** A live map: Ash (characterA, Rousing Strike in the loadout) next to a Bear, Bryn (characterB) nearby; a running encounter. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ash = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 5, y: 12, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const adversary = (adversaryId: string, label: string) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 0,
        summoned: false,
        stats: SOFT,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
    const bear = await adversary("bear", "Bear");
    const bearToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: bear }, side: "enemy", x: 6, y: 10, face: Math.PI });
    const machine = await adversary("gargantuan-war-machine", "War Machine");
    return { ash, bryn, encounterId, bear, bearToken, machine };
  });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  await edit(w.characterA, (s) => ({ hp: 3, stress: 0, hope: 2, domainCards: { ...s.domainCards, owned: [...new Set([...s.domainCards.owned, "rousing-strike"])], loadout: ["rousing-strike"] } }));
  await edit(w.characterB, () => ({ hp: 3, stress: 0, hope: 2 }));
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  /** Ash's critical attack (Hope 6, Fear 6) on the Bear, with Rousing Strike. */
  const criticalAttack = () =>
    pinnedDice([6, 6], () =>
      w.as("player").mutation(api.combatActions.attack, {
        campaignId,
        characterId: w.characterA,
        mapId,
        targetTokenIds: [ids.bearToken],
        slot: "primary",
        modifier: 0,
        experienceIds: [],
        advantage: 0,
        disadvantage: 0,
        help: 0,
        options: [],
        riders: [{ source: "card", id: "rousing-strike", choices: [] }],
        idempotencyKey: key(),
      }),
    );
  const answer = (c: Client, requestId: Id<"combatRequests">, chooserId: string, option: string, stepId = "rousing") =>
    c.mutation(api.allyPicks.answer, { campaignId, requestId, stepId, chooserId, options: [option], idempotencyKey: key() });
  /** The actor's review (CU2): send the picks, `drop` unticked. */
  const send = (c: Client, requestId: Id<"combatRequests">, drop: string[] = []) => c.mutation(api.allyPicks.send, { campaignId, requestId, drop, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, ...ids, sheet, edit, requests, criticalAttack, answer, send };
}

/** Ash's critical with Rousing Strike: the row opens in review; unless `review`, Ash sends it with every ally ticked. */
async function openPick(a: Awaited<ReturnType<typeof arena>>, opts: { review?: boolean } = {}) {
  const r = await a.criticalAttack();
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  expect(r.roll.outcome).toBe("critical");
  expect(r.allyPicks).toEqual([expect.objectContaining({ name: "Rousing Strike" })]);
  const requestId = r.allyPicks![0]!.requestId;
  if (opts.review !== true) expect(await a.send(a.w.as("player"), requestId)).toEqual({ status: "open" });
  return { result: r, requestId };
}

describe("FH-AP: Rousing Strike waits for every chooser's own pick (CB p.342)", () => {
  it("the use waits; each pick shows on its chooser's screen; the GM answers a no-show; then it all applies", async () => {
    const a = await arena();
    const { requestId } = await openPick(a);
    const row = (await a.requests()).find((r) => r._id === requestId)!;
    expect(row.payload).toMatchObject({ kind: "allyPick", name: "Rousing Strike", actorName: "Ash" });
    expect(row.payload.kind === "allyPick" && row.payload.choosers.map((c) => [c.chooserId, c.characterId])).toEqual([
      [a.ash, a.w.characterA],
      [a.bryn, a.w.characterB],
    ]);
    // Each player's read: Ash sees his own pick and the waiting line; Bryn sees only hers; the GM sees both answerable.
    const ashView = await a.w.as("player").query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(ashView).toEqual([expect.objectContaining({ actor: true, choosers: [expect.objectContaining({ name: "Ash", mine: true }), expect.objectContaining({ name: "Bryn", mine: false })] })]);
    const brynView = await a.w.as("otherPlayer").query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(brynView).toEqual([expect.objectContaining({ actor: false, choosers: [expect.objectContaining({ mine: false }), expect.objectContaining({ name: "Bryn", mine: true })] })]);
    const gmView = await a.gm.query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(gmView[0]!.choosers.map((c) => c.mine)).toEqual([true, true]);
    expect(await a.w.as("outsider").query(api.allyPicksReads.open, { campaignId: a.campaignId }).catch(errorCode)).toBe("NOT_FOUND");

    // Ash picks; nothing applies yet (the whole card waits).
    expect(await a.answer(a.w.as("player"), requestId, a.ash, "hp")).toEqual({ status: "open" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(3);
    expect((await a.sheet(a.w.characterB)).hp).toBe(3);
    const waiting = await a.w.as("player").query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(waiting[0]!.choosers.map((c) => c.answered)).toEqual([true, false]);

    // Bryn doesn't answer: the GM picks for her from the queue; the card runs with both picks.
    expect(await a.answer(a.gm, requestId, a.bryn, "hp")).toEqual({ status: "resolved" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
    expect((await a.sheet(a.w.characterB)).hp).toBe(2);
    expect((await a.requests()).find((r) => r._id === requestId)?.status).toBe("resolved");
    expect(await a.w.as("player").query(api.allyPicksReads.open, { campaignId: a.campaignId })).toEqual([]);
  });

  it("an ally answers their own pick; 1d4 Stress clears on the ally who picked it", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ stress: 4 }));
    const { requestId } = await openPick(a);
    expect(await a.answer(a.w.as("otherPlayer"), requestId, a.bryn, "stress")).toEqual({ status: "open" });
    expect(await a.answer(a.w.as("player"), requestId, a.ash, "hp")).toEqual({ status: "resolved" });
    const bryn = await a.sheet(a.w.characterB);
    expect(bryn.stress).toBeLessThan(4);
    expect(bryn.stress).toBeGreaterThanOrEqual(0);
    expect(bryn.hp).toBe(3);
  });

  it("only the chooser's player or the GM answers: another player FORBIDDEN, an outsider NOT_FOUND; twice NOT_A_RESPONDER; a wrong option INVALID", async () => {
    const a = await arena();
    const { requestId } = await openPick(a);
    expect(await code(a.answer(a.w.as("otherPlayer"), requestId, a.ash, "hp"))).toBe("FORBIDDEN");
    expect(await code(a.answer(a.w.as("player"), requestId, a.bryn, "hp"))).toBe("FORBIDDEN");
    expect(await code(a.answer(a.w.as("outsider"), requestId, a.ash, "hp"))).toBe("NOT_FOUND");
    expect(await code(a.answer(a.w.as("player"), requestId, a.ash, "hope"))).toBe("INVALID");
    expect(await code(a.answer(a.w.as("player"), requestId, a.ash, "hp"))).toBe("ok");
    expect(await code(a.answer(a.w.as("player"), requestId, a.ash, "hp"))).toBe("NOT_A_RESPONDER");
    expect(await code(a.answer(a.w.as("player"), requestId, a.ash, "hp", "other-step"))).toBe("NOT_A_RESPONDER");
  });

  it("undoing the attack cancels the outstanding picks; nothing applies", async () => {
    const a = await arena();
    const { result, requestId } = await openPick(a);
    await a.gm.mutation(api.actionLog.undo, { entryId: result.entryId, idempotencyKey: key() });
    expect((await a.requests()).find((r) => r._id === requestId)?.status).toBe("declined");
    expect(await code(a.answer(a.w.as("otherPlayer"), requestId, a.bryn, "hp"))).toBe("REQUEST_NOT_OPEN");
    expect((await a.sheet(a.w.characterB)).hp).toBe(3);
  });

  it("ending the encounter closes the picks as it closes reaction windows (declined)", async () => {
    const a = await arena();
    const { requestId } = await openPick(a);
    await a.gm.mutation(api.encounters.end, { campaignId: a.campaignId, encounterId: a.encounterId });
    expect((await a.requests()).find((r) => r._id === requestId)?.status).toBe("declined");
    expect(await a.w.as("otherPlayer").query(api.allyPicksReads.open, { campaignId: a.campaignId })).toEqual([]);
  });

  it("no pick opens without a critical (the trigger didn't happen)", async () => {
    const a = await arena();
    const r = await pinnedDice([6, 3], () =>
      a.w.as("player").mutation(api.combatActions.attack, {
        campaignId: a.campaignId,
        characterId: a.w.characterA,
        mapId: a.mapId,
        targetTokenIds: [a.bearToken],
        slot: "primary",
        modifier: 0,
        experienceIds: [],
        advantage: 0,
        disadvantage: 0,
        help: 0,
        options: [],
        riders: [{ source: "card", id: "rousing-strike", choices: [] }],
        idempotencyKey: key(),
      }),
    );
    expect(r.status === "resolved" && r.allyPicks).toBeFalsy();
    expect((await a.requests()).filter((x) => x.kind === "allyPick")).toEqual([]);
  });
});

describe("FH-AP: an adversary feature's PC picks go to each PC (Awesome Size, HF p.93)", () => {
  it("nothing applies until both PCs picked; then each loses a Hope or marks 1d4 Stress", async () => {
    const a = await arena();
    const res = await a.gm.mutation(api.adversaryActions.useFeature, { campaignId: a.campaignId, instanceId: a.machine, feature: "Awesome Size", targets: [], picked: [a.w.characterA, a.w.characterB], idempotencyKey: key() });
    if (res.status !== "resolved") throw new Error("expected resolved");
    expect(res.picks).toBeDefined();
    const requestId = res.picks!;
    const row = (await a.requests()).find((r) => r._id === requestId)!;
    expect(row.payload.kind === "allyPick" && row.payload.choosers.map((c) => c.characterId)).toEqual([a.w.characterA, a.w.characterB]);
    expect((await a.requests()).filter((r) => r.kind === "gmPrompt")).toEqual([]);
    expect(await a.answer(a.w.as("player"), requestId, a.w.characterA, "hope", "size")).toEqual({ status: "open" });
    expect((await a.sheet(a.w.characterA)).hope).toBe(2);
    expect(await a.answer(a.w.as("otherPlayer"), requestId, a.w.characterB, "stress", "size")).toEqual({ status: "resolved" });
    expect((await a.sheet(a.w.characterA)).hope).toBe(1);
    expect((await a.sheet(a.w.characterB)).stress).toBeGreaterThan(0);
  });

  it("undoing the held use cancels its picks", async () => {
    const a = await arena();
    const res = await a.gm.mutation(api.adversaryActions.useFeature, { campaignId: a.campaignId, instanceId: a.machine, feature: "Awesome Size", targets: [], picked: [a.w.characterA, a.w.characterB], idempotencyKey: key() });
    if (res.status !== "resolved") throw new Error("expected resolved");
    await a.gm.mutation(api.actionLog.undo, { entryId: res.entryId, idempotencyKey: key() });
    expect((await a.requests()).find((r) => r._id === res.picks)?.status).toBe("declined");
  });
});

describe("CU2: 'Neither' and the actor's review (bead dcm-bxp.99.32.46, user 2026-11-06)", () => {
  it("each chooser may pick Neither (Rousing Strike CB p.342: 'can clear'); a Neither changes nothing for that PC", async () => {
    const a = await arena();
    const { requestId } = await openPick(a);
    const view = await a.w.as("otherPlayer").query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(view[0]!.choosers[1]!.options.map((o) => o.id)).toEqual(["hp", "stress", "neither"]);
    expect(await a.answer(a.w.as("otherPlayer"), requestId, a.bryn, "neither")).toEqual({ status: "open" });
    expect(await a.answer(a.w.as("player"), requestId, a.ash, "hp")).toEqual({ status: "resolved" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 3, stress: 0 });
  });

  it("the picks wait for the actor's review: only the actor and the GM see the row, nobody answers yet", async () => {
    const a = await arena();
    const { requestId } = await openPick(a, { review: true });
    const ashView = await a.w.as("player").query(api.allyPicksReads.open, { campaignId: a.campaignId });
    expect(ashView).toEqual([expect.objectContaining({ actor: true, review: true })]);
    expect(ashView[0]!.choosers.map((c) => [c.name, c.self, c.mine])).toEqual([
      ["Ash", true, false],
      ["Bryn", false, false],
    ]);
    expect(await a.w.as("otherPlayer").query(api.allyPicksReads.open, { campaignId: a.campaignId })).toEqual([]);
    expect((await a.gm.query(api.allyPicksReads.open, { campaignId: a.campaignId }))[0]).toMatchObject({ review: true });
    expect(await code(a.answer(a.w.as("player"), requestId, a.ash, "hp"))).toBe("NOT_A_RESPONDER");
    expect(await code(a.answer(a.gm, requestId, a.bryn, "hp"))).toBe("NOT_A_RESPONDER");
  });

  it("the actor unticks an ally who can't see or hear them: only the rest pick, and the dropped ally gets nothing", async () => {
    const a = await arena();
    const { requestId } = await openPick(a, { review: true });
    expect(await a.send(a.w.as("player"), requestId, [a.bryn])).toEqual({ status: "open" });
    expect(await a.w.as("otherPlayer").query(api.allyPicksReads.open, { campaignId: a.campaignId })).toEqual([]);
    expect(await code(a.answer(a.gm, requestId, a.bryn, "hp"))).toBe("NOT_A_RESPONDER");
    expect(await a.answer(a.w.as("player"), requestId, a.ash, "hp")).toEqual({ status: "resolved" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
    expect((await a.sheet(a.w.characterB)).hp).toBe(3);
  });

  it("send refusals: another player FORBIDDEN, the actor's own pick or an unknown chooser INVALID, twice NOT_A_RESPONDER; the GM may send", async () => {
    const a = await arena();
    const { requestId } = await openPick(a, { review: true });
    expect(await code(a.send(a.w.as("otherPlayer"), requestId))).toBe("FORBIDDEN");
    expect(await code(a.send(a.w.as("outsider"), requestId))).toBe("NOT_FOUND");
    expect(await code(a.send(a.w.as("player"), requestId, [a.ash]))).toBe("INVALID");
    expect(await code(a.send(a.w.as("player"), requestId, ["nobody"]))).toBe("INVALID");
    expect(await a.send(a.gm, requestId)).toEqual({ status: "open" });
    expect(await code(a.send(a.w.as("player"), requestId))).toBe("NOT_A_RESPONDER");
  });

  it("an adversary's held use goes out at once (no review) and can't be 'sent'", async () => {
    const a = await arena();
    const res = await a.gm.mutation(api.adversaryActions.useFeature, { campaignId: a.campaignId, instanceId: a.machine, feature: "Awesome Size", targets: [], picked: [a.w.characterA, a.w.characterB], idempotencyKey: key() });
    if (res.status !== "resolved") throw new Error("expected resolved");
    expect((await a.gm.query(api.allyPicksReads.open, { campaignId: a.campaignId }))[0]).toMatchObject({ review: false });
    expect(await code(a.send(a.gm, res.picks!))).toBe("NOT_A_RESPONDER");
  });

  describe("Critical Inspiration (CB p.341: 'all allies within Very Close range can clear a Stress or gain a Hope')", () => {
    /** Ash with Critical Inspiration instead; Bryn moved far away (out of Very Close). */
    async function inspiration(definedRanges: boolean) {
      const a = await arena();
      await a.edit(a.w.characterA, (s) => ({ domainCards: { ...s.domainCards, owned: [...new Set([...s.domainCards.owned, "critical-inspiration"])], loadout: ["critical-inspiration"] } }));
      await a.edit(a.w.characterB, () => ({ stress: 2 }));
      await a.t.run(async (ctx) => {
        await ctx.db.patch("combatTokens", a.bryn, { x: 5, y: 40 });
        await ctx.db.patch("campaigns", a.campaignId, { ruleModes: { definedRanges } });
      });
      const r = await pinnedDice([6, 6], () =>
        a.w.as("player").mutation(api.combatActions.attack, {
          campaignId: a.campaignId,
          characterId: a.w.characterA,
          mapId: a.mapId,
          targetTokenIds: [a.bearToken],
          slot: "primary",
          modifier: 0,
          experienceIds: [],
          advantage: 0,
          disadvantage: 0,
          help: 0,
          options: [],
          riders: [{ source: "card", id: "critical-inspiration", choices: [] }],
          idempotencyKey: key(),
        }),
      );
      if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
      return { a, r };
    }

    it("Defined Ranges on: an ally out of Very Close is not on the list (no pick opens)", async () => {
      const { a, r } = await inspiration(true);
      expect(r.allyPicks ?? []).toEqual([]);
      expect((await a.requests()).filter((x) => x.kind === "allyPick")).toEqual([]);
    });

    it("Defined Ranges off: every PC is on the list; the actor reviews, the ally picks (Neither offered)", async () => {
      const { a, r } = await inspiration(false);
      expect(r.allyPicks).toEqual([expect.objectContaining({ name: "Critical Inspiration" })]);
      const requestId = r.allyPicks![0]!.requestId;
      const view = await a.w.as("player").query(api.allyPicksReads.open, { campaignId: a.campaignId });
      expect(view[0]!.choosers.map((c) => [c.name, c.self])).toEqual([["Bryn", false]]);
      expect(view[0]!.choosers[0]!.options.map((o) => o.id)).toEqual(["stress", "hope", "neither"]);
      expect(await a.send(a.w.as("player"), requestId)).toEqual({ status: "open" });
      expect(await a.answer(a.w.as("otherPlayer"), requestId, a.bryn, "stress", "inspiration")).toEqual({ status: "resolved" });
      expect((await a.sheet(a.w.characterB)).stress).toBe(1);
    });

    it("Defined Ranges off: the actor unticks everyone, so the card doesn't happen and stays unspent", async () => {
      const { a, r } = await inspiration(false);
      const requestId = r.allyPicks![0]!.requestId;
      expect(await a.send(a.w.as("player"), requestId, [a.bryn])).toEqual({ status: "declined" });
      expect((await a.requests()).find((x) => x._id === requestId)?.status).toBe("declined");
      expect((await a.sheet(a.w.characterB)).stress).toBe(2);
      expect((await a.sheet(a.w.characterA)).featureUses ?? []).not.toContainEqual(expect.objectContaining({ key: "card:critical-inspiration" }));
    });
  });
});
