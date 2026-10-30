// DA7 (plan drawer-answers, bead dcm-bxp.99.19; docs/tasks/TASK-DA-DA7.md): the user's answers to the D5-delegated
// features and the drawer read model. Expected values come from the book texts and the answers by hand:
// - Rogue's Dodge (CB p.42): neither refresh nor stack; while the +2 holds the feature is Active and refuses (2026-10-30).
// - Hex (HF p.16): at the maximum a new Hex ends the oldest, or the one picked before casting (2026-10-29).
// - Prayer Dice (CB p.44): add to action and reaction rolls, not damage rolls (2026-10-29).
// - Armor maximum counts installed augments (SD6 QUESTION 4).
// - Pin: Contacts Everywhere's +3 is picked after the roll, seeing both dice (2026-10-30, dcm-bxp.99.19.40).
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { drawerOf } from "../../convex/lib/featureDrawer";
import { queueRng } from "@/lib/domain/dice";
import { expire } from "@/lib/domain/characters/expiry";
import { hexDropOptions, hexesToEnd } from "@/lib/domain/class-features/classes/witch";
import { findFeature, onRest } from "@/lib/domain/class-features/hooks";
import type { FeatureUseInput, FeatureUseResult } from "@/lib/domain/class-features/types";
import type { RollRecord } from "@/lib/domain/duality";
import { runFeature } from "@/lib/domain/feature-effects/run";
import { RuleError } from "@/lib/errors/app-error";
import { featureEffect } from "@/lib/srd/feature-effects";
import { RANGER_ROGUE_IDS } from "@/lib/srd/feature-effects/ranger-rogue";
import { HEX_DROP_CHOICE } from "@/lib/srd/feature-effects/seraph-witch";
import type { CharacterSheet } from "@/lib/validation/characters";
import { actorOf, adversary, sheetOf } from "./feature-effects/engine/fixtures";

const CAMPAIGN = { frameId: "witherwild" as const, options: { hopeAndFear: true } };
const CHARACTER = "character" as Id<"characters">;

function act(sheet: CharacterSheet, key: string, input: Partial<FeatureUseInput> = {}): FeatureUseResult {
  const feature = findFeature(sheet, key);
  if (!feature?.use) throw new Error(`no ${key}`);
  return feature.use({ sheet, params: {}, rng: queueRng([]), others: [], ...input });
}

function ruleMessage(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof RuleError) return e.message;
    throw e;
  }
  return "no refusal";
}

const roll = (kind: RollRecord["kind"], total: number, outcome: RollRecord["outcome"] = "none"): RollRecord => ({
  kind,
  dice: kind === "damage" ? [{ sides: 8, value: total, role: "damage" }] : [{ sides: 12, value: 6, role: "hope" }, { sides: 12, value: 3, role: "fear" }],
  modifier: 0,
  total,
  difficulty: kind === "damage" ? undefined : 12,
  outcome,
  manual: false,
});

describe("Rogue's Dodge (CB p.42): Active while the +2 holds, no refresh, no stack", () => {
  const rogue = () => sheetOf("rogue", "nightwalker", { hope: 6 });

  it("a second use while the bonus holds is refused; a hit or a rest brings it back", () => {
    const once = act(rogue(), "roguesDodge").sheet;
    expect(once.effects.map((e) => e.id)).toEqual(["rogues-dodge"]);
    expect(ruleMessage(() => act(once, "roguesDodge"))).toMatch(/already active/);
    expect(act(expire(once, "hit"), "roguesDodge").sheet.effects).toHaveLength(1);
    expect(act(onRest(once, "short"), "roguesDodge").sheet.effects).toHaveLength(1);
  });

  it("the drawer reads it as Active with Use disabled and says when it comes back", () => {
    const id = RANGER_ROGUE_IDS.roguesDodge;
    const ready = drawerOf(CHARACTER, rogue(), CAMPAIGN).features.find((f) => f.featureId === id)!;
    expect(ready).toMatchObject({ state: "ready", resetLabel: null });
    expect(ready.uses[0]!.ready).toBe(true);

    const active = drawerOf(CHARACTER, act(rogue(), "roguesDodge").sheet, CAMPAIGN).features.find((f) => f.featureId === id)!;
    expect(active).toMatchObject({ state: "active", resetLabel: "Until an attack succeeds against you, or your next rest" });
    expect(active.uses[0]).toMatchObject({ ready: false, resetLabel: "Until an attack succeeds against you, or your next rest" });
  });

  it("the drawer's Use runs D5's refusal: the whole use is refused and nothing is paid", () => {
    const sheet = act(rogue(), "roguesDodge").sheet;
    const result = runFeature(featureEffect(RANGER_ROGUE_IDS.roguesDodge)!, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet });
    expect(result).toMatchObject({ ok: false, reason: "choice" });
  });
});

describe("Hex (HF p.16): at the maximum the new Hex ends the oldest, or the picked one", () => {
  // Hedge witch: Spellcast is Knowledge 2, so two Hexes at once.
  const witch = (hexes?: string[]) => {
    const sheet = sheetOf("witch", "hedge", { traits: { agility: 0, strength: 0, finesse: 1, instinct: 1, presence: 1, knowledge: 2 } });
    return hexes ? { ...sheet, classState: { ...sheet.classState, hexes } } : sheet;
  };

  it("below the maximum nothing ends", () => {
    expect(act(witch(["Ghoul"]), "hex", { params: { choice: "Bandit" } }).sheet.classState.hexes).toEqual(["Ghoul", "Bandit"]);
    expect(hexDropOptions(witch(["Ghoul"]))).toBeNull();
  });

  it("by default the oldest ends; the summary says so", () => {
    const out = act(witch(["Ghoul", "Bandit"]), "hex", { params: { choice: "Ooze" } });
    expect(out.sheet.classState.hexes).toEqual(["Bandit", "Ooze"]);
    expect(out.summary).toMatch(/ended the Hex on Ghoul/);
    // `amount` 0 is the oldest too (the drawer choice's default).
    expect(act(witch(["Ghoul", "Bandit"]), "hex", { params: { choice: "Ooze", amount: 0 } }).sheet.classState.hexes).toEqual(["Bandit", "Ooze"]);
  });

  it("the player can pick which Hex ends (its place in the list)", () => {
    expect(act(witch(["Ghoul", "Bandit"]), "hex", { params: { choice: "Ooze", amount: 2 } }).sheet.classState.hexes).toEqual(["Ghoul", "Ooze"]);
    expect(ruleMessage(() => act(witch(["Ghoul", "Bandit"]), "hex", { params: { amount: 3 } }))).toMatch(/Choose a Hex you hold/);
    // A target already Hexed is still refused, and a trait of 0 allows none.
    expect(ruleMessage(() => act(witch(["Ghoul", "Bandit"]), "hex", { params: { choice: "Ghoul" } }))).toMatch(/already Hexed/);
  });

  it("past the maximum (the trait went down) the oldest others end too, so the new Hex fits", () => {
    expect(hexesToEnd(["A", "B", "C"], 2, 3)).toEqual(["C", "A"]);
    expect(act(witch(["A", "B", "C"]), "hex", { params: { choice: "D" } }).sheet.classState.hexes).toEqual(["C", "D"]);
  });

  it("the drawer entry's choice lists the current Hexes at the maximum (0 = the oldest)", () => {
    const hex = (sheet: CharacterSheet) => drawerOf(CHARACTER, sheet, CAMPAIGN).features.find((f) => f.featureId === "class:witch:hex")!.uses[0]!;
    expect(hex(witch(["Ghoul"])).choices).toEqual([{ id: HEX_DROP_CHOICE.id, label: HEX_DROP_CHOICE.label, min: 0 }]);
    expect(hex(witch(["Ghoul", "Bandit"])).choices[0]!.options).toEqual([
      { value: 0, label: "The oldest (Ghoul)" },
      { value: 1, label: "Ghoul" },
      { value: 2, label: "Bandit" },
    ]);
  });

  it("the map's Hex passes the pick to D5: at the maximum it no longer refuses", () => {
    const full = witch(["Target 1", "Target 2"]);
    const run = (choices?: Record<string, number>) =>
      runFeature(featureEffect("class:witch:hex")!, undefined, { actor: actorOf(full, { spellcast: 2, tier: 1 }), gmFear: 0, rng: queueRng([]), sheet: full, targets: [adversary("bandit")], ...(choices ? { choices } : {}) });
    const oldest = run();
    if (!oldest.ok) throw new Error(oldest.detail);
    expect(oldest.sheet!.classState.hexes).toEqual(["Target 2", "bandit"]);
    const picked = run({ [HEX_DROP_CHOICE.id]: 2 });
    if (!picked.ok) throw new Error(picked.detail);
    expect(picked.sheet!.classState.hexes).toEqual(["Target 1", "bandit"]);
  });
});

describe("Prayer Dice (CB p.44): action and reaction rolls, not damage rolls", () => {
  const seraph = () => sheetOf("seraph", "divine-wielder", { heldDice: [{ id: "prayer-1", kind: "prayer", sides: 4, value: 3, until: "session" }] });

  it("adds to an action roll and to a reaction roll", () => {
    expect(act(seraph(), "prayerRoll", { roll: roll("action", 10, "failHope") }).roll).toMatchObject({ total: 13, outcome: "successHope" });
    expect(act(seraph(), "prayerRoll", { roll: roll("reaction", 11, "failHope") }).roll).toMatchObject({ kind: "reaction", total: 14, outcome: "successHope" });
  });

  it("refuses a damage roll and keeps the die", () => {
    expect(ruleMessage(() => act(seraph(), "prayerRoll", { roll: roll("damage", 6) }))).toMatch(/not to damage rolls/);
  });

  it("the table's roll use stays an after-roll answer to an action roll; damage only through the damage use", () => {
    const uses = featureEffect("class:seraph:prayer-dice")!.uses;
    const rollUse = uses.find((u) => u.id === "roll")!;
    expect(rollUse.activation).toMatchObject({ kind: "reaction", trigger: { kind: "afterAllyRolls" } });
    // No use of Prayer Dice is triggered by a damage roll (`afterYouRoll` with roll "damage", or a damage rider).
    for (const u of uses) {
      const a = u.activation;
      const trigger = a.kind === "reaction" || a.kind === "rider" || a.kind === "auto" ? a.trigger : undefined;
      expect(trigger && "roll" in trigger ? trigger.roll : undefined).not.toBe("damage");
      expect(trigger?.kind).not.toBe("whenYouDealDamage");
    }
  });
});

describe("Drawer Armor maximum counts installed augments (SD6 QUESTION 4)", () => {
  it("adds the augments' Armor Score as characters.adjustResource does", () => {
    const sheet = sheetOf("guardian", "stalwart", { armorId: "gambeson-armor" });
    const base = drawerOf(CHARACTER, sheet, CAMPAIGN).trackers.armor.max;
    expect(drawerOf(CHARACTER, sheet, CAMPAIGN, ["guard"]).trackers.armor.max).toBe(base + 1);
    expect(drawerOf(CHARACTER, sheet, CAMPAIGN, ["deny", "guard"]).trackers.armor.max).toBe(base + 3);
  });
});

describe("Pin: Contacts Everywhere's +3 is picked after the roll, seeing both dice (CB p.43)", () => {
  it("is a rider on your finished action roll that adds 3 to the Hope or the Fear Die", () => {
    const die = featureEffect(RANGER_ROGUE_IDS.contactsEverywhere)!.uses.find((u) => u.id === "die")!;
    expect(die.activation).toEqual({ kind: "rider", trigger: { kind: "afterYouRoll", roll: "action" } });
    expect(die.steps[0]).toMatchObject({ kind: "modifyRoll", change: { kind: "dieBonus", die: "hopeOrFear", amount: { kind: "fixed", value: 3 } } });
  });
});
