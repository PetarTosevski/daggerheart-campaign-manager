import { describe, expect, it } from "vitest";

import { adversaryFeatureId } from "@/lib/domain/adversary-effects/run";
import { ADVERSARY_EFFECTS } from "@/lib/srd/adversary-effects";
import { EFFECT_ID_MAX, effectSchema } from "@/lib/validation/characters";

import { effectKeyOf } from "../../../convex/lib/cardRunner";

// dcm-s7hd: an adversary feature's effect on a PC is `card:<adversaryId>/<feature>:<n>` (cardRunner nextEffectId). The
// sheet's effect id cap was 40, so Reality Quake (45) and Burrowing Leechpoles (49) failed the sheet save. Widened to
// EFFECT_ID_MAX (widen only); every SRD adversary feature's id fits, up to the runner's highest counter (99).
describe("dcm-s7hd: adversary-made sheet effect ids fit the sheet", () => {
  it("every SRD adversary feature's effect id parses", () => {
    let longest = "";
    for (const [adversaryId, effects] of ADVERSARY_EFFECTS) {
      for (const e of effects) {
        const id = `${effectKeyOf(adversaryFeatureId(adversaryId, e.feature))}:99`;
        if (id.length > longest.length) longest = id;
        expect(effectSchema.safeParse({ id, source: e.feature.slice(0, 80), text: "", until: "manual" }).success, id).toBe(true);
      }
    }
    expect(longest.length).toBeGreaterThan(40);
    expect(longest.length).toBeLessThanOrEqual(EFFECT_ID_MAX);
  });

  it("the two ids from the bead parse; an id over the cap still fails", () => {
    for (const id of ["card:outer-realms-abomination/Reality Quake:1", "card:cephilith-abomination/Burrowing Leechpoles:1"]) {
      expect(effectSchema.safeParse({ id, source: "x", text: "", until: "manual" }).success).toBe(true);
    }
    expect(effectSchema.safeParse({ id: "x".repeat(EFFECT_ID_MAX + 1), source: "x", text: "", until: "manual" }).success).toBe(false);
  });
});
