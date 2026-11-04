"use client";

import type { FunctionReturnType } from "convex/server";

import { weaponDice } from "@/lib/domain/dice";
import type { RollRecord } from "@/lib/domain/duality";
import { WEAPONS } from "@/lib/srd/equipment";
import type { Weapon } from "@/lib/srd/types";

import { api } from "../../../../../convex/_generated/api";
import type { CharacterView } from "../../../../../convex/characters";
import type { WeaponSlot } from "../targets/state";

/**
 * Attack helpers (plan combat-actions CA5): the weapon damage label, the equipped weapons, and what a player learns of a
 * roll and of each target (never an enemy's numbers, U1). The HUD's attack picker and result read them; the classic
 * Attack bar and its result card went with the cut-over (plan combat-hud H8.1).
 */

export type AttackOutcome = FunctionReturnType<typeof api.combatActions.attack>;
export type ResolvedAttack = Extract<AttackOutcome, { status: "resolved" }>;

/** "2d8+3 phy": the weapon's damage at the character's Proficiency, as the sheet shows it. */
export function damageLabel(weapon: Pick<Weapon, "damage">, proficiency: number): string {
  const type = weapon.damage.trim().split(/\s+/)[1] ?? "";
  try {
    const { dice, flat } = weaponDice(weapon.damage, proficiency);
    return `${dice.map((d) => `${d.count}d${d.sides}`).join("+")}${flat ? `+${flat}` : ""}${type ? ` ${type}` : ""}`;
  } catch {
    return weapon.damage;
  }
}

/** The equipped weapons of a sheet, primary first. */
export function equippedWeapons(sheet: Pick<CharacterView["sheet"], "primaryWeaponId" | "secondaryWeaponId">): { slot: WeaponSlot; weapon: Weapon }[] {
  const out: { slot: WeaponSlot; weapon: Weapon }[] = [];
  for (const [slot, id] of [
    ["primary", sheet.primaryWeaponId],
    ["secondary", sheet.secondaryWeaponId],
  ] as const) {
    const weapon = id ? WEAPONS.find((w) => w.id === id) : undefined;
    if (weapon) out.push({ slot, weapon });
  }
  return out;
}

/** "Critical success", "With Hope", "With Fear": the attack roll has no Difficulty for the player (U1). */
export function outcomeLine(roll: RollRecord): { tone: "crit" | "hope" | "fear"; text: string } {
  if (roll.outcome === "critical") return { tone: "crit", text: "Critical success" };
  return roll.outcome.endsWith("Hope") ? { tone: "hope", text: "With Hope" } : { tone: "fear", text: "With Fear" };
}

/** What the player learns about one target (U1): Hit, Miss or Defeated. */
export function targetVerdict(t: { hit: boolean; defeated: boolean }): "Hit" | "Miss" | "Defeated" {
  if (t.defeated) return "Defeated";
  return t.hit ? "Hit" : "Miss";
}
