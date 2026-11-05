import type { RollRecord } from "@/lib/domain/duality";
import type { Step } from "@/lib/domain/card-effects/types";
import { cardEffect } from "@/lib/srd/card-effects";

import type { ChoiceAsk, CardChoice } from "../../actions/hand/model";

/**
 * The result panel's pure model (plan combat-hud H4.1; boards Main 'Card result', CmpPromptsPlayer 'Your roll waits',
 * CmpPicking 'After the roll'). Everything here reads what the server already returned to the actor: their own dice and
 * damage totals and Hit / Miss / Defeated per target (U1, HANDOFF hard rule 2). No adversary number ever reaches it, so
 * none can be shown.
 */

export type Verdict = "Hit" | "Miss" | "Defeated";

/** Hit / Miss / Defeated (the classic `targetVerdict`'s rule). */
export function verdictOf(t: { hit: boolean; defeated?: boolean }): Verdict {
  if (t.defeated) return "Defeated";
  return t.hit ? "Hit" : "Miss";
}

export type DamageType = "physical" | "magic";

/** One damage roll as the panel reads it: "1d8+1 → 7 physical". */
export type DamageLine = { formula: string; total: number; type: DamageType | null };

/** One target row: name, verdict; the actor's own damage on a hit when the use rolled exactly one damage roll. */
export type ResultTarget = { tokenId: string; name: string; verdict: Verdict };

/** A table step the use leaves (CA5 prompts): a manual step gets a Done button. */
export type ResultPrompt = { kind: "manual" | "move" | "pcSave" | "pcDamage" | "fold"; text: string };

/** What the result panel shows (built once when the server answers; never recomputed from live data). */
export type ResultView = {
  /** Unique per result (the actionLog entry). */
  id: string;
  characterId: string;
  kind: "card" | "attack" | "feature";
  /** "Vicious Entangle", "Shortstaff", "Fangs". */
  title: string;
  /** "Moss · Spellcast Roll", "Moss · Attack". */
  sub: string;
  /** The card's art (header thumbnail), null for an attack. */
  cardId: string | null;
  roll: RollRecord | null;
  /** The roll's success when the use has one (card: the server's `success`; attack: every target hit). */
  success: boolean | null;
  damage: readonly DamageLine[];
  targets: readonly ResultTarget[];
  /** The GM's Fear gained from this roll. */
  fear: number;
  prompts: readonly ResultPrompt[];
  /** Short notes under the rows (riders that applied, skipped riders, the Minion offer). */
  notes: readonly string[];
};

// ---------------------------------------------------------------- the dice

/** The tag in the header ("Success with Hope", "Critical success", "Failure with Fear"; "With Hope" for a mixed attack). */
export function outcomeTag(roll: RollRecord | null, success: boolean | null): { text: string; tone: "hope" | "fear" | "crit" | "plain" } {
  if (roll === null) return { text: "Used", tone: "plain" };
  if (roll.outcome === "critical") return { text: "Critical success", tone: "crit" };
  if (roll.outcome === "none") return { text: success === false ? "Failure" : "Rolled", tone: "plain" };
  const hope = roll.outcome.endsWith("Hope");
  const side = hope ? "Hope" : "Fear";
  const tone = hope ? "hope" : "fear";
  if (success === null) return { text: `With ${side}`, tone };
  return { text: `${success ? "Success" : "Failure"} with ${side}`, tone };
}

/** The duality line: Hope die, Fear die, everything else as one signed number, the total. Null without duality dice. */
export function dualityParts(roll: RollRecord): { hope: number; fear: number; rest: number; total: number } | null {
  const hope = roll.dice.find((d) => d.role === "hope" && !d.dropped);
  const fear = roll.dice.find((d) => d.role === "fear" && !d.dropped);
  if (!hope || !fear) return null;
  return { hope: hope.value, fear: fear.value, rest: roll.total - hope.value - fear.value, total: roll.total };
}

/** "+2", "−1", "" for 0. */
export function signedPart(n: number): string {
  if (n === 0) return "";
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** What the roll gave the actor (CB p.95: with Hope gain a Hope; a critical also clears a Stress) and the GM's Fear. */
export function gainsOf(roll: RollRecord | null, fear: number): { text: string; tone: "hope" | "fear" }[] {
  const out: { text: string; tone: "hope" | "fear" }[] = [];
  if (roll !== null && dualityParts(roll) !== null) {
    if (roll.outcome === "critical") out.push({ text: "+1 Hope", tone: "hope" }, { text: "Clear a Stress", tone: "hope" });
    else if (roll.outcome === "successHope" || roll.outcome === "failHope") out.push({ text: "+1 Hope", tone: "hope" });
  }
  if (fear > 0) out.push({ text: `GM +${fear} Fear`, tone: "fear" });
  return out;
}

// ---------------------------------------------------------------- damage

/**
 * "2d8+3": the counted damage dice grouped by size, then the roll's modifier. Anything else in the total is named after
 * it: a critical's dice maximum (CB p.98: "Start with the highest possible value the damage dice can roll") reads
 * "1d8+1 +8 critical"; another bonus "+2".
 */
export function damageFormula(roll: RollRecord, critical = false): string {
  const counts = new Map<number, number>();
  for (const d of roll.dice) if (!d.dropped) counts.set(d.sides, (counts.get(d.sides) ?? 0) + 1);
  const dice = [...counts.entries()].map(([sides, n]) => `${n}d${sides}`).join("+");
  if (dice === "") return String(roll.total);
  // The server folds a critical's dice maximum into `modifier` (rollDamage, CB p.98): split it back out so a critical
  // reads "1d8+1 +8 critical", not "1d8+9".
  const critMax = critical ? roll.dice.reduce((n, d) => n + (d.dropped ? 0 : d.sides), 0) : 0;
  const folded = critMax > 0 && roll.modifier >= critMax ? critMax : 0;
  const modifier = roll.modifier - folded;
  const extra = roll.total - modifier - roll.dice.reduce((n, d) => n + (d.dropped ? 0 : d.value), 0);
  const base = `${dice}${signedPart(modifier).replace("−", "-")}`;
  if (extra === 0) return base;
  return `${base} ${signedPart(extra)}${critical && extra > 0 ? " critical" : ""}`;
}

/** A weapon's damage string ("d8+1 mag", "1d6 phy") → its type. */
export function weaponDamageType(damage: string): DamageType | null {
  const word = damage.trim().split(/\s+/)[1]?.toLowerCase() ?? "";
  if (word.startsWith("phy")) return "physical";
  if (word.startsWith("mag")) return "magic";
  return null;
}

function damageStepTypes(steps: readonly Step[]): string[] {
  return steps.flatMap((s) => [
    ...(s.kind === "damage" ? [s.type] : []),
    ...(s.kind === "optional" || s.kind === "followUp" ? damageStepTypes(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => damageStepTypes(o.steps)) : []),
  ]);
}

/** The damage type a card use names (its first damage step), null when it names none or "weapon" / "both". */
export function cardDamageType(cardId: string, useId: string): DamageType | null {
  const use = cardEffect(cardId)?.uses.find((u) => u.id === useId);
  const type = damageStepTypes(use?.steps ?? [])[0];
  return type === "physical" || type === "magic" ? type : null;
}

/** "Spellcast Roll", "Agility Roll", "Reaction Roll": what kind of roll a card use makes (header sub line). */
export function cardRollWord(cardId: string, useId: string): string | null {
  const roll = cardEffect(cardId)?.uses.find((u) => u.id === useId)?.roll;
  if (!roll) return null;
  if (roll.kind === "spellcast") return "Spellcast Roll";
  if (roll.kind === "attack") return "Attack Roll";
  if (roll.kind === "reaction") return "Reaction Roll";
  if (roll.kind === "trait") {
    const trait = Array.isArray(roll.trait) ? null : (roll.trait as string);
    return trait ? `${trait.charAt(0).toUpperCase()}${trait.slice(1)} Roll` : "Action Roll";
  }
  return null;
}

const lineOf = (roll: RollRecord, type: DamageType | null, critical: boolean): DamageLine => ({ formula: damageFormula(roll, critical), total: roll.total, type });

// ---------------------------------------------------------------- builders

type Names = ReadonlyMap<string, string>;
type Target = { tokenId: string; hit: boolean; defeated: boolean };
type Prompt = { kind: ResultPrompt["kind"]; text: string };

const targetsOf = (targets: readonly Target[], names: Names): ResultTarget[] => targets.map((t) => ({ tokenId: t.tokenId, name: names.get(t.tokenId) ?? "Target", verdict: verdictOf(t) }));

/** A resolved card use (`combatCards.useCard`'s `resolved`). */
export function cardResultView(input: {
  characterId: string;
  actorName: string;
  cardName: string;
  result: { entryId: string; cardId: string; useId: string; roll: RollRecord | null; damage: readonly RollRecord[]; success: boolean; targets: readonly Target[]; fearDelta?: number; prompts: readonly Prompt[]; minionOffer: unknown };
  names: Names;
  /** The use's own name when it differs from the card's (a grimoire's spell). */
  useName?: string;
}): ResultView {
  const { result } = input;
  const type = cardDamageType(result.cardId, result.useId);
  const word = cardRollWord(result.cardId, result.useId);
  return {
    id: result.entryId,
    characterId: input.characterId,
    kind: "card",
    title: input.useName && input.useName !== input.cardName ? `${input.cardName}: ${input.useName}` : input.cardName,
    sub: [input.actorName, word ?? (result.roll ? "Roll" : "Card")].join(" · "),
    cardId: result.cardId,
    roll: result.roll,
    success: result.roll ? result.success : null,
    damage: result.damage.map((d) => lineOf(d, type, result.roll?.outcome === "critical")),
    targets: targetsOf(result.targets, input.names),
    fear: Math.max(0, result.fearDelta ?? 0),
    prompts: result.prompts.map((p) => ({ kind: p.kind, text: p.text })),
    notes: result.minionOffer ? ["Your damage can defeat more Minions: pick them in the prompt."] : [],
  };
}

/**
 * A resolved feature use (`combatFeatures.useFeature`'s `resolved`, convex/lib/featureRunner.ts
 * `resolvedFeatureValidator`) through the picking panel (dcm-bxp.99.32.26; it used to be one line in the square-picking
 * bar). No art; the feature's own notes (Favor, Help dice, areas) go under the rows.
 */
export function featureResultView(input: {
  characterId: string;
  actorName: string;
  featureName: string;
  result: { entryId: string; roll: RollRecord | null; damage: readonly RollRecord[]; success: boolean; targets: readonly Target[]; fearDelta?: number; prompts: readonly Prompt[]; notes: readonly string[] };
  names: Names;
}): ResultView {
  const { result } = input;
  return {
    id: result.entryId,
    characterId: input.characterId,
    kind: "feature",
    title: input.featureName,
    sub: [input.actorName, result.roll ? "Roll" : "Feature"].join(" · "),
    cardId: null,
    roll: result.roll,
    success: result.roll ? result.success : null,
    damage: result.damage.map((d) => lineOf(d, null, result.roll?.outcome === "critical")),
    targets: targetsOf(result.targets, input.names),
    fear: Math.max(0, result.fearDelta ?? 0),
    prompts: result.prompts.map((p) => ({ kind: p.kind, text: p.text })),
    notes: result.notes.filter((n) => n.length > 0),
  };
}

/** A resolved weapon attack (`combatActions.attack` / `afterRoll`'s `resolved`). */
export function attackResultView(input: {
  characterId: string;
  actorName: string;
  weaponName: string;
  damageType: DamageType | null;
  result: {
    entryId: string;
    roll: RollRecord;
    damage: RollRecord | null;
    targets: readonly Target[];
    /** Absent for a player while the GM's Fear is hidden (dcm-jh6d.62). */
    fearGained?: number;
    minionOffer: unknown;
    riders?: readonly string[];
    skipped?: readonly string[];
    riderPrompts?: readonly Prompt[];
  };
  names: Names;
}): ResultView {
  const { result } = input;
  const hits = result.targets.filter((t) => t.hit).length;
  const success = result.targets.length === 0 ? null : hits === result.targets.length ? true : hits === 0 ? false : null;
  const notes: string[] = [];
  if (result.riders && result.riders.length > 0) notes.push(`With ${result.riders.join(", ")}`);
  if (result.skipped && result.skipped.length > 0) notes.push(`Not used (its moment didn’t come): ${result.skipped.join(", ")}`);
  if (result.minionOffer) notes.push("Your damage can defeat more Minions: pick them in the prompt.");
  return {
    id: result.entryId,
    characterId: input.characterId,
    kind: "attack",
    title: input.weaponName,
    sub: `${input.actorName} · Attack Roll`,
    cardId: null,
    roll: result.roll,
    success,
    damage: result.damage ? [lineOf(result.damage, input.damageType, result.roll.outcome === "critical")] : [],
    targets: targetsOf(result.targets, input.names),
    fear: Math.max(0, result.fearGained ?? 0),
    prompts: (result.riderPrompts ?? []).map((p) => ({ kind: p.kind, text: p.text })),
    notes,
  };
}

/** The damage a target row shows: the one damage roll on a hit (several rolls are listed under the rows instead). */
export function rowDamage(view: Pick<ResultView, "damage">, target: ResultTarget): DamageLine | null {
  if (target.verdict === "Miss" || view.damage.length !== 1) return null;
  return view.damage[0]!;
}

/** "1d8+1 → 7 physical". */
export function damageText(line: DamageLine): string {
  return `${line.formula} → ${line.total}${line.type ? ` ${line.type}` : ""}`;
}

// ---------------------------------------------------------------- the held roll (CmpPromptsPlayer 'Your roll waits')

/** "Brannoc · 15 with Hope · before damage". */
export function heldSub(characterName: string, roll: RollRecord): string {
  const side = roll.outcome === "critical" ? "a critical" : roll.outcome.endsWith("Hope") ? "with Hope" : roll.outcome.endsWith("Fear") ? "with Fear" : null;
  return [characterName, side ? `${roll.total} ${side}` : String(roll.total), "before damage"].join(" · ");
}

/** The held roll's primary: "Use and roll damage" (a hit) / "Use" (every target missed). */
export function heldPrimary(targets: readonly { hit: boolean }[]): string {
  return targets.some((t) => t.hit) ? "Use and roll damage" : "Use";
}

// ---------------------------------------------------------------- after the roll (CmpPicking 'After the roll')

export type SplitAsk = Extract<ChoiceAsk, { kind: "split" }>;
export type ChooseAsk = Extract<ChoiceAsk, { kind: "choose" }>;

/** The amount a split shares out, when the server says it (`amount`); null when the ask doesn't carry it. */
export function splitTotal(ask: SplitAsk): number | null {
  const amount = (ask as { amount?: unknown }).amount;
  return typeof amount === "number" ? amount : null;
}

/** What is still to share: total − assigned (never below 0); null without a total. */
export function splitLeft(ask: SplitAsk, splits: Readonly<Record<string, number>>): number | null {
  const total = splitTotal(ask);
  if (total === null) return null;
  return Math.max(0, total - ask.tokenIds.reduce((n, id) => n + (splits[id] ?? 0), 0));
}

/** A split of damage (the board's "Deal the damage") vs Hope, Stress, marks or clears. */
export function splitIsDamage(ask: SplitAsk): boolean {
  return /damage/i.test(ask.label);
}

/** The asks grouped for the panel: plain choices, splits, and per-chooser picks of one step ("each ally picks their own"). */
export type AskGroup =
  | { kind: "choose"; ask: ChooseAsk }
  | { kind: "split"; ask: SplitAsk; index: number }
  | { kind: "allies"; stepId: string; label: string; asks: readonly ChooseAsk[] };

export function groupAsks(asks: readonly ChoiceAsk[]): AskGroup[] {
  const out: AskGroup[] = [];
  asks.forEach((a, index) => {
    if (a.kind === "split") out.push({ kind: "split", ask: a, index });
    else if (a.kind === "choose" && a.chooserId !== undefined) {
      const group = out.find((g): g is Extract<AskGroup, { kind: "allies" }> => g.kind === "allies" && g.stepId === a.stepId);
      if (group) (group.asks as ChooseAsk[]).push(a);
      else out.push({ kind: "allies", stepId: a.stepId, label: a.label, asks: [a] });
    } else if (a.kind === "choose") out.push({ kind: "choose", ask: a });
  });
  return out;
}

/** "2 of 3 chose": how many choosers of a step have an option picked. */
export function choseCount(asks: readonly ChooseAsk[], options: Readonly<Record<string, readonly string[]>>, keyOf: (a: ChooseAsk) => string): { chose: number; of: number } {
  return { chose: asks.filter((a) => (options[keyOf(a)] ?? []).length > 0).length, of: asks.length };
}

/** Why the after-roll primary is blocked: an unanswered choice, damage left to share. */
export function asksProblem(asks: readonly ChoiceAsk[], options: Readonly<Record<string, readonly string[]>>, splits: Readonly<Record<string, number>>, keyOf: (a: ChoiceAsk) => string): string | null {
  for (const a of asks) {
    if (a.kind === "choose" && (options[keyOf(a)] ?? []).length === 0) return "Every choice needs an answer";
    if (a.kind === "split") {
      const left = splitLeft(a, splits);
      if (left !== null && left > 0) return `${left} left to share`;
    }
  }
  return null;
}

/** The after-roll primary: "Deal the damage" for a damage split, else "Confirm". */
export function asksPrimary(asks: readonly ChoiceAsk[]): string {
  return asks.some((a) => a.kind === "split" && splitIsDamage(a)) ? "Deal the damage" : "Confirm";
}

/** The request's choices with the after-roll answers in (an answer replaces one with the same id). */
export function withAnswers<T extends { choices: readonly CardChoice[] }>(request: T, answers: readonly CardChoice[]): T {
  const ids = new Set(answers.map((c) => c.id));
  return { ...request, choices: [...request.choices.filter((c) => !ids.has(c.id)), ...answers] };
}
