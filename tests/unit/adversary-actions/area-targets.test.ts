/**
 * dcm-y3mf: who names an adversary feature's "all targets" list. The Cave Ogre's Hail of Boulders ("all targets in front
 * of the Ogre within Far range", CB p.210) and Rampaging Fury ("all targets in their path") ran on nobody: the client read
 * every `count: "all"` list as "the server fills it" and the server never could for a shape. Every such feature in the
 * SRD tables is now a list the GM picks; plain "all targets within <range>" fills from the map.
 */
import { describe, expect, it } from "vitest";

import { capOf, missing, initialAnswers, namedArea, needsChoices, pickable, type FeatureAsk, type TargetAsk } from "@/components/adversaries/tracker/actions/ask";
import { areaPick } from "@/components/combat-map/hud/statblock/model";
import { areaWords, fillsFromMap, namedByGm } from "@/lib/domain/adversary-actions/area-targets";
import type { TargetSpec } from "@/lib/domain/card-effects/types";
import { ADVERSARY_EFFECTS, adversaryFeatureEffect } from "@/lib/srd/adversary-effects/index";

import type { Id } from "../../../convex/_generated/dataModel";

const ask = (spec: TargetSpec): TargetAsk => ({ side: spec.side, range: spec.range, count: spec.count.kind, max: null, sight: false, ...(spec.area ? { area: spec.area } : {}) });

function targetsOf(adversaryId: string, feature: string): TargetSpec {
  const t = adversaryFeatureEffect(adversaryId, feature)!.uses[0]!.targets!;
  if (t.side === "trigger") throw new Error("trigger targets");
  return t;
}

describe("namedByGm / fillsFromMap", () => {
  it("Hail of Boulders and Rampaging Fury are named by the GM; Death Quake fills from the map", () => {
    const hail = targetsOf("cave-ogre", "Hail of Boulders");
    const fury = targetsOf("cave-ogre", "Rampaging Fury");
    const quake = targetsOf("construct", "Death Quake");
    expect([namedByGm(hail), fillsFromMap(hail)]).toEqual([true, false]);
    expect([namedByGm(fury), fillsFromMap(fury)]).toEqual([true, false]);
    expect([namedByGm(quake), fillsFromMap(quake)]).toEqual([false, true]);
  });

  it("every SRD adversary 'all targets' list in a shape is a list the GM picks (front, path, line, between, point)", () => {
    const shaped: string[] = [];
    for (const [id, effects] of ADVERSARY_EFFECTS) {
      for (const e of effects) {
        for (const u of e.uses) {
          const t = u.targets;
          if (!t || t.side === "trigger" || t.count.kind !== "all" || t.area === undefined || t.area === "aroundSelf") continue;
          shaped.push(`${id}/${e.feature}`);
          expect(namedByGm(t)).toBe(true);
          if (!["self", "point", "object"].includes(t.side)) expect(pickable(ask(t))).toBe(true);
        }
      }
    }
    expect(shaped).toEqual(expect.arrayContaining(["cave-ogre/Hail of Boulders", "cave-ogre/Rampaging Fury", "construct/Trample"]));
  });

  it("says the area as the stat block does", () => {
    expect(areaWords("front", "far", "the Ogre")).toBe("in front of the Ogre within Far range");
    expect(areaWords("path", "close", "the Ogre")).toBe("in the Ogre’s path");
  });
});

describe("the GM's pickers", () => {
  it("an area list is pickable without a cap; a plain 'all' list is not", () => {
    const hail = ask(targetsOf("cave-ogre", "Hail of Boulders"));
    expect(pickable(hail)).toBe(true);
    expect(namedArea(hail)).toBe(true);
    expect(capOf(hail)).toBeNull();
    expect(pickable(ask(targetsOf("construct", "Death Quake")))).toBe(false);
  });

  it("Rampaging Fury (any side) opens the choices dialog; an area attack with nobody picked can't be sent", () => {
    const base = { options: [], optionals: [], situations: [], splits: [], eitherCosts: [], picked: null, allies: null, followUp: null, trigger: null, uses: [{ id: "main", activation: "action" }] };
    const fury = { ...base, targets: ask(targetsOf("cave-ogre", "Rampaging Fury")), attack: false } as unknown as FeatureAsk;
    expect(needsChoices(fury)).toBe(true);
    expect(missing(fury, initialAnswers(fury, []))).toEqual([]);
    const hail = { ...base, targets: ask(targetsOf("cave-ogre", "Hail of Boulders")), attack: true } as unknown as FeatureAsk;
    expect(needsChoices(hail)).toBe(false);
    expect(missing(hail, initialAnswers(hail, []))).toEqual(["Pick the targets in the area"]);
  });

  it("the purple picker: in front starts with everyone in range picked; a path starts empty", () => {
    const rows = [
      { tokenId: "a" as Id<"combatTokens">, reach: "in" as const },
      { tokenId: "b" as Id<"combatTokens">, reach: "out" as const },
    ];
    expect(areaPick({ area: "front", range: "far" }, "the Ogre", true, rows)).toEqual({ text: "Everyone in front of the Ogre within Far range: unpick anyone who isn’t", picked: ["a"], min: 1 });
    expect(areaPick({ area: "path", range: "close" }, "the Construct", false, rows)).toEqual({ text: "Pick everyone in the Construct’s path", picked: [], min: 0 });
  });
});
