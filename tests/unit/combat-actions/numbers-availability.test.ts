import { describe, expect, it } from "vitest";

import { resolveDice, resolveNumber, type NumberEnv } from "@/lib/domain/combat-actions";
import {
  RESET_LABEL,
  cardAvailability,
  featureUseKey,
  limitConsumed,
  limitUntil,
  recordUse,
  requirementMet,
  resolveCosts,
  unaffordable,
  unmetRequirements,
  type RequirementState,
} from "@/lib/domain/card-effects/availability";
import { queueRng } from "@/lib/domain/dice";
import { expire } from "@/lib/domain/characters/expiry";

// Plan combat-actions, tracer CA1: numbers of the card vocabulary (CB p.98, p.107), once-per limits (CB p.101, Q3, Q4),
// requirements and costs (CB p.90).

const env = (over: Partial<NumberEnv> = {}): NumberEnv => ({
  traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: 3, knowledge: -1 },
  spellcast: 3,
  proficiency: 2,
  level: 5,
  tier: 3,
  spent: { hope: 2 },
  choices: { hope: 3 },
  cardTokens: 4,
  gmFear: 6,
  self: { hp: 2, stress: 1, armor: 0 },
  target: { id: "t", hp: 3, stress: 2 },
  markedThisMove: { self: {}, byTarget: { t: { hp: 2 } } },
  targetCount: { picked: 3, hit: 2, failedSave: 1 },
  rollTotal: 17,
  triggerAmount: 9,
  loadoutDomains: ["arcana", "arcana", "blade"],
  vaultDomains: ["arcana"],
  ...over,
});

describe("resolveNumber", () => {
  const rng = queueRng([]);
  it("reads the actor, the use and the target", () => {
    const e = env();
    expect(resolveNumber({ kind: "fixed", value: 4 }, e, rng)).toBe(4);
    expect(resolveNumber({ kind: "trait", trait: "presence" }, e, rng)).toBe(3);
    expect(resolveNumber({ kind: "spellcast" }, e, rng)).toBe(3);
    expect(resolveNumber({ kind: "proficiency" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "level" }, e, rng)).toBe(5);
    expect(resolveNumber({ kind: "spent", resource: "hope" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "spent", resource: "stress" }, e, rng)).toBe(0);
    expect(resolveNumber({ kind: "chosen", choice: "hope" }, e, rng)).toBe(3);
    expect(resolveNumber({ kind: "cardTokens" }, e, rng)).toBe(4);
    expect(resolveNumber({ kind: "gmFear" }, e, rng)).toBe(6);
    expect(resolveNumber({ kind: "marked", who: "self", track: "hp" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "marked", who: "target", track: "stress" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "markedThisMove", who: "target", track: "hp" }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "markedThisMove", who: "self", track: "hp" }, e, rng)).toBe(0);
    expect(resolveNumber({ kind: "targetCount", which: "failedSave" }, e, rng)).toBe(1);
    expect(resolveNumber({ kind: "rollTotal" }, e, rng)).toBe(17);
    expect(resolveNumber({ kind: "triggerAmount" }, e, rng)).toBe(9);
    expect(resolveNumber({ kind: "domainCards", domain: "arcana", includeVault: false }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "domainCards", domain: "arcana", includeVault: true }, e, rng)).toBe(3);
    expect(resolveNumber({ kind: "byTier", values: [9, 11, 13, 15] }, e, rng)).toBe(13);
  });
  it("combines sources: sum, product, max, calc (round up by default, CB p.107)", () => {
    const e = env();
    expect(resolveNumber({ kind: "sum", of: [{ kind: "fixed", value: 3 }, { kind: "trait", trait: "strength" }] }, e, rng)).toBe(4);
    expect(resolveNumber({ kind: "product", of: [{ kind: "fixed", value: 2 }, { kind: "trait", trait: "presence" }] }, e, rng)).toBe(6);
    expect(resolveNumber({ kind: "max", of: [{ kind: "trait", trait: "finesse" }, { kind: "trait", trait: "agility" }] }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "calc", of: { kind: "trait", trait: "presence" }, divide: 2 }, e, rng)).toBe(2);
    expect(resolveNumber({ kind: "calc", of: { kind: "trait", trait: "presence" }, divide: 2, round: "down" }, e, rng)).toBe(1);
    expect(resolveNumber({ kind: "calc", of: { kind: "trait", trait: "knowledge" }, min: 1 }, e, rng)).toBe(1);
    expect(resolveNumber({ kind: "calc", of: { kind: "fixed", value: 10 }, max: { kind: "gmFear" } }, e, rng)).toBe(6);
    expect(resolveNumber({ kind: "calc", of: { kind: "fixed", value: 3 }, times: 2, plus: 1 }, e, rng)).toBe(7);
  });
  it("rolls dice sources and remembers the last roll", () => {
    const e = env();
    const dice = queueRng([3, 5]);
    expect(resolveNumber({ kind: "dice", dice: { count: { kind: "fixed", value: 2 }, sides: 6 } }, e, dice)).toBe(8);
    expect(resolveNumber({ kind: "lastRoll" }, e, dice)).toBe(8);
    expect(resolveNumber({ kind: "dice", dice: { count: { kind: "fixed", value: 2 }, sides: 6 }, keep: "highest" }, env(), queueRng([2, 6]))).toBe(6);
  });
  it("resolves dice expressions: d8+2 using your Proficiency (CB p.98)", () => {
    expect(resolveDice({ count: { kind: "proficiency" }, sides: 8, plus: { kind: "fixed", value: 2 } }, env(), rng)).toEqual({ count: 2, sides: 8, plus: 2 });
    expect(resolveDice({ count: { kind: "spellcast" }, sides: 6 }, env(), rng)).toEqual({ count: 3, sides: 6, plus: 0 });
  });
});

describe("cardAvailability (CB p.101, Q3)", () => {
  it("a card without an entry is ready", () => {
    expect(cardAvailability({ featureUses: [] }, "earthquake")).toEqual({ state: "ready" });
    expect(cardAvailability({}, "earthquake")).toEqual({ state: "ready" });
  });
  it("an entry exhausts it until a rest or a long rest, with the reset label", () => {
    expect(cardAvailability({ featureUses: [{ key: "card:earthquake", until: "rest" }] }, "earthquake")).toEqual({
      state: "exhausted",
      until: "rest",
      label: "Back after a rest",
    });
    expect(cardAvailability({ featureUses: [{ key: "card:earthquake", until: "longRest" }] }, "earthquake")).toMatchObject({ label: "Back after a long rest" });
  });
  it("a class feature key or another card does not exhaust it", () => {
    expect(cardAvailability({ featureUses: [{ key: "rally", until: "session" }, { key: "card:other", until: "rest" }] }, "earthquake").state).toBe("ready");
  });
  it("per-use keys for grimoire spells, per-target keys, times per period", () => {
    expect(featureUseKey("book-of-ava")).toBe("card:book-of-ava");
    expect(featureUseKey("book-of-ava", "main")).toBe("card:book-of-ava");
    expect(featureUseKey("book-of-ava", "ice-spike")).toBe("card:book-of-ava:ice-spike");
    expect(featureUseKey("healing-hands", "main", "pc1")).toBe("card:healing-hands:pc1");
    const uses = [{ key: "card:book-of-ava:ice-spike", until: "rest" as const }];
    expect(cardAvailability({ featureUses: uses }, "book-of-ava").state).toBe("ready");
    expect(cardAvailability({ featureUses: uses }, "book-of-ava", { useId: "ice-spike" }).state).toBe("exhausted");
    const perTarget = { per: "longRest" as const, perTarget: true };
    const healed = [{ key: "card:healing-hands:pc1", until: "longRest" as const }];
    expect(cardAvailability({ featureUses: healed }, "healing-hands", { limit: perTarget, targetId: "pc1" }).state).toBe("exhausted");
    expect(cardAvailability({ featureUses: healed }, "healing-hands", { limit: perTarget, targetId: "pc2" }).state).toBe("ready");
    const thrice = { per: "scene" as const, times: 3 };
    expect(cardAvailability({ featureUses: [{ key: "card:x", until: "session" }] }, "x", { limit: thrice })).toEqual({ state: "ready", usesLeft: 2 });
  });
  it("comes back through the one expiry point: a rest clears `rest`, only a long rest clears `longRest`", () => {
    const sheet = { featureUses: [{ key: "card:a", until: "rest" as const }, { key: "card:b", until: "longRest" as const }], effects: [], heldDice: [] };
    const short = expire(sheet, "shortRest");
    expect(cardAvailability(short, "a").state).toBe("ready");
    expect(cardAvailability(short, "b").state).toBe("exhausted");
    expect(cardAvailability(expire(sheet, "longRest"), "b").state).toBe("ready");
    expect(cardAvailability(expire(sheet, "session"), "a").state).toBe("exhausted");
  });
  it("records a use under the limit's period; scene is stored as session", () => {
    expect(recordUse([], "card:a", { per: "longRest" })).toEqual([{ key: "card:a", until: "longRest" }]);
    expect(limitUntil("scene")).toBe("session");
    expect(RESET_LABEL.session).toBe("Back next session");
  });
  it("'on a success' is used up only by a success (Q4); 'on a failure' only by a failure", () => {
    expect(limitConsumed({ per: "rest" }, false)).toBe(true);
    expect(limitConsumed({ per: "rest", consumedOn: "success" }, false)).toBe(false);
    expect(limitConsumed({ per: "rest", consumedOn: "success" }, true)).toBe(true);
    expect(limitConsumed({ per: "rest", consumedOn: "failure" }, false)).toBe(true);
    expect(limitConsumed({ per: "rest", consumedOn: "failure" }, true)).toBe(false);
  });
});

describe("requirements", () => {
  const s: RequirementState = {
    hp: 4,
    hpMax: 6,
    stress: 5,
    stressMax: 5,
    armor: 1,
    hope: 0,
    armorWorn: false,
    loadoutDomains: ["arcana", "arcana", "arcana", "arcana", "blade"],
    activeCardEffects: ["force-of-nature"],
    nearestEnemy: 2,
    situations: ["While you're shrouded in low light"],
  };
  it("checks each kind", () => {
    expect(requirementMet({ kind: "loadoutDomainCount", domain: "arcana", min: 4 }, s)).toBe(true);
    expect(requirementMet({ kind: "loadoutDomainCount", domain: "blade", min: 4 }, s)).toBe(false);
    expect(requirementMet({ kind: "armor", worn: false }, s)).toBe(true);
    expect(requirementMet({ kind: "hpUnmarkedAtMost", value: 2 }, s)).toBe(true);
    expect(requirementMet({ kind: "stressFull" }, s)).toBe(true);
    expect(requirementMet({ kind: "trackMarked", track: "stress", atMost: 0 }, s)).toBe(false);
    expect(requirementMet({ kind: "trackMarked", track: "armor", atLeast: 1 }, s)).toBe(true);
    expect(requirementMet({ kind: "hopeAtMost", value: 0 }, s)).toBe(true);
    expect(requirementMet({ kind: "noEnemyWithin", range: "melee" }, s)).toBe(true);
    expect(requirementMet({ kind: "noEnemyWithin", range: "veryClose" }, s)).toBe(false);
    expect(requirementMet({ kind: "effectActive", cardId: "force-of-nature" }, s)).toBe(true);
    expect(requirementMet({ kind: "situation", text: "While you're shrouded in low light" }, s)).toBe(true);
    expect(requirementMet({ kind: "situation", text: "In a natural environment" }, s)).toBe(false);
  });
  it("lists the unmet ones", () => {
    expect(unmetRequirements([{ kind: "stressFull" }, { kind: "armor", worn: true }], s)).toEqual([{ kind: "armor", worn: true }]);
    expect(unmetRequirements(undefined, s)).toEqual([]);
  });
});

describe("costs (CB p.90)", () => {
  const payer = { hope: 1, stress: 4, stressMax: 5, hp: 0, hpMax: 6, armor: 2, armorMax: 3, cardTokens: 0 };
  it("flattens costs; an `either` takes the picked option", () => {
    const costs = resolveCosts(
      [
        { kind: "hope", amount: { kind: "fixed", value: 1 } },
        { kind: "either", options: [[{ kind: "hope", amount: { kind: "fixed", value: 1 } }], [{ kind: "stress", amount: { kind: "fixed", value: 1 } }]] },
        { kind: "gold", handfuls: 3 },
      ],
      (c) => (c.amount.kind === "fixed" ? c.amount.value : 0),
      () => 1,
    );
    expect(costs).toEqual([
      { resource: "hope", amount: 1 },
      { resource: "stress", amount: 1 },
      { resource: "gold", amount: 3 },
    ]);
  });
  it("names what is short: Hope, free Stress slots, tokens", () => {
    expect(unaffordable([{ resource: "hope", amount: 1 }, { resource: "stress", amount: 1 }], payer)).toEqual([]);
    expect(unaffordable([{ resource: "hope", amount: 2 }], payer)).toEqual(["hope"]);
    expect(unaffordable([{ resource: "stress", amount: 1 }, { resource: "stress", amount: 1 }], payer)).toEqual(["stress"]);
    expect(unaffordable([{ resource: "tokens", amount: 1 }, { resource: "armor", amount: 2 }], payer)).toEqual(["armor", "tokens"]);
  });
});
