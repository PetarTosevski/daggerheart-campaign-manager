/**
 * Plan lanes-2 wave 10, E1.4a: the Hand's after-the-roll answers (per-chooser picks and chain links, dcm-tn8u) and the
 * squares a use's area needs (Hand point picking: a `point` area one, a wall two; Veil of Night, CB p.336: "between two
 * points").
 */
import { describe, expect, it } from "vitest";

import { answerChoices, areaPickOf, askKey, type ChoiceAsk } from "@/components/combat-map/actions/hand/model";
import type { Step } from "@/lib/domain/card-effects/types";

import type { Id } from "../../convex/_generated/dataModel";

const tok = (s: string) => s as Id<"combatTokens">;

describe("answerChoices (dcm-tn8u)", () => {
  it("answers a per-chooser pick as by:<step>:<chooser>, a chain link as chain:<link>, a plain pick as opt:<step>", () => {
    const asks: ChoiceAsk[] = [
      { kind: "choose", stepId: "boon", label: "Pick a boon", count: 1, options: [{ id: "hope", label: "Hope" }], chooserId: tok("ally1") } as ChoiceAsk,
      { kind: "choose", stepId: "mode", label: "Pick a mode", count: 1, options: [{ id: "a", label: "A" }] } as ChoiceAsk,
      { kind: "followUp", label: "Next link", link: 1, tokenIds: [tok("t1"), tok("t2")] },
    ];
    expect(askKey(asks[0]!)).toBe("boon:ally1");
    expect(askKey(asks[2]!)).toBe("chain:1");
    const out = answerChoices(asks, { "boon:ally1": ["hope"], mode: ["a"], "chain:1": ["t2"] }, {});
    expect(out).toEqual([
      { id: "by:boon:ally1", value: ["hope"] },
      { id: "opt:mode", value: ["a"] },
      { id: "chain:1", value: ["t2"] },
    ]);
  });
});

describe("areaPickOf (Hand point picking)", () => {
  const area = (extra: Record<string, unknown>): Step => ({ kind: "area", to: "self", area: { label: "Mist", centre: "point", radius: "close", side: "all", duration: "scene", ...extra } }) as Step;

  it("a point area needs one square, a wall two; a self-centred circle none", () => {
    expect(areaPickOf({ steps: [area({ placeWithin: "far" })] })).toEqual({ label: "Mist", radius: "close", placeWithin: "far", squares: 1 });
    expect(areaPickOf({ steps: [area({ shape: "wall", centre: "self" })] })?.squares).toBe(2);
    expect(areaPickOf({ steps: [area({ centre: "self" })] })).toBeNull();
  });

  it("finds an area inside an optional step", () => {
    expect(areaPickOf({ steps: [{ kind: "optional", id: "o", to: "self", label: "Also", steps: [area({})] } as unknown as Step] })?.label).toBe("Mist");
  });
});
