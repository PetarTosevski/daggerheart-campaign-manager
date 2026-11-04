import { describe, expect, it } from "vitest";

import { ADVERSARY_TRIGGER_KINDS } from "@/lib/domain/adversary-effects/types";
import type { AdversaryFeatureUse, AdversaryTrigger } from "@/lib/domain/adversary-effects/types";

// Plan lanes-2, tracer V3 (docs/tasks/TASK-LN3-V3.md): the vocabulary widened a third time, widen only. The fixtures write
// each bead's mechanic with the new pieces (the types are the test: a narrowing breaks the build).

/** dcm-j63t: every narrowing of the pcEscapes trigger. */
const escapeTriggers: AdversaryTrigger[] = [
  { kind: "pcEscapes" },
  { kind: "pcEscapes", name: "bramble" },
  { kind: "pcEscapes", condition: { kind: "standard", condition: "restrained" } },
  { kind: "pcEscapes", condition: { kind: "tag", tag: "Entangled" }, within: "close" },
];

/**
 * dcm-j63t Drain and Multiply (Tangle Bramble Swarm, CB p.218, with Encumber's bramble tokens): when a PC removes bramble
 * tokens, a Minion appears per token removed (the event's token count is `trigger.amount`).
 */
const drainAndMultiply: AdversaryFeatureUse = {
  id: "main",
  activation: { kind: "auto", trigger: { kind: "pcEscapes", name: "bramble" } satisfies AdversaryTrigger },
  needsSpotlight: false,
  steps: [{ kind: "summon", label: "Tangle Bramble", count: { kind: "triggerAmount" }, range: "close" }],
};

describe("the V3 widening (plan lanes-2)", () => {
  it("adds pcEscapes once, keeping V's four trigger kinds last", () => {
    expect(ADVERSARY_TRIGGER_KINDS).toContain("pcEscapes");
    expect(ADVERSARY_TRIGGER_KINDS.filter((k) => k === "pcEscapes")).toHaveLength(1);
    expect(ADVERSARY_TRIGGER_KINDS.slice(-4)).toEqual(["pcSpotlit", "allyAttacks", "pcDealsDamage", "pcsRest"]);
  });

  it("expresses dcm-j63t's mechanic with the widened trigger", () => {
    expect(escapeTriggers.every((t) => t.kind === "pcEscapes")).toBe(true);
    const a = drainAndMultiply.activation;
    expect(a.kind === "auto" && a.trigger.kind).toBe("pcEscapes");
  });
});
