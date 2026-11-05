/**
 * Plan lanes-2, wave 10, tracer E1.4a (docs/tasks/TASK-LN4-E1A.md): card and feature use paths round 4. The SRD entries
 * are injected as fixtures named after real cards (Deft Maneuvers, an ability), so the tests don't depend on data
 * switches.
 *
 * Book texts (printed pages):
 * - Cloaked (CB p.42): "After you make an attack ... you are no longer Cloaked"; CB p.99: "When you make an action roll
 *   with the intent to harm an adversary, you're making an attack roll". User 2026-10-31 (dcm-vx5n): any other action
 *   roll by a Cloaked PC that targets an enemy asks the GM "Does <name>'s Cloaked end?".
 * - Words of Discord (CB p.335): "the target must ... make an attack against another adversary" (dcm-svnq, dcm-9l9g).
 * - Transform (HF p.142): "While she embodies a form, she uses its statistics" (dcm-9l9g `changeForm`).
 * - Contacts Everywhere (CB p.43): gold given to a PC (dcm-tn8u gifts).
 * - Ill Omen (HF p.95): "their Fear Die gains a bonus equal to the amount of Fear you have" (dcm-m7tm); user answer
 *   2026-10-31: the bonus only decides Hope vs Fear, a tie is WITH FEAR.
 * - Lead by Example (CB p.342): "The next PC to make an attack against that adversary" (dcm-j5aw: the placing PC).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { gainFear } from "../../convex/lib/fear";
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
/** Ill Omen (HF p.95) as its data switch will read: a Fear Die bonus on every PC action roll (4 here, a fixed number). */
vi.mock("../../src/lib/srd/adversary-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/adversary-effects/index")>();
  const omen = {
    adversaryId: "owl-witch",
    feature: "Ill Omen",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "action" } },
        needsSpotlight: false,
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "modifyRoll", to: "targets", change: { kind: "dieBonus", die: "fear", amount: { kind: "fixed", value: 4 } } }],
      },
    ],
  };
  return { ...real, adversaryEffects: (id: string) => (id === "owl-witch" ? [omen] : real.adversaryEffects(id)) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

const n = (value: number) => ({ kind: "fixed" as const, value });
const brave = { classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation" } as const;
const ABILITY = "deft-maneuvers";
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
const AGILITY_5 = { kind: "trait" as const, trait: "agility" as const, difficulty: { kind: "fixed" as const, value: 5 } };

const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [
    // A non-attack action roll on an enemy: a debuff (the Cloaked prompt), a condition with entry fields (castWrites).
    {
      id: "hex",
      name: "Hex",
      activation: { kind: "action" },
      roll: AGILITY_5,
      targets: ONE_ENEMY,
      steps: [
        { kind: "condition", to: "targets", when: ["success"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary", escape: { trait: "strength", difficulty: n(12) } },
        { kind: "effect", to: "targets", when: ["success"], label: "Hexed", mods: [{ kind: "stat", stat: "difficulty", delta: n(-1) }], duration: "scene" },
      ],
    },
    // An attack (Cloaked ends by itself, no prompt).
    {
      id: "strike",
      name: "Strike",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
    // Words of Discord-like (CB p.335): the target attacks a creature the player picked.
    { id: "discord", name: "Discord", activation: { kind: "action" }, roll: AGILITY_5, targets: ONE_ENEMY, steps: [{ kind: "forcedAttack", to: "targets", when: ["success"], against: { side: "enemy", range: "unlimited", count: { kind: "one" } } }] },
    // Transform-like (HF p.142): the target takes another stat block.
    { id: "shift", name: "Shift", activation: { kind: "action" }, targets: ONE_ENEMY, steps: [{ kind: "changeForm", to: "targets", adversaryId: "dire-wolf" }] },
    // Contacts Everywhere-like (CB p.43): gold for the user.
    { id: "gift", name: "Gift", activation: { kind: "action" }, steps: [{ kind: "inventory", to: "self", op: "giveGold", amount: n(2) }] },
    // A lasting effect on the user (casterId).
    { id: "boon", name: "Boon", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Boon", mods: [], duration: "manual" }] },
  ],
};

/** Fangs-like (HF p.39): a feature attack with a trait roll; and a rider paid with a Hope (+2), as the brave's features. */
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
  const enemy = (label: string, x: number, y: number, adversaryId = "bear", token = true) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 0,
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
      const tokenId = token ? await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI }) : null;
      return { instanceId, tokenId: tokenId! };
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const card = (spell: string, extra: { targetTokenIds?: Id<"combatTokens">[]; choices?: { id: string; value: string[] }[] } = {}) =>
    player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell, targetTokenIds: extra.targetTokenIds ?? [], choices: extra.choices ?? [], idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const requests = (kind: string) => t.run(async (ctx) => (await ctx.db.query("combatRequests").withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "open")).take(50)).filter((r) => r.kind === kind));
  await edit({ ...brave, hope: 3, domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, sheet, edit, card, undo, instance, requests };
}

describe("E1.4a: the GM's Cloaked prompt (dcm-vx5n)", () => {
  allowWorldEmails();

  it("a Cloaked PC's non-attack roll on an enemy asks the GM; yes ends Cloaked in the use's group, undo puts it back", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit({ conditions: ["cloaked"] });
    dice([10, 3]);
    const r = await a.card("hex", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved") throw new Error(r.status);
    expect((await a.sheet()).conditions).toContain("cloaked");
    const rows = await a.gm.query(api.cloakPromptsReads.pending, { campaignId: a.campaignId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Deft Maneuvers", targets: [{ tokenId: bear.tokenId, name: "Bear" }] });
    const out = await a.gm.mutation(api.cloakPrompts.answer, { campaignId: a.campaignId, requestId: rows[0]!.requestId, ends: true, idempotencyKey: key() });
    expect(out.status).toBe("ended");
    expect((await a.sheet()).conditions).not.toContain("cloaked");
    expect(await a.gm.query(api.cloakPromptsReads.pending, { campaignId: a.campaignId })).toHaveLength(0);
    await a.undo(r.entryId);
    expect((await a.sheet()).conditions).toContain("cloaked");
  });

  it("no keeps Cloaked; an undone use declines its prompt; an attack opens no prompt (it ends Cloaked by itself)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit({ conditions: ["cloaked"] });
    dice([10, 3]);
    await a.card("hex", { targetTokenIds: [bear.tokenId] });
    const [first] = await a.requests("cloakPrompt");
    const no = await a.gm.mutation(api.cloakPrompts.answer, { campaignId: a.campaignId, requestId: first!._id, ends: false, idempotencyKey: key() });
    expect(no.status).toBe("declined");
    expect((await a.sheet()).conditions).toContain("cloaked");

    dice([10, 3]);
    const again = await a.card("hex", { targetTokenIds: [bear.tokenId] });
    if (again.status !== "resolved") throw new Error(again.status);
    const [second] = await a.requests("cloakPrompt");
    await a.undo(again.entryId);
    // Orchestrator (merge): the undo declines the prompt (`declineGroupOffers`); answering it after is REQUEST_NOT_OPEN.
    expect(await a.requests("cloakPrompt")).toHaveLength(0);
    const late = await a.gm.mutation(api.cloakPrompts.answer, { campaignId: a.campaignId, requestId: second!._id, ends: true, idempotencyKey: key() }).catch((e: unknown) => e);
    expect(errorCode(late)).toBe("REQUEST_NOT_OPEN");
    expect((await a.sheet()).conditions).toContain("cloaked");

    dice([10, 3]);
    await a.card("strike", { targetTokenIds: [bear.tokenId] });
    expect(await a.requests("cloakPrompt")).toHaveLength(0);
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });

  it("only the GM lists and answers the prompts (a player is FORBIDDEN)", async () => {
    const a = await arena();
    expect(errorCode(await a.player.query(api.cloakPromptsReads.pending, { campaignId: a.campaignId }).catch((e: unknown) => e))).toBe("FORBIDDEN");
  });
});

describe("E1.4a: who gave it (dcm-lztq card writer, dcm-j5aw writer half, dcm-svnq conditions)", () => {
  allowWorldEmails();

  it("a card's effect on its user carries the user as caster", async () => {
    const a = await arena();
    await a.card("boon");
    const boon = (await a.sheet()).effects.find((e) => e.text.startsWith("Boon"));
    expect(boon?.casterId).toBe(a.w.characterA);
  });

  it("a card's condition with entry fields and its effect on an enemy record the caster; undo takes them back", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    dice([10, 3]);
    const r = await a.card("hex", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved") throw new Error(r.status);
    const inst = await a.instance(bear.instanceId);
    expect(inst.conditions).toContain("restrained");
    const restrained = inst.effects?.find((e) => e.condition === "restrained");
    expect(restrained).toMatchObject({ casterId: a.w.characterA, escape: { traits: ["strength"], difficulty: 12 } });
    expect(inst.effects?.find((e) => e.label === "Hexed")?.casterId).toBe(a.w.characterA);
    await a.undo(r.entryId);
    expect((await a.instance(bear.instanceId)).effects ?? []).toHaveLength(0);
  });
});

describe("E1.4a: card plan hand-offs (dcm-tn8u, dcm-svnq, dcm-9l9g)", () => {
  allowWorldEmails();

  it("a forced attack makes the target's standard attack against the picked adversary; none picked is the GM's", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    const wolf = await a.enemy("Wolf", 7, 10);
    dice([10, 3]);
    const r = await a.card("discord", { targetTokenIds: [bear.tokenId], choices: [{ id: "picked", value: [wolf.tokenId] }] });
    if (r.status !== "resolved") throw new Error(r.status);
    const rows = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", a.campaignId)).order("desc").take(30)).filter((x) => x.kind === "adversary"));
    expect(rows.some((x) => x.summary.includes("Bear"))).toBe(true);
    dice([10, 3]);
    const gmPicks = await a.card("discord", { targetTokenIds: [bear.tokenId] });
    if (gmPicks.status !== "resolved") throw new Error(gmPicks.status);
    expect(gmPicks.prompts.map((p) => p.text)).toContain("Bear must make its standard attack against a target the GM picks");
  });

  it("a form change writes the instance's form modifier; undo takes it back", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    const r = await a.card("shift", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved") throw new Error(r.status);
    expect((await a.instance(bear.instanceId)).effects?.some((e) => e.form === "dire-wolf")).toBe(true);
    await a.undo(r.entryId);
    expect((await a.instance(bear.instanceId)).effects?.some((e) => e.form === "dire-wolf") ?? false).toBe(false);
  });

  it("a gift of gold is written on the sheet, not left as a prompt", async () => {
    const a = await arena();
    const before = (await a.sheet()).gold;
    const r = await a.card("gift");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.prompts.filter((p) => p.kind === "manual")).toHaveLength(0);
    expect((await a.sheet()).gold).not.toEqual(before);
  });
});

describe("E1.4a: adversary uses on a card roll (dcm-m7tm)", () => {
  allowWorldEmails();

  it("Ill Omen's Fear Die bonus turns a roll with Hope into one with Fear (the GM gains the Fear, no Hope)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.enemy("Owl Witch", 0, 0, "owl-witch", false);
    await a.t.run((ctx) => gainFear(ctx, a.campaignId, 4));
    await a.edit({ hope: 2 });
    dice([8, 5]);
    const r = await a.card("hex", { targetTokenIds: [bear.tokenId] });
    if (r.status !== "resolved" || r.roll === null) throw new Error(r.status);
    expect(r.roll.outcome).toBe("successFear");
    expect(r.roll.dice.find((d) => d.role === "fear")?.value).toBe(9);
    expect((await a.sheet()).hope).toBe(2);
    const gm = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", a.campaignId)).order("desc").take(30)).filter((x) => x.visibility === "gm"));
    expect(gm.some((x) => x.summary.includes("Ill Omen"))).toBe(true);
  });
});

describe("E1.4a: the feature sanction keeps its riders (dcm-mcgj)", () => {
  allowWorldEmails();

  it("an out-of-range feature use stores the sent riders; the GM's approval replays them (the Hope is paid)", async () => {
    const a = await arena();
    const far = await a.enemy("Far bear", 25, 10);
    const r = await a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: BITE_ID, targetTokenIds: [far.tokenId], choices: [], riders: [{ source: "feature", id: STEADY_ID, choices: [] }], idempotencyKey: key() });
    if (r.status !== "pending") throw new Error(r.status);
    const stored = await a.t.run(async (ctx) => (await ctx.db.get("combatRequests", r.requestId))!.payload);
    expect(stored).toMatchObject({ kind: "sanction", action: { kind: "feature", riders: [{ id: STEADY_ID }] } });
    dice([3, 10]);
    const done = await a.gm.mutation(api.combatFeatures.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() });
    if (done.status !== "resolved" || done.roll === null) throw new Error(done.status);
    expect(done.roll.outcome).toBe("successFear");
    expect((await a.sheet()).hope).toBe(2);
  });
});
