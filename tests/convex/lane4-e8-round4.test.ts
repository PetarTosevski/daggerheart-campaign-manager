/**
 * Plan lanes-2, wave 10, tracer E8.4 (docs/tasks/TASK-LN4-E8.md): feature runner round 4.
 *
 * Book texts (printed pages):
 * - Otherworldly Ire (HF p.15): "spend any number of Favor to roll that many Patron Dice and target a number of creatures
 *   within Close range equal to the highest result" (user 2026-10-31: ALL the use's costs are paid at the roll).
 * - Contacts Everywhere (CB p.43): "They provide 1 handful of gold, a unique tool, or a mundane object that the situation
 *   requires."
 * - Weapon Specialist (CB p.48): "once per long rest when you roll your Slayer Dice, reroll any 1s."
 * - Vitality (CB p.330): "permanently gain two of the following benefits: • One Stress slot • One Hit Point slot • +2
 *   bonus to your damage thresholds".
 */
import { describe, expect, it } from "vitest";

import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { countMark, paidAtRoll, rollAndStoreCount, withoutRollCosts } from "../../convex/lib/featurePrompts";
import { giftsOf, withFeatureCaster } from "../../convex/lib/featureRunner";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { queueRng } from "../../src/lib/domain/dice";
import { actorExtras, featureAvailability, featureLimitKey, runFeature, WEAPON_SPECIALIST_FEATURE, WEAPON_SPECIALIST_REROLL_USE } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { WEAPON_SPECIALIST_KEY } from "../../src/lib/domain/session-features/slayer";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { actorOf, sheetOf } from "../unit/feature-effects/engine/fixtures";
import { allowWorldEmails, buildWorld } from "./authz/world";

allowWorldEmails();

/** Otherworldly Ire as the wave-10 data will read, with a second, fixed cost (a Hope) to show every cost moves. */
const ire = {
  id: "main",
  name: "Otherworldly Ire",
  activation: { kind: "action" },
  choices: [{ id: "favor", label: "Favor to spend", min: 1 }],
  costs: [
    { kind: "tokens", amount: { kind: "chosen", choice: "favor" }, pool: "favor" },
    { kind: "hope", amount: { kind: "fixed", value: 1 } },
  ],
  targets: { side: "enemy", range: "close", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", dice: { count: { kind: "chosen", choice: "favor" }, sides: 6, sidesOf: "patron" }, keep: "highest" } } },
  steps: [],
} as unknown as CardUse;

describe("dcm-szfg: Otherworldly Ire pays every cost at the roll", () => {
  it("paidAtRoll is all of the use's costs; the use then pays none", () => {
    expect(paidAtRoll(ire)).toEqual(ire.costs);
    expect(withoutRollCosts(ire).costs).toBeUndefined();
    // A fixed count (Warden's Protection's 1d4) still pays with the use.
    const warden = { ...ire, targets: { side: "ally", range: "close", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 4 } } } } } as unknown as CardUse;
    expect(paidAtRoll(warden)).toEqual([]);
    expect(withoutRollCosts(warden)).toBe(warden);
  });

  it("the roll takes the Favor and the Hope and logs both", async () => {
    const w = await buildWorld();
    const out = await w.t.run(async (ctx) => {
      const character = (await ctx.db.get("characters", w.characterA))!;
      const sheet = { ...readSheet(character.sheet), hope: 2, classState: { favor: 4 } };
      await saveSheet(ctx, w.characterA, sheet);
      const rolled = await rollAndStoreCount(ctx, { campaignId: w.campaignId, character, sheet, featureId: "test:ire", use: ire, userId: w.users.player, choices: { favor: 3 } });
      const after = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      const rows = await ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", w.characterA))
        .collect();
      return { rolled, after, rows };
    });
    expect(out.after.classState.favor).toBe(1);
    expect(out.after.hope).toBe(1);
    expect(out.after.featureUses.map((u) => u.key)).toContain(countMark(out.rolled.requestId));
    const row = out.rows.find((r) => r.summary.includes("3 Favor and 1 Hope"));
    expect(row?.undoable).toBe(true);
  });

  it("short of the Hope: refused, nothing paid", async () => {
    const w = await buildWorld();
    const out = await w.t.run(async (ctx) => {
      const character = (await ctx.db.get("characters", w.characterA))!;
      const sheet = { ...readSheet(character.sheet), hope: 0, classState: { favor: 4 } };
      await saveSheet(ctx, w.characterA, sheet);
      let code = "none";
      try {
        await rollAndStoreCount(ctx, { campaignId: w.campaignId, character, sheet, featureId: "test:ire", use: ire, userId: w.users.player, choices: { favor: 3 } });
      } catch (e) {
        code = (e as { data?: { code?: string } }).data?.code ?? "thrown";
      }
      return { code, after: readSheet((await ctx.db.get("characters", w.characterA))!.sheet) };
    });
    expect(out.code).toBe("FEATURE_COST_UNPAID");
    expect(out.after.classState.favor).toBe(4);
  });
});

const CONTACTS = "subclass:syndicate:contacts-everywhere";

/** Contacts Everywhere with its supply option as the data switch will read (`inventory` steps). */
function contactsWith(steps: unknown[]): FeatureEffect {
  const real = featureEffect(CONTACTS)!;
  return {
    ...real,
    uses: real.uses.map((u) =>
      u.id !== "main" ? u : { ...u, steps: u.steps.map((s) => (s.kind === "choose" ? { ...s, options: s.options.map((o) => (o.id === "supply" ? { ...o, steps } : o)) } : s)) },
    ),
  } as FeatureEffect;
}

describe("dcm-h1y9: giftsOf reads the plan's inventory steps", () => {
  const sheet = sheetOf("rogue", "syndicate");
  const runSupply = (steps: unknown[]) => {
    const result = runFeature(contactsWith(steps), "main", { actor: actorOf(sheet), gmFear: 2, rng: queueRng([]), options: { benefit: ["supply"] } });
    if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
    return result.plan;
  };

  it("a giveGold step gives its handfuls to the PC", () => {
    const gifts = giftsOf(runSupply([{ kind: "inventory", to: "self", op: "giveGold" }]), () => true);
    expect(gifts.byTarget.get("pc")).toEqual([{ kind: "gold", handfuls: 1 }]);
    expect(gifts.notes(() => "you")).toEqual(["you: 1 handful of gold"]);
  });

  it("a named item is given; an unnamed one is the GM's pick (a note, nothing written)", () => {
    const named = giftsOf(runSupply([{ kind: "inventory", to: "self", op: "giveItem", text: "Lockpicks" }]), () => true);
    expect(named.byTarget.get("pc")).toEqual([{ kind: "item", name: "Lockpicks" }]);
    const unnamed = giftsOf(runSupply([{ kind: "inventory", to: "self", op: "giveItem" }]), () => true);
    expect(unnamed.byTarget.size).toBe(0);
    expect(unnamed.notes(() => "you")).toEqual(["you: an item the GM picks"]);
  });

  it("a recipient that is no PC gets nothing", () => {
    expect(giftsOf(runSupply([{ kind: "inventory", to: "self", op: "giveGold" }]), () => false).byTarget.size).toBe(0);
  });
});

describe("dcm-40rt / dcm-7l0g: Weapon Specialist's reroll of Slayer 1s", () => {
  const slayer = (patch: Partial<CharacterSheet> = {}) => sheetOf("warrior", "call-of-the-slayer", { subclassRank: "specialization", sessionFeatures: { slayerDice: 2 }, ...patch } as Partial<CharacterSheet>);

  it("the slayer-ones use's limit is the dice box's key", () => {
    expect(featureLimitKey(WEAPON_SPECIALIST_FEATURE, WEAPON_SPECIALIST_REROLL_USE)).toBe(WEAPON_SPECIALIST_KEY);
    const entry = featureEffect(WEAPON_SPECIALIST_FEATURE)!;
    const used = slayer({ featureUses: [{ key: WEAPON_SPECIALIST_KEY, until: "longRest" }] });
    expect(featureAvailability(used, entry, WEAPON_SPECIALIST_REROLL_USE).state).toBe("exhausted");
    expect(featureAvailability(slayer(), entry, WEAPON_SPECIALIST_REROLL_USE).state).toBe("ready");
  });

  it("Slayer's own rider rerolls the 1s once per long rest and spends the key", () => {
    const sheet = slayer();
    const entry = featureEffect("subclass:call-of-the-slayer:slayer")!;
    const actor = { ...actorOf(sheet), ...actorExtras(sheet) };
    // Two dice: 1 and 4; the 1 is rerolled to 5.
    const first = runFeature(entry, "attack", { actor, gmFear: 0, rng: queueRng([1, 4, 5]), choices: { dice: 2 } });
    if (!first.ok) throw new Error(`refused: ${first.reason} ${first.detail}`);
    expect(first.plan.steps).toContainEqual({ kind: "heldReroll", die: "slayer", before: [1], after: [5] });
    expect(first.plan.actor.featureUses).toContainEqual({ key: WEAPON_SPECIALIST_KEY, until: "longRest" });
    // Spent: the next roll's 1 stands.
    const spent = { ...actor, featureUses: first.plan.actor.featureUses };
    const second = runFeature(entry, "attack", { actor: spent, gmFear: 0, rng: queueRng([1, 2]), choices: { dice: 2 } });
    if (!second.ok) throw new Error(`refused: ${second.reason} ${second.detail}`);
    expect(second.plan.steps.some((s) => s.kind === "heldReroll")).toBe(false);
  });

  it("no 1s: nothing rerolled, the reroll is kept; a foundation-rank Slayer has none", () => {
    const sheet = slayer();
    const entry = featureEffect("subclass:call-of-the-slayer:slayer")!;
    const none = runFeature(entry, "attack", { actor: { ...actorOf(sheet), ...actorExtras(sheet) }, gmFear: 0, rng: queueRng([3, 4]), choices: { dice: 2 } });
    if (!none.ok) throw new Error(`refused: ${none.reason} ${none.detail}`);
    expect(none.plan.actor.featureUses.some((u) => u.key === WEAPON_SPECIALIST_KEY)).toBe(false);
    expect(actorExtras(slayer({ subclassRank: "foundation" })).heldRerolls).toBeUndefined();
  });
});

describe("dcm-u9pv: the derived thresholds add a chosen card's permanent bonus", () => {
  it("Vitality's +2 raises both thresholds", () => {
    const base = sheetOf("warrior", "call-of-the-slayer", { level: 5 });
    const plain = derivedThresholds(base);
    const vital = derivedThresholds({ ...base, slotBonuses: ["card:vitality:major+2", "card:vitality:severe+2"] });
    expect(vital).toEqual({ major: plain.major + 2, severe: plain.severe + 2 });
  });
});

describe("dcm-lztq: feature effects record their caster", () => {
  const FEATURE = "ancestry:skykin:eye-of-the-storm";
  const prefix = effectKeyOf(FEATURE);
  const effect = (n: number, casterId?: string) => ({ id: `${prefix}:${n}`, source: "Eye of the Storm", text: "Eye of the Storm: +1 Evasion", until: "manual" as const, ...(casterId ? { casterId } : {}) });

  it("new effects of the feature get the caster; old ones and other sources are left", () => {
    const before = { ...sheetOf("ranger", "beastbound"), effects: [effect(1, "other")] } as CharacterSheet;
    const foreign = { id: "card:x:1", source: "X", text: "X", until: "manual" as const };
    const after = { ...before, effects: [...before.effects, effect(2), foreign] } as CharacterSheet;
    const out = withFeatureCaster(before, after, FEATURE, "c1" as never);
    expect(out.effects.map((e) => e.casterId)).toEqual(["other", "c1", undefined]);
    expect(withFeatureCaster(before, before, FEATURE, "c1" as never)).toBe(before);
  });
});
