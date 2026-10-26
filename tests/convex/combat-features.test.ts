/**
 * Features on the Combat Map sheet drawer (plan sheet-drawer SD3; docs/tasks/TASK-SD-SD3.md): the drawer, the refusals,
 * repeat activation (CB p.107), the Q13 confirmation, effects on enemy instances (Make a Scene) with public and GM rows
 * and undo (U1, U4), D5 delegation (Rally with Epic Poetry's d10), the GM's sanction, Flying (Q16), stances and Refocus
 * (Q5, HF p.12), per-target limit keys, and one feature per group table that has entries. Role checks: authz/features.*.
 *
 * The FE-* tables fill the real entries in parallel, so these tests inject their own entries (each named after the feature
 * it stands in for, with the book's numbers); the table-driven block at the end runs the real tables.
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { expandedLimitKey, storedLimitKey, USE_KEY_MAX } from "../../convex/lib/featureRunner";
import { featureLimitKey } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION } from "../../src/lib/srd/feature-effects/classification";
import { SUBCLASSES } from "../../src/lib/srd/subclasses";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const injected = vi.hoisted(() => ({ on: true, entries: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.on ? (injected.entries.get(id) as FeatureEffect | undefined) : undefined) ?? real.featureEffect(id) };
});

const hope = (value: number) => ({ kind: "hope" as const, amount: { kind: "fixed" as const, value } });

/** Frontline Tank (CB p.36): "Spend 3 Hope to clear 2 Armor Slots." */
const FRONTLINE_TANK: FeatureEffect = {
  featureId: "hope:guardian",
  source: "hope",
  owner: "guardian",
  uses: [{ id: "main", name: "Frontline Tank", activation: { kind: "action" }, costs: [hope(3)], targets: { side: "self", range: "unlimited", count: { kind: "one" } }, steps: [{ kind: "clear", to: "self", track: "armor", amount: { kind: "fixed", value: 2 } }] }],
};

/** Make a Scene (CB p.29): "Spend 3 Hope to temporarily Distract a target within Close range, giving them a −2 penalty to their Difficulty." (melee here, to test the range.) */
const MAKE_A_SCENE: FeatureEffect = {
  featureId: "hope:bard",
  source: "hope",
  owner: "bard",
  uses: [
    {
      id: "main",
      name: "Make a Scene",
      activation: { kind: "action" },
      costs: [hope(3)],
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [
        { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Distracted" }, duration: "temporary" },
        { kind: "effect", to: "targets", label: "Distracted", mods: [{ kind: "stat", stat: "difficulty", delta: { kind: "fixed", value: -2 } }], duration: "temporary" },
      ],
    },
  ],
};

/** Rally (CB p.28) delegated to D5, with Epic Poetry's d10 (CB p.29: "Your Rally Die increases to a d10"). */
const RALLY: FeatureEffect = {
  featureId: "class:bard:rally",
  source: "class",
  owner: "bard",
  uses: [{ id: "main", name: "Rally", activation: { kind: "action" }, steps: [{ kind: "delegate", to: "self", feature: "rally" }] }],
  upgrades: [{ when: { kind: "feature", featureId: "subclass:wordsmith:epic-poetry" }, patch: { dieSides: 10 }, note: "Epic Poetry" }],
};

/** Dedicated (CB p.75): "Once per rest, when you describe how you're embodying one of these principles …" (Q13). */
const DEDICATED_TEXT = "You embody one of your principles";
const DEDICATED: FeatureEffect = {
  featureId: "community:orderborne:dedicated",
  source: "community",
  owner: "orderborne",
  uses: [{ id: "main", name: "Dedicated", activation: { kind: "action" }, requires: [{ kind: "situation", text: DEDICATED_TEXT }], limit: { per: "rest" }, steps: [{ kind: "manual", to: "self", text: "Roll a d20 as your Hope Die." }] }],
};

for (const e of [FRONTLINE_TANK, MAKE_A_SCENE, RALLY, DEDICATED]) injected.entries.set(e.featureId, e);

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const STAT_KEYS = ["hp", "hpMax", "stress", "stressMax", "difficulty", "major", "severe", "thresholds", "adversaryBefore"];
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  await t.run(async (ctx) => {
    const c = (await ctx.db.get("campaigns", campaignId))!;
    await ctx.db.patch("campaigns", campaignId, { options: { ...c.options, hopeAndFear: true } });
  });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ash = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 6, y: 11, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 12, major: 100, severe: 200, hpMax: 5, stressMax: 3 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const use = (c = player, featureId: string, extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, featureId, targetTokenIds: [], choices: [], idempotencyKey: key(), ...extra } as never);
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, rows, use };
}

type Arena = Awaited<ReturnType<typeof arena>>;
const asGuardian = (a: Arena, extra: Partial<CharacterSheet> = {}) => a.edit(() => ({ classId: "guardian", subclassId: "stalwart", subclassRank: "foundation", ...extra }));
const asBard = (a: Arena, extra: Partial<CharacterSheet> = {}) => a.edit(() => ({ classId: "bard", subclassId: "wordsmith", subclassRank: "foundation", ...extra }));

function resolved(r: unknown) {
  const x = r as { status: string };
  if (x.status !== "resolved") throw new Error(`expected a resolved use, got ${x.status}`);
  return r as { entryId: Id<"actionLog">; notes: string[]; targets: { hit: boolean }[]; fearDelta: number };
}

describe("combatFeatures.useFeature: refusals", () => {
  allowWorldEmails();

  it("refuses a feature not owned, an out-of-combat feature, a missing map and an unpaid cost", async () => {
    const a = await arena();
    // A warrior holds no Guardian Hope feature.
    expect(await code(a.use(a.player, "hope:guardian"))).toBe("FEATURE_NOT_OWNED");
    // Wordsmith's Heart of a Poet is out-of-combat (SD0 classification, Q15).
    await asBard(a, { hope: 0 });
    expect(await code(a.use(a.player, "subclass:wordsmith:heart-of-a-poet"))).toBe("FEATURE_NOT_COMBAT");
    // Make a Scene targets an enemy: without a map it needs one.
    expect(await code(a.use(a.player, "hope:bard"))).toBe("FEATURE_NEEDS_MAP");
    // With the map and no Hope: refused before any roll (CB p.90).
    const bandit = await a.enemy("Bandit", 6, 10);
    expect(await code(a.use(a.player, "hope:bard", { mapId: a.mapId, targetTokenIds: [bandit.tokenId] }))).toBe("FEATURE_COST_UNPAID");
    expect((await a.rows()).filter((r) => r.kind === "combat")).toHaveLength(0);
  });

  it("Q13: a situation the engine can't see needs the player's confirmation; once per rest then exhausted", async () => {
    const a = await arena();
    await a.edit(() => ({ communityId: "orderborne" }));
    expect(await code(a.use(a.player, "community:orderborne:dedicated"))).toBe("INVALID");
    resolved(await a.use(a.player, "community:orderborne:dedicated", { choices: [{ id: "situations", value: [DEDICATED_TEXT] }] }));
    expect((await a.sheet()).featureUses).toContainEqual({ key: "feat:community:orderborne:dedicated", until: "rest" });
    expect(await code(a.use(a.player, "community:orderborne:dedicated", { choices: [{ id: "situations", value: [DEDICATED_TEXT] }] }))).toBe("FEATURE_EXHAUSTED");
    // CB p.107: a feature with a limit is not repeated (times).
    await a.edit(() => ({ featureUses: [] }));
    expect(await code(a.use(a.player, "community:orderborne:dedicated", { choices: [{ id: "situations", value: [DEDICATED_TEXT] }, { id: "times", value: 2 }] }))).toBe("INVALID");
  });
});

describe("combatFeatures.useFeature: resolving", () => {
  allowWorldEmails();

  it("Frontline Tank twice for 6 Hope clears 4 Armor Slots without a map (CB p.107); undo restores the sheet", async () => {
    const a = await arena();
    await asGuardian(a, { hope: 6, armorMarked: 4 });
    const r = resolved(await a.use(a.player, "hope:guardian", { choices: [{ id: "times", value: 2 }] }));
    const after = await a.sheet();
    expect(after.hope).toBe(0);
    expect(after.armorMarked).toBe(0);
    const row = (await a.rows()).find((x) => x._id === r.entryId)!;
    expect(row.summary).toContain("Frontline Tank ×2");
    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet()).hope).toBe(6);
    expect((await a.sheet()).armorMarked).toBe(4);
  });

  it("Make a Scene: Distracted and Difficulty −2 on the instance, a GM row with adversaryBefore, no stat for the player, undo", async () => {
    const a = await arena();
    await asBard(a, { hope: 3 });
    const bandit = await a.enemy("Bandit", 6, 10);
    const r = resolved(await a.use(a.player, "hope:bard", { mapId: a.mapId, targetTokenIds: [bandit.tokenId] }));
    expect(keysOf(r).filter((k) => STAT_KEYS.includes(k))).toEqual([]);
    const inst = await a.instance(bandit.instanceId);
    expect(inst.tags).toContain("Distracted");
    expect(inst.effects).toEqual([expect.objectContaining({ id: "feat:hope:bard:1", difficulty: -2, source: "Make a Scene" })]);
    expect((await a.sheet()).hope).toBe(0);
    const all = await a.rows();
    const groupId = all.find((y) => y._id === r.entryId)!.groupId;
    const group = all.filter((x) => x.groupId !== undefined && x.groupId === groupId);
    const gmRow = group.find((x) => x.visibility === "gm")!;
    expect(gmRow.adversaryBefore).toHaveLength(1);
    const publicRow = group.find((x) => x._id === r.entryId)!;
    expect(publicRow.summary).toMatch(/Bandit: (Hit|Miss|Defeated)/);
    expect(publicRow.summary).not.toMatch(/Difficulty|\d+\/\d+/);
    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    const back = await a.instance(bandit.instanceId);
    expect(back.tags).toEqual([]);
    expect(back.effects ?? []).toEqual([]);
    expect((await a.sheet()).hope).toBe(3);
  });

  it("Rally through D5 in the same mutation: Rally Dice for the party at d10 with Epic Poetry, the feed says d10, D5's key exhausts it", async () => {
    const a = await arena();
    await asBard(a, { subclassRank: "mastery" });
    const r = resolved(await a.use(a.player, "class:bard:rally"));
    expect(r.notes.join(" ")).toContain("(d10)");
    expect((await a.sheet()).heldDice).toEqual([expect.objectContaining({ kind: "rally", sides: 10 })]);
    expect((await a.sheet(a.w.characterB)).heldDice).toEqual([expect.objectContaining({ kind: "rally", sides: 10 })]);
    expect((await a.sheet()).featureUses.map((u) => u.key)).toContain("rally");
    expect(await code(a.use(a.player, "class:bard:rally"))).toBe("FEATURE_EXHAUSTED");
    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet(a.w.characterB)).heldDice).toEqual([]);
  });

  it("out of range: the GM's sanction (combat-actions Q1); pending lists it; approval resolves for the player", async () => {
    const a = await arena();
    await asBard(a, { hope: 3 });
    const far = await a.enemy("Archer", 9, 10);
    const r = (await a.use(a.player, "hope:bard", { mapId: a.mapId, targetTokenIds: [far.tokenId] })) as { status: string; requestId: Id<"combatRequests"> };
    expect(r.status).toBe("pending");
    expect((await a.sheet()).hope).toBe(3);
    const mine = await a.player.query(api.combatFeatures.pending, { campaignId: a.campaignId });
    expect(mine).toEqual([expect.objectContaining({ featureId: "hope:bard", featureName: "Make a Scene" })]);
    expect(keysOf(mine).filter((k) => STAT_KEYS.includes(k))).toEqual([]);
    resolved(await a.gm.mutation(api.combatFeatures.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() }));
    expect((await a.sheet()).hope).toBe(0);
    expect(await a.player.query(api.combatFeatures.pending, { campaignId: a.campaignId })).toEqual([]);
  });
});

describe("combatFeatures.drawer", () => {
  allowWorldEmails();

  it("trackers, every owned feature with its state and badges; other players only while hands are shared; no enemy field", async () => {
    const a = await arena();
    await asGuardian(a, { hope: 2 });
    const d = await a.player.query(api.combatFeatures.drawer, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(d.trackers.hope.value).toBe(2);
    const tank = d.features.find((f) => f.featureId === "hope:guardian")!;
    expect(tank).toMatchObject({ source: "hope", automated: true, state: "ready" });
    expect(tank.uses[0]).toMatchObject({ costs: ["3 Hope"], limit: null, repeatable: true });
    expect(d.features.find((f) => f.featureId === "subclass:stalwart:unwavering")?.state).toBe("passive");
    expect(d.flying).toBe(false);
    expect(d.canFly).toBe(false);
    expect(keysOf(d).filter((k) => ["difficulty", "adversaryBefore", "thresholds"].includes(k))).toEqual([]);
    // Another player: shared by default, refused once the hand is hidden.
    await a.w.as("otherPlayer").query(api.combatFeatures.drawer, { campaignId: a.campaignId, characterId: a.w.characterA });
    await a.player.mutation(api.combatCards.setHandHidden, { campaignId: a.campaignId, characterId: a.w.characterA, hidden: true });
    expect(await code(a.w.as("otherPlayer").query(api.combatFeatures.drawer, { campaignId: a.campaignId, characterId: a.w.characterA }))).toBe("FORBIDDEN");
  });

  it("an exhausted feature shows its reset label (Q3)", async () => {
    const a = await arena();
    await a.edit(() => ({ communityId: "orderborne", featureUses: [{ key: "feat:community:orderborne:dedicated", until: "rest" }] }));
    const d = await a.player.query(api.combatFeatures.drawer, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(d.features.find((f) => f.featureId === "community:orderborne:dedicated")).toMatchObject({ state: "exhausted", resetLabel: "Back after a rest" });
  });
});

describe("Flying (Q16), stances and Refocus (Q5, HF p.12)", () => {
  allowWorldEmails();

  it("setFlying needs a flying feature; it toggles a sheet effect, undoable", async () => {
    const a = await arena();
    expect(await code(a.player.mutation(api.combatFeatures.setFlying, { campaignId: a.campaignId, characterId: a.w.characterA, flying: true, idempotencyKey: key() }))).toBe("FEATURE_NOT_OWNED");
    await a.edit(() => ({ ancestry: { kind: "single", id: "faerie" } }));
    await a.player.mutation(api.combatFeatures.setFlying, { campaignId: a.campaignId, characterId: a.w.characterA, flying: true, idempotencyKey: key() });
    expect((await a.sheet()).effects.map((e) => e.id)).toContain("flying");
    const d = await a.player.query(api.combatFeatures.drawer, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(d).toMatchObject({ flying: true, canFly: true });
    await a.player.mutation(api.combatFeatures.setFlying, { campaignId: a.campaignId, characterId: a.w.characterA, flying: false, idempotencyKey: key() });
    expect((await a.sheet()).effects.map((e) => e.id)).not.toContain("flying");
  });

  it("shiftStance spends a Focus (Flow State: a Stress); refocus rolls Instinct d6s once per rest", async () => {
    const a = await arena();
    const shift = (stance: string, payWith?: "focus" | "stress") =>
      a.player.mutation(api.combatFeatures.shiftStance, { campaignId: a.campaignId, characterId: a.w.characterA, stance, ...(payWith ? { payWith } : {}), idempotencyKey: key() });
    expect(await code(shift("quick"))).toBe("FEATURE_STATE_MISSING");
    await a.edit((s) => ({ classId: "brawler", subclassId: "martial-artist", subclassRank: "foundation", traits: { ...s.traits, instinct: 2 }, classState: { martial: { known: ["quick", "reliable"], focus: 1 } } }));
    expect(await code(shift("honed"))).toBe("FEATURE_NOT_OWNED");
    await shift("quick");
    expect((await a.sheet()).classState.martial).toMatchObject({ active: "quick", focus: 0 });
    expect(await code(shift("quick"))).toBe("INVALID");
    expect(await code(shift("reliable"))).toBe("FEATURE_COST_UNPAID");
    expect(await code(shift("reliable", "stress"))).toBe("FEATURE_NOT_OWNED");

    const refocus = (calm: boolean) => a.player.mutation(api.combatFeatures.refocus, { campaignId: a.campaignId, characterId: a.w.characterA, calm, idempotencyKey: key() });
    expect(await code(refocus(false))).toBe("INVALID");
    const r = await refocus(true);
    expect(r.dice).toHaveLength(2);
    expect(r.focus).toBe(Math.max(...r.dice));
    expect((await a.sheet()).classState.martial?.focus).toBe(r.focus);
    expect(await code(refocus(true))).toBe("FEATURE_EXHAUSTED");
  });
});

describe("per-target limit keys (SD1 open point 4)", () => {
  it("stay within the 80-character cap for the longest feature ids and read back for the same target", () => {
    const longest = Object.keys(FEATURE_CLASSIFICATION).reduce((a, b) => (b.length > a.length ? b : a));
    const target = "k57a9qmw1z3x7v2d8f0h6j4n2p8r5t1y";
    // The main use, and a use id of a few letters ("fire": Elemental Incarnation's channels, CB p.31).
    expect(storedLimitKey(featureLimitKey(longest, "fire", target), [target]).length).toBeLessThanOrEqual(USE_KEY_MAX);
    const raw = featureLimitKey(longest, undefined, target);
    expect(raw.length).toBeGreaterThan(USE_KEY_MAX);
    const stored = storedLimitKey(raw, [target]);
    expect(stored.length).toBeLessThanOrEqual(USE_KEY_MAX);
    expect(expandedLimitKey(stored, [target])).toBe(raw);
    expect(expandedLimitKey(stored, ["another-target-id"])).toBe(stored);
    expect(storedLimitKey("feat:hope:bard", [target])).toBe("feat:hope:bard");
  });
});

describe("one feature per group table (the real tables)", () => {
  allowWorldEmails();

  it("every table with entries runs its first action use through useFeature without a server error", async () => {
    const { FEATURE_EFFECT_TABLES } = await import("../../src/lib/srd/feature-effects/index");
    injected.on = false;
    try {
      for (const [group, table] of Object.entries(FEATURE_EFFECT_TABLES)) {
        const entry = table.find((e) => e.uses.some((u) => u.activation.kind === "action"));
        if (entry === undefined) continue;
        const a = await arena();
        await a.edit((s) => sheetFor(entry, s));
        const outcome = await code(a.use(a.player, entry.featureId, { mapId: a.mapId }));
        // Resolved, or refused by a domain code (cost, choices, targets): never an unexpected server error.
        expect(typeof outcome === "string" && outcome !== "UNKNOWN", `${group}: ${entry.featureId} → ${String(outcome)}`).toBe(true);
      }
    } finally {
      injected.on = true;
    }
  });
});

/** A sheet that holds the entry's feature. */
function sheetFor(entry: FeatureEffect, s: CharacterSheet): Partial<CharacterSheet> {
  const base = { hope: 6 };
  switch (entry.source) {
    case "hope":
    case "class":
      return { ...base, classId: entry.owner };
    case "subclass":
      return { ...base, classId: SUBCLASSES.find((x) => x.id === entry.owner)?.classId ?? s.classId, subclassId: entry.owner, subclassRank: "mastery" };
    case "ancestry":
      return { ...base, ancestry: { kind: "single", id: entry.owner } };
    case "community":
      return { ...base, communityId: entry.owner };
    case "transformation":
      return { ...base, transformationId: entry.owner };
    case "stance":
      return { ...base, classState: { ...s.classState, martial: { known: [entry.featureId.split(":")[2]!], focus: 6 } } };
    case "beastform":
      return base;
  }
}
