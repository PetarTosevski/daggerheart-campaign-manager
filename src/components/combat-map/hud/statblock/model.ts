// The GM's adversary stat block and attack picker in the HUD (plan combat-hud H5.2; GMDesktop 'Adversary acting',
// CmpPicking, CmpTokens): the pure parts. No React, no Convex calls.
//
// ```ts
// attackLine(block);                            // "Javelin · Close · 1d8+3 phy · +2"
// spotlightCost(instance, instances, gmTurn);   // 1 when this spotlight is the GM turn's second or later (CB p.153)
// gmAttackRows(self, pcs, sight, "Close");      // the PCs as the purple picker's rows: in / out / los
// fearReasons(confirm, "the Lieutenant", ...);  // ["1 to spotlight the Lieutenant", "1 for Local Knowledge"]
// ```

import { conditionProvenance, provenanceLine, type ConditionSourceEntry } from "@/lib/domain/characters/condition-sources";
import type { SightResult } from "@/lib/domain/combat-actions/sight";
import type { Footprint } from "@/lib/domain/combat-actions/distance";
import { spotlightCostsFear, spotlightsThisTurn, turnSpotlights } from "@/lib/domain/encounters/spotlight";
import { areaWords } from "@/lib/domain/adversary-actions/area-targets";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { attackBand, rangeRows } from "../../actions/adversary/model";
import type { PickRowInput } from "../pick";

/** The parts of a stat block the HUD reads (`StatBlockAdversary`, SRD or custom). */
export type BlockLike = {
  name: string;
  tier: number;
  type: string;
  motives: string;
  difficulty: number;
  thresholds: { major: number | null; severe: number | null } | null | string;
  attack: { modifier: number | string; name: string; range: string; damage: string };
  experiences: readonly { name: string; value: number }[];
  features: readonly { name: string; kind: "passive" | "action" | "reaction" | "evolution"; text: string; fearCost?: number }[];
};

export type SpotlightCount = { spotlights: number; spotlightTurn: number };

const KIND_LABEL = { passive: "Passive", action: "Action", reaction: "Reaction", evolution: "Evolution" } as const;

export function kindLabel(kind: BlockLike["features"][number]["kind"]): string {
  return KIND_LABEL[kind];
}

/**
 * Whether a feature gets a Use button: passives apply on their own (the classic panel's `usable`), and Momentum's Fear
 * is automatic (answer 7a; the board shows it without Use).
 */
export function featureUsable(f: Pick<BlockLike["features"][number], "kind" | "name">): boolean {
  return f.kind !== "passive" && f.name !== "Momentum";
}

/** "+2", "-1", "+X". */
export function signed(n: number | string): string {
  if (typeof n === "string") return /^[+-]/.test(n) ? n : `+${n}`;
  return n >= 0 ? `+${n}` : `${n}`;
}

/** "Javelin · Close · 1d8+3 phy · +2" (the picker's header line). */
export function attackLine(block: Pick<BlockLike, "attack">): string {
  const { name, range, damage, modifier } = block.attack;
  return [name, range, damage, signed(modifier)].filter(Boolean).join(" · ");
}

/** "7/14", "None" (a block without thresholds, e.g. a Minion). */
export function thresholdsText(stats: { major: number | null; severe: number | null }): string {
  if (stats.major === null && stats.severe === null) return "None";
  return `${stats.major ?? "–"}/${stats.severe ?? "–"}`;
}

/** "Tier 1 Leader". */
export function tierLine(block: Pick<BlockLike, "tier" | "type">): string {
  return `Tier ${block.tier} ${block.type}`;
}

/** "the Jagged Knife Lieutenant": the instance label the map shows, as the board's copy names it. */
export function theName(label: string): string {
  return `the ${label}`;
}

/** The face letter (the boards' `.ad-face`): the instance label's last word's initial. */
export function faceLetter(label: string): string {
  const words = label.trim().split(/\s+/).filter((w) => !/^\d+$/.test(w));
  return (words.at(-1) ?? label).charAt(0).toUpperCase() || "?";
}

/** "2 of 6 marked" (answer 2: numbers read marked). */
export function markedText(marked: number, max: number): string {
  return `${marked} of ${max} marked`;
}

/**
 * The Fear the Spotlight button spends (CB p.153: "spend a Fear to make an additional GM move, shifting the spotlight to
 * another adversary"): encounterTracking.spotlight counts one more spotlight in this GM turn, which costs 1 Fear once
 * any spotlight was given this turn.
 */
export function spotlightCost(instances: readonly SpotlightCount[], gmTurn: number): number {
  return spotlightCostsFear(turnSpotlights(instances, gmTurn)) ? 1 : 0;
}

/**
 * The Fear an action's own spotlight costs (adversaryActions spotlights the acting instance): free when this adversary
 * already holds it this GM turn, otherwise as the Spotlight button.
 */
export function actionSpotlightCost(instance: SpotlightCount, instances: readonly SpotlightCount[], gmTurn: number): number {
  return spotlightsThisTurn(instance, gmTurn) > 0 ? 0 : spotlightCost(instances, gmTurn);
}

/** "Spotlight · 1 Fear" / "Spotlight". */
export function spotlightButtonText(cost: number): string {
  return cost > 0 ? `Spotlight · ${cost} Fear` : "Spotlight";
}

/** The picker's footer (board: "Spotlight: 1 Fear · Momentum on a hit"). */
export function attackFooter({
  spotlightFear,
  experienceFear,
  momentum,
  darkHearted = false,
  experienceByHand = false,
}: {
  spotlightFear: number;
  experienceFear: number;
  momentum: boolean;
  /** WF, W3 Tier 3: Dark-Hearted picked (1 Fear). */
  darkHearted?: boolean;
  /** WF, F4 Manual: an Experience picked, its Fear spent by hand. */
  experienceByHand?: boolean;
}): string | null {
  const parts = [
    spotlightFear > 0 ? `Spotlight: ${spotlightFear} Fear` : null,
    experienceFear > 0 ? (experienceByHand ? "Experience: spend 1 Fear by hand" : `Experience: ${experienceFear} Fear`) : null,
    darkHearted ? "Dark-Hearted: 1 Fear" : null,
    momentum ? "Momentum on a hit" : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Momentum ("When the X makes a successful attack against a PC, you gain a Fear") runs on its own (answer 7a). */
export function hasMomentum(block: Pick<BlockLike, "features">): boolean {
  return block.features.some((f) => f.name === "Momentum");
}

/** Reaction features the GM may opt into on this attack (Q19 default No); Momentum is automatic. */
export function attackReactions(block: Pick<BlockLike, "features">): string[] {
  return block.features.filter((f) => f.kind === "reaction" && f.name !== "Momentum").map((f) => f.name);
}

/** The server's `confirmFear` as FearConfirm's reasons (board: "1 to spotlight the Lieutenant, 1 for Coup de Grace"). */
export function fearReasons(c: { spotlight: number; feature: number; experience: number; darkHearted?: number }, who: string, feature: string | null, experience: string | null): string[] {
  return [
    c.spotlight ? `${c.spotlight} to spotlight ${who}` : null,
    c.feature ? `${c.feature} for ${feature ?? "the feature"}` : null,
    c.experience ? `${c.experience} for ${experience ?? "the Experience"}` : null,
    // Rule switches WF, W3 Tier 3 (HF p.177).
    c.darkHearted ? `${c.darkHearted} for Dark-Hearted` : null,
  ].filter((p): p is string => p !== null);
}

/** WF, W3 Tier 3 (HF p.177): the pickers' option id for Dark-Hearted ("advantage on its next roll" for 1 Fear). */
export const DARK_HEARTED_OPTION = "dark-hearted";

/** WF: the Dark-Hearted option, when adversaries have it (`adversaryActions.darkHearted`). */
export function darkHeartedOption(on: boolean): { id: string; label: string; note: string; cost: { amount: number; resource: "fear" } }[] {
  return on ? [{ id: DARK_HEARTED_OPTION, label: "Dark-Hearted: advantage", note: "Costs 1 Fear (Doom Track Tier 3)", cost: { amount: 1, resource: "fear" } }] : [];
}

/** A PC token on the map as the GM attack reads it. */
export type PcToken = Footprint & { tokenId: Id<"combatTokens">; characterId: Id<"characters">; name: string; conditions: readonly string[] };

/**
 * The purple picker's rows (GMDesktop 'Adversary acting'): every PC token on the map from the adversary's token, with
 * the Defined Range band (CB p.103), `los` when the adversary can't see them (CB p.104, Q2: the server refuses them too),
 * `out` beyond the attack's printed range (amber "Out of range"; adversary attacks are not refused for range, the GM
 * decides, analysis B4) and `in` otherwise. The PCs are the adversary's enemies (side "enemy", never the mint ally ring).
 */
export function gmAttackRows(self: Footprint, pcs: readonly PcToken[], sight: ((from: Footprint, to: Footprint) => SightResult) | null, attackRange: string): PickRowInput[] {
  const ranges = rangeRows(
    self,
    pcs.map((p) => ({ ...p, characterId: p.characterId as string })),
    sight,
    attackRange,
  );
  return pcs.map((pc, i) => {
    const r = ranges[i]!;
    return {
      tokenId: pc.tokenId,
      name: pc.name,
      side: "enemy" as const,
      band: r.band,
      reach: r.sight === "blocked" ? ("los" as const) : r.inAttackRange ? ("in" as const) : ("out" as const),
      conditions: pc.conditions,
    };
  });
}

/** The attack rule's range for the picker's rule (a Defined Range band, or unlimited for an odd printed range). */
export function attackRuleRange(range: string): string {
  return attackBand(range) ?? "unlimited";
}

/** The Experience the GM switched on (the server takes one); null with none, "many" with more than one. */
export function pickedExperience(options: Readonly<Record<string, boolean>>): string | null | "many" {
  const on = Object.entries(options)
    .filter(([id, v]) => v && id.startsWith("xp:"))
    .map(([id]) => id.slice(3));
  if (on.length > 1) return "many";
  return on[0] ?? null;
}

/** The reaction features switched on. */
export function pickedReactions(options: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(options)
    .filter(([id, v]) => v && id.startsWith("rx:"))
    .map(([id]) => id.slice(3));
}

export type Edge = "none" | "advantage" | "disadvantage";
export const EDGES: readonly { id: Edge; label: string }[] = [
  { id: "none", label: "Normal" },
  { id: "advantage", label: "Advantage" },
  { id: "disadvantage", label: "Disadvantage" },
];

export function edgeArgs(edge: Edge): { advantage?: number; disadvantage?: number } {
  return edge === "advantage" ? { advantage: 1 } : edge === "disadvantage" ? { disadvantage: 1 } : {};
}

/** "Attack Brannoc", "Attack" (nothing picked). */
export function attackLabel(names: readonly string[]): string {
  if (names.length === 0) return "Attack";
  return `Attack ${names.length <= 2 ? names.join(" and ") : `${names.length} targets`}`;
}

/**
 * The condition chips: each condition, with the Fear end that clears it (by name), and Fear ends with no condition.
 * `from` (dcm-bxp.99.32.1): the instance's stored provenance, "From Vicious Entangle (Moss) - until it breaks free", or
 * null when none is stored (the chip shows the condition alone, as before).
 */
export type FearEnd = { effectId: string; label: string; source: string; fear: number };
export type ConditionChip = { key: string; label: string; condition: string | null; end: FearEnd | null; from: string | null };

export function conditionChips(conditions: readonly string[], ends: readonly FearEnd[], sources?: readonly ConditionSourceEntry[]): ConditionChip[] {
  const used = new Set<string>();
  const chips: ConditionChip[] = conditions.map((c) => {
    const label = c.charAt(0).toUpperCase() + c.slice(1);
    const end = ends.find((e) => !used.has(e.effectId) && e.label.toLowerCase() === c.toLowerCase()) ?? null;
    if (end) used.add(end.effectId);
    const stored = conditionProvenance(sources, c);
    return { key: `c:${c}`, label, condition: c, end, from: stored ? provenanceLine(stored) : null };
  });
  for (const e of ends) if (!used.has(e.effectId)) chips.push({ key: `e:${e.effectId}`, label: e.label, condition: null, end: e, from: null });
  return chips;
}

/**
 * dcm-y3mf: the purple picker for an "all targets" area the GM names (Hail of Boulders, "all targets in front of the Ogre
 * within Far range"; Trample, "all targets in the Construct's path"). In front of / in a line / around: everyone in range
 * starts picked and the GM unpicks who isn't there (the map has no facing to read); a path or "between" starts empty
 * (where the adversary goes is the GM's). An attack needs one target (the server refuses a roll at nobody).
 */
export function areaPick(
  target: { area: string; range: string },
  who: string,
  attack: boolean,
  rows: readonly Pick<PickRowInput, "tokenId" | "reach" | "conditions">[],
  /** Plan rule-switches WF, C4 Book (CB p.106): an unconscious PC can't be targeted, so it starts unpicked. */
  skipUnconscious = false,
): { text: string; picked: Id<"combatTokens">[]; min: number } {
  const where = areaWords(target.area, target.range, who);
  const empty = target.area === "path" || target.area === "between";
  return {
    text: empty ? `Pick everyone ${where}` : `Everyone ${where}: unpick anyone who isn’t`,
    picked: empty ? [] : rows.filter((r) => r.reach === "in" && !(skipUnconscious && (r.conditions ?? []).some((c) => c.toLowerCase() === "unconscious"))).map((r) => r.tokenId),
    min: attack ? 1 : 0,
  };
}
