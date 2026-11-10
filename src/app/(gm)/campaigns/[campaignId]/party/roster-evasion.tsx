"use client";

import { derivedDefense } from "@/lib/domain/characters/derived";

import type { CharacterView } from "../../../../../../convex/characters";

/**
 * A roster card's Evasion (equipment, subclass, feature passives, Motherboard augments). Its own module because
 * derivedDefense carries the rules engine (every feature effect, the SRD barrel with the domain cards and the Tier 2-4
 * equipment): roster.tsx loads it with next/dynamic beside the roster's data, off the Party tab's initial JS (NB3).
 */
export function RosterEvasion({ sheet, augments }: { sheet: CharacterView["sheet"]; augments: readonly string[] }) {
  return <span data-testid="roster-evasion">{derivedDefense(sheet, augments).evasion}</span>;
}
