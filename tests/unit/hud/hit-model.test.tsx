/**
 * The hit window's pure model (plan combat-hud H4.2; docs/tasks/TASK-HUD-H4.2.md): modes, titles, threshold tiles,
 * the armor question, the HP / Armor preview ("n of 6 marked", answer 2), footer labels, the counts stepper and the
 * engine's grants.
 */
import { describe, expect, it } from "vitest";

import type { HitView } from "@/lib/combat-map/reactions";
import {
  armorAsk,
  grantNote,
  grantUnit,
  keepCount,
  keepGrant,
  markLabel,
  offersArmor,
  previewRows,
  slotCounts,
  splitViews,
  stepCount,
  takeLabel,
  thresholdTiles,
  windowMode,
  windowSub,
  windowTitle,
} from "@/components/combat-map/hud/hit/model";

import type { Id } from "../../../convex/_generated/dataModel";

function hitView(over: Partial<HitView> = {}): HitView {
  return {
    requestId: "r1" as Id<"combatRequests">,
    attackerLabel: "Bandit",
    targetCharacterId: "moss" as Id<"characters">,
    targetName: "Moss",
    role: "target",
    awaiting: true,
    cardIds: [],
    createdAt: 1,
    damage: 9,
    severity: "major",
    maxSlots: 1,
    armorPreview: [
      { slots: 0, severity: "major", hp: 2 },
      { slots: 1, severity: "minor", hp: 1 },
    ],
    ...over,
  };
}

const trackers = { hp: { marked: 2, max: 6 }, armor: { marked: 1, max: 3 } };

describe("modes and titles", () => {
  it("offers armor with a free slot, hides it with none, after the answer, or on direct damage", () => {
    expect(windowMode(hitView())).toBe("armorOne");
    expect(offersArmor(windowMode(hitView()))).toBe(true);
    expect(windowMode(hitView({ maxSlots: 0 }))).toBe("ok");
    expect(offersArmor("ok")).toBe(false);
    expect(windowMode(hitView({ direct: true }))).toBe("ok");
    expect(windowMode(hitView({ armorAnswered: true }))).toBe("afterArmor");
    expect(windowMode(hitView({ maxSlots: 3, armorPreview: [{ slots: 0, severity: "severe", hp: 3 }, { slots: 1, severity: "major", hp: 2 }, { slots: 2, severity: "minor", hp: 1 }] }))).toBe("armorMany");
    expect(windowMode(hitView({ role: "ally" }))).toBe("ally");
    expect(windowMode(hitView({ preRoll: true }))).toBe("preRoll");
    expect(windowMode(hitView({ afterHit: true }))).toBe("afterHit");
  });

  it("says You were hit to a player, the PC's name to the GM, and who hit whom", () => {
    expect(windowTitle("armorOne", "Moss", false)).toBe("You were hit");
    expect(windowTitle("armorOne", "Brannoc", true)).toBe("Brannoc was hit");
    expect(windowTitle("ally", "Tabby", false)).toBe("Tabby can react");
    expect(windowTitle("preRoll", "Moss", false)).toBe("Before the roll");
    expect(windowSub(hitView(), "armorOne")).toBe("Bandit hit Moss");
    expect(windowSub(hitView(), "preRoll")).toBe("Bandit attacks Moss");
    expect(windowSub(hitView({ originalTargetName: "Mira", targetName: "Tabby" }), "armorOne")).toBe("Bandit hit Tabby (instead of Mira)");
  });
});

describe("tiles, question and preview", () => {
  it("lights the hit's severity with the engine's HP and the PC's thresholds", () => {
    const tiles = thresholdTiles(hitView(), { major: 9, severe: 16 });
    expect(tiles.map((t) => [t.label, t.hp, t.on])).toEqual([
      ["Minor", 1, false],
      ["Major 9+", 2, true],
      ["Severe 16+", 3, false],
    ]);
    expect(thresholdTiles(hitView(), null).map((t) => t.label)).toEqual(["Minor", "Major", "Severe"]);
    expect(thresholdTiles(hitView({ armorPreview: [{ slots: 0, severity: "none", hp: 0 }] }), null).some((t) => t.on)).toBe(false);
  });

  it("asks to drop it to the next severity, or says why there is no armor option", () => {
    expect(armorAsk(hitView(), "armorOne", 1)).toEqual({ lead: "Mark an Armor Slot to drop it to ", result: "Minor", tail: "?" });
    expect(armorAsk(hitView({ armorPreview: [{ slots: 0, severity: "minor", hp: 1 }, { slots: 1, severity: "none", hp: 0 }] }), "armorOne", 1).result).toBe("no damage");
    expect(armorAsk(hitView({ maxSlots: 0 }), "ok", 0).lead).toBe("No Armor Slot left to mark.");
    expect(armorAsk(hitView({ direct: true }), "ok", 0).lead).toBe("Direct damage: Armor Slots can't reduce it.");
  });

  it("previews HP and Armor as n of max marked; no Armor row without the option", () => {
    const rows = previewRows(hitView(), "armorOne", 1, trackers);
    expect(rows.map((r) => r.text)).toEqual(["2 → 3 of 6 marked", "1 → 2 of 3 marked"]);
    expect(rows[0]!.aria).toBe("Hit Points: 2 of 6 marked now, 3 after");
    const none = previewRows(hitView({ maxSlots: 0 }), "ok", 0, trackers);
    expect(none.map((r) => r.text)).toEqual(["2 → 4 of 6 marked"]);
    expect(previewRows(hitView(), "armorOne", 1, { ...trackers, hp: { marked: 5, max: 6 } })[0]!.after).toBe(6);
    expect(previewRows(hitView(), "armorOne", 1, null)).toEqual([]);
  });

  it("names both footer answers", () => {
    expect(takeLabel(hitView())).toBe("Take 2 HP");
    expect(markLabel(hitView(), 1)).toBe("Mark Armor · take 1 HP");
    expect(takeLabel(hitView({ armorPreview: [{ slots: 0, severity: "none", hp: 0 }] }))).toBe("Take no damage");
  });
});

describe("counts, grants and the queue", () => {
  it("steps through the offered counts only", () => {
    const many = hitView({ maxSlots: 4, armorPreview: [{ slots: 0, severity: "severe", hp: 3 }, { slots: 2, severity: "major", hp: 2 }, { slots: 4, severity: "minor", hp: 1 }] });
    const counts = slotCounts(many, "armorMany");
    expect(counts).toEqual([2, 4]);
    expect(stepCount(counts, 2, 1)).toBe(4);
    expect(stepCount(counts, 4, 1)).toBe(4);
    expect(stepCount(counts, 4, -1)).toBe(2);
    expect(keepCount(counts, 3)).toBe(2);
    expect(keepCount(counts, null)).toBe(2);
    expect(slotCounts(hitView(), "ok")).toEqual([]);
  });

  it("words the engine's grants without inventing rates", () => {
    const hope = { id: "hope", label: "Spend Hope to mark that many fewer of the Hit Points this attack forces", amount: 2 };
    const gold = { id: "gold", label: "Spend handfuls of gold instead of marking Hit Points (1 handful per HP)", amount: 3 };
    expect(grantUnit(hope).spend(1)).toBe("Spend 1 Hope");
    expect(grantUnit(gold).spend(2)).toBe("Spend 2 handfuls of gold");
    expect(grantUnit({ id: "new" }).label).toBe("How many");
    expect(grantNote(hope)).toBe("up to 2");
    expect(keepGrant([hope, gold], "gold")).toBe(gold);
    expect(keepGrant([hope, gold], "gone")).toBe(hope);
    expect(keepGrant([], null)).toBeNull();
  });

  it("shows the oldest owed hit first and counts the rest", () => {
    const a = hitView({ requestId: "a" as Id<"combatRequests">, createdAt: 5 });
    const b = hitView({ requestId: "b" as Id<"combatRequests">, createdAt: 2 });
    const c = hitView({ requestId: "c" as Id<"combatRequests">, awaiting: false });
    const split = splitViews([a, b, c]);
    expect(split.first?.requestId).toBe("b");
    expect(split.more).toBe(1);
    expect(split.waiting.map((v) => v.requestId)).toEqual(["c"]);
  });
});
