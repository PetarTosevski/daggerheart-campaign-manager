/**
 * The picking core's pure model (plan combat-hud H3.0; docs/tasks/TASK-HUD-H3.0.md): rows from the classic rules
 * (fitsSide / outOfRange of the Hand model, the server's target hints), states picked / in / out / los, single and
 * multi picks, the selection a primary sees, the rule line, labels, "Waiting for the GM" rows, and the plain attack
 * session (out of range -> pending, nothing else).
 */
import { describe, expect, it, vi } from "vitest";

import { plainAttackSession } from "@/components/combat-map/hud/pick/attack";
import {
  buildRows,
  canToggle,
  clearTop,
  GM_APPROVES_LINE,
  keepPicks,
  primaryProblem,
  ringLabel,
  rowLabel,
  rowsFrom,
  ruleText,
  selectionOf,
  stateOf,
  togglePick,
  waitingReason,
  waitingUses,
  type PickCreature,
} from "@/components/combat-map/hud/pick/model";
import type { PickRule } from "@/components/combat-map/hud/pick/types";
import type { TargetHint } from "@/components/combat-map/actions/targets";

import type { Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => async () => null }));

const tok = (s: string) => s as Id<"combatTokens">;
const MOSS = tok("moss");
const BRANNOC = tok("brannoc");
const LT = tok("lt");
const BANDIT = tok("bandit");
const SNIPER = tok("sniper");
const WALLED = tok("walled");

// Moss at (5,10); the Bandit 5 squares away (Close), the Lieutenant 9 (Far), the Sniper 19 (Very Far).
const creatures: PickCreature[] = [
  { tokenId: MOSS, name: "Moss", side: "self", at: { x: 5, y: 10, size: 1 } },
  { tokenId: BRANNOC, name: "Brannoc", side: "pc", at: { x: 8, y: 9, size: 1 }, conditions: ["Hidden"] },
  { tokenId: LT, name: "Lieutenant", side: "enemy", at: { x: 14, y: 10, size: 1 }, conditions: ["Vulnerable"] },
  { tokenId: BANDIT, name: "Bandit", side: "enemy", at: { x: 10, y: 12, size: 1 } },
  { tokenId: SNIPER, name: "Sniper", side: "enemy", at: { x: 24, y: 14, size: 1 } },
  { tokenId: WALLED, name: "Bandit B", side: "enemy", at: { x: 21, y: 5, size: 1 } },
];

const hint = (tokenId: Id<"combatTokens">, band: TargetHint["band"], inRange: boolean, lineOfSight = true): TargetHint => ({ tokenId, band, inRange, lineOfSight, cover: false });
const hints: TargetHint[] = [hint(LT, "far", false), hint(BANDIT, "close", true), hint(SNIPER, "veryFar", false), hint(WALLED, "veryFar", false, false)];

const far: PickRule = { side: "enemy", max: 1, range: "far" };

describe("buildRows", () => {
  it("lists every creature of the rule's side with band and reach, in reach first, nearest first", () => {
    const rows = buildRows({ creatures, rule: far, hints, picked: [] });
    expect(rows.map((r) => [r.name, r.band, r.reach])).toEqual([
      ["Bandit", "close", "in"],
      ["Lieutenant", "far", "in"],
      ["Sniper", "veryFar", "out"],
      ["Bandit B", "veryFar", "los"],
    ]);
    expect(rows.find((r) => r.tokenId === LT)!.conditions).toEqual(["Vulnerable"]);
  });

  it("a weapon range reads the server's hint (inRange), not the client's band check", () => {
    const rows = buildRows({ creatures, rule: { side: "enemy", max: 1, range: "weapon" }, hints, picked: [] });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.reach]))).toEqual({ Bandit: "in", Lieutenant: "out", Sniper: "out", "Bandit B": "los" });
  });

  it("without hints (still loading, or a non-PC actor) nothing is out of sight and the band comes from the map", () => {
    const rows = buildRows({ creatures, rule: far, hints: undefined, picked: [] });
    expect(rows.every((r) => r.reach !== "los")).toBe(true);
    expect(rows.find((r) => r.tokenId === SNIPER)!.band).toBe("veryFar");
  });

  it("allies and yourself follow the Hand model's sides", () => {
    const ally = buildRows({ creatures, rule: { side: "ally", max: 1, range: "close" }, hints, picked: [] });
    expect(ally.map((r) => r.name)).toEqual(["Brannoc"]);
    const selfOrAlly = buildRows({ creatures, rule: { side: "selfOrAlly", max: null, range: "close" }, hints, picked: [] });
    expect(selfOrAlly.map((r) => r.name)).toEqual(["You", "Brannoc"]);
    expect(buildRows({ creatures, rule: { side: "any", max: null, range: "veryFar" }, hints, picked: [] })).toHaveLength(6);
  });

  it("a picker's own rows get empty conditions", () => {
    expect(rowsFrom([{ tokenId: LT, name: "Lieutenant", side: "enemy", band: "far", reach: "in" }])[0]!.conditions).toEqual([]);
  });
});

describe("picking", () => {
  const rows = buildRows({ creatures, rule: far, hints, picked: [] });
  const row = (id: Id<"combatTokens">) => rows.find((r) => r.tokenId === id);

  it("single: a tap replaces the pick, a tap on the picked one clears it", () => {
    expect(togglePick([], LT, far, row(LT))).toEqual([LT]);
    expect(togglePick([LT], BANDIT, far, row(BANDIT))).toEqual([BANDIT]);
    expect(togglePick([LT], LT, far, row(LT))).toEqual([]);
  });

  it("several: adds and removes up to max; out of range is pickable; out of sight and locked never change", () => {
    const two: PickRule = { ...far, max: 2 };
    expect(togglePick([LT], SNIPER, two, row(SNIPER))).toEqual([LT, SNIPER]);
    expect(togglePick([LT, SNIPER], BANDIT, two, row(BANDIT))).toEqual([LT, SNIPER]);
    expect(togglePick([LT, SNIPER], LT, two, row(LT))).toEqual([SNIPER]);
    expect(togglePick([], WALLED, two, row(WALLED))).toEqual([]);
    expect(togglePick([LT], BANDIT, { ...two, locked: true }, row(BANDIT))).toEqual([LT]);
    expect(canToggle(row(WALLED)!, far)).toBe(false);
    expect(togglePick([LT], BANDIT, { ...far, max: null }, row(BANDIT))).toEqual([LT, BANDIT]);
  });

  it("states: picked wins; keepPicks drops tokens that left the rows or are out of sight", () => {
    expect(stateOf(row(SNIPER)!, [SNIPER])).toBe("picked");
    expect(stateOf(row(SNIPER)!, [])).toBe("out");
    expect(stateOf(row(WALLED)!, [])).toBe("los");
    expect(keepPicks([LT, tok("gone"), WALLED], rows)).toEqual([LT]);
  });

  it("the selection lists picks in order and says when one is out of range", () => {
    const s = selectionOf(rows, [SNIPER, LT], { restrain: true });
    expect(s.targets.map((t) => t.name)).toEqual(["Sniper", "Lieutenant"]);
    expect(s.targetIds).toEqual([SNIPER, LT]);
    expect(s.outOfRange).toBe(true);
    expect(s.options).toEqual({ restrain: true });
    expect(selectionOf(rows, [LT], {}).outOfRange).toBe(false);
  });

  it("the primary needs the rule's minimum, then the picker's reason", () => {
    const none = selectionOf(rows, [], {});
    expect(primaryProblem(none, far, null)).toBe("Pick a target first");
    expect(primaryProblem(none, { ...far, side: "ally" }, null)).toBe("Pick an ally first");
    expect(primaryProblem(none, { ...far, min: 0 }, null)).toBeNull();
    expect(primaryProblem(selectionOf(rows, [LT], {}), far, "Needs 1 Hope · you have 0")).toBe("Needs 1 Hope · you have 0");
    expect(primaryProblem(selectionOf(rows, [LT], {}), { ...far, max: 3, min: 2 }, null)).toBe("Pick at least 2");
  });
});

describe("words", () => {
  it("the rule line", () => {
    expect(ruleText(far)).toBe("Pick 1 target within Far");
    expect(ruleText({ side: "ally", max: 3, range: "close" })).toBe("Pick up to 3 allies within Close");
    expect(ruleText({ side: "enemy", max: null, range: "weapon" })).toBe("Pick any number of targets in your weapon’s range");
    expect(ruleText({ side: "enemy", max: 1, range: "unlimited" })).toBe("Pick 1 target at any range");
    expect(ruleText({ ...far, text: "Pick the Bandit to Restrain" })).toBe("Pick the Bandit to Restrain");
  });

  it("row names and ring labels carry names and bands only (U1), with conditions (answer 10a)", () => {
    const rows = buildRows({ creatures, rule: far, hints, picked: [] });
    const lt = rows.find((r) => r.tokenId === LT)!;
    const sniper = rows.find((r) => r.tokenId === SNIPER)!;
    const walled = rows.find((r) => r.tokenId === WALLED)!;
    expect(rowLabel(lt, "picked")).toBe("Lieutenant, Far, Vulnerable, picked");
    expect(rowLabel(sniper, "out")).toBe("Sniper, Very Far, out of range: the GM approves");
    expect(rowLabel(walled, "los")).toBe("Bandit B, Very Far, no line of sight: can’t be picked");
    expect(ringLabel(sniper)).toBe("Very Far");
    expect(ringLabel(walled)).toBe("No line of sight");
    for (const r of rows) expect(rowLabel(r, "in")).not.toMatch(/\d/);
    expect(GM_APPROVES_LINE).toMatch(/Nothing is rolled or paid/);
  });
});

describe("Waiting for the GM", () => {
  const CH = "moss-c" as Id<"characters">;
  const req = (s: string) => s as Id<"combatRequests">;
  const base = { characterId: CH, targets: [{ tokenId: SNIPER, name: "Sniper" }], outOfRange: [{ tokenId: SNIPER, band: "veryFar" as const }] };

  it("merges attack, card and feature sanctions, oldest first, for the character", () => {
    const rows = waitingUses({
      attacks: [{ ...base, requestId: req("a"), createdAt: 3 }],
      cards: [{ ...base, requestId: req("c"), createdAt: 1, cardName: "Vicious Entangle" }],
      features: [{ ...base, requestId: req("f"), createdAt: 2, featureName: "Rally" }, { ...base, characterId: "other" as Id<"characters">, requestId: req("x"), createdAt: 0, featureName: "Other" }],
      characterId: CH,
    });
    expect(rows.map((r) => r.use)).toEqual(["Vicious Entangle", "Rally", "Attack"]);
    expect(waitingUses({ attacks: undefined, cards: undefined, features: undefined, characterId: null })).toEqual([]);
  });

  it("says who is how far, nothing else", () => {
    expect(waitingReason(base)).toBe("Sniper is Very Far.");
    expect(waitingReason({ targets: [], outOfRange: [] })).toBe("It is out of range.");
  });
});

describe("the plain attack session", () => {
  const CH = "moss-c" as Id<"characters">;
  const spec = (out: Awaited<ReturnType<Parameters<typeof plainAttackSession>[0]["attack"]>>, onResult = vi.fn()) => {
    const attack = vi.fn(async () => out);
    return {
      attack,
      onResult,
      spec: plainAttackSession({ campaignId: "c" as Id<"campaigns">, mapId: "m" as Id<"combatMaps">, characterId: CH, slot: "primary", weaponName: "Shortstaff", picked: [BANDIT, LT], attack, onResult }),
    };
  };
  const rows = buildRows({ creatures, rule: { side: "enemy", max: 1, range: "weapon" }, hints, picked: [] });

  it("one enemy in the weapon's range, the latest pick kept, the primary names the target", () => {
    const { spec: s } = spec({ status: "pending", requestId: "r" as Id<"combatRequests"> });
    expect(s.rule).toMatchObject({ side: "enemy", max: 1, range: "weapon", slot: "primary" });
    expect(s.picked).toEqual([LT]);
    expect(s.primary.label(selectionOf(rows, [LT], {}))).toBe("Attack Lieutenant");
    expect(s.primary.label(selectionOf(rows, [], {}))).toBe("Attack with Shortstaff");
  });

  it("out of range: the server's pending becomes a pending outcome (nothing rolled)", async () => {
    const { spec: s, attack } = spec({ status: "pending", requestId: "r" as Id<"combatRequests"> });
    await expect(s.primary.send(selectionOf(rows, [LT], {}))).resolves.toEqual({ kind: "pending", requestId: "r" });
    expect(attack).toHaveBeenCalledWith({ targetTokenIds: [LT], slot: "primary" });
  });

  it("resolved: Hit / Miss / Defeated only (hard rule 2)", async () => {
    for (const [t, word] of [
      [{ hit: true, defeated: false }, "Hit"],
      [{ hit: false, defeated: false }, "Miss"],
      [{ hit: true, defeated: true }, "Defeated"],
    ] as const) {
      const { spec: s, onResult } = spec({ status: "resolved", targets: [t] });
      await expect(s.primary.send(selectionOf(rows, [BANDIT], {}))).resolves.toEqual({ kind: "done" });
      expect(onResult).toHaveBeenCalledWith(word);
    }
  });
});

describe("clearTop: the panel stays clear of a player's map controls (dcm-bxp.99.32.22)", () => {
  const controls = { left: 690, top: 60, right: 980, bottom: 104 };
  it("a panel under the controls' columns stands below them", () => {
    expect(clearTop(8, 700, 292, [controls], 8)).toBe(112);
    expect(clearTop(40, 500, 292, [controls], 8)).toBe(112);
  });
  it("a panel beside them, or already below them, keeps its spot", () => {
    expect(clearTop(8, 300, 292, [controls], 8)).toBe(8);
    expect(clearTop(300, 700, 292, [controls], 8)).toBe(300);
    expect(clearTop(-20, 980, 292, [], 8)).toBe(8);
  });
});
