/**
 * Plan lanes-2, tracer E6: the endings the SRD data already writes (docs/tasks/TASK-LN2-E6.md). Fixture entries.
 *
 * Book: Confusing Aura (CB p.329) "this spell ends"; Blight Seed (HF p.9) "This effect can't stack"; Flight (CB p.328)
 * "After the action that spends the last token is resolved, you descend"; Invisibility (CB p.334) "After the action that
 * spends the last token is resolved, the effect ends"; Through Your Eyes (CB p.335) "until you cast another spell";
 * Bird's-Eye View (CB p.33) "The first time a character makes a roll to act on this information, they gain advantage";
 * Forest Sprites (CB p.339) "A sprite vanishes after granting a benefit"; Slumber (CB p.332) "the GM spends a Fear";
 * Marked for Death (HF p.8) "the GM spends a number of Fear equal to your tier"; Reliable Backup (CB p.43) adds options
 * to Contacts Everywhere.
 */
import { describe, expect, it } from "vitest";

import {
  endGrantedBenefit,
  endOnSpellCast,
  endOnTokensGone,
  endSharedGrants,
  endTokensGone,
  gmFearForEffect,
  gmFearForInstanceEffect,
  instanceWrites,
  planEndsOnSheet,
  stepEnds,
  tokenKeySource,
  type SourceLookup,
} from "../../convex/lib/cardRows";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import { expire, gmFearToEnd, tokensGoneKeys } from "../../src/lib/domain/characters/expiry";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import type { InstanceEffect } from "../../convex/lib/validators/encounters";
import { allowWorldEmails, buildWorld } from "./authz/world";

allowWorldEmails();

const effect = (id: string, text: string, until: Effect["until"] = "manual"): Effect => ({ id, source: "Test", text, until });
const fx = (cardId: string, n: number, text: string) => effect(`${effectKeyOf(cardId)}:${n}`, text);
const oneUse = (id: string, steps: readonly Step[]): CardUse => ({ id, name: id, activation: { kind: "action" }, steps });
const lasting = (label: string, extra: Record<string, unknown> = {}) => ({ kind: "effect", to: "self", label, mods: [], duration: "manual", ...extra }) as Step;

const FIXTURES: Record<string, readonly CardUse[] | { uses: readonly CardUse[]; upgrades: unknown[] }> = {
  aura: [oneUse("main", [lasting("Confused"), { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Dazzled" }, duration: "manual", endsOn: ["takeDamage"] } as Step])],
  wolf: [oneUse("main", [lasting("Wolf Form", { option: "wolf" }), lasting("Pack Sense", { option: "pack" })])],
  seed: [oneUse("main", [lasting("Blight")])],
  flight: [oneUse("main", [lasting("Flying", { endsOn: ["tokensGone"] })])],
  invisibility: [oneUse("main", [lasting("Invisible", { to: "targets", endsOn: ["tokensGone"] })])],
  eyes: [oneUse("main", [lasting("Through Your Eyes", { endsOn: ["castsSpell"] })])],
  bolt: [oneUse("main", [lasting("Charged", { endsOn: ["castsSpell"] })])],
  birds: [oneUse("main", [lasting("Bird's-Eye View: advantage", { to: "targets", endsOn: ["benefitGranted"], sharedGrant: true })])],
  sprite: [oneUse("main", [lasting("Sprite's help", { endsOn: ["benefitGranted"] })])],
  slumber: [oneUse("main", [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Asleep" }, duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"] } as Step])],
  mark: [oneUse("main", [lasting("Marked for Death", { endsOn: ["gmSpendsFear"], endFear: { kind: "byTier", values: [1, 2, 3, 4] } })])],
  // Reliable Backup: an option only an upgrade adds (dcm-i2tv).
  contacts: { uses: [oneUse("main", [])], upgrades: [{ when: { kind: "rank", rank: "mastery" }, patch: { extraSteps: [lasting("Backup", { endsOnRoll: { roll: "presence" } })] } }] },
};
const lookup: SourceLookup = (id) => FIXTURES[id] as never;
const sheetOf = (name: string, effects: Effect[], loadout: string[] = []) => ({ name, level: 1, effects, conditions: [], domainCards: { owned: loadout, loadout } }) as unknown as CharacterSheet;

describe("expiry (pure)", () => {
  it("gmFearToEnd: 1 by default, the tier's number for byTier, null without a Fear end (dcm-8bv)", () => {
    expect(gmFearToEnd({ endsOn: ["gmSpendsFear"] }, 2)).toBe(1);
    expect(gmFearToEnd({ endsOn: ["gmSpendsFear"], endFear: { kind: "byTier", values: [1, 2, 3, 4] } }, 3)).toBe(3);
    expect(gmFearToEnd({ endsOn: ["gmSpendsFear"], endFear: { kind: "fixed", value: 2 } }, 1)).toBe(2);
    expect(gmFearToEnd({ endsOn: ["takeDamage"] }, 1)).toBeNull();
    expect(gmFearToEnd(undefined, 1)).toBeNull();
  });

  it("tokensGoneKeys names the keys that went from some tokens to none", () => {
    const before = { cardTokens: [{ cardId: "flight", count: 1 }, { cardId: "feat:x", count: 2 }, { cardId: "empty", count: 0 }] };
    expect(tokensGoneKeys(before, { cardTokens: [{ cardId: "feat:x", count: 1 }] })).toEqual(["flight"]);
    expect(tokensGoneKeys(before, { cardTokens: [{ cardId: "flight", count: 0 }, { cardId: "feat:x", count: 0 }] })).toEqual(["flight", "feat:x"]);
    expect(tokenKeySource("feat:class:x:y")).toBe("class:x:y");
    expect(tokenKeySource("flight")).toBe("flight");
  });

  it("gmTurn / day / week feature uses end with their period (dcm-55k)", () => {
    const sheet = { featureUses: [{ key: "a", until: "gmTurn" as const }, { key: "b", until: "day" as const }, { key: "c", until: "week" as const }, { key: "d", until: "rest" as const }] };
    expect(expire(sheet, "gmTurn").featureUses.map((u) => u.key)).toEqual(["b", "c", "d"]);
    expect(expire(sheet, "day").featureUses.map((u) => u.key)).toEqual(["c", "d"]);
    expect(expire(sheet, "week").featureUses.map((u) => u.key)).toEqual(["d"]);
    // A GM turn never outlasts a scene.
    expect(expire(sheet, "scene").featureUses.map((u) => u.key)).toEqual(["b", "c", "d"]);
  });
});

describe("the entry lookup reads upgrades (dcm-i2tv)", () => {
  it("an effect step an upgrade adds has its ends", () => {
    expect(stepEnds("contacts", "Backup", lookup)?.ends).toEqual({ duration: "manual", endsOnRoll: { roll: "presence" } });
  });
});

describe("endEffect and stacking on sheets (dcm-9z2z, dcm-8x8, dcm-5fc, dcm-kkx)", () => {
  it("an endEffect step ends the named card's effects on its target, narrowed to the option", () => {
    const sheet = sheetOf("Ash", [fx("aura", 1, "Confused"), fx("wolf", 1, "Wolf Form"), fx("wolf", 2, "Pack Sense"), effect("note", "A note")]);
    const all = planEndsOnSheet(sheet, [{ kind: "endEffect", targetId: "tokP", of: "aura", own: true }], "tokP", "aura", lookup);
    expect(all.ended.map((e) => e.text)).toEqual(["Confused"]);
    expect(all.lines).toEqual(["Ash: Confused ends (Test)"]);
    const wolf = planEndsOnSheet(sheet, [{ kind: "endEffect", targetId: "tokP", of: "wolf", own: false, option: "wolf" }], "tokP", "rampage", lookup);
    expect(wolf.sheet.effects.map((e) => e.text)).toEqual(["Confused", "Pack Sense", "A note"]);
    // Another target's step leaves this sheet alone.
    expect(planEndsOnSheet(sheet, [{ kind: "endEffect", targetId: "tokQ", of: "aura", own: true }], "tokP", "aura", lookup).sheet).toBe(sheet);
  });

  it("stacking replace keeps only the newest copy of the label", () => {
    const sheet = sheetOf("Ash", [fx("seed", 1, "Blight"), fx("seed", 2, "Blight")]);
    const step: PlanStep = { kind: "effect", targetId: "tokP", label: "Blight", mods: [], duration: "manual", stacking: "replace" };
    const out = planEndsOnSheet(sheet, [step], "tokP", "seed", lookup);
    expect(out.sheet.effects.map((e) => e.id)).toEqual([`${effectKeyOf("seed")}:2`]);
  });
});

describe("endEffect and stacking on instances", () => {
  const marker = (id: string, label: string): InstanceEffect => ({ id, source: "Test", label, until: "temporary" });
  const bear = (effects: InstanceEffect[], tags: string[]) => ({
    kind: "enemy" as const,
    tokenId: "tokE",
    minion: false,
    instance: { _id: "inst1", label: "Bear", hp: 0, stress: 0, defeated: false, stats: { hpMax: 7, stressMax: 2 }, conditions: [], tags, effects },
  });
  const creaturesOf = (c: ReturnType<typeof bear>) => ({ get: (id: string) => (id === "tokE" ? c : undefined), onMap: false }) as never;
  const plan = (cardId: string, steps: unknown[], tags: string[]) => ({ cardId, exclusive: false, steps, creatures: [{ id: "tokE", after: { hp: 0, stress: 0, conditions: [], tags } }] }) as never;

  it("ends the card's modifiers and the condition its marker stood for", () => {
    const c = bear([marker("card:aura:1", "Confused"), marker("card:aura:2", "Dazzled"), marker("card:other:1", "Other")], ["Dazzled", "Kept"]);
    const [w] = instanceWrites(plan("aura", [{ kind: "endEffect", targetId: "tokE", of: "aura", own: true }], ["Dazzled", "Kept"]), creaturesOf(c), "Confusing Aura", lookup);
    expect(w!.patch.effects).toEqual([marker("card:other:1", "Other")]);
    expect(w!.patch.tags).toEqual(["Kept"]);
    expect(w!.before.effects).toHaveLength(3);
  });

  it("refuse adds no second copy; replace swaps the old one", () => {
    const c = bear([marker("card:seed:1", "Blight")], []);
    const step = (stacking: "refuse" | "replace") => ({ kind: "effect", targetId: "tokE", label: "Blight", mods: [], duration: "manual", stacking });
    const [refused] = instanceWrites(plan("seed", [step("refuse")], []), creaturesOf(c), "Blight Seed", lookup);
    expect(refused?.patch.effects ?? c.instance.effects).toEqual([marker("card:seed:1", "Blight")]);
    const [replaced] = instanceWrites(plan("seed", [step("replace")], []), creaturesOf(c), "Blight Seed", lookup);
    expect(replaced!.patch.effects?.map((e) => e.label)).toEqual(["Blight"]);
    expect(replaced!.patch.effects).toHaveLength(1);
  });
});

describe("tokensGone, castsSpell, benefitGranted, sharedGrant", () => {
  it("the caster's tokens gone end Flight on them and Invisibility on the ally (dcm-erhv)", () => {
    const caster = { key: "a", sheet: sheetOf("Ash", [fx("flight", 1, "Flying"), fx("eyes", 1, "Through Your Eyes")], ["flight", "invisibility"]) };
    const ally = { key: "b", sheet: sheetOf("Bryn", [fx("invisibility", 1, "Invisible")]) };
    const out = endOnTokensGone(caster, [caster, ally], ["flight", "invisibility"], lookup);
    expect(out.map((o) => [o.key, o.sheet.effects.map((e) => e.text)])).toEqual([
      ["a", ["Through Your Eyes"]],
      ["b", []],
    ]);
    // A second holder of Invisibility: the ally's effect is left for the table (Q3).
    const twin = { key: "c", sheet: sheetOf("Cass", [], ["invisibility"]) };
    expect(endOnTokensGone(caster, [ally, twin], ["invisibility"], lookup)).toEqual([]);
  });

  it("casting a spell ends the caster's castsSpell effects, but not the one just cast (dcm-o44e)", () => {
    const caster = { key: "a", sheet: sheetOf("Ash", [fx("eyes", 1, "Through Your Eyes"), fx("bolt", 1, "Charged")]) };
    const out = endOnSpellCast(caster, [], "bolt", lookup);
    expect(out.map((o) => o.sheet.effects.map((e) => e.text))).toEqual([["Charged"]]);
  });

  it("a shared grant ends on every sheet once one recipient spends it (dcm-rao5)", () => {
    const a = fx("birds", 1, "Bird's-Eye View: advantage");
    const b = fx("birds", 2, "Bird's-Eye View: advantage");
    const party = [{ key: "b", sheet: sheetOf("Bryn", [b, fx("eyes", 1, "Through Your Eyes")]) }];
    const out = endSharedGrants([a], party, lookup);
    expect(out.map((o) => [o.key, o.sheet.effects.map((e) => e.text)])).toEqual([["b", ["Through Your Eyes"]]]);
    expect(endSharedGrants([fx("eyes", 1, "Through Your Eyes")], party, lookup)).toEqual([]);
  });

  it("a benefit granted ends that effect only (dcm-5yew)", () => {
    const sprite = fx("sprite", 1, "Sprite's help");
    const sheet = sheetOf("Ash", [sprite, fx("sprite", 2, "Sprite's help")]);
    expect(endGrantedBenefit(sheet, sprite.id, lookup).sheet.effects.map((e) => e.id)).toEqual([`${effectKeyOf("sprite")}:2`]);
  });

  it("the Fear a GM spend costs: the PC's tier, or 1 (dcm-8bv)", () => {
    const mark = fx("mark", 1, "Marked for Death");
    expect(gmFearForEffect({ effects: [mark], level: 5 }, mark.id, lookup)).toBe(3);
    expect(gmFearForEffect({ effects: [mark], level: 5 }, "nope", lookup)).toBeNull();
    expect(gmFearForInstanceEffect({ id: "card:slumber:1", label: "Asleep" }, 2, lookup)).toBe(1);
    expect(gmFearForInstanceEffect({ id: "card:aura:2", label: "Dazzled" }, 2, lookup)).toBeNull();
  });
});

describe("endTokensGone on the server", () => {
  it("saves the ended sheets and logs them in the use's undo group", async () => {
    const w = await buildWorld();
    const after = await w.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      const next: CharacterSheet = { ...s, domainCards: { ...s.domainCards, loadout: ["flight"] }, effects: [fx("flight", 1, "Flying")], cardTokens: [] };
      await saveSheet(ctx, w.characterA, next);
      return next;
    });
    const before = { ...after, cardTokens: [{ cardId: "flight", count: 1 }] };
    const out = await w.t.run(async (ctx) =>
      endTokensGone(ctx, { campaignId: w.campaignId, characterId: w.characterA, before, after, groupId: "g1", actorId: (await ctx.db.query("users").first())!._id, lookup }),
    );
    expect(out.lines).toEqual([`${after.name}: Flying ends (Test)`]);
    const saved = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    expect(saved.effects).toEqual([]);
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    const logged = rows.filter((r) => r.groupId === "g1");
    expect(logged).toHaveLength(1);
    expect(readSheet(JSON.parse(logged[0]!.before!)).effects).toEqual(after.effects);
  });
});
