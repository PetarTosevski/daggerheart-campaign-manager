// Encounter-tab adversary actions (plan combat-actions AA3): the pure parts the panel reads. No React, no Convex calls.
//
// ```ts
// targetOptions({ party, tokens: null, instanceId });   // { mode: "party", options: every active PC }  (Q18)
// targetOptions({ party, tokens, instanceId });         // { mode: "map", options: PCs with a token }   (adversary on the live map)
// spotlightNote({ spotlights: 0, spotlightTurn: 1 }, 1, 1);  // "Spotlight: 1 Fear"  (CB p.153, the tracker's spotlightCostsFear)
// fearPrompt({ fear: 2, spotlight: 1, feature: 0, experience: 1 });  // "Spend 2 Fear? 1 for the spotlight, 1 for the Experience."
// ```

import { spotlightCostsFear, spotlightsThisTurn } from "@/lib/domain/encounters/spotlight";

export type PartyMember = { _id: string; status: string; sheet: { name: string } };
export type MapToken = { _id: string; kind: string; characterId?: string; instanceId?: string; name: string };
export type TargetOption = { characterId: string; name: string; tokenId?: string };

/**
 * Who the GM may target (Q18): with a live map that holds the selected adversary's token, the PCs with a token there
 * (the server checks line of sight, Q2); otherwise every active party character, with no range or line-of-sight limit.
 */
export function targetOptions({
  party,
  tokens,
  instanceId,
}: {
  party: readonly PartyMember[];
  tokens: readonly MapToken[] | null;
  instanceId: string;
}): { mode: "map" | "party"; options: TargetOption[] } {
  const active = party.filter((c) => c.status === "active");
  const onMap = tokens !== null && tokens.some((t) => t.instanceId === instanceId);
  if (!onMap) return { mode: "party", options: active.map((c) => ({ characterId: c._id, name: c.sheet.name })) };
  const options: TargetOption[] = [];
  for (const t of tokens) {
    if (t.kind !== "pc" || t.characterId === undefined) continue;
    const member = active.find((c) => c._id === t.characterId);
    if (member) options.push({ characterId: member._id, name: member.sheet.name, tokenId: t._id });
  }
  return { mode: "map", options };
}

/**
 * The Fear an action's spotlight would cost, as the tracker counts it (CB p.153): free when this adversary already holds
 * the spotlight this GM turn or no spotlight was given yet; otherwise 1 Fear. Null when it costs nothing.
 */
export function spotlightNote(instance: { spotlights: number; spotlightTurn: number }, gmTurn: number, turnSpotlights: number): string | null {
  if (spotlightsThisTurn(instance, gmTurn) > 0) return null;
  return spotlightCostsFear(turnSpotlights) ? "Spotlight: 1 Fear" : null;
}

export type FearConfirm = { fear: number; spotlight: number; feature: number; experience: number };

/** The server's `confirmFear` as one question (Q19: Fear is spent only on the GM's tap). */
export function fearPrompt(c: FearConfirm): string {
  const parts = [
    c.spotlight ? `${c.spotlight} for the spotlight` : null,
    c.feature ? `${c.feature} for the feature` : null,
    c.experience ? `${c.experience} for the Experience` : null,
  ].filter((p): p is string => p !== null);
  return `Spend ${c.fear} Fear?${parts.length ? ` ${parts.join(", ")}.` : ""}`;
}

export type RolledDie = { sides: number; value: number };

/** "17 (d20 14, +3)" for the GM's view of the attack roll; advantage dice listed as rolled. */
export function rollText(roll: { dice: readonly RolledDie[]; modifier: number; total: number }): string {
  const dice = roll.dice.map((d) => `d${d.sides} ${d.value}`).join(", ");
  const mod = roll.modifier ? `, ${roll.modifier > 0 ? "+" : ""}${roll.modifier}` : "";
  return `${roll.total} (${dice}${mod})`;
}

/** Feature kinds as the stat block prints them; passives apply on their own and get no Use button. */
export type FeatureKind = "passive" | "action" | "reaction" | "evolution";

export function usable(kind: FeatureKind): boolean {
  return kind !== "passive";
}

/** Toggles one id in a list (target picks). */
export function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
