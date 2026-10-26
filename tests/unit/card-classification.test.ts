import { describe, expect, it } from "vitest";

import { STEP_KINDS, type CardEffect, type OutcomeStep, type Step } from "@/lib/domain/card-effects/types";
import { CARD_CLASSIFICATION, cardUsage } from "@/lib/srd/card-effects/classification";
import { CARD_EFFECTS, DOMAIN_EFFECT_TABLES, cardEffect, mergeEffectTables } from "@/lib/srd/card-effects/index";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { cardTokensSchema, characterSheetSchema, featureUseSchema } from "@/lib/validation/characters";

// Plan combat-actions, tracer CA0: the card classification, the empty registry, the vocabulary and the sheet widening.

const classified = Object.entries(CARD_CLASSIFICATION).flatMap(([domain, cards]) =>
  Object.entries(cards).map(([id, entry]) => ({ domain, id, ...entry })),
);

/** The 14 out-of-combat cards of the analysis (section 1.1). */
const OUT_OF_COMBAT = [
  "A Soldier's Bond",
  "Deft Deceiver",
  "Divination",
  "Endless Charisma",
  "Forager",
  "Gifted Tracker",
  "Master of the Craft",
  "Notorious",
  "Recovery",
  "Safe Haven",
  "Soothing Speech",
  "Uncanny Disguise",
  "Mass Disguise",
  "Nature's Tongue",
];

describe("card classification", () => {
  it("lists every card of DOMAIN_CARDS exactly once, under its own domain", () => {
    expect(classified).toHaveLength(DOMAIN_CARDS.length);
    expect(DOMAIN_CARDS).toHaveLength(210);
    const byId = new Map(classified.map((c) => [c.id, c.domain]));
    expect(byId.size).toBe(classified.length);
    for (const card of DOMAIN_CARDS) expect([card.id, byId.get(card.id)]).toEqual([card.id, card.domain]);
  });

  it("has 196 combat-usable cards and the analysis' 14 out-of-combat cards", () => {
    const out = classified.filter((c) => c.usage === "outOfCombat").map((c) => c.id);
    const names = DOMAIN_CARDS.filter((card) => out.includes(card.id)).map((card) => card.name);
    expect(names.sort()).toEqual([...OUT_OF_COMBAT].sort());
    expect(classified.filter((c) => c.usage !== "outOfCombat")).toHaveLength(196);
  });

  it("matches the per-domain combat counts of the analysis", () => {
    const usable = (domain: string) => classified.filter((c) => c.domain === domain && c.usage !== "outOfCombat").length;
    expect(Object.fromEntries(Object.keys(CARD_CLASSIFICATION).map((d) => [d, usable(d)]))).toEqual({
      arcana: 21,
      blade: 20,
      bone: 20,
      codex: 20,
      grace: 16,
      midnight: 19,
      sage: 18,
      splendor: 20,
      valor: 21,
      dread: 21,
    });
  });

  it("keeps how and usage consistent", () => {
    for (const c of classified) {
      if (c.usage === "outOfCombat") expect([c.id, c.how]).toEqual([c.id, "none"]);
      if (c.usage === "passive") expect(["passive", "auto"]).toContain(c.how);
      if (c.usage === "combat") expect(["action", "reaction", "rider", "mixed"]).toContain(c.how);
      expect(c.why.length).toBeGreaterThan(0);
    }
  });

  it("answers cardUsage, and an unknown card is out of combat", () => {
    expect(cardUsage("bolt-beacon")).toBe("combat");
    expect(cardUsage("untouchable")).toBe("passive");
    expect(cardUsage("forager")).toBe("outOfCombat");
    expect(cardUsage("no-such-card")).toBe("outOfCombat");
  });
});

describe("card-effect registry", () => {
  it("has one table per domain; every entry is a combat or passive card of that domain (the CE-* tracers fill them)", () => {
    expect(Object.keys(DOMAIN_EFFECT_TABLES)).toEqual(Object.keys(CARD_CLASSIFICATION));
    let total = 0;
    for (const [domain, table] of Object.entries(DOMAIN_EFFECT_TABLES)) {
      for (const effect of table) {
        expect(cardUsage(effect.cardId), effect.cardId).not.toBe("outOfCombat");
        expect(DOMAIN_CARDS.find((c) => c.id === effect.cardId)?.domain, effect.cardId).toBe(domain);
        total += 1;
      }
    }
    expect(CARD_EFFECTS.size).toBe(total);
    expect(cardEffect("no-such-card")).toBeUndefined();
  });

  it("merges tables by card id and refuses a card listed twice", () => {
    const a: CardEffect = { cardId: "reckless", uses: [] };
    const b: CardEffect = { cardId: "untouchable", uses: [] };
    expect([...mergeEffectTables([[a], [b]]).keys()]).toEqual(["reckless", "untouchable"]);
    expect(() => mergeEffectTables([[a], [a]])).toThrow("reckless");
  });
});

// ---------------------------------------------------------------- the vocabulary expresses the hard cases (Q13)

/** I Am Your Shield (CB p.341): a reaction in the adversary-hit window that redirects the hit and lifts the armor cap. */
const iAmYourShield: CardEffect = {
  cardId: "i-am-your-shield",
  uses: [
    {
      id: "main",
      name: "I Am Your Shield",
      activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
      costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }],
      steps: [
        { kind: "redirectDamage", to: "triggerSubject", target: "self" },
        { kind: "extraArmorSlots", to: "self", max: "any" },
      ],
    },
  ],
};

/** Bolt Beacon (CB p.340): pay a Hope on a success, d8+2 magic using Proficiency, temporarily Vulnerable. */
const boltBeacon: CardEffect = {
  cardId: "bolt-beacon",
  uses: [
    {
      id: "main",
      name: "Bolt Beacon",
      activation: { kind: "action" },
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }] },
        {
          kind: "damage",
          to: "targets",
          when: ["hit"],
          roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 8, plus: { kind: "fixed", value: 2 } } },
          type: "magic",
        },
        {
          kind: "condition",
          to: "targets",
          when: ["hit"],
          condition: { kind: "standard", condition: "vulnerable" },
          duration: "temporary",
          endsWhen: "glows brightly until this condition is cleared",
        },
      ],
    },
  ],
};

/** Book of Norai (CB p.333): Mystic Tether and Fireball as two uses; Fireball's save halves the damage. */
const bookOfNorai: CardEffect = {
  cardId: "book-of-norai",
  uses: [
    {
      id: "mystic-tether",
      name: "Mystic Tether",
      activation: { kind: "action" },
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" },
        { kind: "markStress", to: "targets", when: ["hit"], amount: { kind: "fixed", value: 1 } },
      ],
    },
    {
      id: "fireball",
      name: "Fireball",
      activation: { kind: "action" },
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "any", range: "veryFar", count: { kind: "one" }, area: "aroundTarget", areaRange: "veryClose" },
      steps: [
        {
          kind: "save",
          when: ["success"],
          to: "targets",
          difficulty: { kind: "fixed", value: 13 },
          onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 20, plus: { kind: "fixed", value: 5 } } }, type: "magic" }],
          onSuccess: [
            { kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 20, plus: { kind: "fixed", value: 5 } } }, type: "magic", scale: "half" },
          ],
        },
      ],
    },
  ],
};

/** Splintering Strike (CB p.332): once per long rest on a success, weapon damage split between the targets hit. */
const splinteringStrike: CardEffect = {
  cardId: "splintering-strike",
  uses: [
    {
      id: "main",
      name: "Splintering Strike",
      activation: { kind: "action" },
      limit: { per: "longRest", consumedOn: "success" },
      costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }],
      roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "weapon", count: { kind: "all" } },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon", distribution: "split", extraDiePerTarget: true },
      ],
    },
  ],
};

/** An adversary outcome AA0 reuses: Ka-Chomp's "must mark an Armor Slot without gaining its benefit". */
const kaChomp: OutcomeStep = { kind: "markArmor", to: "targets", when: ["hit"], amount: { kind: "fixed", value: 1 }, noBenefit: true };

function stepKinds(steps: readonly Step[]): string[] {
  return steps.flatMap((step) => {
    switch (step.kind) {
      case "optional":
      case "followUp":
        return [step.kind, ...stepKinds(step.steps)];
      case "choose":
        return [step.kind, ...step.options.flatMap((o) => stepKinds(o.steps))];
      case "save":
        return [step.kind, ...stepKinds(step.onFail), ...stepKinds(step.onSuccess)];
      case "check":
        return [step.kind, ...stepKinds(step.then), ...stepKinds(step.otherwise)];
      default:
        return [step.kind];
    }
  });
}

describe("card-effect vocabulary", () => {
  it("expresses I Am Your Shield, Bolt Beacon, Book of Norai, Splintering Strike and Ka-Chomp with listed step kinds", () => {
    const kinds = [iAmYourShield, boltBeacon, bookOfNorai, splinteringStrike]
      .flatMap((effect) => effect.uses)
      .flatMap((use) => stepKinds(use.steps))
      .concat(stepKinds([kaChomp]));
    expect(kinds.filter((k) => !(STEP_KINDS as readonly string[]).includes(k))).toEqual([]);
    expect(kinds).toEqual(expect.arrayContaining(["redirectDamage", "extraArmorSlots", "pay", "save", "markArmor"]));
  });

  it("lists each step kind once", () => {
    expect(new Set(STEP_KINDS).size).toBe(STEP_KINDS.length);
  });
});

describe("sheet widening (CA0)", () => {
  it("accepts card tokens and a sheet without them", () => {
    expect(cardTokensSchema.parse({ cardId: "dark-army", count: 8 })).toEqual({ cardId: "dark-army", count: 8 });
    expect(cardTokensSchema.safeParse({ cardId: "dark-army", count: -1 }).success).toBe(false);
    expect(characterSheetSchema.shape.cardTokens.safeParse(undefined).success).toBe(true);
  });

  it("takes card keys in featureUses", () => {
    expect(featureUseSchema.safeParse({ key: "card:sigil-of-retribution:main", until: "rest" }).success).toBe(true);
    expect(featureUseSchema.safeParse({ key: "k".repeat(81), until: "rest" }).success).toBe(false);
  });
});
