import { describe, expect, it } from "vitest";

import { resolveNumber, type MapCreature, type NumberEnv } from "@/lib/domain/combat-actions/numbers";
import {
  EXPIRING_UNTIL,
  exhaustKey,
  featureLimitUntil,
  keyAvailability,
  limitPeriod,
  limitUntil,
  recordUse,
  recordUsedOn,
  requirementMet,
  stateCheckMet,
  unaffordableBy,
  usedOnBefore,
  usedOnKey,
  type CreatureFacts,
  type PayerState,
  type RequirementState,
  type StateFacts,
} from "@/lib/domain/card-effects/availability";
import type { CardEffect, CardUse, Limit, StateCheck } from "@/lib/domain/card-effects/types";
import { gainSlots, loseSlots, slotsFromMods } from "@/lib/domain/characters/slots";
import { passiveMods } from "@/lib/domain/feature-effects/passives";
import { queueRng } from "@/lib/domain/dice";
import { cardBadges, formFor, limitLabel, payerPrefix, type HandCard } from "@/components/combat-map/actions/hand/model";

// Plan lanes, tracer E5 (label w1-e5-checks-limits-numbers): the StateChecks, number sources, limits, payers and slot
// maximums tracer V widened (docs/tasks/TASK-LN-V.md), with fixture entries (wave 5 switches the SRD data over).
// Squares per range: Melee 1, Very Close 3, Close 6, Far 12 (combat-map/ranges.ts).

const state = (facts: StateFacts = {}, over: Partial<RequirementState> = {}): RequirementState => ({
  hp: 2,
  hpMax: 6,
  stress: 1,
  stressMax: 6,
  armor: 1,
  hope: 3,
  armorWorn: true,
  loadoutDomains: [],
  activeCardEffects: [],
  situations: [],
  facts,
  ...over,
});

const target = (over: Partial<CreatureFacts> = {}): CreatureFacts => ({ conditions: [], hp: 0, hpMax: 6, ...over });
const met = (check: StateCheck, facts: StateFacts = {}, over: Partial<RequirementState> = {}) => stateCheckMet(check, state(facts, over));

describe("state checks", () => {
  it("track: marks, free slots and Hope of the actor, the target or the subject (Spit Acid, Dreadhowl)", () => {
    // Spit Acid (CB p.210): "If they can't mark an Armor Slot" = free Armor Slots at most 0.
    const noArmor: StateCheck = { kind: "track", who: "target", track: "armor", measure: "free", atMost: 0 };
    expect(met(noArmor, { target: target({ armor: 3, armorMax: 3 }) })).toBe(true);
    expect(met(noArmor, { target: target({ armor: 2, armorMax: 3 }) })).toBe(false);
    expect(met(noArmor, { target: target({ armor: 2 }) })).toBeUndefined();
    expect(met(noArmor, {})).toBeUndefined();
    // Dreadhowl (CB p.222): "If a target is not able to lose a Hope" = Hope held at most 0.
    const noHope: StateCheck = { kind: "track", who: "target", track: "hope", measure: "marked", atMost: 0 };
    expect(met(noHope, { target: target({ hope: 0 }) })).toBe(true);
    expect(met(noHope, { target: target({ hope: 1 }) })).toBe(false);
    // The actor: Stress 1 of 6 = 5 free; Armor needs the slots in the facts.
    expect(met({ kind: "track", who: "self", track: "stress", measure: "free", atLeast: 5 })).toBe(true);
    expect(met({ kind: "track", who: "self", track: "armor", measure: "free", atLeast: 1 })).toBeUndefined();
    expect(met({ kind: "track", who: "self", track: "armor", measure: "free", atLeast: 1 }, { armorMax: 2 })).toBe(true);
    expect(met({ kind: "track", who: "self", track: "hope", measure: "free", atMost: 0 }, {}, { hopeMax: 3 })).toBe(true);
    expect(met({ kind: "track", who: "subject", track: "hp", measure: "marked", atLeast: 1 }, { subject: target({ hp: 1 }) })).toBe(true);
  });

  it("tokens: this card's tokens and named tokens on a creature (Feed, Invisibility, bramble tokens)", () => {
    // Feed (HF p.39): "While there are no tokens on this card".
    const none: StateCheck = { kind: "tokens", atMost: 0 };
    expect(met(none, { cardTokens: 0 })).toBe(true);
    expect(met(none, { cardTokens: 2 })).toBe(false);
    expect(met(none, {})).toBeUndefined();
    // Crush (CB p.218) needs 3 or more bramble tokens on the target.
    const brambles: StateCheck = { kind: "tokens", who: "target", name: "bramble", atLeast: 3 };
    expect(met(brambles, { target: target({ tokens: { bramble: 3 } }) })).toBe(true);
    expect(met(brambles, { target: target({ tokens: {} }) })).toBe(false);
    expect(met(brambles, { target: target() })).toBeUndefined();
    expect(met({ kind: "tokens", name: "tide", atLeast: 1 }, { tokens: { tide: 1 } })).toBe(true);
    expect(met({ kind: "tokens", who: "target", atLeast: 1 }, { target: target({ tokens: { bramble: 1 } }) })).toBeUndefined();
  });

  it("within: the target's distance (Kick, Tusks: 'a target within Melee range')", () => {
    const melee: StateCheck = { kind: "within", range: "melee", who: "target" };
    expect(met(melee, { target: target({ distance: 1 }) })).toBe(true);
    expect(met(melee, { target: target({ distance: 2 }) })).toBe(false);
    expect(met(melee, { target: target() })).toBeUndefined();
    expect(met({ kind: "within", range: "veryFar", who: "subject" }, { subject: target({ distance: 40 }) })).toBe(true);
  });

  it("allyNear, not and anyOf: Sneak Attack's 'while Cloaked or while an ally is within Melee range of your target'", () => {
    const sneak: StateCheck = {
      kind: "anyOf",
      checks: [
        { kind: "hasCondition", condition: { kind: "tag", tag: "Cloaked" } },
        { kind: "allyNear", range: "melee", of: "target" },
      ],
    };
    expect(met(sneak, { conditions: [], tags: ["Cloaked"], target: target({ nearestAlly: 5 }) })).toBe(true);
    expect(met(sneak, { conditions: [], tags: [], target: target({ nearestAlly: 1 }) })).toBe(true);
    expect(met(sneak, { conditions: [], tags: [], target: target({ nearestAlly: 2 }) })).toBe(false);
    // Not Cloaked, ally distance unknown: the player decides.
    expect(met(sneak, { conditions: [], tags: [], target: target() })).toBeUndefined();
    expect(met({ kind: "allyNear", range: "close", of: "self" }, { nearestAlly: 6 })).toBe(true);
    // Magical Weakness (CB p.231): "While Dazed, they can't use their Regeneration action".
    const notDazed: StateCheck = { kind: "not", check: { kind: "hasCondition", condition: { kind: "tag", tag: "Dazed" } } };
    expect(met(notDazed, { conditions: [], tags: ["Dazed"] })).toBe(false);
    expect(met(notDazed, { conditions: [], tags: [] })).toBe(true);
    expect(met(notDazed, {})).toBeUndefined();
  });

  it("weaponRange: Spirit Weapon's 'Melee or Very Close' and Surrounded's attacking Melee weapon", () => {
    const spirit: StateCheck = { kind: "weaponRange", weapon: "either", atMost: "veryClose" };
    expect(met(spirit, { weapons: { primary: "far", secondary: "melee" } })).toBe(true);
    expect(met(spirit, { weapons: { primary: "far", secondary: null } })).toBe(false);
    expect(met(spirit, { weapons: { primary: "far" } })).toBeUndefined();
    expect(met(spirit, {})).toBeUndefined();
    const surrounded: StateCheck = { kind: "weaponRange", weapon: "attacking", atMost: "melee" };
    expect(met(surrounded, { weapons: { attacking: "melee" } })).toBe(true);
    expect(met(surrounded, { weapons: { attacking: "veryClose" } })).toBe(false);
    expect(met(surrounded, { weapons: { attacking: null } })).toBe(false);
    expect(met({ kind: "weaponRange", weapon: "primary", atMost: "far" }, { weapons: { primary: "veryFar" } })).toBe(false);
  });

  it("holdsItem, usedArmor, moonPhase, usedOnBefore and inArea for another creature", () => {
    // Enchanted Talisman (HF p.16): "the person holding the talisman".
    const talisman: StateCheck = { kind: "holdsItem", item: "Enchanted Talisman", who: "subject" };
    expect(met(talisman, { subject: target({ items: ["Enchanted Talisman"] }) })).toBe(true);
    expect(met(talisman, { subject: target({ items: [] }) })).toBe(false);
    expect(met(talisman, { subject: target() })).toBeUndefined();
    expect(met({ kind: "holdsItem", item: "Rope", who: "self" }, { items: ["Rope"] })).toBe(true);
    expect(met({ kind: "usedArmor", used: false }, { usedArmor: false })).toBe(true);
    expect(met({ kind: "usedArmor", used: false }, { usedArmor: true })).toBe(false);
    expect(met({ kind: "usedArmor", used: true }, {})).toBeUndefined();
    expect(met({ kind: "moonPhase", phase: 6 }, { moonPhase: 6 })).toBe(true);
    expect(met({ kind: "moonPhase", phase: 6 }, { moonPhase: 1 })).toBe(false);
    expect(met({ kind: "usedOnBefore" }, { usedOnBefore: true })).toBe(true);
    expect(met({ kind: "usedOnBefore" }, {})).toBeUndefined();
    // Circle of Power (HF p.16): the roller stands in the circle.
    const circle: StateCheck = { kind: "inArea", featureId: "circle-of-power", who: "subject" };
    expect(met(circle, { subject: target({ areas: [{ featureId: "circle-of-power", own: false }] }) })).toBe(true);
    expect(met(circle, { subject: target({ areas: [] }) })).toBe(false);
    expect(met(circle, { subject: target() })).toBeUndefined();
  });

  it("a situation requirement with a new check: decided from the facts, else the player's box (Q13)", () => {
    // Shield Aura on yourself (CB p.341, dcm-qdm): the actor carries the 'Shield Aura' tag.
    const aura = { kind: "situation", text: "You have Shield Aura", check: { kind: "hasCondition", condition: { kind: "tag", tag: "Shield Aura" }, who: "self" } } as const;
    expect(requirementMet(aura, state({ conditions: [], tags: ["Shield Aura"] }))).toBe(true);
    expect(requirementMet(aura, state({ conditions: [], tags: [] }, { situations: ["You have Shield Aura"] }))).toBe(false);
    const kick = { kind: "situation", text: "The target is within Melee range", check: { kind: "within", range: "melee", who: "target" } } as const;
    expect(requirementMet(kick, state({}))).toBe(false);
    expect(requirementMet(kick, state({}, { situations: [kick.text] }))).toBe(true);
    expect(requirementMet(kick, state({ target: target({ distance: 1 }) }))).toBe(true);
  });
});

describe("per-target memory (Words of Discord, CB p.335: 'The next time you cast Words of Discord on them')", () => {
  it("records once per target and answers usedOnBefore", () => {
    const key = "card:words-of-discord";
    let uses = recordUsedOn([], key, "adv-1");
    uses = recordUsedOn(uses, key, "adv-1");
    // Wave 9 E5.3 (dcm-pg8x): the memory lasts the whole campaign.
    expect(uses).toEqual([{ key: usedOnKey(key, "adv-1"), until: "campaign" }]);
    expect(usedOnBefore({ featureUses: uses }, key, "adv-1")).toBe(true);
    expect(usedOnBefore({ featureUses: uses }, key, "adv-2")).toBe(false);
    expect(recordUsedOn([], key, "adv-1", "longRest")).toEqual([{ key: usedOnKey(key, "adv-1"), until: "longRest" }]);
    // The memory does not use up the card itself.
    expect(keyAvailability({ featureUses: uses }, key).state).toBe("ready");
  });
});

describe("limits", () => {
  it("limitPeriod: the period when a limit names one (Resurrection's week, CB p.341), else per", () => {
    expect(limitPeriod({ per: "session", period: "week", consumedOn: "failure" })).toBe("week");
    expect(limitPeriod({ per: "rest" })).toBe("rest");
    expect(limitLabel({ per: "session", period: "week", consumedOn: "failure" })).toBe("Once per week on a failure");
    expect(limitLabel({ per: "scene", period: "gmTurn" })).toBe("Once per GM turn");
    expect(limitLabel({ per: "session", period: "day" })).toBe("Once per day");
  });

  it("round 2: limitUntil / featureLimitUntil take the Limit; since wave 9 (dcm-bc67) they store the real period", () => {
    // Resurrection (CB p.341: "you can't cast Resurrection again for a week"): `expire` ends `week` (dcm-55k).
    const resurrection: Limit = { per: "session", period: "week", consumedOn: "failure" };
    expect(limitUntil(resurrection)).toBe("week");
    expect(featureLimitUntil(resurrection)).toBe("week");
    expect(recordUse([], "card:resurrection", resurrection)).toEqual([{ key: "card:resurrection", until: "week" }]);
    // Summon Tormentors (CB p.237: "Once per day") and Ravenous (HF p.97: "Once per GM turn") likewise.
    expect(featureLimitUntil({ per: "session", period: "day" })).toBe("day");
    expect(featureLimitUntil({ per: "scene", period: "gmTurn" })).toBe("gmTurn");
    expect(limitUntil({ per: "scene", period: "gmTurn" })).toBe("gmTurn");
    // Without a period, the Limit and its `per` store the same; cards keep scene as session.
    expect(limitUntil({ per: "longRest" })).toBe("longRest");
    expect(limitUntil({ per: "scene" })).toBe(limitUntil("scene"));
    expect(featureLimitUntil({ per: "scene" })).toBe("scene");
    expect([...EXPIRING_UNTIL].sort()).toEqual(["day", "gmTurn", "longRest", "rest", "scene", "session", "week"]);
    // Every stored period has a label and an order (an entry already stored with `week` still reads right).
    expect(keyAvailability({ featureUses: [{ key: "k", until: "rest" }, { key: "k", until: "week" }] }, "k")).toEqual({
      state: "exhausted",
      until: "week",
      label: "Back in a week",
    });
  });

  it("exhaustKey: Rune Ward's Ward Die 8 spends the ward until the next rest (CB p.328)", () => {
    const key = "card:rune-ward";
    const spent = exhaustKey([], key, "rest");
    expect(keyAvailability({ featureUses: spent }, key)).toEqual({ state: "exhausted", until: "rest", label: "Back after a rest" });
    // A limit of 3: entries are topped up to 3, not added on top.
    const three = exhaustKey([{ key, until: "rest" }], key, "longRest", 3);
    expect(three).toHaveLength(3);
    expect(keyAvailability({ featureUses: three }, key, { per: "rest", times: 3 }).state).toBe("exhausted");
    expect(exhaustKey(three, key, "rest", 3)).toHaveLength(3);
  });
});

describe("costs paid by another PC (Tactician, CB p.333; Rune Ward's holder, CB p.328)", () => {
  const payer = (hope: number): PayerState => ({ hope, stress: 0, stressMax: 6, hp: 0, hpMax: 6, armor: 0, armorMax: 3, cardTokens: 0 });
  const hope = [{ resource: "hope" as const, amount: 1 }];
  it("checks the paying creature's resources, not the actor's", () => {
    expect(unaffordableBy(hope, "triggerSubject", { self: payer(3), triggerSubject: payer(0) })).toEqual(["hope"]);
    expect(unaffordableBy(hope, "triggerSubject", { self: payer(0), triggerSubject: payer(1) })).toEqual([]);
    expect(unaffordableBy(hope, undefined, { self: payer(0) })).toEqual(["hope"]);
    expect(unaffordableBy(hope, "picked", { self: payer(3) })).toBeNull();
  });

  it("the Hand's badges name who pays", () => {
    expect(payerPrefix(undefined)).toBe("");
    const use: CardUse = {
      id: "main",
      name: "Rune Ward",
      activation: { kind: "action" },
      paidBy: "triggerSubject",
      costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }],
      steps: [{ kind: "pay", costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }], paidBy: "picked", when: ["success"] }],
    };
    const effect = { cardId: "fixture", uses: [use] } as unknown as CardEffect;
    const card = { state: "ready", uses: [{ useId: "main", activation: "action" }] } as unknown as Pick<HandCard, "state" | "uses">;
    expect(cardBadges(card, effect).map((b) => b.text)).toEqual(["They pay: 1 Hope", "On a success: the ally pays: 1 Stress"]);
  });
});

describe("Attack of Opportunity (CB p.48): 'a reaction roll using a trait of your choice'", () => {
  it("asks for any of the six traits", () => {
    const use: CardUse = {
      id: "main",
      name: "Attack of Opportunity",
      activation: { kind: "action" },
      roll: { kind: "reaction", trait: "agility", anyTrait: true, difficulty: { kind: "gm" } },
      steps: [],
    };
    expect(formFor(use).traits).toEqual(["agility", "strength", "finesse", "instinct", "presence", "knowledge"]);
    expect(formFor({ ...use, roll: { kind: "reaction", trait: "agility", difficulty: { kind: "gm" } } }).traits).toBeNull();
  });
});

describe("number sources", () => {
  const rng = queueRng([]);
  const env = (over: Partial<NumberEnv> = {}): NumberEnv => ({
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    spellcast: 0,
    proficiency: 1,
    level: 1,
    tier: 1,
    spent: {},
    choices: {},
    cardTokens: 0,
    gmFear: 0,
    self: { hp: 1, stress: 2, armor: 1, hpMax: 6, stressMax: 5, armorMax: 3, stats: { armorScore: 4 }, gold: { handfuls: 3, bags: 2 }, tokens: { tide: 2 } },
    target: { id: "t", hp: 0, stress: 0, stats: { majorThreshold: 11, severeThreshold: 20 }, tokens: { bramble: 3 } },
    markedThisMove: { self: {}, byTarget: {} },
    targetCount: { picked: 0, hit: 0, failedSave: 0 },
    loadoutDomains: [],
    vaultDomains: [],
    ...over,
  });

  it("free slots (Confusing Aura's 'any number of Stress')", () => {
    expect(resolveNumber({ kind: "free", who: "self", track: "stress" }, env(), rng)).toBe(3);
    expect(resolveNumber({ kind: "free", who: "self", track: "armor" }, env(), rng)).toBe(2);
    expect(resolveNumber({ kind: "free", who: "target", track: "hp" }, env(), rng)).toBe(0);
  });

  it("stat: Armored Shell's Armor Score (CB p.33) and Blade of the Forest's 'target's Major threshold' (CB p.231)", () => {
    expect(resolveNumber({ kind: "stat", stat: "armorScore", who: "self" }, env(), rng)).toBe(4);
    expect(resolveNumber({ kind: "stat", stat: "majorThreshold", who: "target" }, env(), rng)).toBe(11);
    expect(resolveNumber({ kind: "stat", stat: "evasion", who: "target" }, env(), rng)).toBe(0);
    // 3d4 + the target's Major threshold.
    const blade = { kind: "sum", of: [{ kind: "dice", dice: { count: { kind: "fixed", value: 3 }, sides: 4 } }, { kind: "stat", stat: "majorThreshold", who: "target" }] } as const;
    expect(resolveNumber(blade, env(), queueRng([1, 2, 3]))).toBe(17);
  });

  it("creatureCount: Hive Mind, Shallow Cuts, Stolen Armor (HF p.65-67)", () => {
    const creatures: MapCreature[] = [
      { id: "me", side: "self", pc: false, name: "Mechanorb", fromTarget: 4 },
      { id: "m2", side: "ally", pc: false, name: "Mechanorb", fromSelf: 5, fromTarget: 1 },
      { id: "m3", side: "ally", pc: false, name: "Mechanorb", fromSelf: 9 },
      { id: "s1", side: "ally", pc: false, name: "Skinner", fromSelf: 2, fromTarget: 1 },
      { id: "pc1", side: "enemy", pc: true, fromSelf: 4 },
      { id: "pc2", side: "enemy", pc: true },
    ];
    const e = env({ creatures });
    // Hive Mind: "+1 per other Mechanorb within Close".
    expect(resolveNumber({ kind: "creatureCount", side: "allies", name: "Mechanorb", within: "close", excludeSelf: true }, e, rng)).toBe(1);
    // Shallow Cuts: each Skinner within Melee of the PC.
    expect(resolveNumber({ kind: "creatureCount", side: "allies", name: "Skinner", within: "melee", of: "target" }, e, rng)).toBe(1);
    // Stolen Armor: the number of PCs.
    expect(resolveNumber({ kind: "creatureCount", side: "pcs" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "creatureCount", side: "enemies", within: "veryClose" }, e, rng)).toBe(0);
    expect(resolveNumber({ kind: "creatureCount", side: "all" }, e, rng)).toBe(6);
    expect(resolveNumber({ kind: "creatureCount", side: "allies", within: "far" }, e, rng)).toBe(4);
    expect(resolveNumber({ kind: "creatureCount", side: "all" }, env(), rng)).toBe(0);
  });

  it("gold, creature tokens, duality, class dice and tide tokens", () => {
    expect(resolveNumber({ kind: "gold", who: "self" }, env(), rng)).toBe(23);
    expect(resolveNumber({ kind: "gold", who: "self", unit: "bag" }, env(), rng)).toBe(2);
    expect(resolveNumber({ kind: "gold", who: "target" }, env(), rng)).toBe(0);
    expect(resolveNumber({ kind: "creatureTokens", who: "target", name: "bramble" }, env(), rng)).toBe(3);
    expect(resolveNumber({ kind: "dualityDie", die: "fear" }, env({ dualityDice: { hope: 4, fear: 9 } }), rng)).toBe(9);
    expect(resolveNumber({ kind: "dualityDie", die: "hope" }, env(), rng)).toBe(0);
    expect(resolveNumber({ kind: "classDie", die: "unstoppable" }, env({ classDice: { unstoppable: 3 } }), rng)).toBe(3);
    expect(resolveNumber({ kind: "tideTokens" }, env({ tideTokens: 2 }), rng)).toBe(2);
  });
});

describe("Hit Point and Stress slot maximums (Vitality, CB p.330; At Ease, CB p.36)", () => {
  it("slotsFromMods reads fixed hpMax / stressMax mods", () => {
    expect(
      slotsFromMods([
        { kind: "stat", stat: "hpMax", delta: { kind: "fixed", value: 1 } },
        { kind: "stat", stat: "stressMax", delta: { kind: "fixed", value: 1 } },
        { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 } },
        { kind: "stat", stat: "hpMax", delta: { kind: "proficiency" } },
      ]),
    ).toEqual({ hp: 1, stress: 1 });
  });

  it("gainSlots raises a maximum once per key; loseSlots takes it back", () => {
    const sheet = { hp: 6, hpMax: 6, stress: 6, stressMax: 6, slotBonuses: [] as string[] };
    const once = gainSlots(sheet, "card:vitality:hp", { hp: 1, stress: 0 });
    expect(once).toMatchObject({ hpMax: 7, stressMax: 6, slotBonuses: ["card:vitality:hp"] });
    expect(gainSlots(once, "card:vitality:hp", { hp: 1, stress: 0 })).toBe(once);
    expect(gainSlots(sheet, "nothing", { hp: 0, stress: 0 })).toBe(sheet);
    expect(loseSlots(once, "card:vitality:hp", { hp: 1, stress: 0 })).toMatchObject({ hpMax: 6, hp: 6, slotBonuses: [] });
  });

  it("passiveMods reports no slots for a sheet whose passives name none", () => {
    expect(passiveMods({ level: 1, subclassId: "" }).slots).toEqual({ hp: 0, stress: 0 });
  });
});
