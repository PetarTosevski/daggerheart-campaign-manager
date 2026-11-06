/**
 * Rule switches RX (plan rule-switches; CB p.106; user answer Q8 a): X1 "Death move prompt" and X2 "Death moves resolve
 * themselves", Book and Manual, with Castle High's less-lethal rule (HF p.127) in every mode.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { partyMemberOf } from "../../convex/lib/combatHud";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

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

/** Counts the server's dice: `rollDie` reads one Uint32 per die. `faces` forces the next ones. */
function watchDice(...faces: number[]) {
  const real = crypto.getRandomValues.bind(crypto);
  const seen = { dice: 0 };
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1) {
      seen.dice += 1;
      if (faces.length > 0) {
        array[0] = faces.shift()! - 1;
        return array;
      }
    }
    return real(array as never) as T;
  });
  return seen;
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

type Modes = { prompt?: "book" | "manual"; resolve?: "book" | "manual" };

/** A GM and a player whose level-1 warrior Ash is at their last Hit Point, with the death rules set as asked. */
async function setup(modes: Modes = {}, frameId: "witherwild" | "castle-high" = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const edit = (change: (s: CharacterSheet) => CharacterSheet) => t.run(async (ctx) => saveSheet(ctx, a, change(readSheet((await ctx.db.get("characters", a))!.sheet))));
  await edit((s) => ({ ...s, hp: s.hpMax, stress: 3 }));
  if (modes.resolve) await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMoveResolve", value: modes.resolve } });
  if (modes.prompt) await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMovePrompt", value: modes.prompt } });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", a))!.sheet));
  const character = () => t.run(async (ctx) => (await ctx.db.get("characters", a))!);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const feed = (c: typeof gm) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  /** The player chooses; the GM confirms (HD4). */
  const play = async (move: "avoidDeath" | "riskItAll" | "blazeOfGlory", extra: { awayReason?: "infirmary" | "sentHome" } = {}) => {
    const r = await p1.mutation(api.deathMoves.choose, { characterId: a, move, ...extra, idempotencyKey: key() });
    expect(r.awaitingGm).toBe(true);
    return gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() });
  };
  return { t, gm, p1, campaignId, a, edit, sheet, character, rows, notes, feed, play };
}

describe("RX: X2 Death moves resolve themselves", () => {
  useAllowlist("gm@example.com,p1@example.com");
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Book: Avoid Death rolls the Hope Die and posts no note", async () => {
    const f = await setup();
    const dice = watchDice(1);
    const r = await f.play("avoidDeath");
    expect(r).toMatchObject({ hopeDie: 1, scarred: true });
    expect(dice.dice).toBe(1);
    expect((await f.sheet()).scars).toBe(1);
    expect(await f.notes()).toEqual([]);
  });

  it("Manual: Avoid Death rolls nothing, drops the PC unconscious and tells the GM what to roll", async () => {
    const f = await setup({ resolve: "manual" });
    const dice = watchDice();
    const r = await f.play("avoidDeath");
    expect(dice.dice).toBe(0);
    expect(r).toMatchObject({ hopeDie: null, fearDie: null, scarred: false, journeyEnds: false, pending: null, status: "active" });
    const s = await f.sheet();
    expect(s.conditions).toContain("unconscious");
    expect(s.scars).toBe(0);
    const move = (await f.rows()).find((row) => row._id === r.entryId)!;
    expect(move).toMatchObject({ kind: "death", visibility: "public" });
    expect(move.roll).toBeUndefined();
    expect(move.summary).toContain("Roll the Hope Die in the dice box");
    const [note, ...more] = await f.notes();
    expect(more).toEqual([]);
    expect(note).toMatchObject({ ruleId: "deathMoveResolve", visibility: "gm", groupId: move.groupId, summary: "Avoid Death (Ash): roll the Hope Die; scar at or under level 1." });
    expect((await f.feed(f.gm)).page.some((row) => row._id === note!._id)).toBe(true);
    expect((await f.feed(f.p1)).page.some((row) => row.kind === "rule")).toBe(false);
    expect((await f.p1.query(api.deathMoves.state, { characterId: f.a })).awaitingMove).toBe(false);

    // Undo takes back the move and its note; the death move is due again.
    await f.gm.mutation(api.deathMoves.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await f.sheet()).conditions).not.toContain("unconscious");
    expect((await f.notes())[0]!.undoneAt).toBeDefined();
    expect((await f.p1.query(api.deathMoves.state, { characterId: f.a })).awaitingMove).toBe(true);
  });

  it("Manual: Risk It All rolls nothing, changes nothing and asks no second time; undo makes it due again", async () => {
    const f = await setup({ resolve: "manual" });
    const before = await f.sheet();
    const dice = watchDice();
    const r = await f.play("riskItAll");
    expect(dice.dice).toBe(0);
    expect(r).toMatchObject({ hopeDie: null, fearDie: null, pending: null, status: "active" });
    const after = await f.sheet();
    expect({ hp: after.hp, stress: after.stress }).toEqual({ hp: before.hp, stress: before.stress });
    expect((await f.character()).status).toBe("active");
    expect((await f.p1.query(api.deathMoves.state, { characterId: f.a })).awaitingMove).toBe(false);
    const [note] = await f.notes();
    expect(note!.summary).toContain("Risk It All (Ash): roll the Duality Dice");
    expect(note!.summary).toContain("Fear higher: Ash dies");
    // The GM's own move is made at once (no request): it gets its own group, joined by the note.
    expect(note!.groupId).toBe((await f.rows()).find((row) => row._id === r.entryId)!.groupId);

    await f.gm.mutation(api.deathMoves.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await f.character()).deathMoveSpent).toBeUndefined();
    expect((await f.p1.query(api.deathMoves.state, { characterId: f.a })).awaitingMove).toBe(true);
  });

  it("Manual: the GM's own move groups the move and the note", async () => {
    const f = await setup({ resolve: "manual" });
    const r = await f.gm.mutation(api.deathMoves.choose, { characterId: f.a, move: "avoidDeath", idempotencyKey: key() });
    expect(r).toMatchObject({ awaitingGm: false, hopeDie: null });
    const move = (await f.rows()).find((row) => row._id === r.entryId)!;
    expect(move.groupId).toMatch(/^death-manual:/);
    expect((await f.notes())[0]!.groupId).toBe(move.groupId);
  });

  it("Manual: Blaze of Glory is the same in every mode", async () => {
    const f = await setup({ resolve: "manual" });
    const r = await f.play("blazeOfGlory");
    expect(r.pending).toEqual({ move: "blazeOfGlory" });
    expect(await f.notes()).toEqual([]);
  });

  it("less lethal (Castle High) still applies: Book sends the PC away on Fear; Manual's note says so", async () => {
    const book = await setup({}, "castle-high");
    await book.gm.mutation(api.campaigns.setOption, { campaignId: book.campaignId, option: "lessLethal", enabled: true });
    watchDice(2, 9);
    const r = await book.play("riskItAll", { awayReason: "sentHome" });
    expect(r.status).toBe("away");
    expect((await book.character()).away?.reason).toBe("sentHome");
    vi.restoreAllMocks();

    const manual = await setup({ resolve: "manual" }, "castle-high");
    await manual.gm.mutation(api.campaigns.setOption, { campaignId: manual.campaignId, option: "lessLethal", enabled: true });
    const m = await manual.play("riskItAll", { awayReason: "infirmary" });
    expect(m.status).toBe("active");
    expect((await manual.notes())[0]!.summary).toContain("goes to the infirmary or home instead of dying (less lethal)");
    expect((await manual.p1.query(api.deathMoves.state, { characterId: manual.a })).lessLethal).toBe(true);
  });
});

describe("RX: X1 Death move prompt", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it("Manual: nobody is asked, choose is refused, and a move waiting from before resolves by hand", async () => {
    const f = await setup();
    // A request made while X1 was Book (rule switches change only between sessions).
    await f.p1.mutation(api.deathMoves.choose, { characterId: f.a, move: "avoidDeath", idempotencyKey: key() });
    await f.gm.mutation(api.ruleSettings.set, { campaignId: f.campaignId, change: { key: "deathMovePrompt", value: "manual" } });
    const state = await f.p1.query(api.deathMoves.state, { characterId: f.a });
    expect(state.awaitingMove).toBe(false);
    expect(state.request).not.toBeNull();
    // X2 resolves to Manual while X1 is Manual (Q8 a).
    const r = await f.gm.mutation(api.deathMoves.confirm, { characterId: f.a, idempotencyKey: key() });
    expect(r.hopeDie).toBeNull();
    expect((await f.notes()).map((n) => n.ruleId)).toEqual(["deathMoveResolve"]);
  });

  it("Manual: choose is refused for the player and the GM", async () => {
    const f = await setup({ prompt: "manual" });
    expect(await codeOf(f.p1.mutation(api.deathMoves.choose, { characterId: f.a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    expect(await codeOf(f.gm.mutation(api.deathMoves.choose, { characterId: f.a, move: "riskItAll", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    for (const c of [f.p1, f.gm]) expect((await c.query(api.deathMoves.state, { characterId: f.a })).awaitingMove).toBe(false);
  });

  it("the HUD's deathMoveDue follows X1; the PC still shows down at 0 HP", async () => {
    const f = await setup();
    const member = (gm: boolean) =>
      f.t.run(async (ctx) => {
        const campaign = (await ctx.db.get("campaigns", f.campaignId))!;
        const user = (await ctx.db.query("users").collect()).find((u) => u.email === (gm ? "gm@example.com" : "p1@example.com"))!;
        return partyMemberOf(ctx, campaign, user, gm, "token" as Id<"combatTokens">, f.a);
      });
    expect(await member(false)).toMatchObject({ down: true, deathMoveDue: true });
    await f.gm.mutation(api.ruleSettings.set, { campaignId: f.campaignId, change: { key: "deathMovePrompt", value: "manual" } });
    expect(await member(false)).toMatchObject({ down: true, deathMoveDue: false });
    expect(await member(true)).toMatchObject({ down: true, deathMoveDue: false });
  });
});

describe("RX: X1 Manual on a hit that marks the last HP (incomingHits)", () => {
  allowWorldEmails();

  const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

  /** The Bear hits Ash, one HP from their last (any hit marks one); Ash marks no armor. */
  async function bearHitsAsh(prompt: "book" | "manual") {
    const w = await buildWorld();
    const { t, campaignId } = w;
    const gm = w.as("gm");
    const player = w.as("player");
    if (prompt === "manual") await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "deathMovePrompt", value: "manual" } });
    await t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, armorId: "chainmail-armor", armorMarked: 0, hp: s.hpMax - 1, stress: 0, effects: [EASY], domainCards: { owned: [], loadout: [] } });
    });
    const now = Date.now();
    const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
    const bear = await t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      }),
    );
    const attack = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: bear, targets: [w.characterA], idempotencyKey: key() });
    if (attack.status !== "resolved") throw new Error("expected resolved");
    const requestId = attack.targets[0]!.requestId!;
    const answer = await player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId: w.characterA, choice: { kind: "noArmor" }, idempotencyKey: key() });
    const rows = await t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
    const sheet = await t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    return { w, gm, player, answer, rows, sheet };
  }

  it("Book: the player is asked; no note", async () => {
    const { w, player, answer, rows } = await bearHitsAsh("book");
    expect(answer).toMatchObject({ status: "resolved", deathMove: true });
    expect(rows.find((r) => r.visibility === "public" && r.summary.startsWith("Ash took Bear's hit"))!.summary).toContain("must make a death move");
    expect(rows.filter((r) => r.kind === "rule")).toEqual([]);
    expect((await player.query(api.deathMoves.state, { characterId: w.characterA })).awaitingMove).toBe(true);
  });

  it("Manual: no prompt; the GM gets 'Ash marked their last HP' in the hit's group; the PC is at 0 HP", async () => {
    const { w, gm, player, answer, rows, sheet } = await bearHitsAsh("manual");
    expect(answer).toMatchObject({ status: "resolved", deathMove: true });
    expect(sheet.hp).toBe(sheet.hpMax);
    const pub = rows.find((r) => r.visibility === "public" && r.summary.startsWith("Ash took Bear's hit"))!;
    expect(pub.summary).toContain("marked their last Hit Point");
    expect(pub.summary).not.toContain("death move");
    const notes = rows.filter((r) => r.kind === "rule");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ruleId: "deathMovePrompt", visibility: "gm", characterId: w.characterA, groupId: pub.groupId });
    expect(notes[0]!.summary).toContain("Ash marked their last HP");
    for (const c of [player, gm]) expect((await c.query(api.deathMoves.state, { characterId: w.characterA })).awaitingMove).toBe(false);
    const playerFeed = await player.query(api.feed.list, { campaignId: w.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(playerFeed.page.some((r) => r.kind === "rule")).toBe(false);
  });
});
