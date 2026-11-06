import { describe, expect, it } from "vitest";

import { choiceAsks, type BuiltRun } from "../../convex/lib/cardRunner";
import type { RunPlan } from "../../src/lib/domain/card-effects/run";

/**
 * dcm-bxp.99.32.23 (plan combat-hud H4.1): a `needsChoice` split ask carries the total to share (`amount`, the engine's
 * prompt amount: the actor's damage total, Hope, Stress, marks or clears), so the HUD shows "Split 14 damage" and "n left".
 */

const built = {
  context: { actor: { id: "me" } },
  creatures: { onMap: false, get: (id: string) => ({ tokenId: `token-${id}` }) },
} as unknown as BuiltRun;

const plan = (steps: unknown[]) => ({ steps }) as unknown as RunPlan;

describe("choiceAsks: split asks", () => {
  it("carry the prompt's amount with the label and the targets' tokens", () => {
    const asks = choiceAsks(built, plan([{ kind: "prompt", prompt: "split", text: "Distribute the damage", targetIds: ["a", "b"], amount: 14 }]));
    expect(asks).toEqual([{ kind: "split", label: "Distribute the damage", tokenIds: ["token-a", "token-b"], amount: 14 }]);
  });

  it("leave amount off when the prompt has none", () => {
    const asks = choiceAsks(built, plan([{ kind: "prompt", prompt: "split", text: "Divide the Hope", targetIds: ["a"] }]));
    expect(asks).toEqual([{ kind: "split", label: "Divide the Hope", tokenIds: ["token-a"] }]);
  });
});
