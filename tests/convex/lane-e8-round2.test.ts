// Plan lanes-2, tracer E8 (docs/tasks/TASK-LN2-E8.md): the feature runner's round-2 pieces. Pure functions, inline
// fixtures (the SRD entries switch in wave 9).
// Book (printed pages): Know the Tide (CB p.77) "spend any number of these tokens"; Armored Shell (CB p.33) "reduce the
// incoming damage by your Armor Score"; Blight Seed (HF p.9) "This effect can't stack"; Contacts Everywhere (CB p.43)
// "a handful of gold"; Stance Fighter (HF p.12) "shift into a martial stance"; Ranger's Focus (CB p.39) "On a success,
// that target becomes your Focus"; Otherworldly Ire (HF p.15) "spend any number of Favor to roll that many Patron Dice";
// Vitality (CB p.330) "When you choose this card, permanently gain two of the following benefits".
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { chosenMark, countChoices, countMark, isMarkOf, withChosenCount, withoutCountMarks } from "../../convex/lib/featurePrompts";
import { giftsOf, giveTo, HELD_DICE_PICKS, ownFacts, refuseStacked, splitFeatureChoices, stancesOf } from "../../convex/lib/featureRunner";
import type { RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardEffect, CardUse } from "../../src/lib/domain/card-effects/types";
import type { RollRecord } from "../../src/lib/domain/duality";
import { missedFor } from "../../src/lib/domain/feature-effects/delegate";
import { bindSheetNumbers, onChooseUse, runOnChoose, sheetNumbers } from "../../src/lib/domain/feature-effects/run";
import { actorOf, sheetOf } from "../unit/feature-effects/engine/fixtures";

const plan = (steps: RunPlan["steps"]): RunPlan => ({ steps }) as unknown as RunPlan;
const errorCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code;
  }
  return undefined;
};

describe("dcm-me3 / dcm-rm9 / dcm-78x / dcm-bxp.99.19.4: the sheet's own numbers", () => {
  const sheet = sheetOf("guardian", "stalwart", { sessionFeatures: { tideTokens: 3 } } as never);

  it("reads Tide tokens, class dice and the derived stats", () => {
    const n = sheetNumbers({ ...sheet, classState: { ...sheet.classState, unstoppable: { value: 4 } } } as never);
    expect(n.tideTokens).toBe(3);
    expect(n.classDice.unstoppable).toBe(4);
    expect(n.stats.armorScore).toBeGreaterThanOrEqual(0);
    expect(n.stats.severeThreshold).toBeGreaterThan(n.stats.majorThreshold);
  });

  it("binds tideTokens / classDie / self stat sources as fixed numbers; other parts keep their identity", () => {
    const n = { tideTokens: 3, classDice: { unstoppable: 4 }, stats: { armorScore: 5, evasion: 10, majorThreshold: 7, severeThreshold: 14 } };
    const use = { id: "main", choices: [{ id: "n", max: { kind: "tideTokens" } }], steps: [{ x: { kind: "stat", stat: "armorScore", who: "self" } }, { y: { kind: "classDie", die: "unstoppable" } }] };
    const bound = bindSheetNumbers(use, n);
    expect(bound.choices[0]!.max).toEqual({ kind: "fixed", value: 3 });
    expect(bound.steps[0]!.x).toEqual({ kind: "fixed", value: 5 });
    expect(bound.steps[1]!.y).toEqual({ kind: "fixed", value: 4 });
    // A stat Mod (delta) and an adversary's stat are not sources of the sheet.
    const other = { a: { kind: "stat", stat: "armorScore", delta: 1 }, b: { kind: "stat", stat: "evasion", who: "target" } };
    expect(bindSheetNumbers(other, n)).toBe(other);
  });

  it("ownFacts: the feature's own tokens, the moon die and the items carried", () => {
    const s = { ...sheet, cardTokens: [{ cardId: "feat:feed", count: 2 }], sessionFeatures: { moonDie: 5 }, inventory: [{ id: "i", name: "Rope" }] } as never;
    const facts = ownFacts(s, "feed");
    expect(facts.moonPhase).toBe(5);
    expect(facts.items).toEqual(["Rope"]);
    expect(typeof facts.cardTokens).toBe("number");
  });
});

describe("dcm-kkx: an effect that can't stack", () => {
  const effect = (targetId: string) => ({ kind: "effect", targetId, label: "Blight Seed", mods: [], duration: "scene", stacking: "refuse" }) as unknown as RunPlan["steps"][number];

  it("becomes a note on a creature that carries it; others get it", () => {
    const out = refuseStacked(plan([effect("a"), effect("b")]), (id) => (id === "a" ? ["Blight Seed"] : []));
    expect(out.steps[0]).toMatchObject({ kind: "prompt", prompt: "manual", targetIds: ["a"] });
    expect(out.steps[1]).toMatchObject({ kind: "effect", targetId: "b" });
  });

  it("a plan without such a step comes back as is", () => {
    const p = plan([]);
    expect(refuseStacked(p, () => ["x"])).toBe(p);
  });
});

describe("dcm-vf7i: gold and items given to PCs", () => {
  const gift = (targetIds: string[], step: object) => ({ kind: "prompt", prompt: "manual", text: JSON.stringify(step), targetIds, step }) as unknown as RunPlan["steps"][number];

  it("collects gifts for PCs only; a GM's-pick item stays a prompt", () => {
    const g = giftsOf(
      plan([
        gift(["me"], { kind: "inventory", op: "giveGold" }),
        gift(["ally"], { kind: "inventory", op: "giveItem", text: "Lockpicks" }),
        gift(["me"], { kind: "inventory", op: "giveItem" }),
        gift(["foe"], { kind: "inventory", op: "giveGold" }),
      ]),
      (id) => id !== "foe",
    );
    expect(g.byTarget.get("me")).toEqual([{ kind: "gold", handfuls: 1 }]);
    expect(g.byTarget.get("ally")).toEqual([{ kind: "item", name: "Lockpicks" }]);
    expect(g.byTarget.has("foe")).toBe(false);
    expect(g.texts.size).toBe(2);
    expect(g.notes((id) => id)).toEqual(["me: 1 handful of gold", "ally: Lockpicks"]);
  });

  it("writes them to the sheet", () => {
    const sheet = sheetOf("guardian", "stalwart");
    const out = giveTo(sheet, [{ kind: "gold", handfuls: 2 }, { kind: "item", name: "Rope" }]);
    expect(out.inventory.at(-1)?.name).toBe("Rope");
    expect(out.gold).not.toEqual(sheet.gold);
  });
});

describe("dcm-awh: a setStance step", () => {
  const stance = (step: object, targetIds = ["me"]) => ({ kind: "prompt", prompt: "manual", text: "stance", targetIds, step }) as unknown as RunPlan["steps"][number];

  it("names the stance, or the option picked; none is INVALID", () => {
    expect(stancesOf(plan([stance({ kind: "setStance", stance: "Rampart" })]), "me", {})).toEqual(["Rampart"]);
    expect(stancesOf(plan([stance({ kind: "setStance", choice: "s" })]), "me", { s: ["Ironwall"] })).toEqual(["Ironwall"]);
    expect(stancesOf(plan([stance({ kind: "setStance" }, ["other"])]), "me", {})).toEqual([]);
    expect(errorCode(() => stancesOf(plan([stance({ kind: "setStance", choice: "s" })]), "me", {}))).toBe("INVALID");
  });
});

describe("dcm-qbn: the held dice the player picked", () => {
  it("splitFeatureChoices takes heldDicePicks out of the card choices", () => {
    const out = splitFeatureChoices([{ id: HELD_DICE_PICKS, value: ["d1", "d2"] }, { id: "times", value: 2 }, { id: "x", value: 1 }] as never);
    expect(out).toEqual({ rest: [{ id: "x", value: 1 }], times: 2, heldDicePicks: ["d1", "d2"] });
    expect(errorCode(() => splitFeatureChoices([{ id: HELD_DICE_PICKS, value: 3 }] as never))).toBe("INVALID");
  });
});

describe("dcm-8dhe / dcm-d1d: a delegate reads the use's roll", () => {
  it("a missed target reads the success as the failure with the same die", () => {
    const r = (outcome: RollRecord["outcome"]) => ({ outcome }) as RollRecord;
    expect(missedFor(r("successHope")).outcome).toBe("failHope");
    expect(missedFor(r("critical")).outcome).toBe("failHope");
    expect(missedFor(r("successFear")).outcome).toBe("failFear");
    expect(missedFor(r("failFear")).outcome).toBe("failFear");
  });
});

describe("dcm-q3t1: a count rolled from a chosen number (Otherworldly Ire)", () => {
  const ire = {
    id: "main",
    name: "Otherworldly Ire",
    activation: { kind: "action" },
    targets: { side: "enemy", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", count: { kind: "chosen", choice: "favor" }, sidesOf: "patron", keep: "highest" } } },
    steps: [],
  } as unknown as CardUse;

  it("finds the chosen numbers and writes them in as fixed", () => {
    expect(countChoices(ire, { favor: 3 })).toEqual([{ id: "favor", value: 3 }]);
    const bound = withChosenCount(ire, { favor: 3 }) as unknown as { targets: { count: { n: { count: unknown } } } };
    expect(bound.targets.count.n.count).toEqual({ kind: "fixed", value: 3 });
  });

  it("the chosen number's mark goes with its roll's mark", () => {
    const id = "req1" as Id<"combatRequests">;
    const mark = chosenMark(id, "favor", 3);
    expect(isMarkOf(mark, id)).toBe(true);
    expect(isMarkOf(countMark(id), id)).toBe(true);
    const sheet = { featureUses: [{ key: countMark(id), until: "scene" as const }, { key: mark, until: "scene" as const }] };
    expect(withoutCountMarks(sheet, new Set([countMark(id)]))).toBe(sheet);
    expect(withoutCountMarks(sheet).featureUses).toEqual([]);
  });
});

describe("dcm-40mj: the use set off when the card is chosen (Vitality)", () => {
  const vitality = {
    cardId: "vitality",
    uses: [
      { id: "use", name: "Use", activation: { kind: "action" }, steps: [] },
      { id: "choose", name: "Vitality", activation: { kind: "auto", trigger: { kind: "whenYouChooseThisCard" } }, limit: { per: "rest", times: 1 }, steps: [] },
    ],
  } as unknown as CardEffect;

  it("finds and runs it once, without its limit", () => {
    expect(onChooseUse(vitality)?.id).toBe("choose");
    const out = runOnChoose(vitality, { actor: actorOf(sheetOf("guardian", "stalwart")), targets: [] } as never);
    expect(out).toMatchObject({ ok: true });
    expect(runOnChoose({ ...vitality, uses: [vitality.uses[0]!] }, { actor: actorOf(sheetOf("guardian", "stalwart")), targets: [] } as never)).toBeNull();
  });
});
