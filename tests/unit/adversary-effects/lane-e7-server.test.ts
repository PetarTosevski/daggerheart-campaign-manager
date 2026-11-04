import { describe, expect, it } from "vitest";

import { instanceUses, limitOf, storedUses, type Block } from "../../../convex/lib/adversaryFeatures";
import type { Doc } from "../../../convex/_generated/dataModel";
import { adversaryCountdownArmed, adversaryCountdownLabels, adversaryCountdownName, countdownLabelBonus } from "@/lib/domain/adversary-actions";
import { adversaryFeatureUseKey } from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "@/lib/domain/adversary-effects/types";

// Plan lanes, tracer E7 (docs/tasks/TASK-LN-E7.md): the server helpers of the adversary engine, with plain fixture rows.

describe("dcm-bxp.78: countdowns an adversary feature names", () => {
  it("the printed label first, then the ones its text names", () => {
    expect(adversaryCountdownLabels({ countdown: "Countdown (Decreasing 8)", text: "When it triggers, roll." })).toEqual(["Countdown (Decreasing 8)"]);
    expect(adversaryCountdownLabels({ text: "activate a Doom Countdown (1d6+1) for that PC. It ticks down when a PC rolls with Fear." })).toEqual(["Doom Countdown (1d6+1)"]);
    expect(adversaryCountdownLabels({ text: "starting a Petrification Countdown (4). This countdown ticks down when the Gorgon is attacked." })).toEqual(["Petrification Countdown (4)"]);
  });

  it("armed only when it ticks on action rolls (CB p.162); the entry's tickOn wins", () => {
    expect(adversaryCountdownArmed("When it triggers, the Warlord unleashes.")).toBe(true);
    expect(adversaryCountdownArmed("It ticks down when the Dullahan is spotlighted. When it triggers, the target makes a death move.")).toBe(false);
    expect(adversaryCountdownArmed("It ticks down when a PC rolls with Fear.")).toBe(false);
    expect(adversaryCountdownArmed("The countdown ticks down whenever a PC makes an action roll.")).toBe(true);
    expect(adversaryCountdownArmed("It ticks down when the Dullahan is spotlighted.", "actionRoll")).toBe(true);
    expect(adversaryCountdownArmed("No advancement named.", "spotlight")).toBe(false);
  });

  it("names: '<Adversary>: <Feature>' and per PC '<Adversary>: <Feature> - <PC>'", () => {
    expect(adversaryCountdownName("Dullahan", "Doom")).toBe("Dullahan: Doom");
    expect(adversaryCountdownName("Dullahan", "Doom", "Mira")).toBe("Dullahan: Doom - Mira");
  });

  it("a flat bonus on rolled dice comes off the label", () => {
    expect(countdownLabelBonus("Doom Countdown (1d6+1)")).toEqual({ label: "Doom Countdown (1d6)", plus: 1 });
    expect(countdownLabelBonus("Countdown (Loop 2d6)")).toEqual({ label: "Countdown (Loop 2d6)", plus: 0 });
  });
});

describe("dcm-c5h: a once-per-GM-turn use counts only in its GM turn", () => {
  const ravenous: AdversaryFeatureEffect = {
    adversaryId: "wyrmlings",
    feature: "Ravenous",
    uses: [{ id: "main", activation: { kind: "reaction", trigger: { kind: "pcMarksHp", fromSelf: true } }, needsSpotlight: false, limit: { per: "scene", period: "gmTurn" }, steps: [] }],
  };
  const block = { adversaryId: "wyrmlings", effects: [ravenous] } as unknown as Block;
  const key = adversaryFeatureUseKey("wyrmlings", "Ravenous");
  const encounter = (gmTurn: number) => ({ startedAt: 100, createdAt: 50, gmTurn }) as unknown as Doc<"encounters">;
  const instance = (featureUses: Doc<"encounterAdversaries">["featureUses"]) => ({ featureUses }) as unknown as Doc<"encounterAdversaries">;

  it("reads the limit's period", () => {
    expect(limitOf(block, key)).toMatchObject({ period: "gmTurn" });
  });

  it("stores the GM turn with the key; the runner sees the plain key in that turn only", () => {
    const stored = storedUses(instance([]), encounter(3), block, [{ key, until: "session" }], undefined);
    expect(stored).toEqual([{ key: `${key}@gmTurn3`, until: "session", scene: 100 }]);
    expect(instanceUses(instance(stored), encounter(3))).toEqual([{ key, until: "session" }]);
    expect(instanceUses(instance(stored), encounter(4))).toEqual([]);
  });

  it("a later turn drops the old entry when it records a new one", () => {
    const stored = storedUses(instance([{ key: `${key}@gmTurn3`, until: "session", scene: 100 }]), encounter(4), block, [{ key, until: "session" }], undefined);
    expect(stored.map((u) => u.key)).toEqual([`${key}@gmTurn4`]);
  });

  it("other limits are stored as before", () => {
    const other = adversaryFeatureUseKey("wyrmlings", "Other");
    expect(storedUses(instance([]), encounter(3), block, [{ key: other, until: "session" }], undefined)).toEqual([{ key: other, until: "session", scene: 100 }]);
  });
});
