import { describe, expect, it } from "vitest";

import { unmetRequirements } from "@/lib/domain/card-effects/availability";
import { run, type ActorState, type PlanStep, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardUse, Mod } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import type { RollRecord } from "@/lib/domain/duality";
import { parseFeatureId } from "@/lib/domain/feature-effects/ids";
import { holdingsFor, owned } from "@/lib/domain/feature-effects/owned";
import { featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION, FEATURE_EFFECTS } from "@/lib/srd/feature-effects";
import { BARD_WIZARD_EFFECTS } from "@/lib/srd/feature-effects/bard-wizard";
import type { CharacterSheet } from "@/lib/validation/characters";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-bard-wizard: every Bard and Wizard feature usable in combat (or passive) runs through
// runFeature with fixed dice. Expected values come from the book texts by hand (CB p.28-29 Bard, CB p.50-51 Wizard).

const OWNERS = ["bard", "troubadour", "wordsmith", "wizard", "school-of-knowledge", "school-of-war"];

function entry(featureId: string): FeatureEffect {
  const effect = BARD_WIZARD_EFFECTS.find((e) => e.featureId === featureId);
  if (!effect) throw new Error(`No entry ${featureId}`);
  return effect;
}

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 2,
  hpMax: 6,
  stress: 3,
  stressMax: 6,
  defeated: false,
  conditions: [],
  ...over,
});

/** The holdings a real sheet gives (owned + upgrades), as the server builds them. */
const holdingsOf = (sheet: CharacterSheet) => holdingsFor(sheet, owned(sheet), sheet.subclassId);

function plan(featureId: string, useId: string | undefined, context: Omit<FeatureRunContext, "rng" | "gmFear"> & { dice?: number[]; gmFear?: number }): RunPlan {
  const { dice = [], gmFear = 0, ...rest } = context;
  const rng = queueRng(dice);
  const result = runFeature(entry(featureId), useId, { gmFear, rng, ...rest });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(p: RunPlan, kind: K) => p.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

/** A passive use's mods resolved through an effect step, so run() does the arithmetic. */
function resolvedMods(mods: readonly Mod[], actor: ActorState) {
  const result = run(
    { cardId: "probe", uses: [{ id: "main", name: "probe", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "probe", mods, duration: "permanent" }] }] },
    { actor, gmFear: 0, rng: queueRng([]) },
  );
  if (!result.ok) throw new Error("refused");
  return ofKind(result.plan, "effect")[0]!.mods;
}

const duality = (hope: number, fear: number, total: number, outcome: RollRecord["outcome"]): RollRecord => ({
  kind: "action",
  dice: [
    { sides: 12, value: hope, role: "hope" },
    { sides: 12, value: fear, role: "fear" },
  ],
  modifier: total - hope - fear,
  total,
  difficulty: 12,
  outcome,
  manual: false,
});

describe("the Bard and Wizard table", () => {
  const expected = Object.entries(FEATURE_CLASSIFICATION)
    .filter(([id, c]) => OWNERS.includes(parseFeatureId(id)?.owner ?? "") && (c.usage === "combat" || c.usage === "passive"))
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per Bard and Wizard feature classified combat or passive (19)", () => {
    const ids = BARD_WIZARD_EFFECTS.map((e) => e.featureId);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
    for (const id of ids) expect(FEATURE_EFFECTS.get(id)).toBe(entry(id));
  });

  it("source, owner and subclass card match the feature id and the sheet's own features; use ids are unique", () => {
    const held = [
      ...owned(sheetOf("bard", "troubadour", { subclassRank: "mastery" })),
      ...owned(sheetOf("bard", "wordsmith", { subclassRank: "mastery" })),
      ...owned(sheetOf("wizard", "school-of-knowledge", { subclassRank: "mastery" })),
      ...owned(sheetOf("wizard", "school-of-war", { subclassRank: "mastery" })),
    ];
    for (const effect of BARD_WIZARD_EFFECTS) {
      const parsed = parseFeatureId(effect.featureId);
      expect(parsed).toMatchObject({ source: effect.source, owner: effect.owner });
      const feature = held.find((f) => f.featureId === effect.featureId);
      expect(feature, effect.featureId).toBeDefined();
      expect(effect.card).toBe(feature!.card);
      const useIds = effect.uses.map((u) => u.id);
      expect(new Set(useIds).size).toBe(useIds.length);
    }
  });

  it("passive features have no Use button; combat features have one non-passive use or more", () => {
    for (const effect of BARD_WIZARD_EFFECTS) {
      const usage = FEATURE_CLASSIFICATION[effect.featureId]!.usage;
      if (usage === "passive") expect(effect.uses.every((u) => u.activation.kind === "passive"), effect.featureId).toBe(true);
      else expect(effect.uses.some((u) => u.activation.kind !== "passive"), effect.featureId).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- Bard

describe("Make a Scene (CB p.28)", () => {
  const bard = sheetOf("bard", "troubadour");

  it("3 Hope: one enemy within Close is temporarily Distracted with -2 to their Difficulty; no roll", () => {
    const p = plan("hope:bard", undefined, { actor: actorOf(bard), targets: [adversary("a")] });
    expect(p.roll).toBeNull();
    expect(p.actor.after.hope).toBe(0);
    expect(ofKind(p, "condition")).toEqual([{ kind: "condition", targetId: "a", condition: { kind: "standard", condition: "distracted" }, duration: "temporary" }]);
    expect(ofKind(p, "effect")).toMatchObject([{ targetId: "a", mods: [{ kind: "stat", stat: "difficulty", delta: -2 }], duration: "temporary" }]);
    expect(entry("hope:bard").uses[0]!.targets).toMatchObject({ side: "enemy", range: "close", count: { kind: "one" } });
  });

  it("refuses with fewer than 3 Hope (CB p.90)", () => {
    const r = runFeature(entry("hope:bard"), undefined, { actor: actorOf(bard, { hope: 2 }), gmFear: 0, rng: queueRng([]), targets: [adversary("a")] });
    expect(r).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Rally (CB p.28) with Epic Poetry (CB p.29)", () => {
  const rallyDice = (sheet: CharacterSheet) => {
    const r = runFeature(entry("class:bard:rally"), undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, others: [{ characterId: "mira", sheet: sheetOf("guardian", "stalwart") }], holdings: holdingsOf(sheet) });
    if (!r.ok) throw new Error(r.detail);
    return { own: r.sheet!.heldDice.map((d) => d.sides), ally: r.others[0]!.sheet.heldDice.map((d) => d.sides), uses: r.plan.actor.featureUses };
  };

  it("a d6 for the bard and each ally at level 1, d8 at level 5, d10 with Epic Poetry; D5's once-per-session key", () => {
    expect(rallyDice(sheetOf("bard", "troubadour"))).toEqual({ own: [6], ally: [6], uses: [{ key: "rally", until: "session" }] });
    expect(rallyDice(sheetOf("bard", "troubadour", { level: 5 }))).toMatchObject({ own: [8], ally: [8] });
    expect(rallyDice(sheetOf("bard", "wordsmith", { level: 7, subclassRank: "mastery" }))).toMatchObject({ own: [10], ally: [10] });
    // Wordsmith specialization: no Epic Poetry yet.
    expect(rallyDice(sheetOf("bard", "wordsmith", { level: 5, subclassRank: "specialization" }))).toMatchObject({ own: [8] });
  });

  it("once per session: a used Rally reads as exhausted", () => {
    const used = sheetOf("bard", "troubadour", { featureUses: [{ key: "rally", until: "session" }] });
    expect(featureAvailability(used, entry("class:bard:rally"))).toMatchObject({ state: "exhausted", label: "Back next session" });
  });
});

describe("Gifted Performer (CB p.28) and Virtuoso", () => {
  const sheet = sheetOf("bard", "troubadour");
  const actor = actorOf(sheet, { hp: 2, hope: 2 });

  it("Relaxing Song: you and all allies within Close clear a Hit Point", () => {
    const p = plan("subclass:troubadour:gifted-performer", "relaxing", { actor, allies: [ally("b"), ally("c")] });
    expect(ofKind(p, "clear").map((c) => [c.targetId, c.track, c.amount])).toEqual([
      ["pc", "hp", 1],
      ["b", "hp", 1],
      ["c", "hp", 1],
    ]);
    expect(p.actor.after.hp).toBe(1);
    expect(p.limit).toEqual({ key: "feat:subclass:troubadour:gifted-performer:relaxing", until: "longRest", consumed: true });
  });

  it("Epic Song: a target within Close is temporarily Vulnerable", () => {
    const p = plan("subclass:troubadour:gifted-performer", "epic", { actor, targets: [adversary("a")] });
    expect(ofKind(p, "condition")).toEqual([{ kind: "condition", targetId: "a", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }]);
  });

  it("Heartbreaking Song: you and all allies within Close gain a Hope", () => {
    const p = plan("subclass:troubadour:gifted-performer", "heartbreaking", { actor, allies: [ally("b")] });
    expect(ofKind(p, "hope").map((h) => [h.targetId, h.delta])).toEqual([
      ["pc", 1],
      ["b", 1],
    ]);
    expect(p.actor.after.hope).toBe(3);
  });

  it("each song once per long rest; twice with Virtuoso (mastery)", () => {
    const fe = entry("subclass:troubadour:gifted-performer");
    const once = plan(fe.featureId, "epic", { actor, targets: [adversary("a")], holdings: holdingsOf(sheet) });
    const afterOnce = actorOf(sheet, { featureUses: once.actor.featureUses });
    expect(runFeature(fe, "epic", { actor: afterOnce, gmFear: 0, rng: queueRng([]), targets: [adversary("a")], holdings: holdingsOf(sheet) })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
    // The other songs are their own uses.
    expect(runFeature(fe, "heartbreaking", { actor: afterOnce, gmFear: 0, rng: queueRng([]) }).ok).toBe(true);

    const master = sheetOf("bard", "troubadour", { subclassRank: "mastery" });
    const virtuoso = holdingsOf(master);
    const second = plan(fe.featureId, "epic", { actor: afterOnce, targets: [adversary("a")], holdings: virtuoso });
    const afterTwice = actorOf(master, { featureUses: second.actor.featureUses });
    expect(runFeature(fe, "epic", { actor: afterTwice, gmFear: 0, rng: queueRng([]), targets: [adversary("a")], holdings: virtuoso })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Maestro (CB p.28)", () => {
  const actor = actorOf(sheetOf("bard", "troubadour", { subclassRank: "specialization" }));
  const fe = entry("subclass:troubadour:maestro");

  it("when you give a Rally Die to an ally, they gain a Hope or clear a Stress (their pick)", () => {
    expect(fe.uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouGiveDie", die: "rally" } });
    const hope = plan(fe.featureId, undefined, { actor, trigger: { subject: ally("b") }, options: { benefit: ["hope"] } });
    expect(ofKind(hope, "hope")).toEqual([{ kind: "hope", targetId: "b", delta: 1 }]);
    const stress = plan(fe.featureId, undefined, { actor, trigger: { subject: ally("b") }, options: { benefit: ["stress"] } });
    expect(ofKind(stress, "clear")).toEqual([{ kind: "clear", targetId: "b", track: "stress", amount: 1 }]);
    // Without a pick the ally is asked.
    expect(ofKind(plan(fe.featureId, undefined, { actor, trigger: { subject: ally("b") } }), "prompt")).toMatchObject([{ prompt: "choose" }]);
  });
});

describe("Rousing Speech (CB p.29)", () => {
  const sheet = sheetOf("bard", "wordsmith");
  const fe = entry("subclass:wordsmith:rousing-speech");

  it("once per long rest: every ally within Far clears 2 Stress (not you)", () => {
    const p = plan(fe.featureId, undefined, { actor: actorOf(sheet, { stress: 4 }), allies: [ally("b"), ally("c")] });
    expect(ofKind(p, "clear").map((c) => [c.targetId, c.amount])).toEqual([
      ["b", 2],
      ["c", 2],
    ]);
    expect(p.actor.after.stress).toBe(4);
    expect(fe.uses[0]!.steps[0]).toMatchObject({ pick: { range: "far", excludeSelf: true } });
    const used = actorOf(sheet, { featureUses: p.actor.featureUses });
    expect(runFeature(fe, undefined, { actor: used, gmFear: 0, rng: queueRng([]), allies: [ally("b")] })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
  });
});

describe("Eloquent (CB p.29)", () => {
  const fe = entry("subclass:wordsmith:eloquent");
  const special = sheetOf("bard", "wordsmith", { subclassRank: "specialization" });

  it("Help an Ally without spending Hope: a free d6 Help die, a d10 with Epic Poetry", () => {
    const p = plan(fe.featureId, undefined, { actor: actorOf(special), targets: [ally("b")], options: { option: ["help"] }, holdings: holdingsOf(special) });
    expect(ofKind(p, "help")).toEqual([{ kind: "help", targetId: "b", die: 6, free: true }]);
    expect(p.actor.after.hope).toBe(3);
    const master = sheetOf("bard", "wordsmith", { subclassRank: "mastery" });
    const epic = plan(fe.featureId, undefined, { actor: actorOf(master), targets: [ally("b")], options: { option: ["help"] }, holdings: holdingsOf(master) });
    expect(ofKind(epic, "help")).toEqual([{ kind: "help", targetId: "b", die: 10, free: true }]);
  });

  it("the mundane object and the extra downtime move are the table's; once per session", () => {
    const object = plan(fe.featureId, undefined, { actor: actorOf(special), targets: [ally("b")], options: { option: ["object"] } });
    expect(ofKind(object, "prompt")).toMatchObject([{ prompt: "manual", targetIds: ["b"], text: "Your ally finds a mundane object or tool they need." }]);
    const downtime = plan(fe.featureId, undefined, { actor: actorOf(special), targets: [ally("b")], options: { option: ["downtime"] } });
    expect(ofKind(downtime, "prompt")).toMatchObject([{ prompt: "manual", text: "Your ally takes an additional downtime move during their next rest." }]);
    expect(downtime.limit).toEqual({ key: "feat:subclass:wordsmith:eloquent", until: "session", consumed: true });
  });
});

describe("Epic Poetry (CB p.29)", () => {
  it("the Help die is a d10 (Q12); the Rally Die's d10 is Rally's upgrade", () => {
    const use = entry("subclass:wordsmith:epic-poetry").uses[0]!;
    expect(use.activation.kind).toBe("passive");
    expect(resolvedMods(use.mods!, actorOf(sheetOf("bard", "wordsmith")))).toEqual([{ kind: "set", stat: "helpDie", to: 10 }]);
    expect(entry("class:bard:rally").upgrades).toContainEqual(expect.objectContaining({ when: { kind: "feature", featureId: "subclass:wordsmith:epic-poetry" }, patch: { dieSides: 10 } }));
  });
});

describe("Virtuoso, Battlemage, Fueled by Fear, Have No Fear: no use of their own", () => {
  it("are passive markers without mods (the upgrade or the derived slot does the work)", () => {
    for (const id of ["subclass:troubadour:virtuoso", "subclass:school-of-war:battlemage", "subclass:school-of-war:fueled-by-fear", "subclass:school-of-war:have-no-fear"]) {
      const uses = entry(id).uses;
      expect(uses).toHaveLength(1);
      expect(uses[0]).toMatchObject({ activation: { kind: "passive" }, mods: [], steps: [] });
    }
  });
});

// ---------------------------------------------------------------- Wizard

describe("Not This Time (CB p.50, Q3)", () => {
  const fe = entry("hope:wizard");
  const actor = actorOf(sheetOf("wizard", "school-of-war"), { hope: 4 });

  it("a reaction in any adversary hit's window, the attacker within Far of the wizard", () => {
    expect(fe.uses[0]!.activation).toEqual({
      kind: "reaction",
      trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", attackerWithin: "far", stage: "succeeded" },
    });
    expect(fe.uses[0]!.targets).toEqual({ side: "trigger", who: "source" });
  });

  it("3 Hope: the attacker rerolls the attack roll or the damage roll", () => {
    const attack = plan(fe.featureId, undefined, { actor, trigger: { source: adversary("a"), subject: ally("b") }, options: { reroll: ["attack"] } });
    expect(attack.actor.after.hope).toBe(1);
    expect(ofKind(attack, "fold").map((f) => [f.step.kind, f.targetIds])).toEqual([["modifyRoll", ["a"]]]);
    expect(ofKind(attack, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", dice: "all" } });

    const damage = plan(fe.featureId, undefined, { actor, trigger: { source: adversary("a"), subject: ally("b") }, options: { reroll: ["damage"] } });
    expect(ofKind(damage, "fold").map((f) => [f.step.kind, f.targetIds])).toEqual([["modifyDamage", ["a"]]]);
    expect(ofKind(damage, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", atMost: 20 } });
  });

  it("refuses with fewer than 3 Hope", () => {
    expect(runFeature(fe, undefined, { actor: actorOf(sheetOf("wizard", "school-of-war"), { hope: 2 }), gmFear: 0, rng: queueRng([]), trigger: { source: adversary("a") }, options: { reroll: ["attack"] } })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Strange Patterns (CB p.50)", () => {
  const fe = entry("class:wizard:strange-patterns");
  const sheet = sheetOf("wizard", "school-of-knowledge", { classState: { strangeNumber: 7 } });
  const use = (choice: string, roll: RollRecord, s: CharacterSheet = sheet) =>
    runFeature(fe, undefined, { actor: actorOf(s), gmFear: 0, rng: queueRng([]), sheet: s, delegateRoll: roll, options: { benefit: [choice] } });

  it("your number on a Duality Die: gain a Hope or clear a Stress, once per roll (D5's record)", () => {
    const hope = use("hope", duality(7, 3, 12, "successHope"));
    if (!hope.ok) throw new Error(hope.detail);
    expect(hope.plan.actor.after.hope).toBe(4);
    expect(hope.sheet!.hope).toBe(4);
    const claimed = { ...hope.sheet!, featureUses: hope.plan.actor.featureUses };
    expect(use("stress", duality(7, 3, 12, "successHope"), claimed)).toMatchObject({ ok: false, reason: "choice", detail: "You already took the benefit for this roll." });

    const stress = use("stress", duality(2, 7, 11, "failFear"));
    if (!stress.ok) throw new Error(stress.detail);
    expect(stress.plan.actor.after.stress).toBe(0);
  });

  it("a roll without the number gives nothing (D5 refuses)", () => {
    expect(use("hope", duality(2, 3, 9, "failFear"))).toMatchObject({ ok: false, reason: "choice", detail: "Your latest roll shows no 7 on a Duality Die." });
  });
});

describe("Adept (CB p.50)", () => {
  it("Utilize an Experience with a Stress instead of a Hope: its modifier doubled", () => {
    const fe = entry("subclass:school-of-knowledge:adept");
    expect(fe.uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenYouUseExperience" } });
    const p = plan(fe.featureId, undefined, { actor: actorOf(sheetOf("wizard", "school-of-knowledge"), { stress: 1, hope: 2 }) });
    expect(p.actor.after).toMatchObject({ stress: 2, hope: 2 });
    expect(ofKind(p, "fold").map((f) => f.step)).toMatchObject([{ kind: "modifyRoll", change: { kind: "experience", change: "payWithStress", double: true } }]);
  });
});

describe("Perfect Recall (CB p.50)", () => {
  it("once per rest: the Recall Cost is 1 lower (left to the table: a vocabulary gap)", () => {
    const fe = entry("subclass:school-of-knowledge:perfect-recall");
    const sheet = sheetOf("wizard", "school-of-knowledge", { subclassRank: "specialization" });
    const p = plan(fe.featureId, undefined, { actor: actorOf(sheet) });
    expect(ofKind(p, "prompt")).toMatchObject([{ prompt: "manual" }]);
    expect(p.limit).toEqual({ key: "feat:subclass:school-of-knowledge:perfect-recall", until: "rest", consumed: true });
    expect(runFeature(fe, undefined, { actor: actorOf(sheet, { featureUses: p.actor.featureUses }), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
});

describe("Honed Expertise (CB p.50)", () => {
  const fe = entry("subclass:school-of-knowledge:honed-expertise");
  const actor = actorOf(sheetOf("wizard", "school-of-knowledge", { subclassRank: "mastery" }));

  it("using an Experience rolls a d6: on 5 or higher no Hope is spent", () => {
    const five = plan(fe.featureId, undefined, { actor, dice: [5] });
    expect(ofKind(five, "check")).toEqual([{ kind: "check", total: 5, dice: [5], passed: true }]);
    expect(ofKind(five, "fold").map((f) => f.step)).toMatchObject([{ kind: "modifyRoll", change: { kind: "experience", change: "freeOnCheck" } }]);
    const four = plan(fe.featureId, undefined, { actor, dice: [4] });
    expect(ofKind(four, "check")[0]!.passed).toBe(false);
    expect(ofKind(four, "fold")).toEqual([]);
  });
});

describe("Face Your Fear (CB p.51) with Fueled by Fear and Have No Fear", () => {
  const extra = (rank: CharacterSheet["subclassRank"], dice: number[]) => {
    const sheet = sheetOf("wizard", "school-of-war", { subclassRank: rank });
    const p = plan("subclass:school-of-war:face-your-fear", undefined, { actor: actorOf(sheet), targets: [adversary("a")], holdings: holdingsOf(sheet), dice });
    return ofKind(p, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);
  };

  it("on a success with Fear: +1d10 magic damage, 2d10 at specialization, 3d10 at mastery", () => {
    expect(entry("subclass:school-of-war:face-your-fear").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "successWithFear" } });
    expect(extra("foundation", [7])).toEqual([["modifyDamage", ["a"], 7]]);
    expect(extra("specialization", [7, 3])).toEqual([["modifyDamage", ["a"], 10]]);
    expect(extra("mastery", [7, 3, 9])).toEqual([["modifyDamage", ["a"], 19]]);
    const step = entry("subclass:school-of-war:face-your-fear").uses[0]!.steps[0]!;
    expect(step).toMatchObject({ change: { kind: "add", type: "magic" } });
  });

  it("rides on the attack's own damage: the magic dice join its total", () => {
    // A probe attack that deals 4 physical damage, with Face Your Fear's step after it.
    const use: CardUse = {
      id: "main",
      name: "probe",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "close", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: { kind: "fixed", value: 4 } }, type: "physical" }, ...entry("subclass:school-of-war:face-your-fear").uses[0]!.steps],
    };
    const result = run({ cardId: "probe", uses: [use] }, { actor: actorOf(sheetOf("wizard", "school-of-war")), gmFear: 0, rng: queueRng([6]), targets: [adversary("a")] });
    if (!result.ok) throw new Error(result.detail);
    expect(ofKind(result.plan, "damage")[0]!.result).toMatchObject({ targetId: "a", incoming: 10, taken: 10 });
  });
});

describe("Conjure Shield (CB p.51)", () => {
  const use = entry("subclass:school-of-war:conjure-shield").uses[0]!;
  const state = (hope: number) => ({
    hp: 0,
    hpMax: 6,
    stress: 0,
    stressMax: 6,
    armor: 0,
    hope,
    armorWorn: true,
    loadoutDomains: [],
    activeCardEffects: [],
    situations: [],
  });

  it("while you have at least 2 Hope (the engine reads it, no check box): + Proficiency to Evasion", () => {
    expect(unmetRequirements(use.requires, state(2))).toEqual([]);
    expect(unmetRequirements(use.requires, state(1))).toHaveLength(1);
    expect(resolvedMods(use.mods!, actorOf(sheetOf("wizard", "school-of-war"), { proficiency: 3 }))).toEqual([{ kind: "stat", stat: "evasion", delta: 3 }]);
  });
});

describe("Thrive in Chaos (CB p.51)", () => {
  it("on a successful attack, a Stress after the damage roll: the target marks one more Hit Point", () => {
    const fe = entry("subclass:school-of-war:thrive-in-chaos");
    expect(fe.uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } });
    const p = plan(fe.featureId, undefined, { actor: actorOf(sheetOf("wizard", "school-of-war", { subclassRank: "mastery" }), { stress: 1 }), targets: [adversary("a")] });
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "fold").map((f) => [f.step.kind, f.targetIds, f.amount])).toEqual([["adjustHpMarked", ["a"], 1]]);
    expect(ofKind(p, "fold")[0]!.step).toMatchObject({ change: "more" });
  });
});
