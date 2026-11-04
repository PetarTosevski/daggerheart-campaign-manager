/**
 * Plan lanes-2 wave 9, tracer E4.3 (docs/tasks/TASK-LN3-E4.md): the pure parts of the card runner wiring and the server
 * forced-move path.
 *
 * Expected values come from the book:
 * - CB p.103 Defined Ranges: Melee 1 square, Very Close 3, Close 6, Far 12.
 * - CB p.342 (Hold the Line): "If an adversary moves within Very Close range, they're pulled into Melee range".
 * - CB p.230 (Immovable Object): "An attack that would move the Elemental moves them two fewer ranges (for example, Far
 *   becomes Very Close)".
 * - CB p.330 (Vitality): "permanently gain one of the following benefits: one Stress slot, one Hit Point slot ...".
 * - HF p.88 (Unleash Hellfire): bursts at points you choose; a creature in more than one burst.
 */
import { describe, expect, it } from "vitest";

import type { Doc } from "../../convex/_generated/dataModel";
import { planHandoff, pointsOfCreatures, readsUsedOn, writeSheetChanges, type BuiltRun } from "../../convex/lib/cardRunner";
import type { RunPlan } from "../../src/lib/domain/card-effects/run";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import { alongTo, forcedRange, pullSquare } from "../../src/lib/domain/feature-effects/areas";
import { tokenDistance } from "../../src/lib/domain/combat-actions/distance";
import { sheetOf } from "./feature-effects/engine/fixtures";

const at = (x: number, y: number, size = 1) => ({ x, y, size });

describe("pull into Melee (Hold the Line, CB p.342)", () => {
  it("ends in Melee of the anchor, on a free square nearest the mover", () => {
    const anchor = at(2, 10);
    const to = pullSquare(at(5, 10), anchor, [at(4, 10)], { w: 30, h: 20 });
    expect(to).not.toBeNull();
    expect(tokenDistance(anchor, at(to!.x, to!.y))).toBeLessThanOrEqual(1);
    expect(to!.x).toBe(3);
  });

  it("a creature already in Melee stays; no free square is null", () => {
    expect(pullSquare(at(3, 10), at(2, 10), [], { w: 30, h: 20 })).toEqual({ x: 3, y: 10 });
    const others = [at(1, 0), at(0, 1), at(1, 1)];
    expect(pullSquare(at(9, 9), at(0, 0), others, { w: 30, h: 20 })).toBeNull();
  });
});

describe("forced moves shortened (Immovable Object, CB p.230)", () => {
  it("Far becomes Very Close; Very Close becomes nothing", () => {
    expect(forcedRange(at(0, 0), at(10, 0), 2)).toBe("veryClose");
    expect(forcedRange(at(0, 0), at(3, 0), 2)).toBeNull();
    expect(forcedRange(at(0, 0), at(5, 0), 0)).toBe("close");
  });

  it("the square at most that range along the way", () => {
    expect(alongTo(at(0, 0), at(10, 0), "veryClose")).toEqual({ x: 3, y: 0 });
    expect(alongTo(at(0, 0), at(2, 0), "veryClose")).toEqual({ x: 2, y: 0 });
  });
});

describe("points of creatures (Unleash Hellfire, HF p.88)", () => {
  it("each creature lists the picked points whose Very Close area holds it", () => {
    const token = (x: number, y: number) => ({ x, y, size: 1 }) as unknown as Doc<"combatTokens">;
    const points = [
      { x: 5, y: 5 },
      { x: 8, y: 5 },
    ];
    expect(pointsOfCreatures(points, "veryClose", [
      { id: "a", token: token(6, 5) },
      { id: "b", token: token(20, 5) },
    ])).toEqual({ a: [0, 1] });
  });
});

describe("Vitality's slots (CB p.330, dcm-o3j)", () => {
  const vitality = (option: string, stat: "hpMax" | "stressMax"): PlanStep =>
    ({ kind: "effect", targetId: "self", label: "Vitality", option, mods: [{ kind: "stat", stat, delta: 1 }], duration: "permanent" }) as unknown as PlanStep;

  it("a permanent slot mod raises the maximum once, not as a lasting effect", () => {
    const sheet = sheetOf("guardian", "stalwart");
    const once = writeSheetChanges(sheet, [vitality("hp", "hpMax")], "self", "vitality", "Vitality", false, true);
    expect(once.hpMax).toBe(sheet.hpMax + 1);
    expect(once.effects.length).toBe(sheet.effects.length);
    const twice = writeSheetChanges(once, [vitality("hp", "hpMax")], "self", "vitality", "Vitality", false, true);
    expect(twice.hpMax).toBe(sheet.hpMax + 1);
    const stress = writeSheetChanges(once, [vitality("stress", "stressMax")], "self", "vitality", "Vitality", false, true);
    expect(stress.stressMax).toBe(sheet.stressMax + 1);
  });
});

describe("per-target memory (Words of Discord, CB p.335)", () => {
  it("an entry reading usedOnBefore is remembered; others are not", () => {
    const reads = { cardId: "x", uses: [{ id: "main", name: "x", activation: { kind: "action" }, steps: [], requires: [{ kind: "usedOnBefore" }] }] } as unknown as CardEffect;
    const plain = { cardId: "y", uses: [{ id: "main", name: "y", activation: { kind: "action" }, steps: [] }] } as unknown as CardEffect;
    expect(readsUsedOn(reads)).toBe(true);
    expect(readsUsedOn(plain)).toBe(false);
  });
});

describe("plan entries handed on (dcm-q40t)", () => {
  it("forcedAttack and changeForm go to E7 by token; every entry gets feed words", () => {
    const enemy = { kind: "enemy", tokenId: "tok-1", instance: { label: "Bandit" } };
    const built = { context: { actor: { id: "me" } }, creatures: { onMap: true, scene: { attacker: { _id: "tok-me" } }, get: (id: string) => (id === "tok-1" ? enemy : undefined) } } as unknown as BuiltRun;
    const plan = {
      steps: [
        { kind: "setStance", targetId: "me", stance: "Mountain" },
        { kind: "forcedAttack", attackerIds: ["tok-1"], against: {}, againstIds: [] },
        { kind: "changeForm", targetId: "tok-1", adversaryId: "bear" },
        { kind: "heldReroll", die: "prayer", before: [1], after: [4] },
      ],
    } as unknown as RunPlan;
    const out = planHandoff(built, plan);
    expect(out.forcedAttacks).toEqual([{ attackerTokenIds: ["tok-1"], againstTokenIds: [] }]);
    expect(out.changeForms).toEqual([{ tokenId: "tok-1", adversaryId: "bear" }]);
    expect(out.notes).toEqual(["you: stance Mountain", "Bandit must attack a creature the GM picks", expect.stringContaining("Bandit changes form"), "prayer dice rerolled: 1 → 4"]);
  });
});
