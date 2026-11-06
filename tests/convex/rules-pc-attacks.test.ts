/**
 * Plan rule-switches RC1 (docs/tasks/TASK-RULES-RC1.md): a PC's weapon attack and damaging card on the Combat Map follow
 * the campaign's rule modes. Manual rules post a GM-only `rule` note in the attack's group (undo takes it back).
 *
 * - C1 `conditionDice` (CB p.102: "While Hidden, any rolls against you have disadvantage" / "While you are Vulnerable,
 *   all rolls targeting you have advantage"). Manual: no die added; "Bandit is Vulnerable: add advantage?".
 * - M1 `lineOfSight` (CB p.104). Book: an unseen target is refused, cover adds disadvantage. Manual: nothing refused or
 *   added; "No line of sight to the Lurker" / "Bandit is behind cover: disadvantage?".
 * - D6 `minions` (CB p.201). Book: the attacker picks; variant `gmPicks` (not in the books, Q5 a): the GM picks; Manual:
 *   only the hit Minion falls, "Ash's 8 damage: defeat 8 more Minions? (in range: …)".
 * - D2 `resistance`, D8 `adversaryDefeated`, Massive Damage (RDM's pure functions get `ruleModesOf(campaign)`).
 *
 * Dice: the server's CSPRNG is stubbed (`dice`): Hope 10, Fear 3 (a success with Hope, never a critical), the weapon's
 * d8 shows 8; every value stays within its die (Hope / Fear d12, d6 edge dice, d8 damage).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { coverApplies } from "../../convex/lib/combatActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { damageRuleNotes, minionNote, minionPicker } from "../../src/lib/domain/combat-actions/damage";
import { sightRule } from "../../src/lib/domain/combat-actions/sight";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>() }));
vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});

const ABILITY = "deft-maneuvers";
/** A card attack: an Agility roll against the target's Difficulty, 1d8 physical damage on a hit. */
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [
    {
      id: "strike",
      name: "Strike",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 8 } }, type: "physical" }],
    },
  ],
};
injected.cards.set(CARD.cardId, CARD);

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn, then repeat (a value never above its die: callers pick them so). */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

type Modes = Partial<{
  conditionDice: "book" | "manual";
  lineOfSight: "book" | "manual";
  minions: "book" | "gmPicks" | "manual";
  resistance: "book" | "manual";
  adversaryDefeated: "book" | "manual";
  massiveDamage: boolean;
  hiddenEnds: "book" | "manual";
}>;
type Stats = { difficulty: number; major: number | null; severe: number | null; hpMax: number; stressMax: number };
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 2 };

/** The world, a live medium map with Ash at (5, 10) looking east, a running encounter, and the campaign's rule modes. */
async function arena(modes: Modes = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = (
    label: string,
    x: number,
    y: number,
    stats: Partial<Stats> = {},
    extra: { source?: { kind: "custom"; customId: Id<"customAdversaries"> }; minionCount?: number; conditions?: ("vulnerable" | "hidden")[]; resistance?: { physical: "none" | "resistant" | "immune"; magic: "none" | "resistant" | "immune" } } = {},
  ) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: extra.source ?? { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        ...(extra.minionCount !== undefined ? { minionCount: extra.minionCount } : {}),
        stats: { ...SOFT, ...stats },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: extra.conditions ?? [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
        ...(extra.resistance ? { resistance: extra.resistance } : {}),
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const minionBlock = () =>
    t.run((ctx) =>
      ctx.db.insert("customAdversaries", {
        campaignId,
        name: "Rat",
        tier: 1,
        type: "Minion",
        description: "",
        motives: "",
        difficulty: 1,
        thresholds: { major: null, severe: null },
        hp: 1,
        stress: 1,
        attack: { modifier: 0, name: "Bite", range: "Melee", damage: "1 phy" },
        experiences: [],
        features: [{ name: "Minion (1)", kind: "passive", text: "This adversary is defeated when they take any damage." }],
        createdAt: now,
        updatedAt: now,
      }),
    );
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  const attack = (targetTokenIds: Id<"combatTokens">[], c: Client = player) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const useCard = (targetTokenIds: Id<"combatTokens">[]) =>
    player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "strike", targetTokenIds, choices: [], idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, encounterId, enemy, minionBlock, instance, rows, notes, requests, attack, edit, useCard, undo };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

/** Every die of a roll stays within its sides (Hope / Fear d12, edge dice d6, damage d8). */
function diceInRange(roll: { dice: readonly { role: string; sides: number; value: number }[] }) {
  for (const d of roll.dice) {
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(d.sides);
  }
}

describe("pure helpers", () => {
  it("sightRule: Book refuses an unseen target and keeps cover; Manual refuses nothing, adds nothing and words the note", () => {
    expect(sightRule("Bandit", { lineOfSight: false, cover: false })).toEqual({ refused: true, cover: false, note: null });
    expect(sightRule("Bandit", { lineOfSight: true, cover: false }, "book", false)).toEqual({ refused: true, cover: false, note: null });
    expect(sightRule("Bandit", { lineOfSight: true, cover: true })).toEqual({ refused: false, cover: true, note: null });
    expect(sightRule("Bandit", { lineOfSight: false, cover: false }, "manual")).toEqual({ refused: false, cover: false, note: "No line of sight to the Bandit" });
    expect(sightRule("Bandit", { lineOfSight: true, cover: true }, "manual")).toEqual({ refused: false, cover: false, note: "Bandit is behind cover: disadvantage?" });
    expect(sightRule("Bandit", { lineOfSight: true, cover: false }, "manual")).toEqual({ refused: false, cover: false, note: null });
  });

  it("coverApplies reads M1 from the campaign: Book counts cover, Manual never", () => {
    const covered = [{ sight: { lineOfSight: true, cover: true } }];
    expect(coverApplies({ frameId: "core", ruleModes: undefined } as never, covered)).toBe(true);
    expect(coverApplies({ frameId: "core", ruleModes: { lineOfSight: "manual" } } as never, covered)).toBe(false);
  });

  it("minionPicker and the D6 / D2 / D8 notes", () => {
    expect([minionPicker(), minionPicker("gmPicks"), minionPicker("manual")]).toEqual(["attacker", "gm", null]);
    expect(minionNote("Ash", 7, 2, ["Rats", "Wolves"])).toBe("Ash's 7 damage: defeat 2 more Minions? (in range: Rats, Wolves)");
    expect(minionNote("Ash", 1, 1, [])).toBe("Ash's 1 damage: defeat 1 more Minion?");
    expect(damageRuleNotes("Bear", { resisted: "resistant", incoming: 17 })).toEqual([]);
    expect(damageRuleNotes("Bear", { resisted: "resistant", incoming: 17, resistanceApplied: false, lastHp: true })).toEqual([
      { ruleId: "resistance", summary: "Bear resists: halve? (17 taken in full; halved: 9)" },
      { ruleId: "adversaryDefeated", summary: "Bear marked its last HP: defeated?" },
    ]);
    expect(damageRuleNotes("Bear", { resisted: "immune", incoming: 5, resistanceApplied: false })).toEqual([{ ruleId: "resistance", summary: "Bear is immune: no damage? (5 taken in full)" }]);
  });
});

describe("C1 conditions change the dice (CB p.102)", () => {
  it("Book: a Vulnerable target gives the roll an advantage die, a Hidden one a disadvantage die; no note", async () => {
    dice(10, 3, 4, 8);
    const a = await arena();
    const soft = await a.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable"] });
    const r = resolved(await a.attack([soft.tokenId]));
    diceInRange(r.roll);
    expect(r.roll.dice.some((d) => d.role === "advantage")).toBe(true);
    const shade = await a.enemy("Shade", 6, 11, {}, { conditions: ["hidden"] });
    const h = resolved(await a.attack([shade.tokenId]));
    expect(h.roll.dice.some((d) => d.role === "disadvantage")).toBe(true);
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: no die is added; the GM gets the note in the attack's group, players never see it; undo takes it back", async () => {
    dice(10, 3, 4, 8);
    const a = await arena({ conditionDice: "manual" });
    const soft = await a.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable", "hidden"] });
    const r = resolved(await a.attack([soft.tokenId]));
    diceInRange(r.roll);
    expect(r.roll.dice.some((d) => d.role === "advantage" || d.role === "disadvantage")).toBe(false);
    const entry = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    const notes = await a.notes();
    expect(notes.map((n) => [n.ruleId, n.summary, n.visibility, n.groupId])).toEqual([
      ["conditionDice", "Bandit is Vulnerable: add advantage?", "gm", entry.groupId],
      ["conditionDice", "Bandit is Hidden: disadvantage?", "gm", entry.groupId],
    ]);
    const feed = await a.player.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(feed.page.some((x) => x.kind === "rule")).toBe(false);
    await a.undo(r.entryId);
    expect((await a.notes()).every((n) => n.undoneAt !== undefined)).toBe(true);
  });
});

describe("M1 line of sight and cover (CB p.104)", () => {
  it("Book: a target behind the attacker (not seen) is refused with nothing written", async () => {
    const a = await arena();
    const lurker = await a.enemy("Lurker", 4, 10);
    expect(await code(a.attack([lurker.tokenId]))).toBe("COMBAT_NO_LINE_OF_SIGHT");
    expect(await a.rows()).toEqual([]);
  });

  it("Manual: the attack goes through and the GM is told; an unseen token that isn't a target still answers COMBAT_NO_LINE_OF_SIGHT", async () => {
    dice(10, 3, 8);
    const a = await arena({ lineOfSight: "manual" });
    const lurker = await a.enemy("Lurker", 4, 10);
    const r = resolved(await a.attack([lurker.tokenId]));
    diceInRange(r.roll);
    expect(r.targets).toEqual([{ tokenId: lurker.tokenId, hit: true, defeated: false }]);
    const entry = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect((await a.notes()).map((n) => [n.ruleId, n.summary, n.groupId])).toEqual([["lineOfSight", "No line of sight to the Lurker", entry.groupId]]);
    const { tokenId: crate } = await a.gm.mutation(api.combatTokens.addCustom, { campaignId: a.campaignId, mapId: a.mapId, name: "Crate", hp: 3, side: "enemy", idempotencyKey: key() });
    await a.t.run((ctx) => ctx.db.patch("combatTokens", crate, { x: 4, y: 11 }));
    expect(await code(a.attack([crate]))).toBe("COMBAT_NO_LINE_OF_SIGHT");
  });
});

describe("D6 Minions (CB p.201)", () => {
  async function pack(modes: Modes) {
    dice(10, 3, 8);
    const a = await arena(modes);
    const customId = await a.minionBlock();
    const rats = await a.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 4 });
    const more = await a.enemy("More rats", 6, 9, { hpMax: 3, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 3 });
    return { a, rats, more };
  }

  it("Book: the attacker gets the offer and picks", async () => {
    const { a, rats, more } = await pack({});
    const r = resolved(await a.attack([rats.tokenId]));
    expect(r.minionOffer).not.toBeNull();
    expect(r.minionsForGm).toBeUndefined();
    const picked = await a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [more.instanceId], idempotencyKey: key() });
    expect(picked.status).toBe("resolved");
  });

  it("variant gmPicks (not in the books): the player learns how many; only the GM may pick; the hit Minion fell", async () => {
    const { a, rats, more } = await pack({ minions: "gmPicks" });
    const r = resolved(await a.attack([rats.tokenId]));
    expect(r.minionOffer).toBeNull();
    expect(r.minionsForGm).toBe(r.damage!.total);
    expect((await a.instance(rats.instanceId)).hp).toBe(1);
    const [offer] = (await a.requests()).filter((q) => q.payload.kind === "minionOffer");
    expect(offer!.payload).toMatchObject({ kind: "minionOffer", picker: "gm" });
    const gmView = await a.gm.query(api.combatRequestsReads.mine, { campaignId: a.campaignId });
    expect(gmView.some((v) => v.kind === "minionOffer" && v.entryId === r.entryId)).toBe(true);
    expect(await code(a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [more.instanceId], idempotencyKey: key() }))).toBe("FORBIDDEN");
    const picked = await a.gm.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [more.instanceId, more.instanceId], idempotencyKey: key() });
    expect(picked).toMatchObject({ status: "resolved", defeated: 2 });
    expect((await a.instance(more.instanceId)).hp).toBe(2);
  });

  it("Manual: no offer; only the hit Minion falls; the GM gets the count and the Minions in range", async () => {
    const { a, rats, more } = await pack({ minions: "manual" });
    const r = resolved(await a.attack([rats.tokenId]));
    expect(r.minionOffer).toBeNull();
    expect(r.minionsForGm).toBeUndefined();
    expect((await a.requests()).filter((q) => q.payload.kind === "minionOffer")).toEqual([]);
    expect((await a.instance(rats.instanceId)).hp).toBe(1);
    expect((await a.instance(more.instanceId)).hp).toBe(0);
    const total = r.damage!.total;
    const entry = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect((await a.notes()).map((n) => [n.ruleId, n.summary, n.groupId])).toEqual([["minions", `Ash's ${total} damage: defeat ${total} more Minions? (in range: Rats, More rats)`, entry.groupId]]);
  });
});

describe("damage modes on a PC's weapon attack (RDM functions, ruleModesOf passed in)", () => {
  it("D2: Book halves for a resistant target; Manual applies the full damage and tells the GM", async () => {
    dice(10, 3, 8);
    const book = await arena();
    const b = await book.enemy("Bandit", 6, 10, { major: 6, severe: 100, hpMax: 10 }, { resistance: { physical: "resistant", magic: "none" } });
    const rb = resolved(await book.attack([b.tokenId]));
    const total = rb.damage!.total;
    expect(total).toBeGreaterThanOrEqual(8);
    expect(Math.ceil(total / 2)).toBeLessThan(6);
    expect((await book.instance(b.instanceId)).hp).toBe(1);
    expect(await book.notes()).toEqual([]);

    const manual = await arena({ resistance: "manual" });
    const m = await manual.enemy("Bandit", 6, 10, { major: 6, severe: 100, hpMax: 10 }, { resistance: { physical: "resistant", magic: "none" } });
    const rm = resolved(await manual.attack([m.tokenId]));
    expect(rm.damage!.total).toBe(total);
    expect((await manual.instance(m.instanceId)).hp).toBe(2);
    expect((await manual.notes()).map((n) => [n.ruleId, n.summary])).toEqual([["resistance", `Bandit resists: halve? (${total} taken in full; halved: ${Math.ceil(total / 2)})`]]);
  });

  it("D8: Book defeats at the last HP; Manual leaves it up (public row says Hit) and tells the GM; undo takes the note back", async () => {
    dice(10, 3, 8);
    const book = await arena();
    const b = await book.enemy("Bandit", 6, 10, { hpMax: 1 });
    expect(resolved(await book.attack([b.tokenId])).targets[0]!.defeated).toBe(true);

    const manual = await arena({ adversaryDefeated: "manual" });
    const m = await manual.enemy("Bandit", 6, 10, { hpMax: 1 });
    const r = resolved(await manual.attack([m.tokenId]));
    expect(r.targets).toEqual([{ tokenId: m.tokenId, hit: true, defeated: false }]);
    expect(await manual.instance(m.instanceId)).toMatchObject({ hp: 1, defeated: false });
    const entry = (await manual.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect(entry.summary).toContain("Bandit: Hit");
    expect((await manual.notes()).map((n) => [n.ruleId, n.summary, n.groupId])).toEqual([["adversaryDefeated", "Bandit marked its last HP: defeated?", entry.groupId]]);
    await manual.undo(r.entryId);
    expect((await manual.notes()).every((n) => n.undoneAt !== undefined)).toBe(true);
    expect((await manual.instance(m.instanceId)).hp).toBe(0);
  });

  it("Massive Damage (optional, CB p.91): off marks 3 HP at Severe; on marks 4 at twice the Severe threshold", async () => {
    dice(10, 3, 8);
    const off = await arena();
    const o = await off.enemy("Bandit", 6, 10, { major: 1, severe: 2, hpMax: 10 });
    const ro = resolved(await off.attack([o.tokenId]));
    expect(ro.damage!.total).toBeGreaterThanOrEqual(4);
    expect((await off.instance(o.instanceId)).hp).toBe(3);

    const on = await arena({ massiveDamage: true });
    const n = await on.enemy("Bandit", 6, 10, { major: 1, severe: 2, hpMax: 10 });
    resolved(await on.attack([n.tokenId]));
    expect((await on.instance(n.instanceId)).hp).toBe(4);
    const gmRow = (await on.rows()).find((row) => row.kind === "combat" && row.visibility === "gm");
    expect(gmRow!.summary).toContain("Severe (Massive)");
  });
});

describe("C2 hiddenEnds on a weapon attack (CB p.42: \"After you make an attack … you are no longer Cloaked\")", () => {
  const sheetOf = (a: Awaited<ReturnType<typeof arena>>) => a.t.run(async (ctx) => readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet));

  it("Book: the attack ends an ordinary Cloaked; no note", async () => {
    dice(10, 3, 8);
    const a = await arena();
    await a.edit({ conditions: ["cloaked"] } as Partial<CharacterSheet>);
    const b = await a.enemy("Bandit", 6, 10);
    resolved(await a.attack([b.tokenId]));
    expect((await sheetOf(a)).conditions).not.toContain("cloaked");
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: the sheet keeps Cloaked and the GM gets the note in the attack's group", async () => {
    dice(10, 3, 8);
    const a = await arena({ hiddenEnds: "manual" });
    await a.edit({ conditions: ["cloaked"] } as Partial<CharacterSheet>);
    const b = await a.enemy("Bandit", 6, 10);
    const r = resolved(await a.attack([b.tokenId]));
    expect((await sheetOf(a)).conditions).toContain("cloaked");
    const entry = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    const [note] = await a.notes();
    expect(note).toMatchObject({ ruleId: "hiddenEnds", visibility: "gm", groupId: entry.groupId });
    expect(note!.summary).toMatch(/^Ash attacks with .+: remove Cloaked\?$/);
  });
});

describe("a damaging card (combatCards.useCard)", () => {
  async function caster(modes: Modes) {
    dice(10, 3, 8);
    const a = await arena(modes);
    await a.edit({ domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
    return a;
  }

  it("D8 Manual: the card's last HP leaves the adversary up and tells the GM in the use's group; Book defeats it", async () => {
    const book = await caster({});
    const b = await book.enemy("Bandit", 6, 10, { hpMax: 1 });
    const rb = await book.useCard([b.tokenId]);
    expect(rb.status).toBe("resolved");
    expect((await book.instance(b.instanceId)).defeated).toBe(true);

    const manual = await caster({ adversaryDefeated: "manual" });
    const m = await manual.enemy("Bandit", 6, 10, { hpMax: 1 });
    const r = await manual.useCard([m.tokenId]);
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.targets).toEqual([{ tokenId: m.tokenId, hit: true, defeated: false }]);
    expect(await manual.instance(m.instanceId)).toMatchObject({ hp: 1, defeated: false });
    const entry = (await manual.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect((await manual.notes()).filter((n) => n.ruleId === "adversaryDefeated").map((n) => [n.summary, n.groupId])).toEqual([["Bandit marked its last HP: defeated?", entry.groupId]]);
  });

  it("D6 on a card: gmPicks opens the GM's offer; Manual posts the note", async () => {
    const gmPicks = await caster({ minions: "gmPicks" });
    const customId = await gmPicks.minionBlock();
    const rats = await gmPicks.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 4 });
    const r = await gmPicks.useCard([rats.tokenId]);
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.minionOffer).toBeNull();
    expect(r.minionsForGm).toBeGreaterThan(0);
    expect((await gmPicks.requests()).find((q) => q.payload.kind === "minionOffer")!.payload).toMatchObject({ picker: "gm" });

    const manual = await caster({ minions: "manual" });
    const id2 = await manual.minionBlock();
    const rats2 = await manual.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId: id2 }, minionCount: 4 });
    const m = await manual.useCard([rats2.tokenId]);
    if (m.status !== "resolved") throw new Error(m.status);
    expect(m.minionOffer).toBeNull();
    expect((await manual.requests()).filter((q) => q.payload.kind === "minionOffer")).toEqual([]);
    expect((await manual.notes()).filter((n) => n.ruleId === "minions").map((n) => n.summary)).toEqual([expect.stringMatching(/^Ash's \d+ damage: defeat \d+ more Minions?\? \(in range: Rats\)$/)]);
  });
});
