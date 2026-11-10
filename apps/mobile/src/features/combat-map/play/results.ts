import type { FunctionReturnType } from "convex/server";

import type { RollRecord } from "../../../../../../src/lib/domain/duality";
import { RANGE_BANDS } from "../../../../../../src/lib/domain/combat-map/ranges";

import type { api } from "../../../convex";
import { earlierText } from "../../../../../../src/lib/party/roll-copy";

export type AttackResult = FunctionReturnType<typeof api.combatActions.attack>;
export type CardResult = FunctionReturnType<typeof api.combatCards.useCard>;
export type ResolvedAttack = Extract<AttackResult, { status: "resolved" }>;
export type AwaitingAttack = Extract<AttackResult, { status: "awaiting" }>;
export type MinionOffer = NonNullable<ResolvedAttack["minionOffer"]>;

/**
 * What the player reads after an attack or a card (dcm-gdzi.16), from what the mutation returned: their own dice, Hit /
 * Miss / Defeated per target, their damage totals, "waiting for the GM" (an out-of-range sanction, Q1), the Minions
 * the GM picks (rule switches D6 "GM picks", `minionsForGm`) and the prompts left to the table. Never an enemy's stat
 * (the server sends none, U1).
 */
export type ResultView = {
  tone: "hit" | "miss" | "waiting";
  headline: string;
  lines: string[];
};

const BAND_LABEL: Record<string, string> = Object.fromEntries([...RANGE_BANDS.map((b) => [b.key, b.label]), ["veryFar", "Very Far"]]);

function bandLabel(band: string): string {
  return BAND_LABEL[band] ?? band;
}

function targetWord(t: { hit: boolean; defeated?: boolean }): string {
  if (t.defeated) return "Defeated";
  return t.hit ? "Hit" : "Miss";
}

function targetLines(targets: readonly { tokenId: string; hit: boolean; defeated?: boolean }[], names: ReadonlyMap<string, string>): string[] {
  return targets.map((t) => `${names.get(t.tokenId) ?? "Target"}: ${targetWord(t)}`);
}

function minionLine(n: number | undefined): string[] {
  return n !== undefined && n > 0 ? [`The GM picks ${n} more Minion${n === 1 ? "" : "s"}.`] : [];
}

function waitingView(what: string, outOfRange: readonly { tokenId: string; band: string }[], names: ReadonlyMap<string, string>): ResultView {
  return {
    tone: "waiting",
    headline: `${what}: waiting for the GM`,
    lines: [
      ...outOfRange.map((o) => `${names.get(o.tokenId) ?? "A target"} is out of range (${bandLabel(o.band)}).`),
      "Nothing is rolled or paid until the GM allows it.",
    ],
  };
}

function rollLine(roll: RollRecord): string {
  return earlierText(roll);
}

export function attackResultView(weaponName: string, result: AttackResult, names: ReadonlyMap<string, string>): ResultView {
  if (result.status === "pending") return waitingView(weaponName, result.outOfRange, names);
  if (result.status === "awaiting") {
    return { tone: "waiting", headline: `${weaponName}: ${rollLine(result.roll)}`, lines: [...targetLines(result.targets, names), "Use a feature on this roll, or pass."] };
  }
  const hit = result.targets.some((t) => t.hit);
  const lines = [
    ...targetLines(result.targets, names),
    ...(result.damage ? [`Damage ${result.damage.total}`] : []),
    ...(result.riders ?? []).map((r) => `${r} applied`),
    ...(result.skipped ?? []).map((r) => `${r}: not triggered, nothing paid`),
    ...minionLine(result.minionsForGm),
    ...result.prompts.map((p) => p.text),
    ...(result.riderPrompts ?? []).map((p) => p.text),
    ...(result.allyPicks ?? []).map((p) => `${p.name}: waiting for each ally's pick`),
  ];
  return { tone: hit ? "hit" : "miss", headline: `${weaponName}: ${rollLine(result.roll)}`, lines };
}

export function cardResultView(cardName: string, result: Exclude<CardResult, { status: "needsChoice" }>, names: ReadonlyMap<string, string>): ResultView {
  if (result.status === "pending") return waitingView(cardName, result.outOfRange, names);
  const lines = [
    ...targetLines(result.targets, names),
    ...result.damage.map((d) => `Damage ${d.total}`),
    ...minionLine(result.minionsForGm),
    ...result.prompts.map((p) => p.text),
  ];
  const headline = result.roll ? `${cardName}: ${rollLine(result.roll)}` : `${cardName}: ${result.success ? "done" : "no effect"}`;
  return { tone: result.success ? "hit" : "miss", headline, lines };
}

/** The extra Minions picked so far (per candidate), capped by the offer's `extra` and each candidate's `available`. */
export function addMinion(offer: Pick<MinionOffer, "extra" | "candidates">, counts: Readonly<Record<string, number>>, instanceId: string, delta: 1 | -1): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const candidate = offer.candidates.find((c) => c.instanceId === instanceId);
  const now = counts[instanceId] ?? 0;
  if (candidate === undefined) return { ...counts };
  if (delta > 0 && (total >= offer.extra || now >= candidate.available)) return { ...counts };
  if (delta < 0 && now === 0) return { ...counts };
  return { ...counts, [instanceId]: now + delta };
}

/** The `instanceIds` `combatActions.pickMinions` takes: one id per Minion. */
export function minionIds(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));
}
