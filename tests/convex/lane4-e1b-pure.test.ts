/**
 * Plan lanes-2 wave 10, E1.4b (docs/tasks/TASK-LN4-E1B.md): the pure halves of the attack and roll paths.
 *
 * Book texts:
 * - CB p.104: "you only make one attack roll and compare its result to the Difficulty of each eligible target".
 * - CB p.100: "When you roll with advantage, you add a d6 advantage die to your total ... you subtract a d6 disadvantage die".
 *   User answer 2026-11-01: ONE d6 rolled once, added vs targets with advantage, subtracted vs disadvantage.
 * - Reliable Backup (CB p.43): "When you make a Presence Roll in conversation, they back you up. You can roll a d20 as your
 *   Hope Die."
 * - Lead by Example (CB p.342): "The next PC to make an attack against that adversary can clear a Stress or gain a Hope."
 * - Manipulate Magic (CB p.47): "Extend the spell or attack's reach by one range".
 */
import { describe, expect, it } from "vitest";

import type { Doc } from "../../convex/_generated/dataModel";
import { attackerStepsRun, benefitSteps, instanceAttackedRiders, perTargetDeltas, riderBenefits, sameEdges, setupReach, type PickedRider } from "../../convex/lib/combatActions";
import { bearerRiderFires, hopeDieSwitch, situationalHopeDie, withHopeSides, type LiveMod } from "../../convex/lib/rolls";
import { readSheet } from "../../convex/lib/characterSheet";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { AttackedRider, Step } from "../../src/lib/domain/card-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";

allowWorldEmails();

const record = (dice: RollRecord["dice"], modifier = 0): RollRecord => ({ kind: "action", dice, modifier, total: dice.reduce((s, d) => s + (d.dropped ? 0 : d.role === "disadvantage" ? -d.value : d.value), 0) + modifier, outcome: "successHope", manual: false });
const duality = [
  { sides: 12, value: 8, role: "hope" as const },
  { sides: 12, value: 5, role: "fear" as const },
];

async function aSheet(): Promise<CharacterSheet> {
  const w = await buildWorld();
  return w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
}

describe("dcm-svux: per-target edges on one attack roll (CB p.104, p.100)", () => {
  it("one d6 drawn once: added vs advantage, subtracted vs disadvantage, ignored otherwise", () => {
    const draws: number[] = [];
    const out = perTargetDeltas(record(duality), { advantage: 0, disadvantage: 0, help: 0 }, [{ advantage: 1, disadvantage: 0 }, { advantage: 0, disadvantage: 1 }, { advantage: 0, disadvantage: 0 }], (s) => {
      draws.push(s);
      return 4;
    });
    expect(out.deltas).toEqual([4, -4, 0]);
    expect(draws).toEqual([6]);
    expect(out.edgeDie).toBe(4);
  });

  it("the roller's own advantage die is the shared d6; a target's disadvantage cancels it", () => {
    const out = perTargetDeltas(record([...duality, { sides: 6, value: 5, role: "advantage" }]), { advantage: 1, disadvantage: 0, help: 0 }, [{ advantage: 0, disadvantage: 1 }, { advantage: 1, disadvantage: 0 }], () => {
      throw new Error("no draw");
    });
    // Cancelled: no die (5 less); a second advantage is still one die (CB p.100): no change.
    expect(out.deltas).toEqual([-5, 0]);
  });

  it("the same edge on every target keeps the old one-roll path", () => {
    expect(sameEdges([{ advantage: 1, disadvantage: 0 }, { advantage: 1, disadvantage: 0 }])).toBe(true);
    expect(sameEdges([{ advantage: 1, disadvantage: 0 }, { advantage: 0, disadvantage: 0 }])).toBe(false);
  });
});

describe("dcm-hqk1: Reliable Backup's d20 Hope Die only on a marked roll (CB p.43)", () => {
  const conversation = "This Presence Roll is made in conversation";
  const mods: LiveMod[] = [{ mod: { kind: "dualityDie", die: "hope", sides: 20, situation: conversation } }];

  it("the die is swapped only when the player marks the situation", () => {
    expect(situationalHopeDie(mods, [conversation]).sides).toBe(20);
    expect(situationalHopeDie(mods, []).sides).toBeUndefined();
    expect(situationalHopeDie(mods, undefined).sides).toBeUndefined();
    // A die mod without a situation is not this path's.
    expect(situationalHopeDie([{ mod: { kind: "dualityDie", die: "hope", sides: 8 } }], [conversation]).sides).toBeUndefined();
  });

  it("the switch draws the Hope Die (the first d12) from a d20 and marks its sides", () => {
    const asked: number[] = [];
    const sw = hopeDieSwitch((s) => {
      asked.push(s);
      return 1;
    });
    sw.arm(20);
    sw.rng(12);
    sw.rng(12);
    expect(asked).toEqual([20, 12]);
    const rec = withHopeSides(record(duality), 20);
    expect(rec.dice.find((d) => d.role === "hope")!.sides).toBe(20);
  });
});

describe("dcm-l1er: which bearer riders ride on a roll", () => {
  it("actionRoll / acts on action rolls, attack on attacks, a roll filter narrows", () => {
    const action = { kind: "action" as const, trait: "agility" as const, attack: false };
    expect(bearerRiderFires({ on: "actionRoll", steps: [] }, action)).toBe(true);
    expect(bearerRiderFires({ on: "actionRoll", steps: [] }, { ...action, kind: "reaction" })).toBe(false);
    expect(bearerRiderFires({ on: "attack", steps: [] }, action)).toBe(false);
    expect(bearerRiderFires({ on: "attack", steps: [] }, { ...action, attack: true })).toBe(true);
    expect(bearerRiderFires({ on: "actionRoll", roll: "presence", steps: [] }, action)).toBe(false);
  });
});

describe("dcm-kso9 / dcm-j5aw: Lead by Example's benefit (CB p.342)", () => {
  const choose: Step = {
    kind: "choose",
    id: "benefit",
    label: "Clear a Stress or gain a Hope",
    options: [
      { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: { kind: "fixed", value: 1 } }] },
      { id: "hope", label: "Gain a Hope", steps: [{ kind: "markStress", to: "self", amount: { kind: "fixed", value: 0 } }] },
    ],
  } as Step;
  const rider: AttackedRider = { by: "others", attackerSteps: [choose] };

  it("the benefit's options are the attacker's pick; the picked option's steps run", () => {
    expect(riderBenefits([{ label: "Lead by Example", rider }])).toEqual([{ label: "Lead by Example", options: [{ id: "stress", label: "Clear a Stress" }, { id: "hope", label: "Gain a Hope" }] }]);
    expect(benefitSteps([choose], "stress")).toEqual([{ kind: "clear", to: "self", track: "stress", amount: { kind: "fixed", value: 1 } }]);
    expect(benefitSteps([choose], undefined)).toBeNull();
    expect(riderBenefits([{ label: "Breaking Blow", rider: { by: "others", damage: { kind: "add", amount: { kind: "fixed", value: 1 } } } as AttackedRider }])).toEqual([]);
  });

  it("clearing a Stress runs on the attacker", async () => {
    const sheet = { ...(await aSheet()), stress: 2 };
    const out = attackerStepsRun(sheet, "Lead by Example", benefitSteps([choose], "stress")!, () => 1);
    expect(out.sheet.stress).toBe(1);
    expect(out.line).toBe("Lead by Example: clears 1 Stress");
  });

  it("dcm-j5aw: only the placing PC (the marker's caster) is left out, not every holder", async () => {
    const holder = await aSheet();
    const withCard = { ...holder, domainCards: { ...holder.domainCards, loadout: [...holder.domainCards.loadout, "breaking-blow"] } } as CharacterSheet;
    const instance = (caster?: string) =>
      ({ tags: ["Breaking Blow"], conditions: [], effects: caster ? [{ id: `card:breaking-blow:1~${caster}`, source: "Breaking Blow", label: "Breaking Blow", until: "manual" }] : [] }) as unknown as Pick<Doc<"encounterAdversaries">, "effects" | "tags" | "conditions">;
    // Recorded caster: another holder of the card still gets the rider; the caster doesn't.
    expect(instanceAttackedRiders(instance("tok-caster"), withCard, { tokenId: "tok-other", characterId: "char-other" }).map((r) => r.label)).toEqual(["Breaking Blow"]);
    expect(instanceAttackedRiders(instance("tok-caster"), withCard, { tokenId: "tok-caster", characterId: "char-caster" })).toEqual([]);
    // No caster recorded: the old holder rule.
    expect(instanceAttackedRiders(instance(), withCard, { tokenId: "tok-other", characterId: "char-other" })).toEqual([]);
    // Orchestrator (merge with E1.4a): the marker's stored `casterId` (E1.4a's `castWrites`) names the caster too.
    const stored = { tags: ["Breaking Blow"], conditions: [], effects: [{ id: "card:breaking-blow:1", source: "Breaking Blow", label: "Breaking Blow", until: "manual", casterId: "char-caster" }] } as unknown as Pick<Doc<"encounterAdversaries">, "effects" | "tags" | "conditions">;
    expect(instanceAttackedRiders(stored, withCard, { tokenId: "tok-other", characterId: "char-other" }).map((r) => r.label)).toEqual(["Breaking Blow"]);
    expect(instanceAttackedRiders(stored, withCard, { tokenId: "tok-caster", characterId: "char-caster" })).toEqual([]);
  });
});

describe("dcm-lbai: a reach picked with the attack (Manipulate Magic, CB p.47)", () => {
  const mm = "subclass:primal-origin:manipulate-magic";
  const rider = (option: string): PickedRider => ({ source: "feature", id: mm, useId: "main", name: "Manipulate Magic", trigger: { kind: "afterYouRoll", roll: "any" }, phase: "after", choices: [{ id: "opt:option", value: [option] }], auto: false });

  it("counts the reach option only when it is picked", () => {
    expect(setupReach([rider("reach")])).toBe(1);
    expect(setupReach([rider("roll")])).toBe(0);
    expect(setupReach([])).toBe(0);
  });
});
