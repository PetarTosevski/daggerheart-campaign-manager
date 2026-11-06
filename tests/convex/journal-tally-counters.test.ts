import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction, newGroupId } from "../../convex/lib/actionLog";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { MAX_SESSION_CHARACTER_STATS } from "../../convex/lib/sessions";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { key } from "./helpers";

// Journal JD3b (plan .omc/plans/journal.yaml, user answer Q8 "counted as they happen during the live session"): every
// sheet save (`saveSheet`) that lowers a PC's Hope or marks Hit Points while the campaign has a live session adds the
// difference to that PC's `sessionCharacterStats` row for the session, in the same mutation. Raising Hope or clearing
// HP never subtracts; no live session writes nothing. Undo takes back what the undone rows recorded (`sessionTally`,
// dcm-z9rz.22), and a paying path counts the Hope it paid even when the same save gains it back (dcm-z9rz.23). The tests cover one representative mutation per engine path: the manual stepper, a hit,
// a roll that spends an Experience, a card that costs Hope, a weapon attack, a death move and a rest.

allowWorldEmails();

/** The next dice the server rolls (`rollDie` reads one Uint32 per die; value − 1 gives that face). Others pass through. */
function forceDice(...faces: number[]) {
  const real = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1 && faces.length > 0) {
      array[0] = faces.shift()! - 1;
      return array;
    }
    return real(array as never) as T;
  });
}

async function setup() {
  const w = await buildWorld();
  const { t, campaignId, characterA: a, characterB: b } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const start = async (sessionId?: Id<"sessions">) =>
    (await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key(), ...(sessionId === undefined ? {} : { sessionId }) })).sessionId!;
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const sheet = (id: Id<"characters"> = a) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = a) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const step = (resource: "hp" | "hope" | "stress", delta: number, who: Client = player, characterId: Id<"characters"> = a) =>
    who.mutation(api.characters.adjustResource, { characterId, resource, delta });
  /** The raw rows as { characterId: [hopeSpent, hpMarked] }, for one session or all. */
  const stats = async (sessionId?: Id<"sessions">) => {
    const rows = await t.run((ctx) => ctx.db.query("sessionCharacterStats").collect());
    return Object.fromEntries(rows.filter((r) => sessionId === undefined || r.sessionId === sessionId).map((r) => [r.characterId, [r.hopeSpent, r.hpMarked]]));
  };
  return { w, t, campaignId, gm, player, a, b, start, end, sheet, edit, step, stats };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** A live medium map with Ash's token at (5, 10) facing east, a running encounter and one soft enemy in front of Ash. */
async function arena(s: Setup) {
  const { t, campaignId } = s;
  const { mapId } = await s.gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const enemyTokenId = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: s.a }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bandit",
      order: 0,
      summoned: false,
      stats: { difficulty: 1, major: 100, severe: 200, hpMax: 30, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
  });
  return { mapId, enemyTokenId };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hope spent / HP marked counters (JD3b)", () => {
  it("the manual stepper: lowering Hope and marking HP during a live session count; raising and clearing never subtract", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 5, hp: 0 }));
    const sessionId = await s.start();
    await s.step("hope", -2);
    await s.step("hp", 3);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [2, 3] });

    await s.step("hope", 1);
    await s.step("hp", -2);
    await s.step("stress", 1);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [2, 3] });

    // A GM correction counts like any other drop (Q8 caveat), on the PC's row.
    await s.step("hope", -1, s.gm);
    await s.step("hp", 1, s.gm, s.b);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [3, 3], [s.b]: [0, 1] });
  });

  it("no live session writes nothing: before the first start and after the end", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 5, hp: 0 }));
    await s.step("hope", -1);
    await s.step("hp", 1);
    expect(await s.stats()).toEqual({});

    const sessionId = await s.start();
    await s.step("hp", 1);
    await s.end();
    await s.step("hp", 1);
    await s.step("hope", -1);
    expect(await s.stats()).toEqual({ [s.a]: [0, 1] });

    // Started again (D10 B7): the same session's row keeps adding.
    expect(await s.start(sessionId)).toBe(sessionId);
    await s.step("hope", -1);
    expect(await s.stats()).toEqual({ [s.a]: [1, 1] });
  });

  it("a hit: the HP the damage marks count", async () => {
    const s = await setup();
    const sessionId = await s.start();
    const before = (await s.sheet()).hp;
    const r = await s.gm.mutation(api.characters.applyDamage, { characterId: s.a, damage: 30, useArmorSlot: false, idempotencyKey: key() });
    expect(r.marks).toBeGreaterThan(0);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [0, r.hp - before] });
  });

  it("a roll that spends an Experience and rolls with Fear counts the Hope", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 2 }));
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    const roll = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [exp.id], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
    await s.player.mutation(api.rolls.manualRoll, { characterId: s.a, roll, values: [2, 9], idempotencyKey: key() });
    expect((await s.sheet()).hope).toBe(1);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
  });

  it("a weapon attack on the Combat Map with an Experience and Fear counts the Hope", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 3 }));
    const { mapId, enemyTokenId } = await arena(s);
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    // Hope die 1, Fear die 12: rolled with Fear, so the roll gives no Hope back.
    forceDice(1, 12);
    await s.player.mutation(api.combatActions.attack, {
      campaignId: s.campaignId,
      characterId: s.a,
      mapId,
      targetTokenIds: [enemyTokenId],
      slot: "primary",
      modifier: 0,
      experienceIds: [exp.id],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
    });
    expect((await s.sheet()).hope).toBe(2);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
  });

  it("a card that costs Hope counts it", async () => {
    const s = await setup();
    const cards = ["rain-of-blades"];
    await s.edit(() => ({ domainCards: { owned: cards, loadout: cards }, hope: 3 }));
    const { mapId } = await arena(s);
    const sessionId = await s.start();
    // Hope die 1, Fear die 12: no Hope back from the roll, so the cost is the whole drop.
    forceDice(1, 12);
    await s.player.mutation(api.combatCards.useCard, { campaignId: s.campaignId, characterId: s.a, mapId, cardId: "rain-of-blades", targetTokenIds: [], choices: [], idempotencyKey: key() });
    const spent = 3 - (await s.sheet()).hope;
    expect(spent).toBeGreaterThan(0);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [spent, 0] });
  });

  it("death moves: Risk It All clearing every Hit Point never subtracts", async () => {
    const s = await setup();
    const sessionId = await s.start();
    const hpMax = (await s.sheet()).hpMax;
    await s.step("hp", hpMax);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [0, hpMax] });
    forceDice(6, 6);
    const r = await s.player.mutation(api.deathMoves.choose, { characterId: s.a, move: "riskItAll", idempotencyKey: key() } as FunctionArgs<typeof api.deathMoves.choose>);
    if (r.awaitingGm) await s.gm.mutation(api.deathMoves.confirm, { characterId: s.a, idempotencyKey: key() });
    expect((await s.sheet()).hp).toBe(0);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [0, hpMax] });
  });

  it("death moves: Hope lost to an Avoid Death scar closing its slot is not Hope spent (dcm-z9rz.27)", async () => {
    const s = await setup();
    const hpMax = (await s.sheet()).hpMax;
    await s.edit(() => ({ hope: 6, scars: 0, hp: hpMax, stress: 3 }));
    const sessionId = await s.start();
    forceDice(1);
    const r = await s.player.mutation(api.deathMoves.choose, { characterId: s.a, move: "avoidDeath", idempotencyKey: key() });
    if (r.awaitingGm) await s.gm.mutation(api.deathMoves.confirm, { characterId: s.a, idempotencyKey: key() });
    const after = await s.sheet();
    expect(after.scars).toBe(1);
    // The scar closes a Hope slot, so the sixth Hope goes (applyResourceDelta clamps Hope to the slots left); nobody paid it.
    expect(after.hope).toBe(5);
    expect(await s.stats(sessionId)).toEqual({});
    // Hope paid after the scar still counts.
    await s.step("hope", -2);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [2, 0] });
  });

  it("a rest that clears Hit Points never subtracts", async () => {
    const s = await setup();
    const sessionId = await s.start();
    await s.step("hp", 4, s.gm, s.b);
    const { restId } = await s.gm.mutation(api.rests.start, { campaignId: s.campaignId, kind: "short", idempotencyKey: key() });
    await s.player.mutation(api.rests.choose, { restId, characterId: s.a, moves: [{ move: "clearStress" }, { move: "tendToWounds", targetId: s.b }], idempotencyKey: key() });
    await s.gm.mutation(api.rests.finish, { campaignId: s.campaignId, restId, idempotencyKey: key() });
    expect((await s.sheet(s.b)).hp).toBeLessThan(4);
    expect(await s.stats(sessionId)).toEqual({ [s.b]: [0, 4] });
  });

  it("undo takes the action's count back off the tally (dcm-z9rz.22); undoing a heal does not count again", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 2 }));
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    const roll = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [exp.id], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
    const spent = await s.player.mutation(api.rolls.manualRoll, { characterId: s.a, roll, values: [2, 9], idempotencyKey: key() });
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
    const row = await s.t.run(async (ctx) => (await ctx.db.get("actionLog", spent.entryId))!);
    expect(row.sessionTally).toEqual({ sessionId, hopeSpent: 1, hpMarked: 0 });
    await s.gm.mutation(api.actionLog.undo, { entryId: spent.entryId, idempotencyKey: key() });
    expect((await s.sheet()).hope).toBe(2);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [0, 0] });

    // Clear HP by a logged rest, then undo the rest: the HP come back marked without counting again.
    await s.edit(() => ({ hp: 4 }));
    const marked = { [s.a]: [0, 4] };
    expect(await s.stats(sessionId)).toEqual(marked);
    const { restId } = await s.gm.mutation(api.rests.start, { campaignId: s.campaignId, kind: "short", idempotencyKey: key() });
    await s.player.mutation(api.rests.choose, { restId, characterId: s.a, moves: [{ move: "tendToWounds" }, { move: "clearStress" }], idempotencyKey: key() });
    await s.gm.mutation(api.rests.finish, { campaignId: s.campaignId, restId, idempotencyKey: key() });
    expect((await s.sheet()).hp).toBeLessThan(4);
    await s.gm.mutation(api.rests.undo, { campaignId: s.campaignId, restId, idempotencyKey: key() });
    expect((await s.sheet()).hp).toBe(4);
    expect(await s.stats(sessionId)).toEqual(marked);
  });

  it("undo reverses exactly what each row of the group added, on its own session's row, never below 0 (dcm-z9rz.22)", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 5, hp: 0 }));
    await s.edit(() => ({ hope: 5, hp: 0 }), s.b);
    const sessionId = await s.start();
    // Counted before the action: stays after its undo.
    await s.step("hope", -1);
    await s.step("hp", 1, s.gm, s.b);
    // One action, two characters, two saves for A: each logged row takes what its character's saves counted.
    const entryId = await s.t.run(async (ctx) => {
      const groupId = newGroupId();
      const a = readSheet((await ctx.db.get("characters", s.a))!.sheet);
      const b = readSheet((await ctx.db.get("characters", s.b))!.sheet);
      await saveSheet(ctx, s.a, { ...a, hope: a.hope - 2 });
      await saveSheet(ctx, s.a, { ...a, hope: a.hope - 3, hp: a.hp + 2 });
      const id = await logAction(ctx, { campaignId: s.campaignId, characterId: s.a, actorId: s.w.users.gm, kind: "feature", visibility: "public", summary: "A", groupId, before: a, undoable: true });
      await saveSheet(ctx, s.b, { ...b, hp: b.hp + 3 });
      await logAction(ctx, { campaignId: s.campaignId, characterId: s.b, actorId: s.w.users.gm, kind: "feature", visibility: "public", summary: "B", groupId, before: b, undoable: true });
      return id;
    });
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [4, 2], [s.b]: [0, 4] });
    const rows = await s.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.find((r) => r.summary === "A")!.sessionTally).toEqual({ sessionId, hopeSpent: 3, hpMarked: 2 });
    expect(rows.find((r) => r.summary === "B")!.sessionTally).toEqual({ sessionId, hopeSpent: 0, hpMarked: 3 });

    // A row lowered by hand below the action's count floors at 0.
    await s.t.run(async (ctx) => {
      const row = (await ctx.db
        .query("sessionCharacterStats")
        .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId).eq("characterId", s.b))
        .unique())!;
      await ctx.db.patch("sessionCharacterStats", row._id, { hpMarked: 2 });
    });
    await s.gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0], [s.b]: [0, 0] });
  });

  it("a row written before the field has no sessionTally: its undo leaves the tally as it is (dcm-z9rz.22)", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 2 }));
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    const roll = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [exp.id], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
    const spent = await s.player.mutation(api.rolls.manualRoll, { characterId: s.a, roll, values: [2, 9], idempotencyKey: key() });
    // As stored before the widen: no `sessionTally`.
    await s.t.run((ctx) => ctx.db.patch("actionLog", spent.entryId, { sessionTally: undefined }));
    await s.gm.mutation(api.actionLog.undo, { entryId: spent.entryId, idempotencyKey: key() });
    expect((await s.sheet()).hope).toBe(2);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
  });

  it("an Experience on a roll with Hope counts the Hope paid, though the roll gives it back (dcm-z9rz.23)", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 2 }));
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    const roll = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [exp.id], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
    // Hope die 9, Fear die 2: with Hope, so the Hope paid comes straight back.
    const r = await s.player.mutation(api.rolls.manualRoll, { characterId: s.a, roll, values: [9, 2], idempotencyKey: key() });
    expect((await s.sheet()).hope).toBe(2);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
    // The roll still logs its `before`, so its undo takes the count back.
    await s.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [0, 0] });
  });

  it("a weapon attack's Experience on a roll with Hope counts the Hope paid (dcm-z9rz.23)", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 3 }));
    const { mapId, enemyTokenId } = await arena(s);
    const sessionId = await s.start();
    const exp = (await s.sheet()).experiences[0]!;
    // Hope die 12, Fear die 1: with Hope, so the Hope paid comes straight back.
    forceDice(12, 1);
    await s.player.mutation(api.combatActions.attack, {
      campaignId: s.campaignId,
      characterId: s.a,
      mapId,
      targetTokenIds: [enemyTokenId],
      slot: "primary",
      modifier: 0,
      experienceIds: [exp.id],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
    });
    expect((await s.sheet()).hope).toBe(3);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
  });

  it("Bolt Beacon: a card cost the roll's own Hope pays counts as spent (R8, dcm-z9rz.23)", async () => {
    const s = await setup();
    const cards = ["bolt-beacon"];
    await s.edit(() => ({ domainCards: { owned: cards, loadout: cards }, hope: 3 }));
    const { mapId, enemyTokenId } = await arena(s);
    const sessionId = await s.start();
    // Hope die 12, Fear die 1: a success with Hope; its Hope pays the success cost.
    forceDice(12, 1);
    const r = await s.player.mutation(api.combatCards.useCard, { campaignId: s.campaignId, characterId: s.a, mapId, cardId: "bolt-beacon", targetTokenIds: [enemyTokenId], choices: [], idempotencyKey: key() });
    expect(r.status).toBe("resolved");
    expect((await s.sheet()).hope).toBe(3);
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [1, 0] });
  });

  it("several saves in one mutation each count their own step; a caller may pass the stored character", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 5, hp: 0 }));
    const sessionId = await s.start();
    await s.t.run(async (ctx) => {
      const first = (await ctx.db.get("characters", s.a))!;
      const sheet = readSheet(first.sheet);
      await saveSheet(ctx, s.a, { ...sheet, hope: 4 }, first);
      const second = readSheet((await ctx.db.get("characters", s.a))!.sheet);
      await saveSheet(ctx, s.a, { ...second, hope: 2, hp: 1 });
    });
    expect(await s.stats(sessionId)).toEqual({ [s.a]: [3, 1] });
  });

  it("respects MAX_SESSION_CHARACTER_STATS: a full session gets no new row and the save still succeeds", async () => {
    const s = await setup();
    await s.edit(() => ({ hope: 5 }));
    const sessionId = await s.start();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < MAX_SESSION_CHARACTER_STATS; i++) {
        await ctx.db.insert("sessionCharacterStats", { campaignId: s.campaignId, sessionId, characterId: s.b, hopeSpent: 0, hpMarked: 0 });
      }
    });
    await s.step("hope", -1);
    expect((await s.sheet()).hope).toBe(4);
    const rows = await s.t.run((ctx) => ctx.db.query("sessionCharacterStats").collect());
    expect(rows).toHaveLength(MAX_SESSION_CHARACTER_STATS);
    expect(rows.some((r) => r.characterId === s.a)).toBe(false);
  });
});
