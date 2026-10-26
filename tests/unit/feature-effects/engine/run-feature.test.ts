import { describe, expect, it } from "vitest";

import type { CardUse } from "@/lib/domain/card-effects/types";
import { actorExtras, asCardEffect, featureAvailability, featureCostShort, featureLimitKey, featureLimitKeys, runFeature } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import * as engine from "@/lib/domain/feature-effects";
import { queueRng } from "@/lib/domain/dice";
import { actorOf, adversary, fixed, sheetOf } from "./fixtures";

// Plan sheet-drawer, SD1: runFeature returns run()'s RunPlan with limits under feat:<featureId>[:<useId>] and until
// rest | longRest | session | scene (Q3, Q7). Book: CB p.107, "Spending Resources": "on an effect like the Guardian's Hope
// Feature, which says 'Spend 3 Hope to clear 2 Armor Slots,' you can spend 6 Hope to clear 4 Armor Slots, because this
// effect isn't applying its bonus to a specific roll—you're just activating the feature more than once."

const effect = (featureId: string, uses: Partial<CardUse>[]): FeatureEffect => ({
  featureId,
  source: "class",
  owner: "x",
  uses: uses.map((u, i) => ({ id: i === 0 ? "main" : `use-${i}`, name: featureId, activation: { kind: "action" }, steps: [], ...u })),
});

// Frontline Tank (CB p.36): "Spend 3 Hope to clear 2 Armor Slots."
const frontlineTank = effect("hope:guardian", [{ costs: [{ kind: "hope", amount: fixed(3) }], steps: [{ kind: "clear", to: "self", track: "armor", amount: fixed(2) }] }]);

describe("repeat activation (CB p.107)", () => {
  const guardian = sheetOf("guardian", "stalwart", { hope: 6, armorMarked: 4 });

  it("Frontline Tank twice: 6 Hope clear 4 Armor Slots", () => {
    const result = runFeature(frontlineTank, undefined, { actor: actorOf(guardian, { armorMax: 4 }), gmFear: 0, rng: queueRng([]), times: 2 });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.before).toMatchObject({ hope: 6, armor: 4 });
    expect(result.plan.actor.after).toMatchObject({ hope: 0, armor: 0 });
    expect(result.plan.steps.filter((s) => s.kind === "clear")).toHaveLength(2);
    expect(result.plan.limit).toBeNull();
    expect(result.plan.cardId).toBe("hope:guardian");
  });

  it("twice needs 6 Hope; a roll or a limit can't be repeated; times must be a whole number from 1", () => {
    expect(runFeature(frontlineTank, undefined, { actor: actorOf({ ...guardian, hope: 5 }, { armorMax: 4 }), gmFear: 0, rng: queueRng([]), times: 2 })).toMatchObject({ ok: false, reason: "cost" });
    const rolled = effect("ancestry:drakona:elemental-breath", [{ roll: { kind: "trait", trait: "instinct", difficulty: { kind: "target" } } }]);
    expect(runFeature(rolled, undefined, { actor: actorOf(guardian), gmFear: 0, rng: queueRng([]), times: 2 })).toMatchObject({ ok: false, reason: "choice" });
    const limited = effect("class:x:y", [{ limit: { per: "rest" } }]);
    expect(runFeature(limited, undefined, { actor: actorOf(guardian), gmFear: 0, rng: queueRng([]), times: 2 })).toMatchObject({ ok: false, reason: "choice" });
    expect(runFeature(frontlineTank, undefined, { actor: actorOf(guardian), gmFear: 0, rng: queueRng([]), times: 0 })).toMatchObject({ ok: false, reason: "choice" });
    expect(runFeature(frontlineTank, "nope", { actor: actorOf(guardian), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "noUse" });
  });
});

describe("limits under feat: keys (Q3, Q7)", () => {
  const sheet = sheetOf("rogue", "nightwalker");

  it("main use, another use and a per-target limit; scene stays scene", () => {
    expect(featureLimitKey("ancestry:gnome:flicker-step")).toBe("feat:ancestry:gnome:flicker-step");
    expect(featureLimitKey("ancestry:gnome:flicker-step", "main")).toBe("feat:ancestry:gnome:flicker-step");
    expect(featureLimitKey("subclass:troubadour:gifted-performer", "epic")).toBe("feat:subclass:troubadour:gifted-performer:epic");
    expect(featureLimitKey("class:x:y", "main", "pc2")).toBe("feat:class:x:y:pc2");
    expect(featureLimitKeys("class:x:y").until("scene")).toBe("scene");

    const flicker = effect("ancestry:gnome:flicker-step", [{ limit: { per: "scene" } }]);
    const result = runFeature(flicker, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]) });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.limit).toEqual({ key: "feat:ancestry:gnome:flicker-step", until: "scene", consumed: true });
    const used = { ...sheet, featureUses: result.plan.actor.featureUses };
    expect(featureAvailability(used, flicker)).toEqual({ state: "exhausted", until: "scene", label: "Back after the scene" });
    expect(runFeature(flicker, undefined, { actor: actorOf(used), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("each period is stored as itself; 'on a success' only a success uses it (Q4); per target", () => {
    for (const per of ["rest", "longRest", "session"] as const) {
      const r = runFeature(effect("class:x:y", [{ limit: { per } }]), undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]) });
      expect(r.ok && r.plan.limit?.until).toBe(per);
    }
    const onSuccess = effect("subclass:x:y", [
      { limit: { per: "rest", consumedOn: "success" }, roll: { kind: "trait", trait: "agility", difficulty: fixed(15) }, steps: [] },
    ]);
    const fail = runFeature(onSuccess, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([2, 3]) });
    expect(fail.ok && fail.plan.limit).toEqual({ key: "feat:subclass:x:y", until: "rest", consumed: false });
    const perTarget = effect("class:x:y", [{ limit: { per: "longRest", perTarget: true }, targets: { side: "enemy", range: "close", count: { kind: "one" } } }]);
    const hit = runFeature(perTarget, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), targets: [adversary("bandit")] });
    expect(hit.ok && hit.plan.limit?.key).toBe("feat:class:x:y:bandit");
    const healed = { ...sheet, featureUses: hit.ok ? hit.plan.actor.featureUses : [] };
    expect(featureAvailability(healed, perTarget, undefined, { targetId: "bandit" }).state).toBe("exhausted");
    expect(featureAvailability(healed, perTarget, undefined, { targetId: "other" }).state).toBe("ready");
    expect(featureAvailability(healed, effect("class:x:y", [{ limit: { per: "rest", times: 3 } }]))).toEqual({ state: "ready", usesLeft: 3 });
    expect(featureAvailability(healed, perTarget, "missing")).toEqual({ state: "ready" });
  });
});

describe("costs and the actor's class resources", () => {
  it("the drawer's cost badge: short of Favor reads as tokens, Hope as hope", () => {
    const sheet = sheetOf("warlock", "pact-of-the-endless", { classState: { favor: 0 }, hope: 1 });
    const actor = actorOf(sheet, actorExtras(sheet));
    const favorUse: CardUse = { id: "main", name: "Damage Sink", activation: { kind: "action" }, costs: [{ kind: "tokens", amount: fixed(1), pool: "favor" }], steps: [] };
    expect(featureCostShort(actor, favorUse)).toEqual(["tokens"]);
    expect(featureCostShort(actorOf(sheet, { ...actorExtras(sheet), favor: 1 }), favorUse)).toEqual([]);
    const hope3: CardUse = { ...favorUse, costs: [{ kind: "hope", amount: fixed(3) }] };
    expect(featureCostShort(actor, hope3)).toEqual(["hope"]);
    const chosen: CardUse = { ...favorUse, costs: [{ kind: "hope", amount: { kind: "chosen", choice: "n" } }] };
    expect(featureCostShort(actor, chosen, { n: 1 })).toEqual([]);
  });

  it("actorExtras reads Favor, Focus, held dice (Slayer Dice as d6s) and the class dice sizes", () => {
    const sheet = sheetOf("brawler", "martial-artist", {
      level: 5,
      classState: { favor: 2, martial: { known: ["quick"], focus: 4 }, comboDie: 6 },
      heldDice: [{ id: "rally-1", kind: "rally", sides: 8, until: "session" }],
      sessionFeatures: { slayerDice: 2 },
    });
    expect(actorExtras(sheet)).toEqual({
      favor: 2,
      focus: 4,
      heldDice: [
        { id: "rally-1", kind: "rally", sides: 8 },
        { id: "slayer-1", kind: "slayer", sides: 6 },
        { id: "slayer-2", kind: "slayer", sides: 6 },
      ],
      dieSides: { rally: 8, prayer: 4, patron: 8, slayer: 6, combo: 6, unstoppable: 6 },
    });
    expect(actorExtras(sheetOf("guardian", "stalwart"))).toEqual({ heldDice: [], dieSides: { rally: 6, prayer: 4, patron: 6, slayer: 6, combo: 4, unstoppable: 4 } });
  });

  it("asCardEffect keys the card runner by feature id; the barrel exports the engine", () => {
    expect(asCardEffect(frontlineTank)).toEqual({ cardId: "hope:guardian", uses: frontlineTank.uses });
    for (const name of ["owned", "applyUpgrades", "createDelegator", "runFeature", "featureKey", "FEATURE_SOURCES"]) expect(engine).toHaveProperty(name);
  });
});
