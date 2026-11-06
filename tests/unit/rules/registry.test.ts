import { describe, expect, it } from "vitest";

import { RULE_MODE_FIELDS, ruleChangeValidator, ruleModesValidator, storedRuleModesValidator } from "../../../convex/lib/validators/ruleModes";
import { FRAME_IDS } from "../../../src/lib/frames/index";
import { isChoiceRule, isSwitchRule, isToggleRule, RULES, ruleDef, rulesFor, type RuleDef } from "../../../src/lib/rules/registry";
import { resolveRuleModes, ruleBlockedBy } from "../../../src/lib/rules/resolve";

/** Plan rule-switches RS0: the registry (.omc/plans/rule-registry-list.md) and its stored validator. */

const all = RULES as readonly RuleDef[];
const listed = all.filter((r) => r.code !== undefined);
const optional = all.filter((r) => r.kind === "optional");

/** The literals of a validator: a union of literals, or a single literal; `null` for boolean / number. */
function literals(validator: { kind: string; members?: { kind: string; value?: unknown }[] }): unknown[] | null {
  if (validator.kind === "union") return validator.members!.map((m) => m.value);
  return null;
}

describe("the rule registry", () => {
  it("holds the 61 listed rules (27 with modes, 34 Book-only) and the 10 decided optional rules", () => {
    expect(listed).toHaveLength(61);
    expect(listed.filter(isSwitchRule)).toHaveLength(27);
    expect(listed.filter((r) => r.kind === "bookOnly")).toHaveLength(34);
    expect(listed.filter((r) => r.kind === "appRule").map((r) => r.code)).toEqual(["M2"]);
    expect(optional.map((r) => r.id).sort()).toEqual(
      ["massiveDamage", "spotlightTracker", "fallingDamage", "underwater", "goldCoins", "fateRolls", "pcConflict", "horizonEncounterBonuses", "sharedDomainCards", "definedRanges"].sort(),
    );
    expect(all).toHaveLength(71);
  });

  it("has unique ids and codes, a book page for every rule, and codes per area as listed", () => {
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(listed.map((r) => r.code)).size).toBe(listed.length);
    for (const r of all) {
      expect(r.refs.length, r.id).toBeGreaterThan(0);
      for (const ref of r.refs) expect(ref.page, r.id).toBeGreaterThan(0);
    }
    const prefixes = Object.fromEntries(["R", "F", "D", "A", "C", "T", "X", "S", "M", "L", "K", "E", "W"].map((p) => [p, listed.filter((r) => r.code!.match(/^[A-Z]+/)![0] === p).length]));
    expect(prefixes).toEqual({ R: 11, F: 5, D: 8, A: 3, C: 4, T: 5, X: 3, S: 3, M: 4, L: 3, K: 3, E: 1, W: 8 });
    expect(ruleDef("fearFromRests")).toMatchObject({ code: "F2", refs: [{ book: "CB", page: 105 }] });
  });

  it("lists every switch's modes as book, variants, manual; a variant not in the books says so", () => {
    for (const r of all.filter(isSwitchRule)) {
      expect(r.modes[0]!.id, r.id).toBe("book");
      expect(r.modes[r.modes.length - 1]!.id, r.id).toBe("manual");
      expect(new Set(r.modes.map((m) => m.id)).size, r.id).toBe(r.modes.length);
    }
    expect(ruleDef("minions")).toMatchObject({ modes: [{ id: "book" }, { id: "gmPicks", notInBooks: true }, { id: "manual" }] });
    expect(ruleDef("fearFromRests")).toMatchObject({ modes: [{ id: "book" }, { id: "extendedDowntime", notInBooks: false, ref: { book: "CB", page: 181 } }, { id: "manual" }] });
    expect(ruleDef("wallsBlock")).toMatchObject({ kind: "appRule", modes: [{ id: "book", label: "App rule", notInBooks: true }, { id: "manual" }] });
  });

  it("names the frame of every frame rule and hides it elsewhere", () => {
    for (const r of listed.filter((x) => x.code!.startsWith("W"))) expect(r.frames?.length, r.id).toBe(1);
    expect(rulesFor("witherwild").map((r) => r.id)).toContain("witherTokens");
    expect(rulesFor("beast-feast").map((r) => r.id)).not.toContain("witherTokens");
    expect(rulesFor("custom").some((r) => r.frames !== undefined)).toBe(false);
    expect(rulesFor("journey-to-horizon").map((r) => r.id)).toEqual(expect.arrayContaining(["horizonSanctuaryRest", "doomTrack", "horizonEncounterBonuses"]));
  });
});

describe("drift: registry ↔ campaigns.ruleModes validator", () => {
  const settable = all.filter((r) => r.kind !== "bookOnly");
  const params = all.flatMap((r) => ("param" in r && r.param ? [r.param.key] : []));

  it("has exactly one validator field per settable rule and per rule number, and nothing else", () => {
    expect([...RULE_MODE_FIELDS].sort()).toEqual([...settable.map((r) => r.id), ...params].sort());
    expect(Object.keys(storedRuleModesValidator.fields).sort()).toEqual([...RULE_MODE_FIELDS].sort());
    expect(ruleChangeValidator.members.map((m) => m.fields.key.value).sort()).toEqual([...RULE_MODE_FIELDS].sort());
  });

  it("allows exactly the registry's modes / choices, a boolean for an on/off rule and a number for a rule number", () => {
    const fields = ruleModesValidator.fields as Record<string, { kind: string; members?: { kind: string; value?: unknown }[] }>;
    for (const r of settable) {
      const field = fields[r.id]!;
      if (isSwitchRule(r)) expect(literals(field), r.id).toEqual(r.modes.map((m) => m.id));
      else if (isChoiceRule(r)) expect(literals(field), r.id).toEqual(r.choices.map((c) => c.id));
      else if (isToggleRule(r)) expect(field.kind, r.id).toBe("boolean");
    }
    for (const key of params) expect(fields[key]!.kind, key).toBe("float64");
    for (const key of RULE_MODE_FIELDS) expect((storedRuleModesValidator.fields as Record<string, { isOptional: string }>)[key]!.isOptional, key).toBe("optional");
  });
});

describe("resolveRuleModes", () => {
  it("defaults: every switch Book, optional rules off except Defined Ranges, Shared domain cards Warn, numbers at their default", () => {
    for (const frameId of FRAME_IDS) {
      const modes = resolveRuleModes(frameId, undefined) as unknown as Record<string, unknown>;
      for (const r of all.filter(isSwitchRule)) expect(modes[r.id], r.id).toBe("book");
      for (const r of all.filter(isToggleRule)) expect(modes[r.id], r.id).toBe(r.id === "definedRanges");
      expect(modes.sharedDomainCards).toBe("warn");
      expect(modes.spotlightTrackerTokens).toBe(3);
      expect(modes.darknessDifficulty).toBe(2);
      expect(Object.keys(modes).sort()).toEqual([...RULE_MODE_FIELDS].sort());
    }
  });

  it("uses stored values; another frame's rule stays Book / off; an unknown or out-of-range value falls back", () => {
    const stored = {
      hopeFearFromRolls: "manual",
      massiveDamage: true,
      definedRanges: false,
      beastFeastFeast: "manual",
      horizonEncounterBonuses: true,
      spotlightTrackerTokens: 9,
      darknessDifficulty: 4,
      darkness: "gone",
    } as never;
    expect(resolveRuleModes("witherwild", stored)).toMatchObject({
      hopeFearFromRolls: "manual",
      massiveDamage: true,
      definedRanges: false,
      beastFeastFeast: "book",
      horizonEncounterBonuses: false,
      spotlightTrackerTokens: 3,
      darknessDifficulty: 4,
      darkness: "book",
    });
    expect(resolveRuleModes("beast-feast", stored).beastFeastFeast).toBe("manual");
    expect(resolveRuleModes("journey-to-horizon", stored).horizonEncounterBonuses).toBe(true);
  });

  it("X2 resolves to Manual and is read-only while X1 is Manual (Q8 a)", () => {
    const modes = resolveRuleModes("witherwild", { deathMovePrompt: "manual", deathMoveResolve: "book" });
    expect(modes.deathMoveResolve).toBe("manual");
    expect(ruleBlockedBy(ruleDef("deathMoveResolve")!, modes)).toBe("deathMovePrompt");
    expect(ruleBlockedBy(ruleDef("deathMoveResolve")!, resolveRuleModes("witherwild", undefined))).toBeNull();
  });
});
