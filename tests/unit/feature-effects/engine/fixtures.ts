// Shared fixtures for the feature-engine tests (plan sheet-drawer, SD1).

import { readSheet } from "../../../../convex/lib/characterSheet";
import type { ActorState } from "@/lib/domain/card-effects/run";
import type { Combatant } from "@/lib/domain/combat-actions";
import type { CharacterSheet } from "@/lib/validation/characters";

export const fixed = (value: number) => ({ kind: "fixed" as const, value });

/** A parsed sheet (D5 defaults filled in) with `patch` on top. */
export function sheetOf(classId: string, subclassId: string, patch: Partial<CharacterSheet> = {}): CharacterSheet {
  const sheet = readSheet({
    schemaVersion: 2,
    name: "Vex",
    pronouns: "",
    description: "",
    level: 1,
    classId,
    subclassId,
    ancestry: { kind: "single", id: "elf" },
    communityId: "wildborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 2,
    stressMax: 6,
    stress: 1,
    hope: 3,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "dagger",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
  });
  return { ...sheet, ...patch };
}

/** The runner's actor for a sheet (the server builds it from the sheet and derived stats). */
export function actorOf(sheet: CharacterSheet, over: Partial<ActorState> = {}): ActorState {
  return {
    id: "pc",
    side: "pc",
    evasion: sheet.evasion,
    thresholds: { major: 7, severe: 14 },
    hp: sheet.hp,
    hpMax: sheet.hpMax,
    stress: sheet.stress,
    stressMax: sheet.stressMax,
    armor: sheet.armorMarked,
    armorMax: 3,
    defeated: false,
    conditions: [],
    hope: sheet.hope,
    hopeMax: 6,
    traits: sheet.traits,
    spellcast: 1,
    proficiency: sheet.proficiency,
    level: sheet.level,
    tier: 1,
    loadoutDomains: [],
    vaultDomains: [],
    armorWorn: true,
    activeCardEffects: [],
    cardTokens: 0,
    featureUses: sheet.featureUses,
    weapons: { primary: { damage: "d8 phy", trait: "agility", damageType: "physical", range: "melee" } },
    ...over,
  };
}

export const adversary = (id: string): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 30, severe: 60 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
});

/** A fixed die sequence. */
export const dice = (...values: number[]) => {
  const queue = [...values];
  return (sides: number) => {
    const next = queue.shift();
    if (next === undefined) throw new Error("rng exhausted");
    if (next < 1 || next > sides) throw new Error(`d${sides} cannot roll ${next}`);
    return next;
  };
};
