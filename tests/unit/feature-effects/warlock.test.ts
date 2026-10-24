import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import { queueRng } from "@/lib/domain/dice";
import { owned } from "@/lib/domain/feature-effects/owned";
import { actorExtras, featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { HARROWED, WARLOCK_EFFECTS } from "@/lib/srd/feature-effects/warlock";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-warlock: every Warlock feature's entry, run through runFeature with fixed dice. Expected
// values come from the feature texts by hand (HF p.14: Patron's Boon, Patron's Pact, Favor, Pact of the Endless; HF p.15:
// Pact of the Wrathful). The warlock is level 1 (Patron Die d6, tier 1) unless a test says otherwise, with 3 Favor.

const WARLOCK_PREFIXES = ["hope:warlock", "class:warlock:", "subclass:pact-of-the-endless:", "subclass:pact-of-the-wrathful:"];
const isWarlock = (id: string) => WARLOCK_PREFIXES.some((p) => id === p || id.startsWith(p));

const effectOf = (featureId: string): FeatureEffect => {
  const found = WARLOCK_EFFECTS.find((e) => e.featureId === featureId);
  if (!found) throw new Error(`No entry for ${featureId}`);
  return found;
};

const sheet = sheetOf("warlock", "pact-of-the-endless", { classState: { favor: 3 }, hp: 3, stress: 2, hope: 4 });
const actor = (over: Partial<ActorState> = {}): ActorState => actorOf(sheet, { ...actorExtras(sheet), ...over });

function use(featureId: string, useId: string | undefined, context: Partial<FeatureRunContext> & { dice?: number[] } = {}): RunPlan {
  const { dice = [], ...rest } = context;
  const result = runFeature(effectOf(featureId), useId, { actor: actor(), gmFear: 2, rng: queueRng(dice), ...rest });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

describe("the Warlock table", () => {
  it("has exactly one entry per Warlock feature classified combat or passive, and nothing else", () => {
    const expected = Object.entries(FEATURE_CLASSIFICATION)
      .filter(([id, c]) => isWarlock(id) && (c.usage === "combat" || c.usage === "passive"))
      .map(([id]) => id)
      .sort();
    const ids = WARLOCK_EFFECTS.map((e) => e.featureId);
    expect(expected).toHaveLength(15);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names each entry's source, owner and subclass card as owned() does for a mastery warlock of either pact", () => {
    for (const subclassId of ["pact-of-the-endless", "pact-of-the-wrathful"]) {
      const held = owned(sheetOf("warlock", subclassId, { subclassRank: "mastery" })).filter((f) => isWarlock(f.featureId));
      for (const f of held) {
        const e = effectOf(f.featureId);
        expect({ source: e.source, owner: e.owner }).toEqual({ source: f.source, owner: f.owner });
        if (e.source === "subclass") expect(e.card).toBe(f.card);
      }
      expect(held).toHaveLength(9);
    }
  });

  it("every Favor cost is paid from the Favor pool; a warlock with no Favor is refused (CARD_COST_UNPAID)", () => {
    const broke = actor({ favor: 0 });
    for (const e of WARLOCK_EFFECTS) {
      for (const u of e.uses) {
        if (!(u.costs ?? []).some((c) => c.kind === "tokens")) continue;
        expect(u.costs!.every((c) => c.kind !== "tokens" || c.pool === "favor")).toBe(true);
        const result = runFeature(e, u.id, {
          actor: broke,
          gmFear: 2,
          rng: queueRng([6, 6, 6]),
          situations: (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
          targets: [adversary("bandit")],
          trigger: { amount: 2, source: adversary("bandit") },
        });
        expect(result, `${e.featureId}:${u.id}`).toMatchObject({ ok: false, reason: "cost", detail: "tokens" });
      }
    }
  });
});

describe("Hope feature and class features (HF p.14)", () => {
  it("Patron's Boon: on a failed roll, 3 Hope reroll it with advantage (an after-roll fold, Q1)", () => {
    const boon = effectOf("hope:warlock");
    expect(boon.uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "any", result: "failure" } });
    const plan = use("hope:warlock", undefined);
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "reroll", dice: "all", advantage: true } });
    expect(runFeature(boon, undefined, { actor: actor({ hope: 2 }), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });

  it("Patron's Pact: a Favor adds the Patron Die to the action roll: a d6 at level 1, a d8 from level 5", () => {
    const situations = ["This action roll relates to your patron’s sphere of influence"];
    const d6 = use("class:warlock:patrons-pact", undefined, { situations, dice: [5] });
    expect(d6.actor.after.favor).toBe(2);
    expect(ofKind(d6, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "add" } }, amount: 5 });
    const level5 = sheetOf("warlock", "pact-of-the-endless", { level: 5, classState: { favor: 1 } });
    const d8 = use("class:warlock:patrons-pact", undefined, { actor: actorOf(level5, actorExtras(level5)), situations, dice: [8] });
    expect(ofKind(d8, "fold")[0]!.amount).toBe(8);
    // The sphere is the player's check box (Q13).
    expect(runFeature(effectOf("class:warlock:patrons-pact"), undefined, { actor: actor(), gmFear: 0, rng: queueRng([3]) })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Favor: after a success with Hope, a Favor instead of the Hope (NV17: a fold on the trigger's roll)", () => {
    const plan = use("class:warlock:favor", undefined, { situations: ["The action roll succeeded with Hope"] });
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "replaceHopeGain", with: "favor" });
    expect(plan.actor.after).toMatchObject({ hope: 4, favor: 3 });
    expect(effectOf("class:warlock:favor").uses[0]!.activation).toMatchObject({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } });
  });
});

describe("Pact of the Endless (HF p.14)", () => {
  it("Patron's Mantle: a Favor; +tier to both thresholds until Severe damage or the scene ends (Q7)", () => {
    const plan = use(`subclass:pact-of-the-endless:patrons-mantle`, undefined, { actor: actor({ tier: 3 }) });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({
      targetId: "pc",
      mods: [
        { kind: "stat", stat: "majorThreshold", delta: 3 },
        { kind: "stat", stat: "severeThreshold", delta: 3 },
      ],
      duration: "scene",
      endsOn: ["takeSevere"],
    });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", text: expect.stringMatching(/advantage on action rolls to intimidate/) });
  });

  it("Deathless Embrace: 3 Favor roll 3 Patron Dice; 4, 2, 6 clear 2 Hit Points; once per rest", () => {
    const plan = use(`subclass:pact-of-the-endless:deathless-embrace`, undefined, { choices: { favor: 3 }, dice: [4, 2, 6] });
    expect(ofKind(plan, "clear")[0]).toMatchObject({ track: "hp", amount: 2 });
    expect(plan.actor.after).toMatchObject({ hp: 1, favor: 0 });
    expect(plan.limit).toEqual({ key: "feat:subclass:pact-of-the-endless:deathless-embrace", until: "rest", consumed: true });
    const used = { ...sheet, featureUses: plan.actor.featureUses };
    expect(featureAvailability(used, effectOf(`subclass:pact-of-the-endless:deathless-embrace`))).toMatchObject({ state: "exhausted", until: "rest" });
    // A d8 from level 5: 8, 3 clear 1.
    const lv5 = sheetOf("warlock", "pact-of-the-endless", { level: 5, hp: 4, classState: { favor: 2 } });
    const d8 = use(`subclass:pact-of-the-endless:deathless-embrace`, undefined, { actor: actorOf(lv5, actorExtras(lv5)), choices: { favor: 2 }, dice: [8, 3] });
    expect(d8.actor.after.hp).toBe(3);
  });

  it("Harrowing Invocation: before the attack roll (Q2), a Favor gives the attacker disadvantage; if it fails, it marks a Stress", () => {
    const main = effectOf(`subclass:pact-of-the-endless:harrowing-invocation`).uses[0]!;
    expect(main.activation).toEqual({ kind: "reaction", trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "targeted" } });
    const bandit = adversary("bandit");
    const plan = use(`subclass:pact-of-the-endless:harrowing-invocation`, "main", { trigger: { source: bandit, subject: actorOf(sheet) } });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "bandit", mods: [{ kind: "flag", flag: "attackDisadvantage" }], duration: "nextRoll" });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "bandit", condition: HARROWED, duration: "nextRoll" });

    // The attack failed: the Harrowed attacker marks a Stress, at no further cost; one that was not invoked does not.
    const harrowed = { ...bandit, tags: [HARROWED.kind === "tag" ? HARROWED.tag : ""] };
    const failed = use(`subclass:pact-of-the-endless:harrowing-invocation`, "failed", { trigger: { source: harrowed } });
    expect(ofKind(failed, "mark")).toMatchObject([{ targetId: "bandit", track: "stress", amount: 1 }]);
    expect(failed.actor.after.favor).toBe(3);
    expect(ofKind(use(`subclass:pact-of-the-endless:harrowing-invocation`, "failed", { trigger: { source: bandit } }), "mark")).toEqual([]);
  });

  it("Damage Sink: a Favor halves the incoming damage, rounding up (Q6: 27 → 14); once per rest", () => {
    const plan = use(`subclass:pact-of-the-endless:damage-sink`, undefined, { trigger: { amount: 27 } });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage", change: { kind: "halve" } }, amount: 14 });
    expect(plan.actor.after.favor).toBe(2);
    expect(plan.limit).toMatchObject({ until: "rest", consumed: true });
    expect(ofKind(use(`subclass:pact-of-the-endless:damage-sink`, undefined, { trigger: { amount: 26 } }), "fold")[0]!.amount).toBe(13);
  });

  it("Dark Aegis: a Favor instead of marking Hit Points (no HP marked from this hit); once per long rest", () => {
    const plan = use(`subclass:pact-of-the-endless:dark-aegis`, undefined, { trigger: { amount: 40 } });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "adjustHpMarked", change: "fewer" }, amount: 4 });
    expect(plan.actor.after.favor).toBe(2);
    expect(plan.limit).toMatchObject({ key: "feat:subclass:pact-of-the-endless:dark-aegis", until: "longRest" });
  });

  it("Draining Bane: a Favor; the attacker marks a Stress, you may clear one, and it rolls a d12 until it fails a roll", () => {
    const bandit = adversary("bandit");
    const plan = use(`subclass:pact-of-the-endless:draining-bane`, undefined, { trigger: { source: bandit }, optionals: ["clear-stress"] });
    expect(plan.actor.after).toMatchObject({ favor: 2, stress: 1 });
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "bandit", track: "stress", amount: 1 }]);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "bandit", mods: [{ kind: "set", stat: "attackDie", to: 12 }], duration: "manual", endsOn: ["bearerFails"] });
    // Without taking the optional clear, your Stress stays.
    expect(use(`subclass:pact-of-the-endless:draining-bane`, undefined, { trigger: { source: bandit } }).actor.after.stress).toBe(2);
  });
});

describe("Pact of the Wrathful (HF p.15)", () => {
  const wrathful = sheetOf("warlock", "pact-of-the-wrathful", { classState: { favor: 3 }, hp: 1 });
  const wActor = (over: Partial<ActorState> = {}) => actorOf(wrathful, { ...actorExtras(wrathful), ...over });

  it("Patron's Fury: a Favor starts it until Severe damage dealt or the scene ends; each damage roll then adds tier Patron Dice", () => {
    const fury = `subclass:pact-of-the-wrathful:patrons-fury`;
    const start = use(fury, "main", { actor: wActor() });
    expect(start.actor.after.favor).toBe(2);
    expect(ofKind(start, "effect")[0]).toMatchObject({ targetId: "pc", duration: "scene", endsOn: ["dealSevere"] });

    // Tier 2: two Patron Dice (d6) rolling 3 and 5 add 8 to the damage, with no Favor spent.
    const active = wActor({ tier: 2, facts: { featureEffects: [{ featureId: fury }] } });
    const damage = use(fury, "damage", { actor: active, targets: [adversary("bandit")], dice: [3, 5] });
    expect(ofKind(damage, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage", change: { kind: "add" } }, amount: 8 });
    expect(damage.actor.after.favor).toBe(3);
    // Not active: no dice.
    expect(runFeature(effectOf(fury), "damage", { actor: wActor({ facts: { featureEffects: [] } }), gmFear: 0, rng: queueRng([]), targets: [adversary("bandit")] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Deadly Vengeance: you marked 3 HP from an attack; a Favor rolls 3 Patron Dice; 4, 6, 1 make the attacker mark 2 HP", () => {
    const plan = use(`subclass:pact-of-the-wrathful:deadly-vengeance`, undefined, { actor: wActor(), trigger: { amount: 3, source: adversary("bandit") }, dice: [4, 6, 1] });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "bandit", track: "hp", amount: 2 }]);
    expect(plan.creatures[0]!.after.hp).toBe(2);
  });

  it("Menacing Reach: a Favor; primary weapon range +1 step until a successful attack", () => {
    const plan = use(`subclass:pact-of-the-wrathful:menacing-reach`, undefined, { actor: wActor() });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ mods: [{ kind: "stat", stat: "primaryRange", delta: 1 }], duration: "manual", endsOn: ["attackSucceeds"] });
  });

  it("Diminish My Foes: after a success with Hope, 2 Favor make the target mark 2 Stress", () => {
    const plan = use(`subclass:pact-of-the-wrathful:diminish-my-foes`, undefined, {
      actor: wActor(),
      situations: ["The action roll against a target succeeded with Hope"],
      choices: { favor: 2 },
      targets: [adversary("bandit")],
    });
    expect(plan.actor.after.favor).toBe(1);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "bandit", track: "stress", amount: 2 }]);
    expect(runFeature(effectOf(`subclass:pact-of-the-wrathful:diminish-my-foes`), undefined, { actor: wActor({ favor: 1 }), gmFear: 0, rng: queueRng([]), situations: ["The action roll against a target succeeded with Hope"], choices: { favor: 2 }, targets: [adversary("bandit")] })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Fearsome Attack: a Favor rerolls the picked damage dice; again for another Favor (no limit)", () => {
    const fearsome = effectOf(`subclass:pact-of-the-wrathful:fearsome-attack`);
    expect(fearsome.uses[0]!.limit).toBeUndefined();
    const plan = use(fearsome.featureId, undefined, { actor: wActor(), targets: [adversary("bandit")], damageDice: { reroll: [0] } });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyDamage", change: { kind: "rerollChosen" } });
    const again = use(fearsome.featureId, undefined, { actor: wActor({ favor: 2 }), targets: [adversary("bandit")], damageDice: { reroll: [1] } });
    expect(again.actor.after.favor).toBe(1);
  });

  it("Otherworldly Ire: when you take damage, 2 Favor roll 2 Patron Dice (shown); the targets are a manual step; once per rest", () => {
    const plan = use(`subclass:pact-of-the-wrathful:otherworldly-ire`, undefined, { actor: wActor(), choices: { favor: 2 }, dice: [2, 5] });
    expect(plan.actor.after.favor).toBe(1);
    expect(ofKind(plan, "check")[0]).toMatchObject({ dice: [2, 5], passed: true });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", text: expect.stringMatching(/highest Patron Die result/) });
    expect(plan.limit).toMatchObject({ key: "feat:subclass:pact-of-the-wrathful:otherworldly-ire", until: "rest" });
  });
});
