import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { MIDNIGHT_EFFECTS, MIDNIGHT_SITUATIONS as S } from "@/lib/srd/card-effects/midnight";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-midnight: every Midnight card's effect entry, run through the CA1 runner with fixed
// dice. Expected values come from the card text (CB p.336-337) by hand. RNG order: Hope die, Fear die, then damage dice,
// d20 reaction rolls and token dice in the order the steps need them. The default actor has Spellcast 3, Proficiency 2,
// Knowledge 3, 2 Hope and 1 of 6 Stress marked; the default adversary has Difficulty 12 and thresholds 8/14.

const actor = (over: Partial<ActorState> = {}): ActorState => ({
  id: "pc",
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 1,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 2,
  hopeMax: 6,
  traits: { agility: 2, strength: 0, finesse: 1, instinct: 1, presence: 1, knowledge: 3 },
  spellcast: 3,
  proficiency: 2,
  level: 9,
  tier: 4,
  loadoutDomains: ["midnight", "grace"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d6+2 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string): Combatant => ({ id, side: "pc", evasion: 12, thresholds: { major: 6, severe: 12 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, defeated: false, conditions: [] });

const effectOf = (cardId: string): CardEffect => {
  const effect = MIDNIGHT_EFFECTS.find((e) => e.cardId === cardId);
  if (!effect) throw new Error(`no entry for ${cardId}`);
  return effect;
};

/** Runs one use with fixed dice and checks every die was used. */
function plan(cardId: string, useId: string, dice: number[], over: Partial<RunContext> = {}): RunPlan {
  const rng = queueRng(dice);
  const result = run(effectOf(cardId), { actor: actor(), gmFear: 2, useId, rng, ...over });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}

const refusal = (cardId: string, useId: string, over: Partial<RunContext> = {}) =>
  run(effectOf(cardId), { actor: actor(), gmFear: 2, useId, rng: queueRng([]), ...over });

const ofKind = <K extends PlanStep["kind"]>(p: RunPlan, kind: K) => p.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const prompts = (p: RunPlan, prompt: "move" | "manual" | "choose") => ofKind(p, "prompt").filter((s) => s.prompt === prompt);
const damages = (p: RunPlan) => ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity, d.result.hpMarked]);
const folds = (p: RunPlan) => ofKind(p, "fold").map((f) => ({ kind: f.step.kind, targetIds: f.targetIds, amount: f.amount }));
const after = (p: RunPlan, id: string) => p.creatures.find((c) => c.id === id)?.after;
const midnight4 = actor({ loadoutDomains: ["midnight", "midnight", "midnight", "midnight", "grace"] });

describe("the Midnight table", () => {
  const usable = Object.entries(CARD_CLASSIFICATION.midnight)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Midnight card (no missing, extra or duplicate id)", () => {
    const ids = MIDNIGHT_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(19);
    const midnightIds = DOMAIN_CARDS.filter((c) => c.domain === "midnight").map((c) => c.id);
    for (const id of ids) expect(midnightIds).toContain(id);
    expect(ids).not.toContain("uncanny-disguise");
    expect(ids).not.toContain("mass-disguise");
  });

  it("every use runs through run() without throwing, with unique use ids", () => {
    for (const effect of MIDNIGHT_EFFECTS) {
      expect(new Set(effect.uses.map((u) => u.id)).size).toBe(effect.uses.length);
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: actor({ hope: (use.requires ?? []).some((r) => r.kind === "hopeAtMost") ? 0 : 6, cardTokens: 2, loadoutDomains: ["midnight", "midnight", "midnight", "midnight"], activeCardEffects: ["midnight-spirit", "veil-of-night", "phantom-retreat", "eclipse"] }),
          gmFear: 2,
          useId: use.id,
          targets: [adv("a")],
          picked: [adv("b")],
          allies: [ally("mira")],
          situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
          choices: { tokens: 1, fearDie: 4 },
          trigger: { source: adv("a"), subject: ally("mira"), amount: 2 },
          rng: () => 1,
        });
        expect(result.ok, `${effect.cardId}/${use.id}`).toBe(true);
      }
    }
  });
});

describe("Pick and Pull (L1, CB p.336)", () => {
  it("is a passive advantage on action rolls to pick locks, disarm traps or steal, once the player confirms the roll is one", () => {
    const use = effectOf("pick-and-pull").uses[0]!;
    expect(use.activation.kind).toBe("passive");
    expect(use.mods).toEqual([{ kind: "advantage", on: "action" }]);
    expect(plan("pick-and-pull", "main", [], { situations: [S.pickAndPull] }).steps).toEqual([]);
    expect(refusal("pick-and-pull", "main")).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Rain of Blades (L1, CB p.336): a Hope, all within Very Close, d8+2 using Proficiency, +1d8 if Vulnerable", () => {
  it("spends a Hope; every adversary hit takes 2d8+2 magic, a Vulnerable one 1d8 more, totalled before thresholds", () => {
    // 9 + 4 + Spellcast 3 = 16 beats both. 2d8+2 = 5 + 6 + 2 = 13 (Major, 2 HP); +1d8 = 7 on the Vulnerable one: 20 (Severe, 3 HP).
    const p = plan("rain-of-blades", "main", [9, 4, 5, 6, 7], { targets: [adv("a"), adv("b", { conditions: ["vulnerable"] })] });
    expect(ofKind(p, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "hope", amount: 1 }] });
    expect(ofKind(p, "damageRoll").map((d) => [d.type, d.record.total])).toEqual([["magic", 13], ["magic", 7]]);
    expect(damages(p)).toEqual([["a", 13, "major", 2], ["b", 20, "severe", 3]]);
    expect(p.actor.after.hope).toBe(2); // 2 - 1 spent + 1 from rolling with Hope
  });
  it("only targets the roll beats take damage; no Vulnerable target hit means no extra die", () => {
    // 6 + 5 + 3 = 14: hits a (12), misses b (16, Vulnerable). 2d8+2 = 1 + 2 + 2 = 5 (Minor).
    const p = plan("rain-of-blades", "main", [6, 5, 1, 2], { targets: [adv("a"), adv("b", { difficulty: 16, conditions: ["vulnerable"] })] });
    expect(p.hits).toEqual([{ id: "a", hit: true }, { id: "b", hit: false }]);
    expect(damages(p)).toEqual([["a", 5, "minor", 1]]);
  });
  it("a critical maximises both the 2d8 and the extra 1d8", () => {
    // Critical: 2d8+2 = 16 + 1 + 1 + 2 = 20; extra 1d8 = 8 + 1 = 9; Vulnerable target takes 29.
    const p = plan("rain-of-blades", "main", [5, 5, 1, 1, 1], { targets: [adv("a", { conditions: ["vulnerable"] })] });
    expect(p.roll?.critical).toBe(true);
    expect(damages(p)).toEqual([["a", 29, "severe", 3]]);
  });
  it("a miss still costs the Hope and deals nothing; with no Hope the card is refused", () => {
    const p = plan("rain-of-blades", "main", [2, 3], { targets: [adv("a")] });
    expect(p.success).toBe(false);
    expect(damages(p)).toEqual([]);
    expect(p.actor.after.hope).toBe(1);
    expect(p.gmFearDelta).toBe(1);
    expect(refusal("rain-of-blades", "main", { actor: actor({ hope: 0 }), targets: [adv("a")] })).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
});

describe("Midnight Spirit (L2, CB p.336)", () => {
  it("a Hope summons the spirit until your next rest; only one at a time", () => {
    const p = plan("midnight-spirit", "main", []);
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "effect")).toEqual([{ kind: "effect", targetId: "pc", label: "Midnight Spirit", mods: [], duration: "rest" }]);
    expect(p.exclusive).toBe(true);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
  it("sent to attack: Spellcast vs a target in Very Far, (Spellcast)d6 magic on a success, then it dissipates", () => {
    // 8 + 3 + 3 = 14 beats 12; 3d6 = 2 + 4 + 6 = 12 (Major).
    const p = plan("midnight-spirit", "attack", [8, 3, 2, 4, 6], { actor: actor({ activeCardEffects: ["midnight-spirit"] }), targets: [adv("a")] });
    expect(damages(p)).toEqual([["a", 12, "major", 2]]);
    expect(prompts(p, "manual")[0]!.text).toMatch(/dissipates/);
    expect(p.actor.after.hope).toBe(3); // no cost to send it; the roll's Hope
  });
  it("can't be sent without a summoned spirit", () => {
    expect(refusal("midnight-spirit", "attack", { targets: [adv("a")] })).toMatchObject({ ok: false, reason: "requirement", detail: "effectActive" });
  });
});

describe("Shadowbind (L2, CB p.336)", () => {
  it("Spellcast vs all adversaries in Very Close; those hit are temporarily Restrained", () => {
    // 7 + 5 + 3 = 15: hits a (12), misses b (16).
    const p = plan("shadowbind", "main", [7, 5], { targets: [adv("a"), adv("b", { difficulty: 16 })] });
    expect(ofKind(p, "condition")).toEqual([{ kind: "condition", targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }]);
    expect(after(p, "a")?.conditions).toEqual(["restrained"]);
    expect(after(p, "b")).toBeUndefined();
  });
});

describe("Chokehold (L3, CB p.336)", () => {
  it("behind a creature your size, a Stress makes it temporarily Vulnerable (the Chokehold tag)", () => {
    const p = plan("chokehold", "main", [], { targets: [adv("a")], situations: [S.chokehold] });
    expect(p.actor.after.stress).toBe(2);
    expect(after(p, "a")).toMatchObject({ conditions: ["vulnerable"], tags: ["Chokehold"] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ duration: "temporary" });
    expect(prompts(p, "manual")[0]!.text).toMatch(/extra 2d6 damage/);
    expect(refusal("chokehold", "main", { targets: [adv("a")] })).toMatchObject({ ok: false, reason: "requirement", detail: "situation" });
  });
  it("your successful attack on the choked target adds 2d6 by itself; any other target adds nothing", () => {
    const choked = adv("a", { conditions: ["vulnerable"], tags: ["Chokehold"] });
    const p = plan("chokehold", "extra-damage", [3, 4], { targets: [choked] });
    expect(p.activation).toBe("auto");
    expect(folds(p)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 7 }]);
    expect(folds(plan("chokehold", "extra-damage", [], { targets: [adv("b", { conditions: ["vulnerable"] })] }))).toEqual([]);
  });
});

describe("Veil of Night (L3, CB p.336)", () => {
  it("Spellcast (13): on a success the veil lasts until you cast another spell", () => {
    const p = plan("veil-of-night", "main", [7, 4]);
    expect(ofKind(p, "effect")).toEqual([{ kind: "effect", targetId: "pc", label: "Veil of Night", mods: [], duration: "manual", endsWhen: "you cast another spell" }]);
    expect(prompts(p, "manual")[0]!.text).toMatch(/Hidden to adversaries on the other side/);
    expect(p.exclusive).toBe(true);
    const fail = plan("veil-of-night", "main", [2, 3]);
    expect(ofKind(fail, "effect")).toEqual([]);
    expect(prompts(fail, "manual")).toEqual([]);
  });
  it("attacks through the darkness get advantage while the veil stands", () => {
    const veil = actor({ activeCardEffects: ["veil-of-night"] });
    const p = plan("veil-of-night", "attack-through", [], { actor: veil, situations: [S.veilAttack] });
    expect(p.activation).toBe("rider");
    expect(folds(p)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: undefined }]);
    expect(refusal("veil-of-night", "attack-through", { situations: [S.veilAttack] })).toMatchObject({ reason: "requirement" });
  });
});

describe("Glyph of Nightfall (L4, CB p.336)", () => {
  it("on a success a Hope (the roll's own may pay) lowers the target's Difficulty by Knowledge, temporarily", () => {
    const p = plan("glyph-of-nightfall", "main", [8, 3], { targets: [adv("a")] });
    expect(ofKind(p, "pay").at(-1)).toMatchObject({ phase: "afterRoll", paid: true });
    expect(ofKind(p, "effect")).toEqual([{ kind: "effect", targetId: "a", label: "Glyph of Nightfall", mods: [{ kind: "stat", stat: "difficulty", delta: -3 }], duration: "temporary" }]);
    expect(p.actor.after.hope).toBe(2);
  });
  it("Knowledge 0 still lowers it by 1 (minimum 1)", () => {
    const p = plan("glyph-of-nightfall", "main", [8, 3], { targets: [adv("a")], actor: actor({ traits: { agility: 2, strength: 0, finesse: 1, instinct: 1, presence: 1, knowledge: 0 } }) });
    expect(ofKind(p, "effect")[0]!.mods).toEqual([{ kind: "stat", stat: "difficulty", delta: -1 }]);
  });
  it("with no Hope to spend after a success with Fear, nothing happens", () => {
    const p = plan("glyph-of-nightfall", "main", [3, 8], { targets: [adv("a")], actor: actor({ hope: 0 }) });
    expect(ofKind(p, "pay").at(-1)).toMatchObject({ paid: false });
    expect(ofKind(p, "effect")).toEqual([]);
  });
});

describe("Stealth Expertise (L4, CB p.336)", () => {
  it("your sneaking roll with Fear: a Stress turns it into a roll with Hope", () => {
    const p = plan("stealth-expertise", "main", [], { situations: [S.sneakSelf] });
    expect(p.activation).toBe("reaction");
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "withHope" } }, targetIds: ["pc"] });
    expect(refusal("stealth-expertise", "main")).toMatchObject({ reason: "requirement" });
  });
  it("an ally's sneaking roll with Fear within Close: your Stress turns theirs into Hope", () => {
    const p = plan("stealth-expertise", "ally", [], { situations: [S.sneakAlly], trigger: { subject: ally("mira") } });
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "withHope" } }, targetIds: ["mira"] });
  });
});

describe("Hush (L5, CB p.336)", () => {
  it("on a success a Hope Silences the target and everything within Very Close of them until the listed ends", () => {
    const p = plan("hush", "main", [8, 3], { targets: [adv("a")], picked: [adv("b"), ally("mira")] });
    const silenced = ofKind(p, "effect");
    expect(silenced.map((e) => e.targetId)).toEqual(["a", "b", "mira"]);
    expect(silenced[0]).toMatchObject({ label: "Silenced (Hush)", mods: [{ kind: "flag", flag: "silenced" }], duration: "manual" });
    expect(silenced[0]!.endsWhen).toMatch(/you take Major damage/);
    expect(prompts(p, "manual")[0]!.text).toMatch(/follows the target/);
    expect(p.exclusive).toBe(true);
    expect(p.actor.after.hope).toBe(2);
  });
  it("a miss silences nobody and costs no Hope", () => {
    const p = plan("hush", "main", [2, 3], { targets: [adv("a")], picked: [adv("b")] });
    expect(ofKind(p, "effect")).toEqual([]);
    expect(ofKind(p, "pay")).toEqual([]);
    expect(p.actor.after.hope).toBe(2);
  });
});

describe("Phantom Retreat (L5, CB p.336)", () => {
  it("a Hope marks where you stand until your next rest; another Hope teleports you back", () => {
    const p = plan("phantom-retreat", "main", []);
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "effect")[0]).toMatchObject({ label: "Phantom Retreat", duration: "rest" });
    const back = plan("phantom-retreat", "return", [], { actor: actor({ activeCardEffects: ["phantom-retreat"] }) });
    expect(back.actor.after.hope).toBe(1);
    expect(prompts(back, "move")[0]).toMatchObject({ targetIds: ["pc"], step: { mode: "teleport" } });
    expect(prompts(back, "manual")[0]!.text).toMatch(/ends after you reappear/);
    expect(refusal("phantom-retreat", "return")).toMatchObject({ reason: "requirement" });
  });
});

describe("Dark Whispers (L6, CB p.336)", () => {
  it("a Stress and a Spellcast Roll against someone you've touched; on a success, one question for the GM", () => {
    const p = plan("dark-whispers", "main", [8, 3], { targets: [adv("a")], situations: [S.darkWhispers], options: { question: ["afraid"] } });
    expect(p.actor.after.stress).toBe(2);
    expect(prompts(p, "manual").map((m) => m.text)).toEqual(["Ask the GM: What are they afraid of?"]);
  });
  it("without a picked question the dialog asks; a miss asks nothing", () => {
    expect(prompts(plan("dark-whispers", "main", [8, 3], { targets: [adv("a")], situations: [S.darkWhispers] }), "choose")).toHaveLength(1);
    const miss = plan("dark-whispers", "main", [2, 3], { targets: [adv("a")], situations: [S.darkWhispers], options: { question: ["where"] } });
    expect(prompts(miss, "manual")).toEqual([]);
    expect(refusal("dark-whispers", "main", { targets: [adv("a")] })).toMatchObject({ reason: "requirement" });
  });
  it("speaking into a touched mind costs nothing", () => {
    const p = plan("dark-whispers", "channel", [], { targets: [ally("mira")], situations: [S.darkWhispers] });
    expect(prompts(p, "manual")[0]!.targetIds).toEqual(["mira"]);
    expect(p.actor.after).toEqual(p.actor.before);
  });
});

describe("Midnight-Touched (L7, CB p.337)", () => {
  it("once per rest, at 0 Hope, a Hope instead of the GM's Fear (needs 4 Midnight cards)", () => {
    const zero = actor({ ...midnight4, hope: 0 });
    const p = plan("midnight-touched", "hope", [], { actor: zero });
    expect(folds(p)).toEqual([{ kind: "negate", targetIds: ["pc"], amount: undefined }]);
    expect(p.actor.after.hope).toBe(1);
    expect(p.limit).toEqual({ key: "card:midnight-touched:hope", until: "rest", consumed: true });
    expect(refusal("midnight-touched", "hope", { actor: actor({ ...midnight4, hope: 1 }) })).toMatchObject({ reason: "requirement", detail: "hopeAtMost" });
    expect(refusal("midnight-touched", "hope", { actor: actor({ hope: 0 }) })).toMatchObject({ reason: "requirement", detail: "loadoutDomainCount" });
    expect(refusal("midnight-touched", "hope", { actor: actor({ ...zero, featureUses: p.actor.featureUses }) })).toMatchObject({ reason: "exhausted" });
  });
  it("on a successful attack, a Stress adds the Fear Die's result to the damage", () => {
    const p = plan("midnight-touched", "fear-die", [], { actor: midnight4, targets: [adv("a")], choices: { fearDie: 7 } });
    expect(p.activation).toBe("rider");
    expect(p.actor.after.stress).toBe(2);
    expect(folds(p)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 7 }]);
    expect(refusal("midnight-touched", "fear-die", { actor: midnight4, targets: [adv("a")], choices: { fearDie: 13 } })).toMatchObject({ reason: "choice" });
  });
});

describe("Vanishing Dodge (L7, CB p.337)", () => {
  it("a failed physical attack against you: a Hope makes you Hidden until your next action roll and teleports you near the attacker", () => {
    const use = effectOf("vanishing-dodge").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "failed", damageType: "physical" } });
    const p = plan("vanishing-dodge", "main", [], { trigger: { source: adv("ogre") } });
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "condition")).toEqual([{ kind: "condition", targetId: "pc", condition: { kind: "standard", condition: "hidden" }, duration: "nextRoll" }]);
    expect(prompts(p, "move")[0]).toMatchObject({ targetIds: ["pc"], step: { mode: "teleport", range: "close", relativeTo: "triggerSource" } });
  });
});

describe("Shadowhunter (L8, CB p.337)", () => {
  it("in low light or darkness: +1 Evasion and attack rolls with advantage", () => {
    const use = effectOf("shadowhunter").uses[0]!;
    expect(use.activation.kind).toBe("passive");
    expect(use.mods).toEqual([{ kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 1 } }, { kind: "advantage", on: "attack" }]);
    expect(plan("shadowhunter", "main", [], { situations: [S.shadowhunter] }).steps).toEqual([]);
    expect(refusal("shadowhunter", "main")).toMatchObject({ reason: "requirement" });
  });
});

describe("Spellcharge (L8, CB p.337)", () => {
  it("taking magic damage stores tokens equal to the HP you marked, up to your Spellcast", () => {
    const p = plan("spellcharge", "charge", [], { actor: actor({ cardTokens: 1 }), trigger: { amount: 1 } });
    expect(p.activation).toBe("auto");
    expect(ofKind(p, "tokens")).toEqual([{ kind: "tokens", op: "add", before: 1, after: 2 }]);
    expect(plan("spellcharge", "charge", [], { actor: actor({ cardTokens: 1 }), trigger: { amount: 3 } }).actor.after.cardTokens).toBe(3);
  });
  it("a successful attack: spend tokens for a d6 each on the damage", () => {
    const p = plan("spellcharge", "spend", [4, 5], { actor: actor({ cardTokens: 3 }), targets: [adv("a")], choices: { tokens: 2 } });
    expect(p.activation).toBe("rider");
    expect(folds(p)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 9 }]);
    expect(p.actor.after.cardTokens).toBe(1);
    expect(refusal("spellcharge", "spend", { targets: [adv("a")], choices: { tokens: 1 } })).toMatchObject({ reason: "choice" });
  });
});

describe("Night Terror (L9, CB p.337): save (16) or Horrified; stolen Fear as d6 damage", () => {
  it("those who fail are Horrified (Vulnerable); steal that much Fear and deal that many d6 to each Horrified target", () => {
    // Saves: a 10 (fails), b 17 (succeeds), c 3 (fails). 2 Horrified, the GM has 2 Fear: steal 2, 2d6 = 4 + 5 = 9 (Major).
    const p = plan("night-terror", "main", [10, 17, 3, 4, 5], { targets: [adv("a"), adv("b"), adv("c")] });
    expect(ofKind(p, "save").map((s) => [s.targetId, s.difficulty, s.success])).toEqual([["a", 16, false], ["b", 16, true], ["c", 16, false]]);
    expect(after(p, "a")).toMatchObject({ tags: ["Horrified"], conditions: ["vulnerable"] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ duration: "temporary" });
    expect(damages(p)).toEqual([["a", 9, "major", 2], ["c", 9, "major", 2]]);
    expect(p.gmFearDelta).toBe(-2);
    expect(p.limit).toEqual({ key: "card:night-terror", until: "longRest", consumed: true });
  });
  it("steals no more Fear than the GM has", () => {
    // Both fail, the GM has 1 Fear: steal 1, 1d6 = 6 to each.
    const p = plan("night-terror", "main", [2, 2, 6], { targets: [adv("a"), adv("b")], gmFear: 1 });
    expect(damages(p)).toEqual([["a", 6, "minor", 1], ["b", 6, "minor", 1]]);
    expect(p.gmFearDelta).toBe(-1);
    const empty = plan("night-terror", "main", [2], { targets: [adv("a")], gmFear: 0 });
    expect(after(empty, "a")).toMatchObject({ hp: 0, tags: ["Horrified"] });
    expect(empty.gmFearDelta).toBe(0);
  });
  it("is once per long rest, used by any use", () => {
    const used = actor({ featureUses: [{ key: "card:night-terror", until: "longRest" }] });
    expect(refusal("night-terror", "main", { actor: used, targets: [adv("a")] })).toMatchObject({ reason: "exhausted", detail: "Back after a long rest" });
  });
});

describe("Twilight Toll (L9, CB p.337)", () => {
  const tolled = (id: string) => adv(id, { tags: ["Twilight Toll"] });
  it("choosing a target clears the old tokens and marks the new target; one creature at a time", () => {
    const p = plan("twilight-toll", "main", [], { actor: actor({ cardTokens: 2 }), targets: [adv("a")] });
    expect(ofKind(p, "tokens")).toEqual([{ kind: "tokens", op: "clear", before: 2, after: 0 }]);
    expect(after(p, "a")).toMatchObject({ tags: ["Twilight Toll"] });
    expect(p.exclusive).toBe(true);
  });
  it("a success against the target that makes no damage roll places a token", () => {
    const p = plan("twilight-toll", "toll", [], { targets: [tolled("a")], situations: [S.twilightToll] });
    expect(p.actor.after.cardTokens).toBe(1);
    expect(plan("twilight-toll", "toll", [], { targets: [adv("b")], situations: [S.twilightToll] }).actor.after.cardTokens).toBe(0);
  });
  it("damaging the target: spend tokens for a d12 each; another target keeps the tokens", () => {
    const p = plan("twilight-toll", "strike", [5, 11], { actor: actor({ cardTokens: 2 }), targets: [tolled("a")], choices: { tokens: 2 } });
    expect(folds(p)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 16 }]);
    expect(p.actor.after.cardTokens).toBe(0);
    const other = plan("twilight-toll", "strike", [], { actor: actor({ cardTokens: 2 }), targets: [adv("b")], choices: { tokens: 2 } });
    expect(folds(other)).toEqual([]);
    expect(other.actor.after.cardTokens).toBe(2);
  });
  it("a rest clears the tokens", () => {
    expect(plan("twilight-toll", "rest", [], { actor: actor({ cardTokens: 3 }) }).actor.after.cardTokens).toBe(0);
  });
});

describe("Eclipse (L10, CB p.337)", () => {
  it("Spellcast (16), once per long rest on a success: attacks against you and allies within Far have disadvantage", () => {
    const p = plan("eclipse", "main", [9, 8], { allies: [ally("mira")] });
    expect(ofKind(p, "effect").map((e) => [e.targetId, e.mods, e.duration])).toEqual([
      ["pc", [{ kind: "disadvantageAgainst", on: "attack" }], "manual"],
      ["mira", [{ kind: "disadvantageAgainst", on: "attack" }], "manual"],
    ]);
    expect(ofKind(p, "effect")[0]!.endsWhen).toMatch(/Severe damage/);
    expect(p.limit).toEqual({ key: "card:eclipse", until: "longRest", consumed: true });
    const fail = plan("eclipse", "main", [2, 3], { allies: [ally("mira")] });
    expect(ofKind(fail, "effect")).toEqual([]);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("your success with Hope against an adversary in the shadow makes it mark a Stress", () => {
    const p = plan("eclipse", "shadow", [], { actor: actor({ activeCardEffects: ["eclipse"] }), targets: [adv("a")] });
    expect(p.activation).toBe("auto");
    expect(ofKind(p, "mark")).toEqual([{ kind: "mark", targetId: "a", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
    expect(refusal("eclipse", "shadow", { targets: [adv("a")] })).toMatchObject({ reason: "requirement" });
  });
});

describe("Specter of the Dark (L10, CB p.337)", () => {
  it("a Stress: Spectral, immune to physical damage, until you make an action roll targeting another creature", () => {
    const p = plan("specter-of-the-dark", "main", []);
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "pc",
        label: "Spectral: float and pass through solid objects",
        mods: [{ kind: "resistance", type: "physical", level: "immune" }],
        duration: "manual",
        endsWhen: "you make an action roll targeting another creature",
      },
    ]);
  });
});
