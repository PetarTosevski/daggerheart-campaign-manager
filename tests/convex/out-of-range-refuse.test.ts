/**
 * Config R2 (plan config; docs/tasks/TASK-CONFIG-R2.md): out-of-range actions with the table setting
 * `tableSettings.outOfRange: "refuse"` (user answer Q2 a).
 *
 * - Core Rulebook p.103 (Range): "Anything beyond a character's Very Far range is Out of Range and usually can't be
 *   targeted." Whether a target outside the action's own band is refused or asked about is the table's choice.
 * - Refuse: a player's attack, card or feature whose target is outside its range throws COMBAT_TARGET_OUT_OF_RANGE (the
 *   message names the band); nothing is rolled, paid or logged and no request opens. A rider's extra target out of its
 *   range is dropped and the attack goes on. The GM or a co-GM acting for a PC is never refused (they keep the sanction).
 * - Ask (the default): today's GM sanction (`pending`), unchanged.
 *
 * Fixtures are injected (as in lane4-e1a-use-paths.test.ts) so the tests don't depend on data switches: a card with an
 * attack use within Far range, a feature attack within Far range and a before-roll rider paid with a Hope.
 */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

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
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
const ABILITY = "deft-maneuvers";
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [
    {
      id: "strike",
      name: "Strike",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
  ],
};
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
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
  ],
};
const STEADY_ID = "subclass:call-of-the-brave:courage";
const STEADY: FeatureEffect = {
  featureId: STEADY_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [{ id: "main", name: "Steady", activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } }, costs: [{ kind: "hope", amount: n(1) }], steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: n(2) } }] }],
};
injected.cards.set(CARD.cardId, CARD);
for (const f of [BITE, STEADY]) injected.features.set(f.featureId, f);

const STEADY_RIDER = [{ source: "feature" as const, id: STEADY_ID, choices: [] }];
/** Hold Them Off (CB p.38): "use that same roll against two additional adversaries within range of the attack." */
const holdThemOff = (tokenIds: Id<"combatTokens">[]) => [{ source: "feature" as const, id: "hope:ranger", choices: [{ id: "picked", value: tokenIds }] }];

/**
 * The world plus a live map: Ash (characterA, a Call of the Brave warrior holding the card) at (5, 10), a running
 * encounter. `near` is in Melee; `far` is at x = 25 (beyond Far: Very Far).
 */
async function arena(outOfRange: "ask" | "refuse" | "manual" = "refuse") {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  if (outOfRange !== "ask") await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "outOfRange", value: outOfRange } });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
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
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  /** What a refusal must leave untouched: action rows and combat requests. */
  const trail = () => t.run(async (ctx) => ({ rows: (await ctx.db.query("actionLog").collect()).length, requests: (await ctx.db.query("combatRequests").collect()).length }));
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key(), ...extra });
  const card = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "strike", targetTokenIds, choices: [], idempotencyKey: key(), ...extra });
  const feature = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: BITE_ID, targetTokenIds, choices: [], idempotencyKey: key(), ...extra } as never);
  await edit({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", hope: 5, domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
  return { w, t, campaignId, mapId, gm, player: handingBack(w.as("player"), gm, w.campaignId), enemy, sheet, edit, instance, trail, attack, card, feature };
}

/** The ConvexError's code and message (tests assert the code; the message is checked only for the band's name). */
async function refusal(p: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await p;
    return { code: "ok", message: "" };
  } catch (e) {
    const data = (e as { data?: { message?: string } }).data;
    return { code: errorCode(e), message: data?.message ?? "" };
  }
}

describe("config R2: Refuse out-of-range actions (Q2 a)", () => {
  allowWorldEmails();

  it("attack: a player's out-of-range target is refused with the band; nothing rolled, paid or logged", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    const before = await a.trail();
    const r = await refusal(a.attack(a.player, [far.tokenId]));
    expect(r.code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(r.message).toContain("Very Far");
    expect(await a.trail()).toEqual(before);
    expect((await a.sheet()).hope).toBe(5);
    expect((await a.instance(far.instanceId)).hp).toBe(0);
  });

  it("attack: an edit-grant player acting for the character is refused too (a player, not the GM)", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    expect((await refusal(a.attack(a.w.as("grantee"), [far.tokenId]))).code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
  });

  it("attack: the GM and a co-GM acting for the PC are not refused (they get today's sanction)", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    for (const who of [a.gm, a.w.as("coGm")]) {
      const r = await a.attack(who, [far.tokenId]);
      expect(r.status).toBe("pending");
    }
  });

  it("ask (the default): the player's out-of-range attack waits for the GM, as today", async () => {
    const a = await arena("ask");
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.player, [far.tokenId]);
    expect(r).toMatchObject({ status: "pending", outOfRange: [{ tokenId: far.tokenId, band: "veryFar" }] });
  });

  it("M4 Manual (WF): a player's out-of-range attack goes through now, with the GM's note in its group", async () => {
    const a = await arena("manual");
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.player, [far.tokenId]);
    expect(r.status).toBe("resolved");
    expect((await a.trail()).requests).toBe(0);
    const notes = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((x) => x.kind === "rule" && x.ruleId === "outOfRange"));
    expect(notes.map((n) => n.summary)).toEqual([`${(await a.sheet()).name} attacked Far out of range`]);
    expect(notes[0]!.groupId).toBeDefined();
  });

  it("M4 Manual (WF): a card use out of range resolves now with the GM's note", async () => {
    const a = await arena("manual");
    const far = await a.enemy("Far", 25, 10);
    const r = await a.card(a.player, [far.tokenId]);
    expect(r.status).toBe("resolved");
    const notes = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((x) => x.kind === "rule" && x.ruleId === "outOfRange"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.summary).toContain("on Far out of range");
  });

  it("rider: Hold Them Off's out-of-range extra target is dropped and the attack goes on; Hold Them Off isn't paid", async () => {
    const a = await arena();
    await a.edit({ classId: "ranger", subclassId: "wayfinder", hope: 5 } as Partial<CharacterSheet>);
    const one = await a.enemy("One", 6, 10);
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.player, [one.tokenId], { riders: holdThemOff([far.tokenId]) });
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    expect(r.targets.map((x) => x.tokenId)).toEqual([one.tokenId]);
    expect(r.riders ?? []).not.toContain("Hold Them Off");
    const gained = r.roll.outcome === "critical" || r.roll.outcome === "successHope" || r.roll.outcome === "failHope" ? 1 : 0;
    expect((await a.sheet()).hope).toBe(Math.min(6, 5 + gained));
    expect((await a.instance(far.instanceId)).hp).toBe(0);
    expect((await a.trail()).requests).toBe(0);
  });

  it("rider: an in-range extra target stays; only the out-of-range one is dropped", async () => {
    const a = await arena();
    await a.edit({ classId: "ranger", subclassId: "wayfinder", hope: 5 } as Partial<CharacterSheet>);
    const one = await a.enemy("One", 6, 10);
    const two = await a.enemy("Two", 6, 9);
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.player, [one.tokenId], { riders: holdThemOff([two.tokenId, far.tokenId]) });
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    if (!r.targets[0]!.hit) return; // Hold Them Off waits for a success (CB p.38).
    expect(r.targets.map((x) => x.tokenId)).toEqual([one.tokenId, two.tokenId]);
    expect((await a.instance(far.instanceId)).hp).toBe(0);
  });

  it("rider: the GM's attack keeps the sanction for an out-of-range extra target (not dropped)", async () => {
    const a = await arena();
    await a.edit({ classId: "ranger", subclassId: "wayfinder", hope: 5 } as Partial<CharacterSheet>);
    const one = await a.enemy("One", 6, 10);
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.gm, [one.tokenId], { riders: holdThemOff([far.tokenId]) });
    expect(r).toMatchObject({ status: "pending", outOfRange: [{ tokenId: far.tokenId }] });
  });

  it("card: a player's out-of-range card use is refused with the band; nothing rolled, paid or logged", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    const before = await a.trail();
    const r = await refusal(a.card(a.player, [far.tokenId]));
    expect(r.code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(r.message).toContain("Very Far");
    expect(await a.trail()).toEqual(before);
    expect((await a.sheet()).hope).toBe(5);
  });

  it("card with a rider: refused before the rider's Hope is paid", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    const before = await a.trail();
    expect((await refusal(a.card(a.player, [far.tokenId], { riders: STEADY_RIDER }))).code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(await a.trail()).toEqual(before);
    expect((await a.sheet()).hope).toBe(5);
  });

  it("card: the GM and a co-GM acting for the PC get the sanction; ask keeps it for the player", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    for (const who of [a.gm, a.w.as("coGm")]) expect((await a.card(who, [far.tokenId])).status).toBe("pending");
    expect((await a.card(a.gm, [far.tokenId], { riders: STEADY_RIDER })).status).toBe("pending");
    const ask = await arena("ask");
    const far2 = await ask.enemy("Far", 25, 10);
    expect((await ask.card(ask.player, [far2.tokenId])).status).toBe("pending");
  });

  it("feature: a player's out-of-range feature use is refused with the band; nothing rolled, paid or logged", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    const before = await a.trail();
    const r = await refusal(a.feature(a.player, [far.tokenId]));
    expect(r.code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(r.message).toContain("Very Far");
    expect(await a.trail()).toEqual(before);
  });

  it("feature with a rider: refused before the rider's Hope is paid", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    const before = await a.trail();
    expect((await refusal(a.feature(a.player, [far.tokenId], { riders: STEADY_RIDER }))).code).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(await a.trail()).toEqual(before);
    expect((await a.sheet()).hope).toBe(5);
  });

  it("feature: the GM and a co-GM acting for the PC get the sanction; ask keeps it for the player", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    for (const who of [a.gm, a.w.as("coGm")]) expect(((await a.feature(who, [far.tokenId])) as { status: string }).status).toBe("pending");
    expect(((await a.feature(a.gm, [far.tokenId], { riders: STEADY_RIDER })) as { status: string }).status).toBe("pending");
    const ask = await arena("ask");
    const far2 = await ask.enemy("Far", 25, 10);
    expect(((await ask.feature(ask.player, [far2.tokenId])) as { status: string }).status).toBe("pending");
  });

  it("in range: refuse changes nothing (attack, card and feature resolve)", async () => {
    const a = await arena();
    const near = await a.enemy("Near", 6, 10);
    expect((await a.attack(a.player, [near.tokenId])).status).toBe("resolved");
    expect((await a.card(a.player, [near.tokenId])).status).toBe("resolved");
    expect(((await a.feature(a.player, [near.tokenId])) as { status: string }).status).toBe("resolved");
  });
});

/** Plan rule-switches WF: R7 Help an Ally on card and feature rolls (CB p.90), the helper picker of the dice box. */
describe("R7 on card and feature rolls (WF)", () => {
  allowWorldEmails();

  const hopeOf = (a: Awaited<ReturnType<typeof arena>>, id: Id<"characters">) => a.t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet).hope);
  const setHope = (a: Awaited<ReturnType<typeof arena>>, id: Id<"characters">, hope: number) =>
    a.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, hope });
    });

  it("Book: a named helper pays 1 Hope with the card's rows; undo refunds it", async () => {
    const a = await arena("ask");
    const near = await a.enemy("Near", 6, 10);
    await setHope(a, a.w.characterB, 2);
    const r = await a.card(a.player, [near.tokenId], { roll: { helpers: [a.w.characterB] } });
    expect(r.status).toBe("resolved");
    expect(await hopeOf(a, a.w.characterB)).toBe(1);
    const row = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((x) => x.characterId === a.w.characterB && x.summary.includes("helped")));
    expect(row?.groupId).toBeDefined();
    await a.gm.mutation(api.actionLog.undo, { entryId: row!._id, idempotencyKey: key() });
    expect(await hopeOf(a, a.w.characterB)).toBe(2);
  });

  it("Book refuses the bare counter and a helper with no Hope, before anything is written", async () => {
    const a = await arena("ask");
    const near = await a.enemy("Near", 6, 10);
    const before = await a.trail();
    expect((await refusal(a.card(a.player, [near.tokenId], { roll: { help: 1 } }))).code).toBe("DICE_RULE");
    await setHope(a, a.w.characterB, 0);
    expect((await refusal(a.card(a.player, [near.tokenId], { roll: { helpers: [a.w.characterB] } }))).code).toBe("NOT_ENOUGH_HOPE");
    expect((await refusal(a.feature(a.player, [near.tokenId], { roll: { helpers: [a.w.characterB] } }))).code).toBe("NOT_ENOUGH_HOPE");
    expect(await a.trail()).toEqual(before);
  });

  it("Manual: the counter adds its dice, no Hope taken, the GM's note", async () => {
    const a = await arena("ask");
    await a.gm.mutation(api.ruleSettings.set, { campaignId: a.campaignId, change: { key: "helpAnAlly", value: "manual" } });
    const near = await a.enemy("Near", 6, 10);
    await setHope(a, a.w.characterB, 2);
    expect((await a.card(a.player, [near.tokenId], { roll: { help: 2 } })).status).toBe("resolved");
    expect(await hopeOf(a, a.w.characterB)).toBe(2);
    const notes = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((x) => x.kind === "rule" && x.ruleId === "helpAnAlly").map((x) => x.summary));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("2 PCs helped");
  });
});
