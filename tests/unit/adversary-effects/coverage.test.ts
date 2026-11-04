import { describe, expect, it } from "vitest";

import { run, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import { ADVERSARY_EFFECT_GROUPS, type AdversaryFeatureEffect } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions/damage";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ADVERSARY_EFFECT_TABLES, ADVERSARY_EFFECTS, adversaryGroup } from "@/lib/srd/adversary-effects";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AA6 (Q15: "Automate EVERY adversary feature"). Across all eight tier / source tables:
// every printed feature of every SRD adversary has exactly one effect entry, in its own group's table, and no entry
// names a feature or adversary that doesn't exist. Every use of every entry runs through the AA1 runner without
// throwing, in one generic context (the adversary spotlit, Fear confirmed, a PC target, an ally, a trigger and every
// situation confirmed). The AE-* tests check each feature's numbers; this one checks nothing slipped between the
// tables. It PRINTS how many `manual` steps (the feature's words plus a Done button for the GM, Q9) each group holds;
// later lanes reduce them, so the counts are not asserted.

const pc = (id: string): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
});

const ally = (id: string): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
});

const selfOf = (d: AdversaryDef): Combatant => {
  const minion = d.features.map((f) => /^Minion \((\d+)\)$/.exec(f.name)).find((m) => m !== null);
  return {
    id: "self",
    side: "adversary",
    difficulty: d.difficulty,
    thresholds: { major: d.thresholds.major, severe: d.thresholds.severe },
    hp: 0,
    hpMax: d.hp,
    stress: 0,
    stressMax: d.stress ?? 0,
    defeated: false,
    conditions: [],
    ...(minion ? { minionX: Number(minion[1]) } : {}),
  };
};

/** Every object (at any depth) whose `kind` is `kind`. */
function objectsOfKind(value: unknown, kind: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((v) => objectsOfKind(v, kind));
  if (value === null || typeof value !== "object") return [];
  const own = (value as { kind?: unknown }).kind === kind ? [value as Record<string, unknown>] : [];
  return [...own, ...Object.values(value).flatMap((v) => objectsOfKind(v, kind))];
}

/** Every situation text the feature asks the GM to confirm (requirements, triggers and gates). */
const situationsOf = (effect: AdversaryFeatureEffect): string[] =>
  objectsOfKind(effect, "situation").flatMap((s) => (typeof s.text === "string" ? [s.text] : []));

const byId = new Map(ADVERSARIES.map((a) => [a.id, a]));

describe("adversary effect coverage across every tier and source (Q15)", () => {
  it("every printed feature of every SRD adversary has exactly one entry, in its own group's table", () => {
    expect(ADVERSARIES).toHaveLength(267);
    const missing: string[] = [];
    for (const a of ADVERSARIES) {
      const table = ADVERSARY_EFFECT_TABLES[adversaryGroup(a)];
      for (const f of a.features) {
        const n = table.filter((e) => e.adversaryId === a.id && e.feature === f.name).length;
        if (n !== 1) missing.push(`${a.id}/${f.name} (${n} in ${adversaryGroup(a)})`);
      }
    }
    expect(missing).toEqual([]);
    const printed = ADVERSARIES.reduce((n, a) => n + a.features.length, 0);
    const entries = Object.values(ADVERSARY_EFFECT_TABLES).reduce((n, t) => n + t.length, 0);
    expect(entries).toBe(printed);
    console.log(`adversary-effects coverage: ${ADVERSARIES.length} adversaries, ${printed} features, ${entries} entries`);
  });

  it("every entry names a real adversary and one of its printed features", () => {
    const strays: string[] = [];
    for (const [group, table] of Object.entries(ADVERSARY_EFFECT_TABLES)) {
      for (const e of table) {
        const a = byId.get(e.adversaryId);
        if (!a || adversaryGroup(a) !== group || !a.features.some((f) => f.name === e.feature)) strays.push(`${group}: ${e.adversaryId}/${e.feature}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("every use of every entry runs through run() without throwing", () => {
    const refused: string[] = [];
    let runs = 0;
    for (const [adversaryId, effects] of ADVERSARY_EFFECTS) {
      const d = byId.get(adversaryId)!;
      for (const effect of effects) {
        const useIds = effect.uses.map((u) => u.id);
        expect(new Set(useIds).size, `${adversaryId}/${effect.feature}: use ids are unique`).toBe(useIds.length);
        for (const use of effect.uses) {
          const context: AdversaryRunContext = {
            adversaryId,
            self: selfOf(d),
            attack: d.attack,
            tier: d.tier,
            tokens: 2,
            gmFear: 12,
            spotlit: true,
            fearConfirmed: true,
            useId: use.id,
            targets: [pc("pc-a")],
            picked: [pc("pc-b")],
            allies: [ally("ally")],
            followUp: [pc("pc-c")],
            trigger: { amount: 6, source: pc("pc-a"), subject: pc("pc-a") },
            situations: situationsOf(effect),
            group: d.features.some((f) => /^Minion \(/.test(f.name)) ? [{ ...selfOf(d), id: "minion-2" }] : [],
            rng: (sides) => Math.min(sides, 10),
          };
          let result: AdversaryRunResult | undefined;
          expect(() => {
            result = run(effect, context);
          }, `${adversaryId}/${effect.feature}/${use.id}`).not.toThrow();
          runs += 1;
          // A refusal is a structured answer (a choice or input this generic context doesn't give); the AE-* tests run
          // those uses with the right inputs. It must still say why.
          if (result && !result.ok) {
            expect(result.reason, `${adversaryId}/${effect.feature}/${use.id}`).toMatch(/^(noUse|requirement|exhausted|spotlight|confirmFear|cost|choice|targets)$/);
            refused.push(`${adversaryId}/${effect.feature}/${use.id}: ${result.reason}`);
          }
        }
      }
    }
    expect(runs).toBeGreaterThanOrEqual(ADVERSARY_EFFECTS.size);
    console.log(
      `adversary-effects coverage: ${runs} uses run; ${refused.length} refused by the generic context (inputs it doesn't give)${refused.length > 0 ? `: ${refused.join("; ")}` : ""}`,
    );
  });

  it("prints the manual steps left to the GM, per SRD group (Q9); not asserted, later lanes reduce them", () => {
    const counts = ADVERSARY_EFFECT_GROUPS.map((g) => [g, objectsOfKind(ADVERSARY_EFFECT_TABLES[g], "manual").length] as const);
    const total = counts.reduce((n, [, c]) => n + c, 0);
    console.log(`adversary-effects manual steps per group: ${counts.map(([g, c]) => `${g} ${c}`).join(", ")}; total ${total}`);
    expect(counts).toHaveLength(8);
  });
});
