import { describe, expect, it } from "vitest";

import { run, type ActorState, type RunResult } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { CARD_CLASSIFICATION, CARD_EFFECTS, DOMAIN_EFFECT_TABLES } from "@/lib/srd/card-effects";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CA8 (U3: "Automate EVERY domain card that can be used in combat"). Across all ten
// domains: every card classified combat or passive has exactly one effect entry and every out-of-combat card has none;
// every use of every entry runs through the CA1 runner without throwing, in one generic context (a rich actor, a
// target, an ally, a trigger and every situation confirmed). The per-domain tests (CE-*) check each card's numbers;
// this one checks nothing slipped between the tables. It prints how many `manual` steps (Q9: the card's words plus a
// Done button, left to the table) each domain's table holds.

const actor = (over: Partial<ActorState> = {}): ActorState => ({
  id: "pc",
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 6,
  hopeMax: 6,
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 1, presence: 1, knowledge: 2 },
  spellcast: 2,
  proficiency: 2,
  level: 10,
  tier: 4,
  loadoutDomains: [],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 3,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "agility", damageType: "physical", range: "melee" } },
  ...over,
});

const adv = (id: string): Combatant => ({
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
});

const ally = (id: string): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 6, severe: 12 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
});

/** Every object in a table entry whose `kind` is "manual" (steps, nested branches, choose options), counted. */
function manualSteps(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + manualSteps(v), 0);
  if (value === null || typeof value !== "object") return 0;
  const own = (value as { kind?: unknown }).kind === "manual" ? 1 : 0;
  return own + Object.values(value).reduce<number>((n, v) => n + manualSteps(v), 0);
}

/** Every situation text a use asks the player to confirm. */
function situationsOf(effect: CardEffect): string[] {
  return effect.uses.flatMap((u) => (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])));
}

const combatOrPassive = Object.entries(CARD_CLASSIFICATION).flatMap(([domain, cards]) =>
  Object.entries(cards)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => ({ domain, id })),
);

describe("card effect coverage across every domain (U3)", () => {
  it("every card classified combat or passive has exactly one effect entry, in its own domain's table", () => {
    const missing = combatOrPassive.filter(({ id }) => !CARD_EFFECTS.has(id)).map(({ id }) => id);
    expect(missing).toEqual([]);
    for (const { domain, id } of combatOrPassive) {
      expect(
        DOMAIN_EFFECT_TABLES[domain]!.some((e) => e.cardId === id),
        `${id} in the ${domain} table`,
      ).toBe(true);
    }
    const all = Object.values(DOMAIN_EFFECT_TABLES).flatMap((t) => t.map((e) => e.cardId));
    expect(new Set(all).size).toBe(all.length);
  });

  it("no out-of-combat card has an entry, and every entry is a real card", () => {
    const cardIds = new Set(DOMAIN_CARDS.map((c) => c.id));
    const outOfCombat = Object.values(CARD_CLASSIFICATION).flatMap((cards) => Object.entries(cards).filter(([, c]) => c.usage === "outOfCombat").map(([id]) => id));
    expect(outOfCombat.filter((id) => CARD_EFFECTS.has(id))).toEqual([]);
    expect([...CARD_EFFECTS.keys()].filter((id) => !cardIds.has(id))).toEqual([]);
    expect(CARD_EFFECTS.size).toBe(combatOrPassive.length);
  });

  it("every use of every entry runs through run() without throwing", () => {
    const refused: string[] = [];
    let runs = 0;
    for (const effect of CARD_EFFECTS.values()) {
      const card = DOMAIN_CARDS.find((c) => c.id === effect.cardId)!;
      const useIds = effect.uses.map((u) => u.id);
      expect(new Set(useIds).size, `${effect.cardId}: use ids are unique`).toBe(useIds.length);
      for (const use of effect.uses) {
        let result: RunResult | undefined;
        expect(() => {
          result = run(effect, {
            actor: actor({ loadoutDomains: [card.domain, card.domain, card.domain, card.domain], activeCardEffects: [effect.cardId] }),
            gmFear: 3,
            useId: use.id,
            targets: [adv("a")],
            picked: [adv("b")],
            allies: [ally("mira")],
            followUp: [adv("c")],
            trigger: { amount: 10, source: adv("src"), subject: ally("mira") },
            choices: { tokens: 1, hope: 1, stress: 1, hp: 1, layers: 1, damage: 10, fearDie: 4 },
            situations: situationsOf(effect),
            roll: { difficulty: 10 },
            rng: () => 4,
          });
        }, `${effect.cardId}/${use.id}`).not.toThrow();
        runs += 1;
        // A refusal is a structured answer (a choice this generic context doesn't make); the domain tests run those uses
        // with the right inputs. It must still say why.
        if (result && !result.ok) {
          expect(result.reason, `${effect.cardId}/${use.id}`).toMatch(/^(noUse|requirement|exhausted|cost|choice|targets)$/);
          refused.push(`${effect.cardId}/${use.id}: ${result.reason}`);
        }
      }
    }
    expect(runs).toBeGreaterThanOrEqual(CARD_EFFECTS.size);
    console.log(`card-effects coverage: ${CARD_EFFECTS.size} cards, ${runs} uses run; ${refused.length} refused by the generic context (inputs it doesn't give)${refused.length > 0 ? `: ${refused.join("; ")}` : ""}`);
  });

  it("prints the manual steps left to the table, per domain (Q9)", () => {
    const counts = Object.fromEntries(Object.entries(DOMAIN_EFFECT_TABLES).map(([domain, table]) => [domain, manualSteps(table)]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(
      `card-effects manual steps per domain: ${Object.entries(counts)
        .map(([d, n]) => `${d} ${n}`)
        .join(", ")}; total ${total}`,
    );
    expect(Object.keys(counts)).toHaveLength(10);
  });
});
