import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import { queueRng } from "@/lib/domain/dice";
import { owned } from "@/lib/domain/feature-effects/owned";
import { featureAvailability, runFeature, type FeatureRunContext, type FeatureRunResult } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { ANCESTRIES, COMMUNITIES } from "@/lib/srd/heritage";
import { FEATURE_CLASSIFICATION, featureEffect } from "@/lib/srd/feature-effects";
import { HERITAGE_HF_EFFECTS, HERITAGE_SITUATIONS as S } from "@/lib/srd/feature-effects/heritage-hf";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-heritage-hf: every Hope & Fear ancestry feature and every community feature classified
// combat or passive, plus the social advantages as roll options (Q13, Q15 b) and the rest-time features as rest-trigger
// entries (Q15 b), run through runFeature with fixed dice. Expected values come from the book texts by hand (printed
// pages: HF p.19-32, CB p.53-81). The default actor (fixtures) has 3 Hope, 1 of 6 Stress and 2 of 6 HP marked.

const sheet = sheetOf("guardian", "stalwart");
const actor = (over: Partial<ActorState> = {}): ActorState => actorOf(sheet, over);
const ally = (id: string, hp = 2) => ({ ...adversary(id), side: "pc" as const, evasion: 11, armor: 0, armorMax: 3, hp, stressMax: 6 });

const effectOf = (featureId: string): FeatureEffect => {
  const effect = HERITAGE_HF_EFFECTS.find((e) => e.featureId === featureId);
  if (!effect) throw new Error(`no entry for ${featureId}`);
  return effect;
};

const use = (featureId: string, useId: string | undefined, dice: number[], over: Partial<FeatureRunContext> = {}): FeatureRunResult =>
  runFeature(effectOf(featureId), useId, { actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

function plan(featureId: string, useId: string | undefined, dice: number[], over: Partial<FeatureRunContext> = {}): RunPlan {
  const rng = queueRng(dice);
  const result = runFeature(effectOf(featureId), useId, { actor: actor(), gmFear: 2, rng, ...over });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(p: RunPlan, kind: K) => p.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (p: RunPlan) => ofKind(p, "fold").map((f) => ({ step: f.step, targetIds: f.targetIds, amount: f.amount }));

// Q1-Q16 notes: Dedicated is the Orderborne community feature (the user's note on Q13); Q15 (b) adds the rest-time ones.
const ROLL_OPTIONS = [
  "ancestry:infernis:dread-visage",
  "ancestry:simiah:natural-climber",
  "community:highborne:privilege",
  "community:loreborne:well-read",
  "community:ridgeborne:steady",
  "community:slyborne:scoundrel",
  "community:underborne:low-light-living",
  "community:wildborne:lightfoot",
];
const REST_TIME = ["ancestry:clank:efficient", "ancestry:elf:celestial-trance", "community:duneborne:oasis", "community:frostborne:hardy"];

describe("the Hope & Fear heritage table", () => {
  const hfAncestries = ANCESTRIES.filter((a) => a.source === "hope-and-fear").map((a) => a.id);
  const isHfAncestry = (id: string) => id.startsWith("ancestry:") && hfAncestries.includes(id.split(":")[1]!);
  const usable = Object.entries(FEATURE_CLASSIFICATION)
    .filter(([id, c]) => (isHfAncestry(id) || id.startsWith("community:")) && (c.usage === "combat" || c.usage === "passive"))
    .map(([id]) => id);
  const expected = [...new Set([...usable, ...ROLL_OPTIONS, ...REST_TIME])].sort();

  it("has exactly one entry per combat or passive H&F ancestry and community feature, the roll options and the rest-time features", () => {
    const ids = HERITAGE_HF_EFFECTS.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(usable).toHaveLength(16);
    expect(ids).toHaveLength(28);
    for (const out of ["ancestry:earthkin:immovable", "ancestry:tidekin:amphibious", "community:wanderborne:nomadic-pack", "ancestry:halfling:luckbringer"]) expect(ids).not.toContain(out);
  });

  it("every entry is classified, names its source and owner, and the registry serves it", () => {
    const owners = new Set([...ANCESTRIES.map((a) => a.id), ...COMMUNITIES.map((c) => c.id)]);
    for (const e of HERITAGE_HF_EFFECTS) {
      expect(FEATURE_CLASSIFICATION[e.featureId], e.featureId).toBeDefined();
      const [source, owner] = e.featureId.split(":");
      expect(e.source).toBe(source);
      expect(e.owner).toBe(owner);
      expect(owners.has(e.owner)).toBe(true);
      expect(featureEffect(e.featureId)).toBe(e);
      expect(new Set(e.uses.map((u) => u.id)).size).toBe(e.uses.length);
    }
    for (const id of ROLL_OPTIONS) expect(FEATURE_CLASSIFICATION[id]!.usage).toBe("outOfCombat");
    for (const id of REST_TIME) expect(FEATURE_CLASSIFICATION[id]!.usage).toBe("outOfCombat");
  });

  it("every use runs through runFeature with its situations confirmed", () => {
    for (const e of HERITAGE_HF_EFFECTS) {
      for (const u of e.uses) {
        const result = runFeature(e, u.id, {
          actor: actor({ hope: 6, facts: { flying: true, featureEffects: [{ featureId: "ancestry:emberkin:ignition" }] } }),
          gmFear: 2,
          targets: [ally("mira")],
          trigger: { amount: 8, source: adversary("bandit"), subject: ally("mira") },
          situations: (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
          choices: { tokens: 1, hope: 1 },
          rng: () => 3,
        });
        expect(result.ok, `${e.featureId}/${u.id}`).toBe(true);
      }
    }
  });
});

describe("Hope & Fear ancestries", () => {
  it("Hallowed Aura (HF p.19): once per long rest an ally within Close who rolled with Fear rolls with Hope instead (Q1)", () => {
    const e = effectOf("ancestry:aetheris:hallowed-aura");
    expect(e.uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "withFear" } });
    const p = plan("ancestry:aetheris:hallowed-aura", undefined, [], { trigger: { subject: ally("mira") } });
    expect(folds(p)).toEqual([{ step: expect.objectContaining({ kind: "modifyRoll", change: { kind: "withHope" } }), targetIds: ["mira"], amount: undefined }]);
    expect(p.limit).toEqual({ key: "feat:ancestry:aetheris:hallowed-aura", until: "longRest", consumed: true });
    const used = actor({ featureUses: p.actor.featureUses });
    expect(use("ancestry:aetheris:hallowed-aura", undefined, [], { actor: used, trigger: { subject: ally("mira") } })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Celestial Wings (HF p.19): while flying (Q16), once per scene (Q7), a Hope instead of marking an Armor Slot", () => {
    const flying = actor({ facts: { flying: true } });
    const p = plan("ancestry:aetheris:celestial-wings", undefined, [], { actor: flying });
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "convertMarks", from: "armor", into: "hope" })]);
    expect(p.limit).toEqual({ key: "feat:ancestry:aetheris:celestial-wings", until: "scene", consumed: true });
    expect(featureAvailability({ ...sheet, featureUses: p.actor.featureUses }, effectOf("ancestry:aetheris:celestial-wings"))).toEqual({ state: "exhausted", until: "scene", label: "Back after the scene" });
    expect(use("ancestry:aetheris:celestial-wings", undefined, [], { actor: actor({ facts: { flying: false } }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(effectOf("ancestry:aetheris:celestial-wings").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "self" } });
  });

  it("Stoneskin (HF p.21): +1 Armor Score and +1 to both damage thresholds, always on", () => {
    const u = effectOf("ancestry:earthkin:stoneskin").uses[0]!;
    expect(u.activation).toEqual({ kind: "passive" });
    expect(u.mods).toEqual([
      { kind: "stat", stat: "armorScore", delta: { kind: "fixed", value: 1 } },
      { kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 1 } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 1 } },
    ]);
    expect(use("ancestry:earthkin:stoneskin", undefined, [])).toMatchObject({ ok: true });
  });

  it("Fireproof (HF p.22): flame damage confirmed by the player (Q13) is negated", () => {
    expect(use("ancestry:emberkin:fireproof", undefined, [], { trigger: { amount: 9 } })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("ancestry:emberkin:fireproof", undefined, [], { trigger: { amount: 9 }, situations: [S.fireproof] });
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "negate", what: "damage" })]);
    expect(p.actor.after).toMatchObject({ hope: 3, stress: 1 });
  });

  it("Ignition (HF p.22): a Stress sets the weapon ablaze until the end of the scene; then +1d6 on its damage rolls", () => {
    const p = plan("ancestry:emberkin:ignition", "main", []);
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "effect")).toEqual([expect.objectContaining({ targetId: "pc", duration: "scene", mods: [] })]);
    // The rider needs the Ignition effect (engine fact) and the player's "with that weapon".
    expect(use("ancestry:emberkin:ignition", "ablaze", [], { situations: [S.ignitionWeapon], actor: actor({ facts: { featureEffects: [] } }) })).toMatchObject({ ok: false, reason: "requirement" });
    const ablaze = actor({ facts: { featureEffects: [{ featureId: "ancestry:emberkin:ignition" }] } });
    expect(use("ancestry:emberkin:ignition", "ablaze", [], { actor: ablaze })).toMatchObject({ ok: false, reason: "requirement" });
    const rider = plan("ancestry:emberkin:ignition", "ablaze", [4], { actor: ablaze, situations: [S.ignitionWeapon], targets: [adversary("bandit")] });
    expect(folds(rider)).toEqual([{ step: expect.objectContaining({ kind: "modifyDamage", change: expect.objectContaining({ kind: "add" }) }), targetIds: ["bandit"], amount: 4 }]);
    expect(effectOf("ancestry:emberkin:ignition").uses[1]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } });
  });

  it("Nimble Fingers (HF p.25): after a Finesse Roll, 2 Hope reroll the Hope Die (Q1)", () => {
    const p = plan("ancestry:gnome:nimble-fingers", undefined, []);
    expect(p.actor.after.hope).toBe(1);
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "modifyRoll", change: { kind: "reroll", dice: "hope" } })]);
    expect(effectOf("ancestry:gnome:nimble-fingers").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "finesse" } });
    expect(use("ancestry:gnome:nimble-fingers", undefined, [], { actor: actor({ hope: 1 }) })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Flicker Step (HF p.25): once per scene, a teleport prompt within Far (Q7, Q9)", () => {
    const p = plan("ancestry:gnome:flicker-step", undefined, []);
    expect(ofKind(p, "prompt")).toEqual([expect.objectContaining({ prompt: "move", targetIds: ["pc"], step: expect.objectContaining({ mode: "teleport", range: "far" }) })]);
    expect(p.limit).toEqual({ key: "feat:ancestry:gnome:flicker-step", until: "scene", consumed: true });
  });

  it("Gale Force (HF p.23): a Stress carries you or a Very Close ally up to Very Far (move prompt)", () => {
    const p = plan("ancestry:skykin:gale-force", undefined, [], { targets: [ally("mira")] });
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "prompt")).toEqual([expect.objectContaining({ prompt: "move", targetIds: ["mira"], step: expect.objectContaining({ mode: "move", range: "veryFar" }) })]);
    expect(effectOf("ancestry:skykin:gale-force").uses[0]!.targets).toEqual({ side: "selfOrAlly", range: "veryClose", count: { kind: "one" } });
  });

  it("Eye of the Storm (HF p.23): 2 Hope, +1 Evasion until you take Severe damage or use it again", () => {
    const self = plan("ancestry:skykin:eye-of-the-storm", "main", [], { targets: [] });
    expect(self.actor.after.hope).toBe(1);
    expect(self.exclusive).toBe(true);
    expect(ofKind(self, "effect")).toEqual([
      expect.objectContaining({ targetId: "pc", mods: [{ kind: "stat", stat: "evasion", delta: 1 }], duration: "manual", endsOn: ["takeSevere", "usedAgain"] }),
    ]);
    const onAlly = plan("ancestry:skykin:eye-of-the-storm", "ally", [], { targets: [ally("mira")] });
    expect(ofKind(onAlly, "effect")).toEqual([expect.objectContaining({ targetId: "mira", endsOn: ["usedAgain"], endsWhen: expect.stringContaining("takes Severe damage") })]);
    expect(use("ancestry:skykin:eye-of-the-storm", "main", [], { actor: actor({ hope: 1 }) })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Lifespring (HF p.24): once per rest with water (Q13), a Stress clears a Hit Point on you or a Very Close ally", () => {
    expect(use("ancestry:tidekin:lifespring", undefined, [], { targets: [ally("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("ancestry:tidekin:lifespring", undefined, [], { targets: [ally("mira")], situations: [S.lifespring] });
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "hp", amount: 1 }]);
    expect(p.limit).toEqual({ key: "feat:ancestry:tidekin:lifespring", until: "rest", consumed: true });
  });
});

describe("communities", () => {
  it("Dedicated (CB p.75): once per rest, embodying a principle (Q13), a d20 Hope Die; only Orderborne characters hold it", () => {
    expect(owned(sheetOf("guardian", "stalwart", { communityId: "orderborne" })).map((f) => f.featureId)).toContain("community:orderborne:dedicated");
    for (const c of COMMUNITIES.filter((x) => x.id !== "orderborne")) {
      expect(owned(sheetOf("guardian", "stalwart", { communityId: c.id })).map((f) => f.featureId)).not.toContain("community:orderborne:dedicated");
    }
    expect(use("community:orderborne:dedicated", undefined, [])).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("community:orderborne:dedicated", undefined, [], { situations: [S.dedicated] });
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "modifyRoll", change: { kind: "hopeDie", sides: 20 } })]);
    expect(p.limit).toEqual({ key: "feat:community:orderborne:dedicated", until: "rest", consumed: true });
    expect(effectOf("community:orderborne:dedicated").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } });
  });

  it("Know the Tide (CB p.77): spending tokens before an action roll is delegated to the session features, +1 per token", () => {
    // You can hold tokens up to your level: a level-1 sheet can't spend 2.
    expect(use("community:seaborne:know-the-tide", undefined, [], { choices: { tokens: 2 } })).toMatchObject({ ok: false, reason: "choice" });
    const p = plan("community:seaborne:know-the-tide", undefined, [], { actor: actor({ level: 3 }), choices: { tokens: 2 } });
    expect(ofKind(p, "delegate")).toEqual([expect.objectContaining({ feature: "knowTheTide", params: expect.objectContaining({ amount: 2 }), done: false })]);
    expect(folds(p)).toEqual([{ step: expect.objectContaining({ kind: "modifyRoll", change: expect.objectContaining({ kind: "add" }) }), targetIds: ["pc"], amount: 2 }]);
    // No cardTokens of its own: the session features keep the one record (sessionFeatures.tideTokens).
    expect(p.actor.after).toMatchObject({ hope: 3, stress: 1 });
    // The D5 delegate handler does not know the session feature yet (vocabulary-gap bead): with a sheet it refuses.
    expect(use("community:seaborne:know-the-tide", undefined, [], { choices: { tokens: 1 }, sheet })).toMatchObject({ ok: false, reason: "choice" });
  });

  it("Unbound (HF p.28): once per session, your roll with Fear becomes a roll with Hope (Q1)", () => {
    const p = plan("community:freeborne:unbound", undefined, []);
    expect(folds(p)).toEqual([{ step: expect.objectContaining({ kind: "modifyRoll", change: { kind: "withHope" } }), targetIds: ["pc"], amount: undefined }]);
    expect(p.limit).toEqual({ key: "feat:community:freeborne:unbound", until: "session", consumed: true });
    expect(effectOf("community:freeborne:unbound").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "any", result: "withFear" } });
  });

  it("Close-Knit (HF p.30): once per long rest, the Hope you spend goes to an ally within Far", () => {
    const p = plan("community:hearthborne:close-knit", undefined, [], { actor: actor({ hope: 3 }), targets: [ally("mira")], choices: { hope: 2 } });
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: 2 }]);
    expect(p.limit).toEqual({ key: "feat:community:hearthborne:close-knit", until: "longRest", consumed: true });
    expect(use("community:hearthborne:close-knit", undefined, [], { actor: actor({ hope: 1 }), targets: [ally("mira")], choices: { hope: 2 } })).toMatchObject({ ok: false, reason: "cost" });
    expect(effectOf("community:hearthborne:close-knit").uses[0]!.targets).toEqual({ side: "ally", range: "far", count: { kind: "one" }, excludeSelf: true });
  });

  it("Found Family (HF p.31): once per rest, a Hope to use an ally's Experience", () => {
    const p = plan("community:reborne:found-family", undefined, []);
    expect(p.actor.after.hope).toBe(2);
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "modifyRoll", change: { kind: "experience", change: "borrowAlly" } })]);
    expect(p.limit).toEqual({ key: "feat:community:reborne:found-family", until: "rest", consumed: true });
  });

  it("Brave Face (HF p.32): once per session, a forced Stress is paid with a Hope instead", () => {
    const p = plan("community:warborne:brave-face", undefined, []);
    expect(folds(p).map((f) => f.step)).toEqual([expect.objectContaining({ kind: "convertMarks", from: "stress", into: "hope" })]);
    expect(p.limit).toEqual({ key: "feat:community:warborne:brave-face", until: "session", consumed: true });
    expect(effectOf("community:warborne:brave-face").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "wouldMarkStress", forced: true } });
  });
});

describe("social advantages as roll options (Q13, Q15 b)", () => {
  const texts: Record<string, string> = {
    "ancestry:infernis:dread-visage": S.dreadVisage,
    "ancestry:simiah:natural-climber": S.naturalClimber,
    "community:highborne:privilege": S.privilege,
    "community:loreborne:well-read": S.wellRead,
    "community:ridgeborne:steady": S.steady,
    "community:slyborne:scoundrel": S.scoundrel,
    "community:underborne:low-light-living": S.lowLight,
    "community:wildborne:lightfoot": S.lightfoot,
  };

  it("each is a passive advantage that holds only while the player confirms the situation", () => {
    for (const id of ROLL_OPTIONS) {
      const u = effectOf(id).uses[0]!;
      expect(u.activation, id).toEqual({ kind: "passive" });
      expect(u.requires).toEqual([{ kind: "situation", text: texts[id] }]);
      expect(u.mods).toEqual([{ kind: "advantage", on: id === "ancestry:simiah:natural-climber" ? "agility" : "action" }]);
      expect(use(id, undefined, [])).toMatchObject({ ok: false, reason: "requirement" });
      expect(use(id, undefined, [], { situations: [texts[id]!] })).toMatchObject({ ok: true });
    }
  });
});

describe("rest-time features (Q15 b): rest-trigger entries SD-R runs", () => {
  it("Hardy (HF p.29): any rest clears a Hit Point, automatically", () => {
    const u = effectOf("community:frostborne:hardy").uses[0]!;
    expect(u.activation).toEqual({ kind: "auto", trigger: { kind: "timing", at: "afterRest" } });
    const p = plan("community:frostborne:hardy", undefined, []);
    expect(ofKind(p, "clear")).toEqual([{ kind: "clear", targetId: "pc", track: "hp", amount: 1 }]);
    expect(p.actor.after.hp).toBe(1);
  });

  it("Efficient (CB p.53) and Oasis (HF p.27) on a short rest, Celestial Trance (CB p.56) on any rest", () => {
    for (const [id, text, short] of [
      ["ancestry:clank:efficient", "long rest move instead of a short rest move", true],
      ["community:duneborne:oasis", "reroll a die used for a downtime move and take the higher result", true],
      ["ancestry:elf:celestial-trance", "additional downtime move", false],
    ] as const) {
      expect(effectOf(id).uses[0]!.activation, id).toEqual({ kind: "reaction", trigger: { kind: "timing", at: "afterRest" } });
      if (short) expect(use(id, undefined, [])).toMatchObject({ ok: false, reason: "requirement" });
      const p = plan(id, undefined, [], { situations: [S.shortRest] });
      expect(ofKind(p, "prompt")).toEqual([expect.objectContaining({ prompt: "manual", text: expect.stringContaining(text) })]);
    }
  });
});
