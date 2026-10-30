// SD2 (plan sheet-drawer): passive feature modifiers read from the feature tables, in derived stats and in the adversary
// attack roll. Expected values come from the book texts (printed pages; CB = Core Book, HF = Hope & Fear):
// - CB p.36, Unwavering / Unrelenting / Undaunted: "Gain a permanent +1 / +2 / +3 bonus to your damage thresholds."
// - CB p.61, Shell: "Gain a bonus to your damage thresholds equal to your Proficiency."
// - CB p.70, Nimble: "Gain a permanent +1 bonus to your Evasion at character creation."
// - HF p.21, Stoneskin: "Gain a permanent +1 bonus to your Armor Score and damage thresholds at character creation."
// - CB p.51, Conjure Shield: "While you have at least 2 Hope, you add your Proficiency to your Evasion."
// - CB p.48, Rise to the Challenge: "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die."
// - CB p.30, Elemental Dominion: "While Channeling … Fire: You gain a +1 bonus to your Proficiency for attacks and spells
//   that deal damage. … Air: You gain a +1 bonus to your Evasion and can fly."
// - CB p.48, Combat Training: "When you deal physical damage, you gain a bonus to your damage roll equal to your level."
// - CB p.68, Sturdy: "When you have 1 Hit Point remaining, attacks against you have disadvantage."
// - CB p.39, Elusive Predator: "When your Focus makes an attack against you, you gain a +2 bonus to your Evasion against
//   the attack." CB p.38, Battle-Bonded: "When an adversary attacks you while they're within your companion's Melee range,
//   you gain a +2 bonus to your Evasion against the attack." HF p.8, Scorpion's Poise: "You gain a +2 bonus to your
//   Evasion against attacks made by a creature you've Marked for Death." HF p.16, Vexing Malison: "You have advantage on
//   attacks against Hexed creatures."
// - CB p.126, Chainmail Armor: base thresholds 7 / 15, base score 4; CB p.18: add your level to the thresholds.

import { describe, expect, it } from "vitest";

import { effectKeyOf } from "../../convex/lib/cardRunner";
import { adversaryAttack, pcTarget } from "@/lib/domain/adversary-actions/attack";
import { derivedDefense, derivedThresholds, subclassBonuses } from "@/lib/domain/characters/derived";
import { rollOptions } from "@/lib/domain/class-features/hooks";
import { queueRng } from "@/lib/domain/dice/index";
import { effectHash, passiveMods, sheetFacts, versusMods } from "@/lib/domain/feature-effects/passives";
import type { CharacterSheet } from "@/lib/validation/characters";
import { sheetOf } from "./feature-effects/engine/fixtures";

const ELEMENTAL_INCARNATION = "subclass:warden-of-the-elements:elemental-incarnation";

/** A sheet effect as the feature runner writes it (`feat:<hash>:<n>`, "option: <element>"). */
const channeling = (element: string): CharacterSheet["effects"][number] => ({
  id: `${effectKeyOf(ELEMENTAL_INCARNATION)}:1`,
  source: "Elemental Incarnation",
  text: `Channeling ${element}; option: ${element}`,
  until: "manual",
});

const armored = (classId: string, subclassId: string, patch: Partial<CharacterSheet> = {}) =>
  sheetOf(classId, subclassId, { armorId: "chainmail-armor", ...patch });

describe("passiveMods: always-on passives", () => {
  it("Shell adds the Proficiency to both thresholds (CB p.61)", () => {
    const galapa = armored("bard", "troubadour", { ancestry: { kind: "single", id: "galapa" }, proficiency: 2 });
    const m = passiveMods(galapa);
    expect([m.majorThreshold, m.severeThreshold]).toEqual([2, 2]);
    expect(m.sources).toEqual(["ancestry:galapa:shell"]);
    // Chainmail 7 / 15 + level 1 + Proficiency 2.
    expect(derivedThresholds(galapa)).toEqual({ major: 10, severe: 18 });
    expect(derivedThresholds({ ...galapa, proficiency: 3 })).toEqual({ major: 11, severe: 19 });
  });

  it("Nimble: +1 Evasion (CB p.70)", () => {
    const elf = sheetOf("bard", "troubadour");
    const simiah = sheetOf("bard", "troubadour", { ancestry: { kind: "single", id: "simiah" } });
    expect(passiveMods(simiah).evasion).toBe(1);
    expect(derivedDefense(simiah).evasion - derivedDefense(elf).evasion).toBe(1);
  });

  it("Stoneskin: +1 Armor Score and +1 to both thresholds (HF p.21), only with Hope & Fear content", () => {
    const earthkin = armored("bard", "troubadour", { ancestry: { kind: "single", id: "earthkin" } });
    expect(derivedDefense(earthkin).armorScore).toBe(5);
    expect(derivedThresholds(earthkin)).toEqual({ major: 9, severe: 17 });
    const coreOnly = { hopeAndFear: false, ikonis: false };
    expect(derivedDefense(earthkin, [], coreOnly).armorScore).toBe(4);
    expect(derivedThresholds(earthkin, coreOnly)).toEqual({ major: 8, severe: 16 });
  });

  it("the Stalwart cards add up from the tables: +1, +3, +6 (CB p.36)", () => {
    const guardian = (rank: CharacterSheet["subclassRank"]) => armored("guardian", "stalwart", { level: 5, subclassRank: rank });
    expect(subclassBonuses(guardian("foundation"))).toEqual({ thresholds: 1, severe: 0, evasion: 0 });
    expect(subclassBonuses(guardian("specialization"))).toEqual({ thresholds: 3, severe: 0, evasion: 0 });
    expect(subclassBonuses(guardian("mastery"))).toEqual({ thresholds: 6, severe: 0, evasion: 0 });
    expect(derivedThresholds(guardian("mastery"))).toEqual({ major: 18, severe: 26 });
  });

  it("a Stalwart Galapa adds Shell to Unwavering (CB p.36, p.61)", () => {
    const sheet = armored("guardian", "stalwart", { ancestry: { kind: "single", id: "galapa" }, proficiency: 2 });
    // 7 / 15 + level 1 + Unwavering 1 + Shell 2.
    expect(derivedThresholds(sheet)).toEqual({ major: 11, severe: 19 });
    // The Subclass line of the Hit Points section keeps only the subclass part.
    expect(subclassBonuses(sheet).thresholds).toBe(1);
  });
});

describe("passiveMods: state-gated passives", () => {
  const wizard = (hope: number) => sheetOf("wizard", "school-of-war", { subclassRank: "specialization", proficiency: 2, hope });

  it("Conjure Shield adds the Proficiency to Evasion with at least 2 Hope (CB p.51)", () => {
    expect(passiveMods(wizard(2)).evasion).toBe(2);
    expect(passiveMods(wizard(1)).evasion).toBe(0);
    expect(derivedDefense(wizard(3)).evasion - derivedDefense(wizard(1)).evasion).toBe(2);
    // The state overrides the sheet: the Hope after a spend.
    expect(passiveMods(wizard(3), { hope: 1 }).evasion).toBe(0);
    // Foundation only: no Conjure Shield yet.
    expect(passiveMods({ ...wizard(3), subclassRank: "foundation" }).evasion).toBe(0);
  });

  it("Rise to the Challenge is a d20 Hope Die option with 2 or fewer Hit Points unmarked (CB p.48)", () => {
    const warrior = (hp: number) => sheetOf("warrior", "call-of-the-brave", { subclassRank: "specialization", hpMax: 6, hp });
    const option = { featureId: "subclass:call-of-the-brave:rise-to-the-challenge", useId: "main", name: "Rise to the Challenge" };
    expect(passiveMods(warrior(4)).rollOptions).toEqual([option]);
    expect(passiveMods(warrior(5)).rollOptions).toEqual([option]);
    expect(passiveMods(warrior(3)).rollOptions).toEqual([]);
    // A toggle on the roll, not a number.
    expect(passiveMods(warrior(4)).actionRoll).toBe(0);
  });

  it("Elemental Dominion while Channeling: Fire +1 Proficiency, Air +1 Evasion (CB p.30)", () => {
    const druid = (effects: CharacterSheet["effects"]) => sheetOf("druid", "warden-of-the-elements", { subclassRank: "mastery", effects });
    expect(sheetFacts(druid([channeling("fire")])).featureEffects).toEqual([{ featureId: ELEMENTAL_INCARNATION, option: "fire" }]);
    expect(passiveMods(druid([channeling("fire")])).proficiency).toBe(1);
    expect(passiveMods(druid([channeling("fire")])).evasion).toBe(0);
    expect(passiveMods(druid([channeling("air")])).evasion).toBe(1);
    expect(passiveMods(druid([channeling("air")])).proficiency).toBe(0);
    expect(derivedDefense(druid([channeling("air")])).evasion - derivedDefense(druid([])).evasion).toBe(1);
    const idle = passiveMods(druid([]));
    expect([idle.evasion, idle.proficiency]).toEqual([0, 0]);
  });

  it("Combat Training stays D5's auto roll option, not a passive damage bonus (CB p.48)", () => {
    const warrior = sheetOf("warrior", "call-of-the-brave", { level: 4 });
    expect(passiveMods(warrior).damage).toBe(0);
    expect(passiveMods(warrior).rollOptions).toEqual([]);
    expect(rollOptions(warrior, "damage").find((o) => o.key === "combatTraining")?.effect).toEqual({ kind: "modifier", value: 4 });
  });

  it("the effect key hash matches the card runner's", () => {
    expect(`feat:${effectHash(ELEMENTAL_INCARNATION)}`).toBe(effectKeyOf(ELEMENTAL_INCARNATION));
  });
});

describe("passives in the adversary attack roll (NV9)", () => {
  const orc = (hp: number) => sheetOf("bard", "troubadour", { ancestry: { kind: "single", id: "orc" }, hpMax: 6, hp });

  it("Sturdy: attacks against a PC with 1 Hit Point left have disadvantage (CB p.68)", () => {
    expect(versusMods(orc(5), "attacksByThem", {}).disadvantage).toBe(1);
    expect(versusMods(orc(4), "attacksByThem", {}).disadvantage).toBe(0);
    // d20 + 2 against Evasion 10: 15 and 4 with disadvantage keep the 4 (6, a miss); without Sturdy the 15 hits.
    const sturdy = adversaryAttack(2, {}, 0, [pcTarget("orc", orc(5), 10, {})], queueRng([15, 4]));
    expect(sturdy.total).toBe(6);
    expect(sturdy.hits[0]?.hit).toBe(false);
    const healthy = adversaryAttack(2, {}, 0, [pcTarget("orc", orc(4), 10, {})], queueRng([15]));
    expect(healthy.total).toBe(17);
    expect(healthy.hits[0]?.hit).toBe(true);
  });

  it("Sturdy's disadvantage cancels the adversary's advantage (CB p.161: one d20 each way)", () => {
    const r = adversaryAttack(2, { advantage: 1 }, 0, [pcTarget("orc", orc(5), 10, {})], queueRng([9]));
    expect(r.total).toBe(11);
  });

  it("Elusive Predator: +2 Evasion against the Ranger's Focus only (CB p.39)", () => {
    const ranger = sheetOf("ranger", "wayfinder", { subclassRank: "specialization" });
    expect(pcTarget("pc", ranger, 12, { tags: ["Ranger's Focus"] }).evasion).toBe(14);
    expect(pcTarget("pc", ranger, 12, { tags: [] }).evasion).toBe(12);
    // d20 13 + 0 against 12 hits; against the Focus's 14 it misses.
    expect(adversaryAttack(0, {}, 0, [pcTarget("pc", ranger, 12, { tags: ["Ranger's Focus"] })], queueRng([13])).hits[0]?.hit).toBe(false);
    expect(adversaryAttack(0, {}, 0, [pcTarget("pc", ranger, 12, {})], queueRng([13])).hits[0]?.hit).toBe(true);
  });

  it("Battle-Bonded: +2 Evasion against an adversary within the companion's Melee range (CB p.38)", () => {
    const ranger = sheetOf("ranger", "beastbound", { subclassRank: "specialization" });
    expect(pcTarget("pc", ranger, 11, { inCompanionReach: true }).evasion).toBe(13);
    expect(pcTarget("pc", ranger, 11, { inCompanionReach: false }).evasion).toBe(11);
    expect(pcTarget("pc", { ...ranger, subclassRank: "foundation" }, 11, { inCompanionReach: true }).evasion).toBe(11);
  });

  it("Scorpion's Poise: +2 Evasion against a creature Marked for Death (HF p.8)", () => {
    const assassin = sheetOf("assassin", "executioners-guild", { subclassRank: "specialization" });
    expect(pcTarget("pc", assassin, 10, { tags: ["Marked for Death"] }).evasion).toBe(12);
    expect(pcTarget("pc", assassin, 10, { tags: ["Ranger's Focus"] }).evasion).toBe(10);
  });

  it("Vexing Malison: advantage on the PC's attacks against a Hexed creature, nothing on attacks against the PC (HF p.16)", () => {
    const witch = sheetOf("witch", "hedge", { subclassRank: "specialization" });
    expect(versusMods(witch, "attacksAgainstThem", { hexed: true })).toEqual({ evasion: 0, advantage: 1, disadvantage: 0 });
    expect(versusMods(witch, "attacksAgainstThem", { tags: ["Hexed"] }).advantage).toBe(1);
    expect(versusMods(witch, "attacksAgainstThem", {}).advantage).toBe(0);
    expect(versusMods(witch, "attacksByThem", { hexed: true })).toEqual({ evasion: 0, advantage: 0, disadvantage: 0 });
  });

  it("a multi-target attack makes one roll (CB p.161): a Sturdy target's disadvantage counts once", () => {
    const targets = [pcTarget("a", orc(5), 10, {}), pcTarget("b", orc(5), 10, {}), pcTarget("c", orc(0), 10, {})];
    const r = adversaryAttack(2, {}, 0, targets, queueRng([15, 4]));
    expect(r.record.dice.filter((d) => d.sides === 20)).toHaveLength(2);
    expect(r.total).toBe(6);
  });
});

// DA9 (B1, dcm-bxp.99.19.19): the form's statistics line is summed by passiveMods (SD2 follow-up 2). CB p.32 Agile Scout:
// "Agility +1 | Evasion +2"; CB p.34 Great Predator: "Strength +2 | Evasion +2 … Gain advantage on: attack, sneak, sprint";
// CB p.34 Legendary Beast: "A +1 bonus to the trait used by this form • A +2 bonus to Evasion".
describe("passiveMods: the Beastform's statistics (DA9)", () => {
  const inForm = (text: string, level = 1, mods?: CharacterSheet["effects"][number]["mods"]) =>
    sheetOf("druid", "warden-of-the-elements", { level, effects: [{ id: "beastform", source: "Beastform", text, until: "manual", ...(mods ? { mods } : {}) }] });

  it("trait and Evasion, the no-weapons flag and advantage on attacks for an 'attack' verb", () => {
    const m = passiveMods(inForm("Great Predator: … Can't use weapons", 5));
    expect(m.evasion).toBe(2);
    expect(m.traits).toEqual({ strength: 2 });
    expect(m.flags).toContain("noWeaponsOrSpells");
    expect(m.advantage).toContain("attack");
    expect(m.sources).toContain("beastform:great-predator:attack");
    // The form's advantage rider (a confirmed verb) is the drawer's, not a roll option.
    expect(m.rollOptions).toEqual([]);
  });

  it("an older effect with the mods keeps them on the effect; the stat line adds the rest", () => {
    const m = passiveMods(inForm("Agile Scout: +2 Evasion, +1 agility.", 1, { evasion: 2, trait: { id: "agility", delta: 1 } }));
    expect(m.evasion).toBe(0);
    expect(m.traits).toEqual({});
    expect(m.flags).toContain("noWeaponsOrSpells");
  });

  it("an Evolved form adds only the use keyed by its base form", () => {
    const m = passiveMods(inForm("Legendary Beast (Pack Predator): …", 5));
    expect(m.evasion).toBe(1 + 2);
    expect(m.traits).toEqual({ strength: 2 + 1 });
    expect(passiveMods(inForm("Legendary Beast. …", 5)).evasion).toBe(0);
  });
});
