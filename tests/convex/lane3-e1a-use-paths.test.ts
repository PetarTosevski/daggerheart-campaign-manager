/**
 * Plan lanes-2, wave 9, tracer E1.3a (docs/tasks/TASK-LN3-E1A.md): card and feature use paths. The SRD entries are
 * injected as fixtures named after the real cards (their ids give the card type: Flight and Bolt Beacon are spells,
 * Deft Maneuvers an ability), so the tests don't depend on the wave-9 data switches.
 *
 * Book texts (printed pages):
 * - Time Lock (CB p.333) "If a creature tries to move it, make a Spellcast Roll against them to maintain this spell"; a use
 *   whose `endEffect` names its own card (dcm-m48i, dcm-9nlr).
 * - Through Your Eyes (CB p.335): "until you cast another spell" (`castsSpell`, dcm-o44e via dcm-m48i).
 * - Veil of Night (CB p.336) / Dark Cloud (CB p.42): an area on a point the player picks (dcm-76l5 (3)).
 * - Marked for Death (HF p.8): "the current adversary Marked for Death is defeated" (dcm-uwg1 card half).
 * - Cloaked (CB p.42): "After you make an attack ... you are no longer Cloaked"; Vanishing Act's stays (dcm-bxp.99.19.67).
 * - CB p.107: riders on a feature's action roll (dcm-1kvg, dcm-3s6e); Fangs, HF p.39: "Make an attack using a trait".
 * - User 2026-10-30 (dcm-bxp.99.19.63): a rogue who is unconscious or dead drops Cloaked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>(), features: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

const n = (value: number) => ({ kind: "fixed" as const, value });
const brave = { classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation" } as const;
const ABILITY = "deft-maneuvers";
const SPELL_A = "flight";
const SPELL_B = "bolt-beacon";

/** An ability card with a lasting effect, the use that ends it, a point area, a Cloaked from a source, a trait attack. */
const ABILITY_CARD: CardEffect = {
  cardId: ABILITY,
  uses: [
    { id: "lock", name: "Lock", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Lock", mods: [], duration: "manual" }] },
    { id: "unlock", name: "Unlock", activation: { kind: "action" }, steps: [{ kind: "endEffect", to: "self", of: ABILITY, note: "The lock ends." }] },
    { id: "circle", name: "Circle", activation: { kind: "action" }, steps: [{ kind: "area", to: "self", area: { label: "Circle", centre: "point", radius: "veryClose", side: "all", duration: "scene" } }] },
    {
      id: "blast",
      name: "Blast",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [{ kind: "area", to: "self", area: { label: "Blast", centre: "point", radius: "veryClose", side: "all", duration: "scene" } }],
    },
    { id: "share", name: "Share", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Sighted", mods: [], duration: "nextRoll", sharedGrant: true }] },
    { id: "vanish", name: "Vanish", activation: { kind: "action" }, steps: [{ kind: "condition", to: "self", condition: { kind: "standard", condition: "cloaked" }, duration: "rest", endsOn: ["rollWithFear"] }] },
    {
      id: "strike",
      name: "Strike",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
    {
      id: "smite",
      name: "Smite",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "magic" }],
    },
  ],
};

/** A spell whose effect lasts until another spell is cast (Through Your Eyes, CB p.335). */
const SPELL_A_CARD: CardEffect = {
  cardId: SPELL_A,
  uses: [{ id: "main", name: "Eyes", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Eyes", mods: [], duration: "manual", endsOn: ["castsSpell"] }] }],
};
/** Another spell (a cast with nothing else to it). */
const SPELL_B_CARD: CardEffect = {
  cardId: SPELL_B,
  uses: [{ id: "main", name: "Spark", activation: { kind: "action" }, steps: [{ kind: "manual", to: "self", text: "A spark." }] }],
};

/** Marked for Death (HF p.8): the tag on the target, ended when that adversary is defeated. */
const MARKED: FeatureEffect = {
  featureId: "class:assassin:marked-for-death",
  source: "class",
  owner: "assassin",
  uses: [{ id: "main", name: "Marked for Death", activation: { kind: "action" }, steps: [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Marked for Death" }, duration: "rest", endsOn: ["targetDefeated"] }] }],
};

/** Fangs-like (HF p.39): a feature attack made with a trait roll, as one of the brave's foundation features. */
const BITE_ID = "subclass:call-of-the-brave:battle-ritual";
const BITE: FeatureEffect = {
  featureId: BITE_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [
    {
      id: "main",
      name: "Bite",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
    { id: "howl", name: "Howl", activation: { kind: "action" }, steps: [{ kind: "manual", to: "self", text: "A howl." }] },
  ],
};
/** A rider on an attack roll paid with a Hope (+2 to the roll), as the brave's other foundation feature. */
const STEADY_ID = "subclass:call-of-the-brave:courage";
const STEADY: FeatureEffect = {
  featureId: STEADY_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [
    {
      id: "main",
      name: "Steady",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
      costs: [{ kind: "hope", amount: n(1) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: n(2) } }],
    },
  ],
};

for (const c of [ABILITY_CARD, SPELL_A_CARD, SPELL_B_CARD]) injected.cards.set(c.cardId, c);
for (const f of [MARKED, BITE, STEADY]) injected.features.set(f.featureId, f);

afterEach(() => {
  vi.restoreAllMocks();
});

/** The next dice faces, in order (Hope Die first); 1 after them. */
function dice(faces: number[]) {
  const queue = [...faces];
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill((queue.shift() ?? 1) - 1)) as typeof crypto.getRandomValues);
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
  });
  const enemy = (label: string, x: number, y: number, extra: { hp?: number; tags?: string[] } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: 0,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: extra.hp ?? 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: extra.tags ?? [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const sheet = () => sheetOf(w.characterA);
  const editOf = (id: Id<"characters">, patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch });
    });
  const edit = (patch: Partial<CharacterSheet>) => editOf(w.characterA, patch);
  const card = (cardId: string, spell: string, extra: { targetTokenIds?: Id<"combatTokens">[]; point?: { x: number; y: number } } = {}) =>
    player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId, spell, targetTokenIds: extra.targetTokenIds ?? [], choices: [], ...(extra.point ? { point: extra.point } : {}), idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const areas = () => t.run(async (ctx) => (await ctx.db.query("combatAreas").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).take(50)).filter((a) => a.status === "active"));
  await edit({ ...brave, hope: 3, domainCards: { owned: [ABILITY, SPELL_A, SPELL_B], loadout: [ABILITY, SPELL_A, SPELL_B] } } as Partial<CharacterSheet>);
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, sheet, sheetOf, edit, editOf, card, undo, areas };
}

const labels = (s: CharacterSheet) => s.effects.map((e) => e.text.split("; ")[0]);

describe("E1.3a: a card use applies what it ends (dcm-m48i, dcm-9nlr)", () => {
  allowWorldEmails();

  it("an endEffect step on self ends the card's own effect, and the use's undo puts it back", async () => {
    const a = await arena();
    await a.card(ABILITY, "lock");
    expect(labels(await a.sheet())).toContain("Lock");
    const r = await a.card(ABILITY, "unlock");
    expect(labels(await a.sheet())).not.toContain("Lock");
    if (r.status !== "resolved") throw new Error(r.status);
    await a.undo(r.entryId);
    expect(labels(await a.sheet())).toContain("Lock");
  });

  it("casting a spell ends the caster's effect that lasts until another spell; casting an ability does not", async () => {
    const a = await arena();
    await a.card(SPELL_A, "main");
    expect(labels(await a.sheet())).toContain("Eyes");
    await a.card(ABILITY, "lock");
    expect(labels(await a.sheet())).toContain("Eyes");
    await a.card(SPELL_B, "main");
    expect(labels(await a.sheet())).not.toContain("Eyes");
    expect(labels(await a.sheet())).toContain("Lock");
  });
});

describe("E1.3a: a card's area on a picked square (dcm-76l5 (3), dcm-9nlr)", () => {
  allowWorldEmails();

  it("useCard takes `point` for a point area; without it the area is left for the table", async () => {
    const a = await arena();
    const r = await a.card(ABILITY, "circle", { point: { x: 7, y: 10 } });
    expect(r.status).toBe("resolved");
    const live = await a.areas();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ label: "Circle", featureId: ABILITY });
    const b = await arena();
    const r2 = await b.card(ABILITY, "circle");
    if (r2.status !== "resolved") throw new Error(r2.status);
    expect(r2.prompts.map((p) => p.text)).toContain("place Circle on the map by hand");
    expect(await b.areas()).toHaveLength(0);
  });
});

describe("orchestrator (dcm-0x2g): a held card use keeps its point and places the area on approval", () => {
  allowWorldEmails();

  it("an out-of-range card use stores `point`; the GM's approval places the area on it", async () => {
    const a = await arena();
    const far = await a.enemy("Far bear", 25, 10);
    const r = await a.card(ABILITY, "blast", { targetTokenIds: [far.tokenId], point: { x: 7, y: 10 } });
    if (r.status !== "pending") throw new Error(r.status);
    const stored = await a.t.run(async (ctx) => (await ctx.db.get("combatRequests", r.requestId))!.payload);
    expect(stored).toMatchObject({ kind: "sanction", action: { kind: "card", point: { x: 7, y: 10 } } });
    expect(await a.areas()).toHaveLength(0);
    const done = await a.gm.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() });
    expect(done.status).toBe("resolved");
    const live = await a.areas();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ label: "Blast", featureId: ABILITY });
  });
});

describe("E1.3a: card damage that defeats an adversary ends Marked for Death on any PC (dcm-uwg1)", () => {
  allowWorldEmails();

  it("another PC's Marked for Death on the defeated adversary ends in the use's group; undo restores it", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10, { hp: 9, tags: ["Marked for Death"] });
    const mark = { id: "marked-for-death", source: "Marked for Death", text: "Bear: +1d4 damage", until: "rest" as const };
    await a.editOf(a.w.characterB, { effects: [mark] });
    const r = await a.card(ABILITY, "smite", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.targets).toEqual([{ tokenId: bear.tokenId, hit: true, defeated: true }]);
    expect((await a.sheetOf(a.w.characterB)).effects).toEqual([]);
    await a.undo(r.entryId);
    expect((await a.sheetOf(a.w.characterB)).effects).toHaveLength(1);
  });
});

describe("E1.3a: a card's roll ends a shared grant on every party sheet (dcm-79v1 card half)", () => {
  allowWorldEmails();

  it("the roll spends the actor's copy and the other PC's copy ends in the same group; undo restores it", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    const shared = await a.card(ABILITY, "share");
    if (shared.status !== "resolved") throw new Error(shared.status);
    const copy = (await a.sheet()).effects.find((e) => e.text.startsWith("Sighted"));
    expect(copy).toBeDefined();
    await a.editOf(a.w.characterB, { effects: [{ ...copy!, id: `card:${ABILITY}:99` }] });
    const r = await a.card(ABILITY, "strike", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(labels(await a.sheet())).not.toContain("Sighted");
    expect((await a.sheetOf(a.w.characterB)).effects).toEqual([]);
    await a.undo(r.entryId);
    expect((await a.sheetOf(a.w.characterB)).effects).toHaveLength(1);
  });
});

describe("E1.3a: card and feature attacks end an ordinary Cloaked (dcm-bxp.99.19.67)", () => {
  allowWorldEmails();

  it("a card attack ends a plain Cloaked; a card that is no attack keeps it", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit({ conditions: ["cloaked"] });
    await a.card(ABILITY, "lock");
    expect((await a.sheet()).conditions).toContain("cloaked");
    await a.card(ABILITY, "strike", { targetTokenIds: [bear.tokenId] });
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });

  it("a Cloaked from a source (Vanishing Act) stays after a card attack", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.card(ABILITY, "vanish");
    expect((await a.sheet()).conditions).toContain("cloaked");
    dice([10, 3]); // with Hope: a roll with Fear would end it (CB p.42)
    await a.card(ABILITY, "strike", { targetTokenIds: [bear.tokenId] });
    expect((await a.sheet()).conditions).toContain("cloaked");
  });

  it("a feature attack (a trait roll marked attack) ends a plain Cloaked", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit({ conditions: ["cloaked"] });
    const r = await a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: BITE_ID, targetTokenIds: [bear.tokenId], choices: [], idempotencyKey: key() });
    expect(r.status).toBe("resolved");
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });
});

describe("E1.3a: riders on a feature's action roll (dcm-1kvg, dcm-3s6e)", () => {
  allowWorldEmails();

  const bite = (a: Awaited<ReturnType<typeof arena>>, target: Id<"combatTokens">, riders: { source: "feature"; id: string; choices: never[] }[] = [], useId?: string) =>
    a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: BITE_ID, ...(useId ? { useId } : {}), targetTokenIds: useId ? [] : [target], choices: [], ...(riders.length > 0 ? { riders } : {}), idempotencyKey: key() });

  it("a sent rider pays its Hope and adds to the feature's roll; one undo returns the Hope", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    const plain = await bite(a, bear.tokenId);
    if (plain.status !== "resolved" || plain.roll === null) throw new Error("plain");
    expect((await a.sheet()).hope).toBeGreaterThanOrEqual(2);
    await a.edit({ hope: 3 });
    dice([3, 10]);
    const ridden = await bite(a, bear.tokenId, [{ source: "feature", id: STEADY_ID, choices: [] }]);
    if (ridden.status !== "resolved" || ridden.roll === null) throw new Error("ridden");
    expect(ridden.roll.modifier).toBe(plain.roll.modifier + 2);
    expect(ridden.roll.outcome).toBe("successFear");
    // A roll with Fear gains no Hope: the paid Hope is gone.
    expect((await a.sheet()).hope).toBe(2);
    await a.undo(ridden.entryId);
    expect((await a.sheet()).hope).toBe(3);
  });

  it("riders on a feature use without an action roll are refused (INVALID)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    expect(errorCode(await bite(a, bear.tokenId, [{ source: "feature", id: STEADY_ID, choices: [] }], "howl").catch((e: unknown) => e))).toBe("INVALID");
  });
});

describe("E1.3a: Cloaked and conditions on the sheet (dcm-bxp.99.19.68, dcm-bxp.99.19.63)", () => {
  allowWorldEmails();

  it("clearing a condition by hand drops its source marker; Unconscious drops Cloaked", async () => {
    const a = await arena();
    await a.card(ABILITY, "vanish");
    const before = await a.sheet();
    expect(before.effects.some((e) => e.text === "cloaked")).toBe(true);
    await a.player.mutation(api.characters.toggleCondition, { characterId: a.w.characterA, condition: "cloaked" });
    const off = await a.sheet();
    expect(off.conditions).not.toContain("cloaked");
    expect(off.effects.some((e) => e.text === "cloaked")).toBe(false);
    await a.edit({ conditions: ["cloaked"] });
    await a.gm.mutation(api.characters.toggleCondition, { characterId: a.w.characterA, condition: "unconscious" });
    const down = await a.sheet();
    expect(down.conditions).toContain("unconscious");
    expect(down.conditions).not.toContain("cloaked");
  });

  it("Avoid Death drops Cloaked with the unconscious condition, in the death row (undo puts it back)", async () => {
    const a = await arena();
    const s = await a.sheet();
    await a.edit({ hp: s.hpMax, conditions: ["cloaked"] });
    // HD4 (answer 15b): the player's move waits for the GM; the GM's confirm makes it (and the GM undoes it).
    await a.player.mutation(api.deathMoves.choose, { characterId: a.w.characterA, move: "avoidDeath", idempotencyKey: key() });
    const r = await a.gm.mutation(api.deathMoves.confirm, { characterId: a.w.characterA, idempotencyKey: key() });
    const down = await a.sheet();
    expect(down.conditions).toContain("unconscious");
    expect(down.conditions).not.toContain("cloaked");
    await a.gm.mutation(api.deathMoves.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet()).conditions).toEqual(["cloaked"]);
  });
});
