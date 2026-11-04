/**
 * Plan lanes-2, wave 9, tracer S2 (docs/tasks/TASK-LN3-S2.md): the feature-effect data switched in this wave runs through
 * the real server paths with the real SRD entries (no injected fixtures).
 *
 * Book texts (printed pages):
 * - Stance Fighter (HF p.12): "You can spend a Focus to shift into a martial stance and gain its effects. You can shift
 *   only into stances you've marked as known."
 * - Elemental Incarnation, Water (CB p.30): "When you deal damage to an adversary within Melee range, all other
 *   adversaries within Very Close range must mark a Stress."
 * - Venomancer (HF p.9): "Blight Seed: The target gains a −3 penalty to their damage thresholds until the end of the
 *   scene. This effect can't stack. • Fear Leaf: You deal extra damage equal to the result of your Fear Die."
 * - Contacts Everywhere (CB p.43): "They provide 1 handful of gold, a unique tool, or a mundane object that the situation
 *   requires." (stays manual: pinned below.)
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { giftsOf } from "../../convex/lib/featureRunner";
import { queueRng } from "../../src/lib/domain/dice";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { actorOf, sheetOf } from "../unit/feature-effects/engine/fixtures";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const INCARNATION = "subclass:warden-of-the-elements:elemental-incarnation";
const STANCE_FIGHTER = "subclass:martial-artist:stance-fighter";
const TOXIC = "subclass:poisoners-guild:toxic-concoctions";
const CONTACTS = "subclass:syndicate:contacts-everywhere";
const CONTACT_CHOOSE = "benefit";
const QUICK = "quick";
const RELIABLE = "reliable";

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** The world plus a live map: Ash (characterA) at (5, 10), a running encounter; `enemy` adds an instance and its token. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
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
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  const use = (featureId: string, extra: Record<string, unknown> = {}) =>
    player.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, featureId, targetTokenIds: [], choices: [], idempotencyKey: key(), ...extra } as never);
  const attack = (targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    player.mutation(api.combatActions.attack, {
      campaignId,
      characterId: w.characterA,
      mapId,
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
    });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, use, attack };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved use, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

describe("lanes-2 S2: Stance Fighter sets the picked stance on the feature path (dcm-awh, dcm-4xl)", () => {
  allowWorldEmails();

  it("a Focus shifts into the picked known stance; the next shift drops it first; an unpicked or unknown stance is refused", async () => {
    const a = await arena();
    await a.edit((s) => ({ classId: "brawler", subclassId: "martial-artist", subclassRank: "foundation", classState: { ...s.classState, martial: { focus: 2, known: [QUICK, RELIABLE] } } }));
    const pay = { id: "opt:cost", value: ["focus"] };
    expect(await code(a.use(STANCE_FIGHTER, { choices: [pay] }))).toBe("INVALID");
    expect(await code(a.use(STANCE_FIGHTER, { choices: [pay, { id: "opt:stance", value: ["anchored"] }] }))).toBe("INVALID");
    expect((await a.sheet()).classState.martial).toMatchObject({ focus: 2 });

    resolved(await a.use(STANCE_FIGHTER, { choices: [pay, { id: "opt:stance", value: [QUICK] }] }));
    expect((await a.sheet()).classState.martial).toMatchObject({ focus: 1, active: QUICK });
    resolved(await a.use(STANCE_FIGHTER, { choices: [pay, { id: "opt:stance", value: [RELIABLE] }] }));
    expect((await a.sheet()).classState.martial).toMatchObject({ focus: 0, active: RELIABLE });
  });
});

describe("lanes-2 S2: Elemental Incarnation, Water on map attacks (dcm-ssf, dcm-76l5, dcm-umti)", () => {
  allowWorldEmails();

  it("damage to an adversary within Melee: every other adversary within Very Close of the druid marks a Stress", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "druid", subclassId: "warden-of-the-elements", subclassRank: "foundation", primaryWeaponId: "broadsword", stress: 0 }));
    resolved(await a.use(INCARNATION, { choices: [{ id: "opt:element", value: ["water"] }] }));
    const target = await a.enemy("Target", 6, 10);
    const near = await a.enemy("Near", 6, 11);
    const far = await a.enemy("Far", 15, 10);
    const r = resolved(await a.attack([target.tokenId]));
    expect(r.roll.outcome).not.toMatch(/^fail/);
    expect((await a.instance(near.instanceId)).stress).toBe(1);
    expect((await a.instance(far.instanceId)).stress).toBe(0);
    // The damaged adversary is the trigger's subject: excluded ("all other adversaries").
    expect((await a.instance(target.instanceId)).stress).toBe(0);
  });

  it("damage to an adversary beyond Melee doesn't trigger it", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "druid", subclassId: "warden-of-the-elements", subclassRank: "foundation", primaryWeaponId: "shortbow", stress: 0 }));
    resolved(await a.use(INCARNATION, { choices: [{ id: "opt:element", value: ["water"] }] }));
    const target = await a.enemy("Target", 9, 10);
    const near = await a.enemy("Near", 6, 11);
    resolved(await a.attack([target.tokenId]));
    expect((await a.instance(near.instanceId)).stress).toBe(0);
  });
});

describe("lanes-2 S2: Venomancer poisons on map attacks (dcm-kkx, dcm-d1b, dcm-n0dv)", () => {
  allowWorldEmails();

  const poisoner = (s: CharacterSheet): Partial<CharacterSheet> => ({
    classId: "assassin",
    subclassId: "poisoners-guild",
    subclassRank: "mastery",
    primaryWeaponId: "broadsword",
    cardTokens: [...(s.cardTokens ?? []).filter((c) => c.cardId !== `feat:${TOXIC}`), { cardId: `feat:${TOXIC}`, count: 5 }],
  });
  const poison = (id: string) => ({ riders: [{ source: "feature", id: TOXIC, useId: "poison", choices: [{ id: "opt:poison", value: [id] }] }] });

  it("Blight Seed can't stack: a second Blight Seed on the same target adds no second copy", async () => {
    const a = await arena();
    await a.edit(poisoner);
    const bandit = await a.enemy("Bandit", 6, 10);
    resolved(await a.attack([bandit.tokenId], poison("blight-seed")));
    const once = (await a.instance(bandit.instanceId)).effects ?? [];
    expect(once.filter((e) => e.label === "Blight Seed")).toHaveLength(1);
    resolved(await a.attack([bandit.tokenId], poison("blight-seed")));
    expect(((await a.instance(bandit.instanceId)).effects ?? []).filter((e) => e.label === "Blight Seed")).toHaveLength(1);
  });

  it("Fear Leaf adds the attack's own Fear Die to the damage, with no dialog number", async () => {
    const a = await arena();
    await a.edit(poisoner);
    const bandit = await a.enemy("Bandit", 6, 10);
    const plain = resolved(await a.attack([bandit.tokenId], poison("ghost-petal")));
    const leaf = resolved(await a.attack([bandit.tokenId], poison("fear-leaf")));
    const flat = (r: typeof plain) => r.damage!.modifier - (r.roll.outcome === "critical" ? r.damage!.dice.reduce((s, d) => s + d.sides, 0) : 0);
    const fear = leaf.roll.dice.find((d) => d.role === "fear")!.value;
    expect(flat(leaf) - flat(plain)).toBe(fear);
  });
});

describe("lanes-2 S2: Contacts Everywhere's supply stays manual (dcm-vf7i)", () => {
  it("an inventory gift step becomes a plan inventory step, which giftsOf reads since lanes-2 E8.4 (dcm-h1y9): the switch is ready", () => {
    const real = featureEffect(CONTACTS)!;
    const supply = { kind: "inventory" as const, to: "self" as const, op: "giveGold" as const };
    const switched: FeatureEffect = {
      ...real,
      uses: real.uses.map((u) =>
        u.id !== "main"
          ? u
          : { ...u, steps: u.steps.map((s) => (s.kind === "choose" ? { ...s, options: s.options.map((o) => (o.id === "supply" ? { ...o, steps: [supply] } : o)) } : s)) },
      ),
    };
    const sheet = sheetOf("rogue", "syndicate");
    const result = runFeature(switched, "main", { actor: actorOf(sheet), gmFear: 2, rng: queueRng([]), options: { [CONTACT_CHOOSE]: ["supply"] } });
    if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
    expect(result.plan.steps.some((s) => s.kind === "inventory")).toBe(true);
    expect(giftsOf(result.plan, () => true).byTarget.get("pc")).toEqual([{ kind: "gold", handfuls: 1 }]);
    // Lanes-2 wave 10 S2.4 switched the real entry (tests/convex/lane4-s2-features.test.ts): it asks which gift first.
    const kept = runFeature(real, "main", { actor: actorOf(sheet), gmFear: 2, rng: queueRng([]), options: { [CONTACT_CHOOSE]: ["supply"] } });
    if (!kept.ok) throw new Error(`refused: ${kept.reason} ${kept.detail}`);
    expect(kept.plan.steps).toContainEqual(expect.objectContaining({ kind: "prompt", prompt: "choose" }));
  });
});
