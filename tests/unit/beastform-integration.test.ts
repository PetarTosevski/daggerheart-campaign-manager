// DA9 (plan drawer-answers, beads dcm-bxp.99.19.6, dcm-bxp.99.19.19, dcm-bxp.99.19.20; docs/tasks/TASK-DA-DA9.md): the
// Beastform integration. Book texts (printed pages, CB = Core Book):
// - CB p.30 Beastform: "you gain the Beastform's features, add their Evasion bonus to your Evasion, and use the trait
//   specified in their statistics for your attack." B1 (user 2026-10-29): the drawer's table owns the bonuses; D5's
//   Beastform effect stops adding them.
// - CB p.32 Agile Scout: "Agility +1 | Evasion +2". CB p.33 Armored Sentry: "Strength +1 | Evasion +1".
// - CB p.34 Legendary Beast: "Pick a Tier 1 Beastform option and become a larger, more powerful version of that creature.
//   While you're in this form, you retain all traits and features from the original form and gain the following bonuses:
//   • A +6 bonus to damage rolls • A +1 bonus to the trait used by this form • A +2 bonus to Evasion".
// - CB p.34 Legendary Hybrid: "To transform into this creature, mark an additional Stress. Choose any two Beastform options
//   from Tiers 1–2. Choose a total of four advantages and two features from those options." "Strength +2 | Evasion +3".
// - CB p.35 Mythic Hybrid: "mark 2 additional Stress … three features".
import { describe, expect, it } from "vitest";

import { derivedDefense, derivedTraits, withPassiveTraits } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
import { findFeature } from "@/lib/domain/class-features/hooks";
import { queueRng } from "@/lib/domain/dice";
import { beastformAttackId } from "@/lib/domain/feature-effects/ids";
import {
  activeBeastform,
  activeBeastformId,
  beastformChoice,
  beastformLabel,
  owned,
  parseBeastformChoice,
  type BeastformHolding,
} from "@/lib/domain/feature-effects/owned";
import { passiveMods } from "@/lib/domain/feature-effects/passives";
import { runFeature } from "@/lib/domain/feature-effects/run";
import { featureEffect } from "@/lib/srd/feature-effects";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";
import { actorOf, sheetOf } from "./feature-effects/engine/fixtures";

/** A druid: Evasion 10, Agility 2, Strength 1, Stress 1 of 6. Level 5 (Tier 3) for the Evolved and Hybrid forms. */
const druid = (level = 1) => sheetOf("druid", "warden-of-the-elements", { level });

function transform(sheet: CharacterSheet, choice?: string): { sheet: CharacterSheet; summary: string } {
  const meta = findFeature(sheet, "beastform")!;
  return meta.use!({ sheet, params: choice === undefined ? {} : { choice }, rng: () => 1, others: [] });
}

function refusal(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof RuleError ? e.code : "other";
  }
}

const evasion = (sheet: CharacterSheet) => derivedDefense(withEffects(sheet)).evasion;
const traits = (sheet: CharacterSheet) => derivedTraits(withEffects(sheet));
const heldIds = (sheet: CharacterSheet) => owned(sheet).filter((f) => f.source === "beastform");

describe("B1: the drawer's table owns the form's trait and Evasion (dcm-bxp.99.19.19)", () => {
  it("D5's Beastform effect carries no mods; the derived Evasion and traits add the form's statistics once", () => {
    const { sheet, summary } = transform(druid(), "agile-scout");
    const effect = sheet.effects.find((e) => e.id === "beastform")!;
    expect(effect.mods).toBeUndefined();
    expect(effect.text).toMatch(/^Agile Scout: \+2 Evasion, \+1 agility/);
    expect(summary).toBe("marked a Stress for Beastform: Agile Scout");
    // withEffects alone no longer adds them (the effect has none) ...
    expect(withEffects(sheet).evasion).toBe(10);
    expect(withEffects(sheet).traits.agility).toBe(2);
    // ... the table does: Evasion 10 + 2, Agility 2 + 1.
    expect(evasion(sheet)).toBe(12);
    expect(traits(sheet).agility).toBe(3);
    expect(withPassiveTraits(withEffects(sheet)).traits).toMatchObject({ agility: 3, strength: 1 });
    expect(passiveMods(sheet).sources).toContain(beastformAttackId("agile-scout"));
    // Dropping out removes them.
    const out = { ...sheet, effects: [] };
    expect(evasion(out)).toBe(10);
    expect(traits(out).agility).toBe(2);
  });

  it("an older sheet whose Beastform effect still carries the mods is not counted twice", () => {
    const old: CharacterSheet = {
      ...druid(),
      effects: [{ id: "beastform", source: "Beastform", text: "Agile Scout: +2 Evasion, +1 agility. Can't use weapons …", until: "manual", mods: { evasion: 2, trait: { id: "agility", delta: 1 } } }],
    };
    expect(evasion(old)).toBe(12);
    expect(traits(old).agility).toBe(3);
    // Its features still come from the table (Fragile, Agile).
    expect(heldIds(old).map((f) => f.featureId)).toEqual(expect.arrayContaining(["beastform:agile-scout:agile", "beastform:agile-scout:fragile"]));
  });

  it("Evolution's +1 stays an effect and adds to the form's trait", () => {
    const { sheet } = transform(druid(), "agile-scout");
    const evolved = findFeature(sheet, "evolution")!.use!({ sheet, params: { choice: "agility" }, rng: () => 1, others: [] }).sheet;
    expect(traits(evolved).agility).toBe(2 + 1 + 1);
    expect(evasion(evolved)).toBe(12);
  });

  it("the Thick Hide and the other form features still count (Powerful Beast: Strength +3, Evasion +1, thresholds +2)", () => {
    const { sheet } = transform(druid(2), "powerful-beast");
    expect(evasion(sheet)).toBe(11);
    expect(traits(sheet).strength).toBe(4);
    expect(passiveMods(sheet).majorThreshold).toBe(2);
  });
});

describe("Evolved forms hold the base form (dcm-bxp.99.19.6 (3))", () => {
  it("Legendary Beast upgrading Agile Scout: the base features and statistics, the Evolved +1 / +2, the Evolved attack only", () => {
    const { sheet } = transform(druid(5), "legendary-beast/agile-scout");
    expect(sheet.effects[0]!.text).toMatch(/^Legendary Beast \(Agile Scout\): \+4 Evasion, \+2 agility, attack agility melee d4\+6 phy/);
    expect(activeBeastform(sheet)).toEqual({ formId: "legendary-beast", baseFormId: "agile-scout" });
    expect(activeBeastformId(sheet)).toBe("legendary-beast");
    const held = heldIds(sheet);
    expect(held.map((f) => [f.featureId, f.uses ?? null])).toEqual([
      [beastformAttackId("legendary-beast"), ["agile-scout"]],
      ["beastform:legendary-beast:evolved", ["agile-scout"]],
      [beastformAttackId("agile-scout"), ["form", "advantage"]],
      ["beastform:agile-scout:agile", null],
      ["beastform:agile-scout:fragile", null],
    ]);
    // Evasion 10 + 2 (Agile Scout) + 2 (Evolved); Agility 2 + 1 + 1.
    expect(evasion(sheet)).toBe(14);
    expect(traits(sheet).agility).toBe(4);
    // The Evolved attack keyed by the base form exists in the table.
    expect(featureEffect(beastformAttackId("legendary-beast"))!.uses.map((u) => u.id)).toContain("agile-scout");
  });

  it("Mythic Beast upgrading Powerful Beast: +3 Evasion, +2 Strength on top of the form's", () => {
    const { sheet } = transform(druid(8), "mythic-beast/powerful-beast");
    expect(evasion(sheet)).toBe(10 + 1 + 3);
    expect(traits(sheet).strength).toBe(1 + 3 + 2);
    expect(passiveMods(sheet).majorThreshold).toBe(2); // Thick Hide, retained (CB p.35: "you retain all traits and features")
  });

  it("an Evolved form needs a base form of the right tier; an older effect without one holds no per-base use", () => {
    expect(refusal(() => transform(druid(5), "legendary-beast"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(5), "legendary-beast/armored-sentry"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(5), "agile-scout/pack-predator"))).toBe("CLASS_FEATURE_RULE");
    const old: CharacterSheet = { ...druid(5), effects: [{ id: "beastform", source: "Beastform", text: "Legendary Beast. Can't use weapons …", until: "manual" }] };
    expect(evasion(old)).toBe(10);
    expect(heldIds(old).every((f) => f.uses !== undefined && f.uses.length === 0)).toBe(true);
  });

  it("the Party sheet's select lists an Evolved form once per base form", () => {
    const input = findFeature(druid(5), "beastform")!.inputs![0]!;
    const options = input.kind === "select" ? input.options(druid(5)) : [];
    expect(options.map((o) => o.value)).toEqual(expect.arrayContaining(["agile-scout", "legendary-beast/agile-scout", "legendary-beast/stalking-arachnid", "legendary-hybrid"]));
    expect(options.map((o) => o.value)).not.toContain("legendary-beast");
  });
});

describe("Hybrid forms: the extra Stress and the chosen features (dcm-bxp.99.19.6 (4))", () => {
  const legendary = "legendary-hybrid/agile-scout:agile+armored-sentry:cannonball";

  it("Legendary Hybrid marks 1 additional Stress and holds its two chosen features and its own statistics", () => {
    const { sheet, summary } = transform(druid(5), legendary);
    expect(sheet.stress).toBe(1 + 1); // the Beastform's own Stress is the caller's cost (classFeatures.use / the drawer entry)
    expect(summary).toBe("marked a Stress for Beastform: Legendary Hybrid (Agile Scout: Agile + Armored Sentry: Cannonball), and 1 additional Stress");
    expect(sheet.effects[0]!.text).toMatch(/^Legendary Hybrid \(Agile Scout: Agile \+ Armored Sentry: Cannonball\): \+3 Evasion, \+2 strength/);
    expect(activeBeastform(sheet)).toEqual({ formId: "legendary-hybrid", hybridFeatures: ["agile-scout:agile", "armored-sentry:cannonball"] });
    expect(heldIds(sheet).map((f) => f.featureId)).toEqual([
      beastformAttackId("legendary-hybrid"),
      "beastform:legendary-hybrid:hybrid-features",
      "beastform:agile-scout:agile",
      "beastform:armored-sentry:cannonball",
    ]);
    expect(evasion(sheet)).toBe(13);
    expect(traits(sheet).strength).toBe(3);
  });

  it("Mythic Hybrid marks 2 additional Stress; a full Stress track marks a Hit Point instead (the app's markStress)", () => {
    const pick = "mythic-hybrid/agile-scout:agile+armored-sentry:cannonball+great-predator:vicious-maul";
    expect(transform(druid(8), pick).sheet.stress).toBe(3);
    const full = { ...druid(8), stress: 6, hp: 0 };
    expect(transform(full, pick).sheet).toMatchObject({ stress: 6, hp: 1 });
  });

  it("refuses picks that break CB p.34-35: the count, the tiers, an Evolved or Hybrid source, a repeat", () => {
    expect(refusal(() => transform(druid(5), "legendary-hybrid/agile-scout:agile"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(5), "legendary-hybrid/agile-scout:agile+great-predator:vicious-maul"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(5), "legendary-hybrid/agile-scout:agile+agile-scout:agile"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(5), "legendary-hybrid/agile-scout:agile+nope:nope"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => transform(druid(8), "mythic-hybrid/agile-scout:agile+pack-predator:pack-hunting+armored-sentry:cannonball+nimble-grazer:elusive-prey"))).toBe("CLASS_FEATURE_RULE");
    // Without picks (the Party sheet's select) the Hybrid holds its statistics and marker only, and still marks the Stress.
    const plain = transform(druid(5), "legendary-hybrid").sheet;
    expect(plain.stress).toBe(2);
    expect(heldIds(plain).map((f) => f.featureId)).toEqual([beastformAttackId("legendary-hybrid"), "beastform:legendary-hybrid:hybrid-features"]);
  });

  it("through the drawer's Beastform and Evolution (the delegate): the entry's Stress plus the Hybrid's", () => {
    const sheet = { ...druid(5), hope: 4 };
    const beastform = runFeature(featureEffect("class:druid:beastform")!, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, options: { form: [legendary] } });
    if (!beastform.ok) throw new Error(beastform.detail);
    expect(beastform.plan.actor.after.stress).toBe(1 + 1 + 1);
    expect(activeBeastform(beastform.sheet!)?.hybridFeatures).toHaveLength(2);
    // Evolution: "without marking a Stress" (CB p.30); the Hybrid's additional Stress is still marked (QUESTIONS 1).
    const evolution = runFeature(featureEffect("hope:druid")!, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, options: { form: [legendary], trait: ["strength"] } });
    if (!evolution.ok) throw new Error(evolution.detail);
    expect(evolution.plan.actor.after).toMatchObject({ hope: 1, stress: 1 + 1 });
  });
});

describe("the choice and the effect text round-trip", () => {
  it("parseBeastformChoice, beastformChoice, beastformLabel and activeBeastform agree", () => {
    const holdings: BeastformHolding[] = [
      { formId: "agile-scout" },
      { formId: "mythic-beast", baseFormId: "winged-beast" },
      { formId: "mythic-hybrid", hybridFeatures: ["winged-beast:birds-eye-view", "great-predator:vicious-maul", "armored-sentry:armored-shell"] },
    ];
    for (const h of holdings) {
      expect(parseBeastformChoice(beastformChoice(h))).toEqual(h);
      const sheet = { effects: [{ id: "beastform", source: "Beastform", text: `${beastformLabel(h)}: stats. Can't use weapons …`, until: "manual" as const }] };
      expect(activeBeastform(sheet)).toEqual(h);
    }
    expect(beastformLabel(holdings[2]!)).toBe("Mythic Hybrid (Winged Beast: Bird's-Eye View + Great Predator: Vicious Maul + Armored Sentry: Armored Shell)");
    expect(parseBeastformChoice("")).toBeNull();
    expect(activeBeastform({ effects: [{ id: "beastform", source: "Beastform", text: "Transformed. Can't …", until: "manual" }] })).toBeNull();
  });
});
