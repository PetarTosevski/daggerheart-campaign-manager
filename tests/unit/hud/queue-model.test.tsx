/**
 * Plan combat-hud H5.1: the request queue's pure parts — the client merge of the open requests (oldest first), the
 * cards' lines, "Already answered" codes and the Resolutions rows.
 */
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  isAlreadyAnswered,
  itemLabel,
  namesText,
  outOfRangeReason,
  queueItems,
  fearRollLine,
  isFearRoll,
  resolutionRows,
  targetsText,
  windowHit,
  windowSub,
  windowWaiting,
} from "@/components/combat-map/hud/queue/model";
import { errorCode } from "@/lib/lorekeeper/answer-model";

const sniper = { tokenId: "t-sniper", name: "Sniper" };
const bandit = { tokenId: "t-bandit", name: "Bandit" };

describe("queueItems", () => {
  it("merges every source, oldest first; a source still loading adds nothing", () => {
    const items = queueItems({
      attacks: [{ requestId: "a", characterName: "Moss", createdAt: 30, targets: [sniper], outOfRange: [{ tokenId: "t-sniper", band: "veryFar" }] }],
      cards: [{ requestId: "c", characterName: "Moss", cardName: "Vicious Entangle", createdAt: 10, targets: [sniper], outOfRange: [] }],
      features: undefined,
      difficulties: [{ requestId: "d", characterName: "Brannoc", createdAt: 20, ask: "charge", target: bandit, seers: [] }],
      windows: [],
      cloaks: [{ requestId: "k", characterName: "Vex", label: "Words of Discord", targets: [bandit], createdAt: 5 }],
      keywords: undefined,
      allyRolls: [{ requestId: "r", characterName: "Moss", rollerName: "Brannoc", featureName: "Cannonball", createdAt: 30 }],
    });
    expect(items.map((i) => `${i.kind}:${i.key}`)).toEqual(["cloak:k", "card:c", "difficulty:d", "attack:a", "allyRoll:r"]);
  });

  it("is empty with nothing loaded", () => {
    expect(queueItems({})).toEqual([]);
  });
});

describe("lines", () => {
  it("out of range: bands for the targets beyond reach", () => {
    expect(targetsText([sniper, bandit], [{ tokenId: "t-sniper", band: "veryFar" }])).toBe("Sniper (Very Far), Bandit");
    expect(outOfRangeReason([sniper], [{ tokenId: "t-sniper", band: "veryFar" }])).toBe("Sniper is Very Far.");
    expect(outOfRangeReason([sniper, bandit], [{ tokenId: "t-sniper", band: "veryFar" }, { tokenId: "t-bandit", band: "far" }])).toBe("Sniper (Very Far), Bandit (Far) are out of range.");
  });

  it("reaction windows: after the attack, the hit, who is left", () => {
    const row = { attackerLabel: "Bandit", targetName: "Moss", damage: 9, damageType: "physical" as const, direct: false, critical: false, awaiting: [{ name: "Oriel", role: "ally" as const }, { name: "Vex", role: "ally" as const }] };
    expect(windowSub(row)).toBe("After Bandit’s attack");
    expect(windowSub({ ...row, feature: "Coup de Grace", preRoll: true })).toBe("Bandit (Coup de Grace) attacks Moss, before the roll");
    expect(windowHit(row)).toBe("Hit Moss: 9 physical damage.");
    expect(windowHit({ ...row, preRoll: true })).toBeNull();
    expect(windowWaiting(row)).toBe("Waiting on Oriel and Vex. Their screens show what they can use.");
    expect(windowWaiting({ awaiting: [] })).toBe("Everyone answered.");
    expect(namesText(["A", "B", "C"])).toBe("A, B and C");
  });

  it("labels name who and what", () => {
    const [item] = queueItems({ features: [{ requestId: "f", characterName: "Moss", featureName: "Wild Surge", createdAt: 1, targets: [], outOfRange: [] }] });
    expect(itemLabel(item!)).toBe("Moss · Wild Surge");
  });
});

describe("Already answered", () => {
  it("REQUEST_NOT_OPEN and DEATH_MOVE_NOT_WAITING drop the item; other codes are errors", () => {
    expect(errorCode(new ConvexError({ code: "REQUEST_NOT_OPEN" }))).toBe("REQUEST_NOT_OPEN");
    expect(isAlreadyAnswered(new ConvexError({ code: "REQUEST_NOT_OPEN" }))).toBe(true);
    expect(isAlreadyAnswered(new ConvexError({ code: "DEATH_MOVE_NOT_WAITING" }))).toBe(true);
    expect(isAlreadyAnswered(new ConvexError({ code: "COMBAT_TARGET_INVALID" }))).toBe(false);
    expect(isAlreadyAnswered(new Error("network"))).toBe(false);
    expect(errorCode("x")).toBeUndefined();
  });
});

describe("resolutionRows", () => {
  it("the GM's combat and adversary rows, newest first, at most six", () => {
    const row = (id: string, kind: string, visibility = "gm") => ({ _id: id, kind, visibility, undone: false, canUndo: true });
    const rows = [row("1", "combat"), row("2", "combat", "public"), row("3", "adversary"), row("4", "roll"), row("5", "adversary", "public")];
    expect(resolutionRows(rows).map((r) => r._id)).toEqual(["1", "3"]);
    expect(resolutionRows(Array.from({ length: 10 }, (_, i) => row(String(i), "combat")))).toHaveLength(6);
  });

  it("plus every roll with Fear (user answer 2026-11-02): 'Vex rolled with Fear · +1 Fear'", () => {
    const roll = (id: string, outcome: string, fearDelta?: number) => ({
      _id: id,
      kind: "roll",
      visibility: "public",
      undone: false,
      canUndo: true,
      summary: "Vex: Agility action roll 14, Success with Fear",
      roll: { outcome },
      ...(fearDelta !== undefined ? { fearDelta } : {}),
    });
    const rows = [roll("1", "successFear", 1), roll("2", "successHope"), roll("3", "failFear"), { _id: "4", kind: "combat", visibility: "gm", undone: false, canUndo: true }];
    expect(resolutionRows(rows).map((r) => r._id)).toEqual(["1", "3", "4"]);
    expect(isFearRoll(rows[0]!)).toBe(true);
    expect(isFearRoll(rows[1]!)).toBe(false);
    expect(fearRollLine(roll("1", "successFear", 1))).toEqual({ lead: "Vex rolled with Fear", fear: "+1 Fear" });
    // At 12 Fear the roll gives none: no "+n Fear".
    expect(fearRollLine(roll("3", "failFear"))).toEqual({ lead: "Vex rolled with Fear", fear: null });
  });
});
