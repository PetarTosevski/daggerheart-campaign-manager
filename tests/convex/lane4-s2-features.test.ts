/**
 * Plan lanes-2, wave 10, tracer S2.4 (docs/tasks/TASK-LN4-S2.md): the feature-effect data switched this wave runs through
 * the real server paths with the real SRD entries (no injected fixtures).
 *
 * Book texts (printed pages):
 * - Marked for Death (HF p.8): "This condition lasts until you take a rest, the current adversary Marked for Death is
 *   defeated, or the GM spends a number of Fear equal to your tier to clear it."
 * - Defensive stance (HF p.12): "Attack rolls targeting you from within Melee range have disadvantage unless the attacker
 *   marks a Stress to negate the disadvantage."
 * - Reliable Backup (CB p.43): "When you make a Presence Roll in conversation, they back you up. You can roll a d20 as
 *   your Hope Die."
 * - Contacts Everywhere (CB p.43): "They provide 1 handful of gold, a unique tool, or a mundane object that the situation
 *   requires."
 * - Armored Shell (CB p.33): "While in your shell, physical damage is reduced by a number equal to your Armor Score
 *   (after applying resistance)."
 * - Otherworldly Ire (HF p.15): "spend any number of Favor to roll that many Patron Dice and target a number of creatures
 *   within Close range equal to the highest result. Each target must mark a Hit Point."
 * - Prayer Dice (CB p.44): "You can spend any number of Prayer Dice … or gain Hope equal to the result."
 * - Spirit Weapon (CB p.44): "it can fly from your hand to attack an adversary within Close range … You can mark a Stress
 *   to target an additional adversary within range with the same attack roll."
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { featureActor } from "../../convex/lib/adversaryHits";
import { MARKED_FOR_DEATH_EFFECT, endOnDefeat, gmFearForEffect } from "../../convex/lib/cardRows";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { queueRng } from "../../src/lib/domain/dice";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { RANGER_ROGUE_SITUATIONS } from "../../src/lib/srd/feature-effects/ranger-rogue";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

/** The server's next dice (`rollDie` maps a random word w to w % sides + 1); later dice stay random. */
function serverDice(...values: number[]) {
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
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

/**
 * The world plus a live map: Ash (characterA) at (5, 10), Bryn (characterB) at (8, 10), a running encounter; `enemy`
 * adds an instance and its token.
 */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  // S2 (plan rule-switches RS2): the GM hands the spotlight back before each act (`handingBack`).
  const player = handingBack(w.as("player"), gm, w.campaignId);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const pc = (characterId: Id<"characters">, x: number) => ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId }, side: "pc", x, y: 10, face: 0 });
    const ash = await pc(w.characterA, 5);
    const bryn = await pc(w.characterB, 8);
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, adversaryId = "bear") =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 6 },
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
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const sheet = () => sheetOf(w.characterA);
  const editOf = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) => editOf(w.characterA, patch);
  const use = (featureId: string, extra: Record<string, unknown> = {}) =>
    player.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId, targetTokenIds: [], choices: [], idempotencyKey: key(), ...extra } as never);
  const roll = (who: "player" | "otherPlayer", characterId: Id<"characters">, extra: Record<string, unknown>) =>
    handingBack(w.as(who), gm, w.campaignId).mutation(api.rolls.actionRoll, {
      characterId,
      kind: "action",
      trait: "presence",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      attack: false,
      options: [],
      idempotencyKey: key(),
      ...extra,
    } as never);
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, sheetOf, edit, editOf, use, roll };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved use, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

const label = (e: Effect) => e.text.split("; ")[0];

// ---------------------------------------------------------------- Marked for Death (dcm-qxb6, dcm-mvoo, dcm-kmr)

describe("S2.4: Marked for Death ends on its own adversary's defeat (real entry)", () => {
  const marked = (target?: string): Effect => ({ id: MARKED_FOR_DEATH_EFFECT, source: "Marked for Death", text: "Marked for Death (+1d4)", until: "rest", ...(target ? { targetInstanceId: target, casterId: "a1" } : {}) });
  const base = { name: "Ash", level: 1, effects: [] as Effect[], domainCards: { owned: [], loadout: [] } } as unknown as CharacterSheet;
  const bear = { _id: "bear" as Id<"encounterAdversaries">, tags: ["Marked for Death"] };

  it("the defeat of the named instance ends it; another instance's leaves it; the tier Fear end stays", () => {
    expect(endOnDefeat({ ...base, effects: [marked("bear")] }, bear).ended).toHaveLength(1);
    expect(endOnDefeat({ ...base, effects: [marked("wolf")] }, bear).ended).toEqual([]);
    // A mark without a named instance: the tag link (E6.4).
    expect(endOnDefeat({ ...base, effects: [marked()] }, bear).ended).toHaveLength(1);
    expect(gmFearForEffect({ ...base, effects: [marked()] }, MARKED_FOR_DEATH_EFFECT)).toBe(1);
    expect(gmFearForEffect({ ...base, level: 5, effects: [marked()] }, MARKED_FOR_DEATH_EFFECT)).toBe(3);
  });

  it("the entry carries no endsWhen reminder any more", () => {
    const step = featureEffect("class:assassin:marked-for-death")!.uses[0]!.steps[0]!;
    expect(step).toMatchObject({ kind: "condition", endsOn: ["targetDefeated", "gmSpendsFear"] });
    expect("endsWhen" in step).toBe(false);
  });
});

// ---------------------------------------------------------------- Defensive stance (dcm-eut)

describe("S2.4: Defensive stance on an adversary's attack (dcm-eut)", () => {
  const defensive = (s: CharacterSheet): Partial<CharacterSheet> => ({
    classId: "brawler",
    subclassId: "martial-artist",
    subclassRank: "foundation",
    classState: { ...s.classState, martial: { focus: 0, known: ["defensive"], active: "defensive" } },
  });
  const attack = (a: Awaited<ReturnType<typeof arena>>, instanceId: Id<"encounterAdversaries">, extra: Record<string, unknown> = {}) =>
    a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId, targets: [a.w.characterA], idempotencyKey: key(), ...extra });
  const lastGmRow = (a: Awaited<ReturnType<typeof arena>>) => a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.visibility === "gm" && r.roll !== undefined).at(-1)!);
  const d20s = (row: { roll?: { dice: { sides: number; role: string }[] } }) => (row.roll?.dice ?? []).filter((d) => d.sides === 20).length;

  it("from Melee: disadvantage (two d20s) and the buy-off offered; paid: one d20 and the attacker marks a Stress", async () => {
    const a = await arena();
    await a.edit(defensive);
    const bear = await a.enemy("Bear", 6, 10);
    serverDice(10, 5);
    await attack(a, bear.instanceId);
    vi.restoreAllMocks();
    const row = await lastGmRow(a);
    expect(d20s(row)).toBe(2);
    expect(JSON.stringify(row)).toContain("could pay 1 Stress");
    expect((await a.instance(bear.instanceId)).stress).toBe(0);

    await attack(a, bear.instanceId, { buyOffs: ["stance:martial-artist:defensive"] });
    expect(d20s(await lastGmRow(a))).toBe(1);
    expect((await a.instance(bear.instanceId)).stress).toBe(1);
  });

  it("from beyond Melee: no disadvantage, nothing offered", async () => {
    const a = await arena();
    await a.edit(defensive);
    const far = await a.enemy("Far", 12, 10);
    await attack(a, far.instanceId);
    const row = await lastGmRow(a);
    expect(d20s(row)).toBe(1);
    expect(JSON.stringify(row)).not.toContain("could pay");
  });
});

// ---------------------------------------------------------------- Contacts Everywhere / Reliable Backup (dcm-h1y9, dcm-hqk1)

const CONTACTS = "subclass:syndicate:contacts-everywhere";
const syndicate = (rank: "specialization" | "mastery") => (): Partial<CharacterSheet> => ({ classId: "rogue", subclassId: "syndicate", subclassRank: rank });

describe("S2.4: Contacts Everywhere's supply gives the gift (dcm-h1y9)", () => {
  it("gold: 1 handful written to the sheet; an item: nothing written (the GM's pick)", async () => {
    const a = await arena();
    await a.edit(() => ({ ...syndicate("specialization")(), gold: { handfuls: 0, bags: 0, chest: false } }));
    resolved(await a.use(CONTACTS, { choices: [{ id: "opt:benefit", value: ["supply"] }, { id: "opt:supply", value: ["gold"] }] }));
    expect((await a.sheet()).gold.handfuls).toBe(1);

    const b = await arena();
    await b.edit(() => ({ ...syndicate("specialization")(), gold: { handfuls: 0, bags: 0, chest: false } }));
    const before = (await b.sheet()).inventory;
    resolved(await b.use(CONTACTS, { choices: [{ id: "opt:benefit", value: ["supply"] }, { id: "opt:supply", value: ["item"] }] }));
    expect((await b.sheet()).gold.handfuls).toBe(0);
    expect((await b.sheet()).inventory).toEqual(before);
  });

  it("the supply pick is asked when it is missing", async () => {
    const a = await arena();
    await a.edit(syndicate("specialization"));
    const r = await a.use(CONTACTS, { choices: [{ id: "opt:benefit", value: ["supply"] }] });
    expect(r.status).toBe("needsChoice");
  });
});

describe("S2.4: Reliable Backup's d20 Hope Die on a Presence Roll in conversation (dcm-hqk1)", () => {
  const backup = (s: CharacterSheet) => s.effects.filter((e) => label(e) === "Contacts Everywhere: d20 Hope Die in conversation");

  it("marked in conversation: the Hope Die is a d20 and the backup ends; unmarked: a d12 and it waits", async () => {
    const a = await arena();
    await a.edit(syndicate("mastery"));
    resolved(await a.use(CONTACTS, { choices: [{ id: "opt:benefit", value: ["backup"] }] }));
    expect(backup(await a.sheet())).toHaveLength(1);

    const plain = await a.roll("player", a.w.characterA, {});
    expect(plain.roll.dice.find((d: { role: string }) => d.role === "hope")!.sides).toBe(12);
    expect(backup(await a.sheet())).toHaveLength(1);

    const talk = await a.roll("player", a.w.characterA, { situations: [RANGER_ROGUE_SITUATIONS.conversation] });
    expect(talk.roll.dice.find((d: { role: string }) => d.role === "hope")!.sides).toBe(20);
    expect(backup(await a.sheet())).toEqual([]);
  });

  it("the old backup rider is gone", () => {
    expect(featureEffect(CONTACTS)!.uses.map((u) => u.id)).not.toContain("backup");
  });
});

// ---------------------------------------------------------------- Armored Shell (dcm-i9c1)

describe("S2.4: Armored Shell reduces physical damage by the Armor Score (dcm-i9c1)", () => {
  it("the window's actor reads the sheet's Armor Score into the reduction", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "druid", subclassId: "warden-of-the-elements", level: 3, stress: 0, hope: 4 }));
    await a.gm.mutation(api.classFeatures.use, { characterId: a.w.characterA, featureKey: "beastform", params: { choice: "armored-sentry" }, idempotencyKey: key() });
    // Retract into the shell through the real use (it marks an Armor Slot and writes the "retracted" effect).
    resolved(await a.use("beastform:armored-sentry:armored-shell", { useId: "retract" }));
    const s = await a.sheet();
    const actor = featureActor("pc", s);
    const armor = actor.stats!.armorScore;
    expect(armor).toBeGreaterThan(0);
    const entry = featureEffect("beastform:armored-sentry:armored-shell")!;
    const out = runFeature(entry, "shell", { actor, gmFear: 0, rng: queueRng([]), trigger: { amount: 10, damageType: "physical" } } as never);
    if (!out.ok) throw new Error(`refused: ${out.reason} ${out.detail}`);
    // The window folds the reduction into the hit: the amount is the sheet's Armor Score, not 0.
    expect(out.plan.steps).toContainEqual(expect.objectContaining({ kind: "fold", amount: armor, step: expect.objectContaining({ kind: "reduceDamage" }) }));
    expect(out.plan.steps.some((st) => st.kind === "prompt" && st.prompt === "manual")).toBe(false);
  });
});

// ---------------------------------------------------------------- Otherworldly Ire (dcm-q3t1, dcm-szfg)

describe("S2.4: Otherworldly Ire rolls its count first and each target marks a Hit Point", () => {
  const IRE = "subclass:pact-of-the-wrathful:otherworldly-ire";
  const SITUATION = { id: "situations", value: ["You just took damage"] };

  it("2 Favor: the Patron Dice show 1 and 2, the use takes up to 2 enemies within Close, each marks 1 HP", async () => {
    const a = await arena();
    await a.edit((s) => ({ classId: "warlock", subclassId: "pact-of-the-wrathful", subclassRank: "mastery", classState: { ...s.classState, favor: 3 } }));
    const x = await a.enemy("X", 6, 10);
    const y = await a.enemy("Y", 6, 11);
    const z = await a.enemy("Z", 6, 9);
    serverDice(1, 2);
    const rolled = await a.player.mutation(api.featurePrompts.rollCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: IRE, choices: { favor: 2 }, idempotencyKey: key() });
    vi.restoreAllMocks();
    expect(rolled.count).toBe(2);
    expect((await a.sheet()).classState.favor).toBe(1);

    expect(await code(a.use(IRE, { targetTokenIds: [x.tokenId, y.tokenId, z.tokenId], choices: [{ id: "n:favor", value: 2 }, SITUATION] }))).not.toBe("ok");
    resolved(await a.use(IRE, { targetTokenIds: [x.tokenId, y.tokenId], choices: [{ id: "n:favor", value: 2 }, SITUATION] }));
    expect((await a.instance(x.instanceId)).hp).toBe(1);
    expect((await a.instance(y.instanceId)).hp).toBe(1);
    expect((await a.instance(z.instanceId)).hp).toBe(0);
    // Paid once, at the roll.
    expect((await a.sheet()).classState.favor).toBe(1);
  });
});

// ---------------------------------------------------------------- Prayer Dice picks (dcm-ef77)

describe("S2.4: Prayer Dice spend the dice the player picks (dcm-ef77, no data change)", () => {
  it("gain Hope equal to the picked die's value; the other die stays", async () => {
    const a = await arena();
    await a.edit(() => ({
      classId: "seraph",
      subclassId: "divine-wielder",
      subclassRank: "foundation",
      hope: 0,
      heldDice: [
        { id: "p1", kind: "prayer", sides: 4, value: 1, until: "session" },
        { id: "p2", kind: "prayer", sides: 4, value: 4, until: "session" },
      ],
    }));
    resolved(await a.use("class:seraph:prayer-dice", { useId: "hope", targetTokenIds: [a.ash], choices: [{ id: "n:dice", value: 1 }, { id: "heldDicePicks", value: ["p2"] }] }));
    const s = await a.sheet();
    expect(s.hope).toBe(4);
    expect(s.heldDice.map((d) => d.id)).toEqual(["p1"]);
  });
});

// ---------------------------------------------------------------- Spirit Weapon / Sacred Resonance (dcm-xbtw)

describe("S2.4: Spirit Weapon and Sacred Resonance are the Attack bar's box (dcm-xbtw)", () => {
  it("no rider is left to offer them a second time", () => {
    for (const id of ["subclass:divine-wielder:spirit-weapon", "subclass:divine-wielder:sacred-resonance"]) {
      expect(featureEffect(id)!.uses.every((u) => u.activation.kind === "passive" && (u.mods ?? []).length === 0 && u.steps.length === 0)).toBe(true);
    }
  });

  it("ticked: a Close target with a Melee weapon, and a second adversary for a Stress", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "seraph", subclassId: "divine-wielder", subclassRank: "mastery", primaryWeaponId: "broadsword", stress: 0 }));
    const near = await a.enemy("Near", 7, 10);
    const other = await a.enemy("Other", 7, 11);
    const attack = (targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
      a.player.mutation(api.combatActions.attack, {
        campaignId: a.campaignId,
        characterId: a.w.characterA,
        mapId: a.mapId,
        targetTokenIds,
        slot: "primary",
        modifier: 0,
        experienceIds: [],
        advantage: 0,
        disadvantage: 0,
        help: 0,
        options: [],
        idempotencyKey: key(),
        ...extra,
      } as never);
    expect(await code(attack([near.tokenId, other.tokenId]))).not.toBe("ok");
    // Unequal Duality Dice: no critical (a critical would clear the Stress again, CB p.98).
    serverDice(9, 3);
    const r = await attack([near.tokenId, other.tokenId], { spiritWeapon: true });
    vi.restoreAllMocks();
    expect(r.status).toBe("resolved");
    expect((await a.sheet()).stress).toBe(1);
  });
});
