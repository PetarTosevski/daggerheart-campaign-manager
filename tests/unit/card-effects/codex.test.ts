import { describe, expect, it } from "vitest";

import { featureUseKey } from "@/lib/domain/card-effects/availability";
import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { CODEX_EFFECTS } from "@/lib/srd/card-effects/codex";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-codex: every Codex card through the runner with fixed dice. Expected values come from
// the card text (CB p.332-334) by hand. RNG order (CA1): Hope die, Fear die, then damage dice, d20s and checks in the
// order the steps need them. Every test checks that the dice it entered are all used (`done`).

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
  traits: { agility: 1, strength: 0, finesse: 1, instinct: 2, presence: 1, knowledge: 3 },
  spellcast: 3,
  proficiency: 2,
  level: 3,
  tier: 2,
  loadoutDomains: ["codex", "codex", "grace"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {},
  ...over,
});

/** A Bandit-like adversary: Difficulty 12, thresholds 8/14, 5 HP, 3 Stress (CB p.193). */
const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string): Combatant => ({ id, side: "pc", evasion: 12, thresholds: { major: 6, severe: 12 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, defeated: false, conditions: [] });

const effectOf = (cardId: string): CardEffect => {
  const effect = CODEX_EFFECTS.find((e) => e.cardId === cardId);
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
const prompts = (p: RunPlan, prompt: "move" | "manual" | "pcSave") => ofKind(p, "prompt").filter((s) => s.prompt === prompt);
const damages = (p: RunPlan) => ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity, d.result.hpMarked]);
const after = (p: RunPlan, id: string) => p.creatures.find((c) => c.id === id)?.after;

describe("the Codex table", () => {
  const codexIds = DOMAIN_CARDS.filter((c) => c.domain === "codex").map((c) => c.id);
  const usable = Object.entries(CARD_CLASSIFICATION.codex)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Codex card (no missing, extra or duplicate id)", () => {
    const ids = CODEX_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(20);
    for (const id of ids) expect(codexIds).toContain(id);
    expect(ids).not.toContain("safe-haven");
  });

  it("lists every grimoire spell as its own use, with unique use ids", () => {
    for (const card of DOMAIN_CARDS.filter((c) => c.domain === "codex" && c.type === "grimoire")) {
      const effect = effectOf(card.id);
      const spells = card.text.split("\n\n").map((p) => p.slice(0, p.indexOf(":")));
      for (const spell of spells) expect(effect.uses.map((u) => u.name)).toContain(spell);
      expect(new Set(effect.uses.map((u) => u.id)).size).toBe(effect.uses.length);
    }
  });

  it("every use runs through run() without throwing", () => {
    for (const effect of CODEX_EFFECTS) {
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: actor({ hope: 6, loadoutDomains: ["codex", "codex", "codex", "codex"], activeCardEffects: ["book-of-exota"] }),
          gmFear: 2,
          useId: use.id,
          targets: [adv("a")],
          situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
          roll: { difficulty: 10 },
          trigger: { source: adv("a"), subject: ally("mira"), amount: 5 },
          rng: () => 1,
        });
        expect(result.ok, `${effect.cardId}/${use.id}`).toBe(true);
      }
    }
  });
});

describe("Book of Ava (CB p.332)", () => {
  it("Power Push: Spellcast vs the target; knocked back to Far and d10+2 magic at Proficiency", () => {
    // 9 + 2 + Spellcast 3 = 14 vs 12; damage 4 + 6 + 2 = 12: Major, 2 HP.
    const p = plan("book-of-ava", "power-push", [9, 2, 4, 6], { targets: [adv("a")] });
    expect(p.hits).toEqual([{ id: "a", hit: true }]);
    expect(prompts(p, "move")[0]).toMatchObject({ text: "Knock back (far)", targetIds: ["a"] });
    expect(ofKind(p, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 12 } });
    expect(damages(p)).toEqual([["a", 12, "major", 2]]);
    expect(p.actor.after.hope).toBe(3);
  });
  it("Power Push misses: nothing happens, the GM gains a Fear", () => {
    const p = plan("book-of-ava", "power-push", [2, 3], { targets: [adv("a")] });
    expect(prompts(p, "move")).toEqual([]);
    expect(damages(p)).toEqual([]);
    expect(p.gmFearDelta).toBe(1);
  });
  it("Tava's Armor: a Hope for +1 Armor Score until the target's next rest; one target at a time", () => {
    const p = plan("book-of-ava", "tavas-armor", [], { targets: [ally("mira")] });
    expect(ofKind(p, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "hope", amount: 1 }] });
    expect(ofKind(p, "effect")).toEqual([
      { kind: "effect", targetId: "mira", label: "Tava's Armor", mods: [{ kind: "stat", stat: "armorScore", delta: 1 }], duration: "rest", endsWhen: "their next rest, or you cast Tava's Armor again" },
    ]);
    expect(p.exclusive).toBe(true);
    expect(refusal("book-of-ava", "tavas-armor", { actor: actor({ hope: 0 }) })).toMatchObject({ ok: false, reason: "cost" });
  });
  it("Ice Spike as a weapon: Spellcast vs the target, d6 physical at Proficiency; a critical starts from the maximum", () => {
    const p = plan("book-of-ava", "ice-spike", [9, 2, 3, 5], { targets: [adv("a")] });
    expect(damages(p)).toEqual([["a", 8, "major", 2]]);
    expect(ofKind(p, "damageRoll")[0]!.type).toBe("physical");
    // Critical against Difficulty 30: 12 + 3 + 5 = 20, Severe.
    const crit = plan("book-of-ava", "ice-spike", [7, 7, 3, 5], { targets: [adv("a", { difficulty: 30 })] });
    expect(damages(crit)).toEqual([["a", 20, "severe", 3]]);
  });
  it("Ice Spike not as a weapon: Spellcast (12) summons the spike", () => {
    expect(prompts(plan("book-of-ava", "ice-spike-summon", [8, 5]), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-ava", "ice-spike-summon", [2, 3]), "manual")).toHaveLength(0);
  });
});

describe("Book of Illiat (CB p.332)", () => {
  it("Slumber: on a hit the target is Asleep until it takes damage or the GM spends a Fear", () => {
    const p = plan("book-of-illiat", "slumber", [9, 2], { targets: [adv("a")] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Asleep" }, duration: "manual" });
    expect(after(p, "a")).toMatchObject({ tags: ["Asleep"] });
  });
  it("Arcane Barrage: once per rest, any Hope; that many d6 magic damage, no roll", () => {
    const p = plan("book-of-illiat", "arcane-barrage", [3, 5], { targets: [adv("a")], choices: { hope: 2 } });
    expect(p.roll).toBeNull();
    expect(p.actor.after.hope).toBe(0);
    expect(ofKind(p, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 8 } });
    expect(damages(p)).toEqual([["a", 8, "major", 2]]);
    expect(p.limit).toEqual({ key: "card:book-of-illiat:arcane-barrage", until: "rest", consumed: true });
    expect(refusal("book-of-illiat", "arcane-barrage", { choices: { hope: 3 }, targets: [adv("a")] })).toMatchObject({ reason: "cost" });
    expect(refusal("book-of-illiat", "arcane-barrage", { choices: { hope: 0 } })).toMatchObject({ reason: "choice" });
    const used = actor({ featureUses: [{ key: "card:book-of-illiat:arcane-barrage", until: "rest" }] });
    expect(refusal("book-of-illiat", "arcane-barrage", { actor: used, choices: { hope: 1 } })).toEqual({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
  it("Telepathy: a Hope, a target you can see; the link itself is for the table", () => {
    const p = plan("book-of-illiat", "telepathy", [], { targets: [adv("a")] });
    expect(p.actor.after.hope).toBe(1);
    expect(prompts(p, "manual")[0]).toMatchObject({ targetIds: ["a"] });
    expect(p.exclusive).toBe(true);
  });
});

describe("Book of Tyfar (CB p.332)", () => {
  it("Wild Flame: up to three in Melee; hit ones take 2d6 magic (not Proficiency) and mark a Stress", () => {
    // 14 beats 12 and 12, not 15. 2d6 = 2 + 3 = 5: Minor, 1 HP.
    const p = plan("book-of-tyfar", "wild-flame", [9, 2, 2, 3], { targets: [adv("a"), adv("b"), adv("c", { difficulty: 15 })] });
    expect(p.hits.map((h) => h.hit)).toEqual([true, true, false]);
    expect(ofKind(p, "damageRoll")).toHaveLength(1);
    expect(damages(p)).toEqual([
      ["a", 5, "minor", 1],
      ["b", 5, "minor", 1],
    ]);
    expect(ofKind(p, "mark").map((m) => [m.targetId, m.track, m.amount])).toEqual([
      ["a", "stress", 1],
      ["b", "stress", 1],
    ]);
    expect(refusal("book-of-tyfar", "wild-flame", { targets: [adv("a"), adv("b"), adv("c"), adv("d")] })).toMatchObject({ reason: "targets" });
  });
  it("Magic Hand is for the table", () => {
    expect(prompts(plan("book-of-tyfar", "magic-hand", []), "manual")).toHaveLength(1);
  });
  it("Mysterious Mist: Spellcast (13), the fog is for the table", () => {
    expect(prompts(plan("book-of-tyfar", "mysterious-mist", [8, 5]), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-tyfar", "mysterious-mist", [4, 5]), "manual")).toHaveLength(0);
  });
});

describe("Book of Sitil (CB p.332)", () => {
  it("Adjust Appearance is for the table", () => {
    expect(prompts(plan("book-of-sitil", "adjust-appearance", []), "manual")).toHaveLength(1);
  });
  it("Parallela: 2 Hope on you or an ally in Close; marks the bearer until their next attack; one creature at a time", () => {
    const p = plan("book-of-sitil", "parallela", [], { targets: [ally("mira")] });
    expect(p.actor.after.hope).toBe(0);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "mira", label: "Parallela", duration: "manual" });
    expect(prompts(p, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
    expect(p.exclusive).toBe(true);
  });
  it("Illusion: Spellcast (14)", () => {
    expect(prompts(plan("book-of-sitil", "illusion", [8, 5]), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-sitil", "illusion", [4, 5]), "manual")).toHaveLength(0);
  });
});

describe("Book of Vagras (CB p.332)", () => {
  it("Runic Lock: Spellcast (15), once per rest on a success (Q4)", () => {
    const p = plan("book-of-vagras", "runic-lock", [8, 5]);
    expect(p.limit).toEqual({ key: "card:book-of-vagras:runic-lock", until: "rest", consumed: true });
    expect(prompts(p, "manual")).toHaveLength(1);
    const fail = plan("book-of-vagras", "runic-lock", [4, 5]);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("Arcane Door: no adversary in Melee; Spellcast (13); on a success a Hope (the roll's own may pay) opens the portal", () => {
    const p = plan("book-of-vagras", "arcane-door", [8, 3], { nearestEnemy: 5 });
    expect(ofKind(p, "pay")[0]).toMatchObject({ phase: "afterRoll", paid: true });
    expect(p.actor.after.hope).toBe(2);
    expect(prompts(p, "move")[0]).toMatchObject({ targetIds: ["pc"], step: { mode: "teleport", range: "far" } });
    expect(refusal("book-of-vagras", "arcane-door", { nearestEnemy: 1 })).toMatchObject({ reason: "requirement" });
  });
  it("Reveal: a Spellcast Roll against the GM's Difficulty", () => {
    expect(prompts(plan("book-of-vagras", "reveal", [8, 3], { roll: { difficulty: 12 } }), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-vagras", "reveal", [2, 3], { roll: { difficulty: 12 } }), "manual")).toHaveLength(0);
  });
});

describe("Book of Korvax (CB p.332)", () => {
  it("Levitation: GM Difficulty; temporarily lifted and moved within Close of where they were", () => {
    const p = plan("book-of-korvax", "levitation", [6, 2], { targets: [adv("a")], roll: { difficulty: 10 } });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "a", condition: { tag: "Levitated" }, duration: "temporary" });
    expect(prompts(p, "move")[0]).toMatchObject({ text: "Move (close)", targetIds: ["a"] });
  });
  it("Recant: a Hope; the target's Reaction Roll (15), on a failure they forget", () => {
    const fail = plan("book-of-korvax", "recant", [10], { targets: [adv("a")] });
    expect(fail.actor.after.hope).toBe(1);
    expect(ofKind(fail, "save")[0]).toMatchObject({ targetId: "a", difficulty: 15, success: false });
    expect(prompts(fail, "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-korvax", "recant", [15], { targets: [adv("a")] }), "manual")).toHaveLength(0);
    expect(prompts(plan("book-of-korvax", "recant", [], { targets: [ally("mira")] }), "pcSave")).toHaveLength(1);
  });
  it("Rune Circle: a Stress; every adversary in Melee takes 2d12+4 magic (rolled once) and is knocked back to Very Close", () => {
    const p = plan("book-of-korvax", "rune-circle", [6, 5], { targets: [adv("a"), adv("b")] });
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "damageRoll")).toHaveLength(1);
    expect(damages(p)).toEqual([
      ["a", 15, "severe", 3],
      ["b", 15, "severe", 3],
    ]);
    expect(prompts(p, "move")[0]).toMatchObject({ text: "Knock back (veryClose)", targetIds: ["a", "b"] });
  });
  it("Rune Circle when an adversary enters: confirmed by the player, no Stress", () => {
    const situations = ["An adversary enters Melee range of your temporary Rune Circle"];
    const p = plan("book-of-korvax", "rune-circle-enter", [1, 1], { targets: [adv("a")], situations });
    expect(p.actor.after.stress).toBe(1);
    expect(damages(p)).toEqual([["a", 6, "minor", 1]]);
    expect(refusal("book-of-korvax", "rune-circle-enter", { targets: [adv("a")] })).toMatchObject({ reason: "requirement" });
  });
});

describe("Book of Norai (CB p.333)", () => {
  it("Mystic Tether: on a hit temporarily Restrained and a Stress; grounding a flyer is for the table", () => {
    const p = plan("book-of-norai", "mystic-tether", [9, 2], { targets: [adv("a")] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" });
    expect(after(p, "a")).toMatchObject({ conditions: ["restrained"], stress: 1 });
    expect(prompts(p, "manual")).toHaveLength(1);
    const miss = plan("book-of-norai", "mystic-tether", [2, 3], { targets: [adv("a")] });
    expect(miss.creatures).toEqual([]);
  });
  it("Fireball: roll vs the target; it and everyone within Very Close save (13); d20+5 at Proficiency once, half on a success", () => {
    // 8 + 5 + 3 = 16 vs 12. Target saves 5 (fail): 10 + 12 + 5 = 27. Blast: adversary b saves 15 (half, 14);
    // ally mira gets a PC reaction-roll prompt.
    const p = plan("book-of-norai", "fireball", [8, 5, 5, 10, 12, 15], { targets: [adv("a")], followUp: [adv("b", { thresholds: { major: 10, severe: 20 } }), ally("mira")] });
    expect(ofKind(p, "save").map((s) => [s.targetId, s.record.total, s.success])).toEqual([
      ["a", 5, false],
      ["b", 15, true],
    ]);
    expect(damages(p)).toEqual([
      ["a", 27, "severe", 3],
      ["b", 14, "major", 2],
    ]);
    expect(prompts(p, "pcSave")[0]).toMatchObject({ targetIds: ["mira"] });
  });
  it("Fireball misses the target: no explosion", () => {
    const p = plan("book-of-norai", "fireball", [2, 3], { targets: [adv("a")], followUp: [adv("b")] });
    expect(ofKind(p, "save")).toEqual([]);
    expect(damages(p)).toEqual([]);
  });
});

describe("Book of Exota (CB p.333)", () => {
  it("Repudiate: a Spellcast reaction roll (no Hope or Fear) against the GM's Difficulty; once per rest on a success it stops the effect", () => {
    const p = plan("book-of-exota", "repudiate", [8, 7], { roll: { difficulty: 14 } });
    expect(p.activation).toBe("reaction");
    expect(p.roll?.record.kind).toBe("reaction");
    expect(p.gmFearDelta).toBe(0);
    expect(ofKind(p, "fold")[0]).toMatchObject({ step: { kind: "negate", what: "effect" } });
    expect(p.limit).toEqual({ key: "card:book-of-exota:repudiate", until: "rest", consumed: true });
    const fail = plan("book-of-exota", "repudiate", [2, 3], { roll: { difficulty: 14 } });
    expect(ofKind(fail, "fold")).toEqual([]);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("Create Construct: a Hope; one construct at a time", () => {
    const p = plan("book-of-exota", "create-construct", []);
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "pc", label: "Construct" });
    expect(p.exclusive).toBe(true);
  });
  it("the construct attacks for 2d10+3 physical; only while it stands", () => {
    const p = plan("book-of-exota", "construct-attack", [9, 2, 4, 5], { targets: [adv("a")], actor: actor({ activeCardEffects: ["book-of-exota"] }) });
    expect(damages(p)).toEqual([["a", 12, "major", 2]]);
    expect(ofKind(p, "damageRoll")[0]!.type).toBe("physical");
    expect(refusal("book-of-exota", "construct-attack", { targets: [adv("a")] })).toMatchObject({ reason: "requirement" });
  });
  it("any other command: GM Difficulty", () => {
    const p = plan("book-of-exota", "construct-command", [8, 3], { actor: actor({ activeCardEffects: ["book-of-exota"] }), roll: { difficulty: 12 } });
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Book of Grynn (CB p.333)", () => {
  it("Arcane Deflection: once per long rest, a Hope negates an attack's damage on you or an ally in Very Close", () => {
    const p = plan("book-of-grynn", "arcane-deflection", [], { trigger: { subject: ally("mira"), amount: 12 } });
    expect(p.activation).toBe("reaction");
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "fold")).toEqual([{ kind: "fold", step: { kind: "negate", to: "triggerSubject", what: "damage" }, targetIds: ["mira"] }]);
    expect(p.limit).toEqual({ key: "card:book-of-grynn:arcane-deflection", until: "longRest", consumed: true });
  });
  it("Time Lock: the object stops; maintaining it is a Spellcast Roll against the creature", () => {
    expect(prompts(plan("book-of-grynn", "time-lock", []), "manual")).toHaveLength(1);
    const situations = ["A creature tries to move your time-locked object"];
    const hold = plan("book-of-grynn", "time-lock-maintain", [9, 2], { targets: [adv("a")], situations });
    expect(prompts(hold, "manual").map((m) => m.text)).toEqual(["Time Lock holds: the object doesn't move."]);
    const lose = plan("book-of-grynn", "time-lock-maintain", [2, 3], { targets: [adv("a")], situations });
    expect(prompts(lose, "manual").map((m) => m.text)).toEqual(["Time Lock ends: the creature moves the object."]);
  });
  it("Wall of Flame: Spellcast (15); whatever passes through later takes 4d10+3 magic", () => {
    expect(prompts(plan("book-of-grynn", "wall-of-flame", [8, 5]), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-grynn", "wall-of-flame", [4, 5]), "manual")).toHaveLength(0);
    const situations = ["A creature passes through your Wall of Flame"];
    const cross = plan("book-of-grynn", "wall-of-flame-cross", [1, 2, 3, 4], { targets: [adv("a")], situations });
    expect(damages(cross)).toEqual([["a", 13, "major", 2]]);
    const pc = plan("book-of-grynn", "wall-of-flame-cross", [1, 2, 3, 4], { targets: [ally("mira")], situations });
    expect(ofKind(pc, "pcDamage")).toEqual([{ kind: "pcDamage", targetId: "mira", amount: 13, type: "magic", direct: false }]);
  });
});

describe("Manifest Wall, Teleport (CB p.333)", () => {
  it("Manifest Wall: Spellcast (15); once per rest on a success, a Hope for the wall until your next rest", () => {
    const p = plan("manifest-wall", "main", [8, 5]);
    expect(p.actor.after.hope).toBe(2);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "pc", label: "Manifest Wall", duration: "rest" });
    expect(p.limit).toEqual({ key: "card:manifest-wall", until: "rest", consumed: true });
    expect(p.exclusive).toBe(true);
    const fail = plan("manifest-wall", "main", [4, 5]);
    expect(ofKind(fail, "pay")).toEqual([]);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("Teleport: once per long rest; the familiarity bonus goes on the Spellcast Roll (16)", () => {
    // 6 + 5 + 3 + 3 = 17: success.
    const p = plan("teleport", "main", [6, 5], { targets: [ally("mira")], choices: { familiarity: 3 } });
    expect(p.roll?.record.total).toBe(17);
    expect(p.success).toBe(true);
    expect(prompts(p, "move").map((m) => m.targetIds)).toEqual([["pc"], ["mira"]]);
    expect(prompts(p, "manual").map((m) => m.text)).toEqual(["You appear where you intended to go."]);
    expect(p.limit).toEqual({ key: "card:teleport", until: "longRest", consumed: true });
    // Only been there once: 6 + 5 + 3 − 2 = 12, off course; the use is still spent.
    const off = plan("teleport", "main", [6, 5], { choices: { familiarity: -2 } });
    expect(off.success).toBe(false);
    expect(prompts(off, "manual")[0]!.text).toMatch(/off course/);
    expect(off.limit?.consumed).toBe(true);
    expect(refusal("teleport", "main", { choices: { familiarity: 4 } })).toMatchObject({ reason: "choice" });
  });
});

describe("Banish (CB p.333)", () => {
  const banishKey = featureUseKey("banish", "main:banish");
  it("on a hit, Spellcast-many d20s; the highest is the Difficulty; a failed reaction roll banishes (once per rest)", () => {
    // 9 + 2 + 3 = 14 vs 12. d20s 4, 11, 7: Difficulty 11. Target rolls 5: banished.
    const p = plan("banish", "main", [9, 2, 4, 11, 7, 5], { targets: [adv("a")], optionals: ["banish"] });
    expect(ofKind(p, "save")[0]).toMatchObject({ targetId: "a", difficulty: 11, success: false });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Banished" }, duration: "manual" });
    expect(p.actor.featureUses).toEqual([{ key: banishKey, until: "rest" }]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
  it("a successful reaction roll marks a Stress instead", () => {
    const p = plan("banish", "main", [9, 2, 4, 11, 7, 15], { targets: [adv("a")], optionals: ["banish"] });
    expect(ofKind(p, "save")[0]).toMatchObject({ success: true });
    expect(after(p, "a")).toMatchObject({ stress: 1 });
    expect(ofKind(p, "condition")).toEqual([]);
    expect(p.actor.featureUses).toEqual([]);
  });
  it("after a banishment this rest, a failure banishes no one; the spell itself stays usable", () => {
    const used = actor({ featureUses: [{ key: banishKey, until: "rest" }] });
    const p = plan("banish", "main", [9, 2, 4, 11, 7, 5], { actor: used, targets: [adv("a")], optionals: ["banish"] });
    expect(ofKind(p, "condition")).toEqual([]);
  });
});

describe("Sigil of Retribution (CB p.333)", () => {
  const tagged = (id: string) => adv(id, { tags: ["Sigil of Retribution"] });
  it("marks an adversary in Close; the GM gains a Fear; a new cast ends the old mark", () => {
    const p = plan("sigil-of-retribution", "main", [], { targets: [adv("a")] });
    expect(after(p, "a")).toMatchObject({ tags: ["Sigil of Retribution"] });
    expect(p.gmFearDelta).toBe(1);
    expect(p.exclusive).toBe(true);
  });
  it("a d8 goes on the card when the marked adversary damages you or an ally, up to your level", () => {
    const p = plan("sigil-of-retribution", "gather-self", [], { trigger: { source: tagged("a") }, actor: actor({ cardTokens: 1 }) });
    expect(ofKind(p, "tokens")).toEqual([{ kind: "tokens", op: "add", before: 1, after: 2, die: 8 }]);
    const full = plan("sigil-of-retribution", "gather-ally", [], { trigger: { source: tagged("a"), subject: ally("mira") }, actor: actor({ cardTokens: 3 }) });
    expect(ofKind(full, "tokens")[0]).toMatchObject({ before: 3, after: 3 });
    const other = plan("sigil-of-retribution", "gather-self", [], { trigger: { source: adv("b") } });
    expect(ofKind(other, "tokens")).toEqual([]);
  });
  it("a successful attack on the marked adversary rolls the d8s into the damage, then clears them", () => {
    const p = plan("sigil-of-retribution", "strike", [3, 6], { targets: [tagged("a")], actor: actor({ cardTokens: 2 }) });
    expect(p.activation).toBe("rider");
    expect(ofKind(p, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage" }, targetIds: ["a"], amount: 9 });
    expect(ofKind(p, "tokens")[0]).toMatchObject({ op: "clear", before: 2, after: 0 });
    const other = plan("sigil-of-retribution", "strike", [], { targets: [adv("b")], actor: actor({ cardTokens: 2 }) });
    expect(ofKind(other, "fold")).toEqual([]);
    expect(other.actor.after.cardTokens).toBe(2);
  });
});

describe("Book of Homet, Codex-Touched, Book of Vyola (CB p.333)", () => {
  it("Pass Through: Spellcast (13), once per rest on a success; you and those touching you pass through", () => {
    const p = plan("book-of-homet", "pass-through", [8, 5], { targets: [ally("mira")] });
    expect(prompts(p, "move").map((m) => m.targetIds)).toEqual([["pc"], ["mira"]]);
    expect(p.limit).toEqual({ key: "card:book-of-homet:pass-through", until: "rest", consumed: true });
  });
  it("Plane Gate: Spellcast (14), once per long rest on a success", () => {
    const p = plan("book-of-homet", "plane-gate", [8, 6]);
    expect(p.limit).toEqual({ key: "card:book-of-homet:plane-gate", until: "longRest", consumed: true });
    expect(plan("book-of-homet", "plane-gate", [2, 3]).limit?.consumed).toBe(false);
  });
  it("Codex-Touched: with 4 Codex cards, a Stress adds Proficiency to a Spellcast Roll", () => {
    const four = actor({ loadoutDomains: ["codex", "codex", "codex", "codex", "grace"] });
    const p = plan("codex-touched", "proficiency", [], { actor: four });
    expect(p.activation).toBe("rider");
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "add" } }, amount: 2 });
    expect(refusal("codex-touched", "proficiency")).toMatchObject({ reason: "requirement" });
    const swap = plan("codex-touched", "swap", [], { actor: four });
    expect(swap.limit).toEqual({ key: "card:codex-touched:swap", until: "rest", consumed: true });
    expect(prompts(swap, "manual")).toHaveLength(1);
  });
  it("Memory Delve: Spellcast vs a target in Far; the question is for the GM", () => {
    expect(prompts(plan("book-of-vyola", "memory-delve", [9, 2], { targets: [adv("a")] }), "manual")).toHaveLength(1);
    expect(prompts(plan("book-of-vyola", "memory-delve", [2, 3], { targets: [adv("a")] }), "manual")).toHaveLength(0);
  });
  it("Shared Clarity: once per long rest, a Hope, two willing creatures linked until their next rest", () => {
    const p = plan("book-of-vyola", "shared-clarity", [], { targets: [ally("mira"), ally("tao")] });
    expect(p.actor.after.hope).toBe(1);
    expect(ofKind(p, "effect").map((e) => [e.targetId, e.label, e.duration])).toEqual([
      ["mira", "Shared Clarity", "rest"],
      ["tao", "Shared Clarity", "rest"],
    ]);
    expect(p.limit).toEqual({ key: "card:book-of-vyola:shared-clarity", until: "longRest", consumed: true });
    expect(refusal("book-of-vyola", "shared-clarity", { targets: [ally("a"), ally("b"), ally("c")] })).toMatchObject({ reason: "targets" });
  });
});

describe("Book of Ronin, Disintegration Wave, Book of Yarrow, Transcendent Union (CB p.334)", () => {
  it("Transform: Spellcast (15); you stay an object until you take damage", () => {
    const p = plan("book-of-ronin", "transform", [8, 5]);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "pc", label: "Transformed", duration: "manual" });
  });
  it("Eternal Enervation: once per long rest (spent even on a miss); on a hit permanently Vulnerable", () => {
    const p = plan("book-of-ronin", "eternal-enervation", [9, 2], { targets: [adv("a")] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "vulnerable" }, duration: "permanent" });
    expect(p.limit).toEqual({ key: "card:book-of-ronin:eternal-enervation", until: "longRest", consumed: true });
    const miss = plan("book-of-ronin", "eternal-enervation", [2, 3], { targets: [adv("a")] });
    expect(ofKind(miss, "condition")).toEqual([]);
    expect(miss.limit?.consumed).toBe(true);
  });
  it("Disintegration Wave: Spellcast (18), once per long rest on a success; a Stress per adversary of Difficulty 18 or lower, killed", () => {
    // 9 + 6 + 3 = 18. b (Difficulty 20) is dropped without telling its number (U1).
    const p = plan("disintegration-wave", "main", [9, 6], { targets: [adv("a"), adv("b", { difficulty: 20 }), adv("c", { difficulty: 18 })] });
    expect(p.excluded).toEqual(["b"]);
    expect(ofKind(p, "pay")[0]).toMatchObject({ phase: "afterRoll", costs: [{ resource: "stress", amount: 2 }], paid: true });
    expect(p.actor.after.stress).toBe(3);
    expect(ofKind(p, "defeat").map((d) => d.targetId)).toEqual(["a", "c"]);
    expect(after(p, "a")).toMatchObject({ defeated: true });
    expect(p.limit).toEqual({ key: "card:disintegration-wave", until: "longRest", consumed: true });
    const fail = plan("disintegration-wave", "main", [2, 3], { targets: [adv("a")] });
    expect(ofKind(fail, "defeat")).toEqual([]);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("Timejammer: Spellcast (18); everyone else within Far is stopped until your next roll that targets a creature", () => {
    const p = plan("book-of-yarrow", "timejammer", [9, 6], { targets: [adv("a"), ally("mira")] });
    expect(ofKind(p, "condition").map((c) => c.targetId)).toEqual(["a", "mira"]);
    expect(ofKind(p, "condition")[0]).toMatchObject({ condition: { tag: "Time-Stopped" }, duration: "manual" });
  });
  it("Magic Immunity: 5 Hope, immune to magic damage until your next rest", () => {
    const p = plan("book-of-yarrow", "magic-immunity", [], { actor: actor({ hope: 5 }) });
    expect(p.actor.after.hope).toBe(0);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "resistance", type: "magic", level: "immune" }], duration: "rest" });
    expect(refusal("book-of-yarrow", "magic-immunity", { actor: actor({ hope: 4 }) })).toMatchObject({ reason: "cost" });
  });
  it("Transcendent Union: once per long rest, 5 Hope; the willing creatures are linked until your next rest", () => {
    const p = plan("transcendent-union", "main", [], { actor: actor({ hope: 5 }), targets: [ally("mira"), ally("tao")] });
    expect(p.actor.after.hope).toBe(0);
    expect(ofKind(p, "effect").map((e) => e.targetId)).toEqual(["mira", "tao"]);
    expect(p.limit).toEqual({ key: "card:transcendent-union", until: "longRest", consumed: true });
  });
});
