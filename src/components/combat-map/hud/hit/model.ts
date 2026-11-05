import { SEVERITY_LABEL, armorCounts, promptMode, stepFor, type GrantView, type HitView, type PromptMode, type Severity } from "../../actions/reactions/model";

/**
 * Pure model of the HUD's hit window (plan combat-hud H4.2; Main 'You're hit', CmpPromptsPlayer 'Pay something else?').
 * Everything comes from the classic prompt's data (`adversaryActionsReads.pending`, through `actions/reactions/model.ts`)
 * and the character's own thresholds and trackers (`combatHud.sheet`); nothing here invents a number the engine did not
 * give. Text follows answer 2: pips show what is left, words say what is marked ("2 → 3 of 6 marked").
 */

/** What the window shows for this hit (the classic `PromptMode`, plus the after-hit offer of Unbreakable). */
export type HitWindowMode = PromptMode | "afterHit";

export function windowMode(view: HitView): HitWindowMode {
  if (view.awaiting && view.afterHit) return "afterHit";
  return promptMode(view);
}

/** Whether the window offers marking Armor Slots (no slot left, direct damage or an answered armor question hide it). */
export function offersArmor(mode: HitWindowMode): boolean {
  return mode === "armorOne" || mode === "armorMany";
}

/**
 * The header: "You were hit" for a player, "<Name> was hit" for the GM's own PC (the GM may own several);
 * `characterName` is the character answering (an ally: "<Name> can react").
 */
export function windowTitle(mode: HitWindowMode, characterName: string, gm: boolean): string {
  if (mode === "preRoll") return "Before the roll";
  if (mode === "ally") return `${characterName} can react`;
  if (mode === "afterHit") return "After the hit";
  return gm ? `${characterName} was hit` : "You were hit";
}

/** The sub line: who hit whom ("The Bandit hit Moss"; before the roll "Bandit attacks Moss"). */
export function windowSub(view: Pick<HitView, "attackerLabel" | "targetName" | "originalTargetName">, mode: HitWindowMode): string {
  if (mode === "preRoll") return `${view.attackerLabel} attacks ${view.targetName}`;
  const redirect = view.originalTargetName ? ` (instead of ${view.originalTargetName})` : "";
  return `${view.attackerLabel} hit ${view.targetName}${redirect}`;
}

/** The severity at 0 Armor Slots (the server's preview; else its own severity). */
export function baseStep(view: HitView): { severity: Severity; hp: number } {
  const step = stepFor(view, 0);
  return { severity: step?.severity ?? view.severity ?? "none", hp: step?.hp ?? 0 };
}

export type ThresholdTile = { severity: Exclude<Severity, "none">; label: string; hp: number; on: boolean };

/** CB p.91: Minor marks 1 HP, Major 2, Severe 3. The active tile shows the engine's own count for this hit. */
const TILE_HP = { minor: 1, major: 2, severe: 3 } as const;

/**
 * The three threshold tiles ("Minor", "Major 9+", "Severe 16+"), the hit's severity before armor active. Without the
 * thresholds (still loading) the tiles carry no numbers.
 */
export function thresholdTiles(view: HitView, thresholds: { major: number; severe: number } | null): ThresholdTile[] {
  const base = baseStep(view);
  return (["minor", "major", "severe"] as const).map((severity) => {
    const on = base.severity === severity;
    const from = severity === "major" ? thresholds?.major : severity === "severe" ? thresholds?.severe : undefined;
    return {
      severity,
      label: from === undefined ? SEVERITY_LABEL[severity] : `${SEVERITY_LABEL[severity]} ${from}+`,
      hp: on ? base.hp : TILE_HP[severity],
      on,
    };
  });
}

/** The Armor Slot counts on offer (1 for the usual hit, several under I Am Your Shield; only whole steps, E2). */
export function slotCounts(view: HitView, mode: HitWindowMode): number[] {
  if (mode === "armorOne") return [1];
  if (mode === "armorMany") return armorCounts(view);
  return [];
}

/** The picked count kept on offer: a count the server no longer lists falls back to the first. */
export function keepCount(counts: readonly number[], picked: number | null): number {
  if (picked !== null && counts.includes(picked)) return picked;
  return counts[0] ?? 0;
}

/** One step through the offered counts (the stepper's − / +). */
export function stepCount(counts: readonly number[], current: number, delta: -1 | 1): number {
  const i = counts.indexOf(current);
  const next = counts[Math.max(0, Math.min(counts.length - 1, (i < 0 ? 0 : i) + delta))];
  return next ?? current;
}

/** "1 HP", "no damage". */
export function hpWords(hp: number): string {
  return hp <= 0 ? "no damage" : `${hp} HP`;
}

/** The hit's question: "Mark an Armor Slot to drop it to Minor?" (Main), or why there is none. */
export function armorAsk(view: HitView, mode: HitWindowMode, slots: number): { lead: string; result: string | null; tail: string } {
  if (mode === "ok") return { lead: view.direct ? "Direct damage: Armor Slots can't reduce it." : "No Armor Slot left to mark.", result: null, tail: "" };
  if (mode === "afterArmor") return { lead: "Armor answered. Use another reaction that fits now, in any order, or Done.", result: null, tail: "" };
  const step = stepFor(view, slots);
  const what = slots === 1 ? "an Armor Slot" : `${slots} Armor Slots`;
  if (!step) return { lead: `Mark ${what}?`, result: null, tail: "" };
  if (step.severity === "none") return { lead: `Mark ${what} to take `, result: "no damage", tail: "?" };
  return { lead: `Mark ${what} to drop it to `, result: SEVERITY_LABEL[step.severity], tail: "?" };
}

export type Track = { marked: number; max: number };

/** One preview row: pips left now and after, and the text "2 → 3 of 6 marked". */
export type PreviewRow = { kind: "hp" | "armor"; label: string; before: number; after: number; max: number; text: string; aria: string };

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n));
}

/**
 * HP and Armor before → after for `slots` marked (0: take the hit as it is). Pips show HP / slots left (answer 2); the
 * text says what is marked. Armor's row only while marking is on offer.
 */
export function previewRows(view: HitView, mode: HitWindowMode, slots: number, trackers: { hp: Track; armor: Track } | null): PreviewRow[] {
  if (trackers === null) return [];
  const step = offersArmor(mode) ? stepFor(view, slots) : stepFor(view, 0);
  const hp = step?.hp ?? baseStep(view).hp;
  const rows: PreviewRow[] = [];
  const hpAfter = clamp(trackers.hp.marked + hp, trackers.hp.max);
  rows.push({
    kind: "hp",
    label: "HP",
    before: trackers.hp.marked,
    after: hpAfter,
    max: trackers.hp.max,
    text: `${trackers.hp.marked} → ${hpAfter} of ${trackers.hp.max} marked`,
    aria: `Hit Points: ${trackers.hp.marked} of ${trackers.hp.max} marked now, ${hpAfter} after`,
  });
  if (offersArmor(mode)) {
    const armorAfter = clamp(trackers.armor.marked + slots, trackers.armor.max);
    rows.push({
      kind: "armor",
      label: "Armor",
      before: trackers.armor.marked,
      after: armorAfter,
      max: trackers.armor.max,
      text: `${trackers.armor.marked} → ${armorAfter} of ${trackers.armor.max} marked`,
      aria: `Armor Slots: ${trackers.armor.marked} of ${trackers.armor.max} marked now, ${armorAfter} after`,
    });
  }
  return rows;
}

/** "Take 2 HP" / "Take no damage" (the hit as it is, `noArmor`). */
export function takeLabel(view: HitView): string {
  const { hp } = baseStep(view);
  return hp <= 0 ? "Take no damage" : `Take ${hp} HP`;
}

/** "Mark Armor · take 1 HP"; with several slots "Mark 2 Armor · take no damage". */
export function markLabel(view: HitView, slots: number): string {
  const step = stepFor(view, slots);
  const what = slots === 1 ? "Mark Armor" : `Mark ${slots} Armor`;
  return step ? `${what} · take ${hpWords(step.hp)}` : what;
}

/** The engine grants' nouns for the stepper ("Hope to spend"); an unknown grant gets a plain "How many". */
const GRANT_UNIT: Record<string, { label: string; spend: (n: number) => string }> = {
  hope: { label: "Hope to spend", spend: (n) => `Spend ${n} Hope` },
  gold: { label: "Handfuls of gold to spend", spend: (n) => `Spend ${n} ${n === 1 ? "handful" : "handfuls"} of gold` },
};

export function grantUnit(grant: Pick<GrantView, "id">): { label: string; spend: (n: number) => string } {
  return GRANT_UNIT[grant.id] ?? { label: "How many", spend: (n) => `Spend ${n}` };
}

/** "up to 2": the most the engine lets this grant take. */
export function grantNote(grant: Pick<GrantView, "amount">): string {
  return `up to ${Math.max(1, Math.trunc(grant.amount ?? 1))}`;
}

/** The picked grant kept on offer (the first when the pick left the list). */
export function keepGrant(grants: readonly GrantView[], picked: string | null): GrantView | null {
  return grants.find((g) => g.id === picked) ?? grants[0] ?? null;
}

/** The first owed hit (oldest first), the rest's count, and the hits waiting on others. */
export function splitViews(views: readonly HitView[]): { first: HitView | null; more: number; waiting: HitView[] } {
  const owed = views.filter((v) => v.awaiting).sort((a, b) => a.createdAt - b.createdAt);
  return { first: owed[0] ?? null, more: Math.max(0, owed.length - 1), waiting: views.filter((v) => !v.awaiting) };
}
