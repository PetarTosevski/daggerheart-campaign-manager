/**
 * The GM request queue's pure parts (plan combat-hud H5.1; boards GMDesktop 'Requests', CmpPromptsGM): one list of
 * everything that waits on the GM, merged on the client from the existing reads, and the Resolutions rows. No React, no
 * Convex calls. Unit tests: tests/unit/hud/queue-model.test.tsx.
 *
 * ```ts
 * queueItems({ attacks, cards, features, difficulties, windows, cloaks, keywords, allyRolls, gmPrompts }); // oldest first
 * resolutionRows(feedPage);                                                                     // newest first, 8
 * isAlreadyAnswered(e);                                                                         // REQUEST_NOT_OPEN etc.
 * ```
 * (`errorCode` lives in src/lib/lorekeeper/answer-model.ts, shared with the phone app.)
 *
 * Answer 7a: no Momentum prompt (its Fear is automatic, the adversary's row in Resolutions carries it, with Undo).
 * Answer 14a: no Hope split. Every item is a request the engine already stores; nothing here invents one.
 */

import { errorCode } from "@/lib/lorekeeper/answer-model";

import { myPicks, type MyPick, type PickRow } from "../ally-picks/model";

/** The five Defined Range bands (CB p.103), as the server's `outOfRange` rows name them. */
export type Band = "melee" | "veryClose" | "close" | "far" | "veryFar";

export const BAND_TEXT: Record<Band, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };

type Named = { tokenId: string; name: string };
type OutOfRange = { tokenId: string; band: Band };

/** `combatRequestsReads.mine` (kind `sanction`), `combatCardsReads.pending`, `combatFeaturesReads.pending`: names and bands only. */
export type AttackSanction = { requestId: string; characterName: string; createdAt: number; targets: Named[]; outOfRange: OutOfRange[] };
export type CardSanction = AttackSanction & { cardName: string };
export type FeatureSanction = AttackSanction & { featureName: string };
/** `combatRequestsReads.difficulties`. */
export type DifficultyAsk = { requestId: string; characterName: string; createdAt: number; ask: "charge" | "cloak"; target: Named | null; seers: Named[] };
/** `adversaryActionsReads.windows`. */
export type ReactionWindow = {
  requestId: string;
  attackerLabel: string;
  feature?: string;
  targetName: string;
  damage: number;
  damageType: "physical" | "magic" | "both";
  direct: boolean;
  critical: boolean;
  awaiting: { name: string; role: "target" | "ally" }[];
  createdAt: number;
  afterHit?: boolean;
  preRoll?: boolean;
};
/** `cloakPromptsReads.pending`. */
export type CloakAsk = { requestId: string; characterName: string; label: string; targets: Named[]; createdAt: number };
/** `hitKeywordsReads.asks`. */
export type KeywordAsk = {
  requestId: string;
  attackerLabel: string;
  feature?: string;
  targetName: string;
  keyword: "fire";
  guard: string;
  question: string;
  damage: number;
  damageType: "physical" | "magic" | "both";
  createdAt: number;
};
/** `featurePromptsReads.allyRolls`'s `pending` (the GM's list). */
export type AllyRollAsk = { requestId: string; characterName: string; rollerName: string; featureName: string; createdAt: number };

/**
 * `adversaryPromptsReads.pending` (dcm-bxp.99.32.27): one stored GM prompt of an adversary feature use, the step the GM
 * applies by hand (summon the Lackeys, tick a countdown, a PC's save, ...).
 */
export type GmPromptAsk = {
  requestId: string;
  instanceLabel: string;
  feature: string;
  prompt: "manual" | "move" | "pcSave" | "summon" | "countdown" | "spotlight" | "choice";
  text: string;
  createdAt: number;
};

/** One queue card. `kind` picks the card and the keyed mutation that answers it. */
export type QueueItem =
  | { kind: "attack"; key: string; createdAt: number; row: AttackSanction }
  | { kind: "card"; key: string; createdAt: number; row: CardSanction }
  | { kind: "feature"; key: string; createdAt: number; row: FeatureSanction }
  | { kind: "difficulty"; key: string; createdAt: number; row: DifficultyAsk }
  | { kind: "reactions"; key: string; createdAt: number; row: ReactionWindow }
  | { kind: "cloak"; key: string; createdAt: number; row: CloakAsk }
  | { kind: "keyword"; key: string; createdAt: number; row: KeywordAsk }
  | { kind: "allyRoll"; key: string; createdAt: number; row: AllyRollAsk }
  | { kind: "gmPrompt"; key: string; createdAt: number; row: GmPromptAsk }
  | { kind: "allyPick"; key: string; createdAt: number; row: AllyPickAsk };

/** FH-AP: one outstanding per-ally pick (its request id up front, as every other card's row). */
export type AllyPickAsk = MyPick & { requestId: string };

export type QueueSources = {
  attacks?: readonly AttackSanction[] | undefined;
  cards?: readonly CardSanction[] | undefined;
  features?: readonly FeatureSanction[] | undefined;
  difficulties?: readonly DifficultyAsk[] | undefined;
  windows?: readonly ReactionWindow[] | undefined;
  cloaks?: readonly CloakAsk[] | undefined;
  keywords?: readonly KeywordAsk[] | undefined;
  allyRolls?: readonly AllyRollAsk[] | undefined;
  gmPrompts?: readonly GmPromptAsk[] | undefined;
  /** FH-AP: `allyPicksReads.open` (the GM's): every outstanding per-ally pick, one card each (a no-show's pick). */
  allyPicks?: readonly PickRow[] | undefined;
};

/**
 * Every open request that waits on the GM, oldest first (ties keep the source order). A source still loading
 * (`undefined`) adds nothing; the list fills in as each read arrives. The key is the request id (each request is one
 * kind), so a card keeps its state while others come and go.
 */
export function queueItems(s: QueueSources): QueueItem[] {
  const items: QueueItem[] = [
    ...(s.attacks ?? []).map((row) => ({ kind: "attack" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.cards ?? []).map((row) => ({ kind: "card" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.features ?? []).map((row) => ({ kind: "feature" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.difficulties ?? []).map((row) => ({ kind: "difficulty" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.windows ?? []).map((row) => ({ kind: "reactions" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.cloaks ?? []).map((row) => ({ kind: "cloak" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.keywords ?? []).map((row) => ({ kind: "keyword" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.allyRolls ?? []).map((row) => ({ kind: "allyRoll" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...(s.gmPrompts ?? []).map((row) => ({ kind: "gmPrompt" as const, key: row.requestId, createdAt: row.createdAt, row })),
    ...myPicks(s.allyPicks ?? []).map((pick) => ({ kind: "allyPick" as const, key: pick.key, createdAt: pick.row.createdAt, row: { ...pick, requestId: pick.row.requestId } })),
  ];
  return items.map((item, i) => ({ item, i })).sort((a, b) => a.item.createdAt - b.item.createdAt || a.i - b.i).map(({ item }) => item);
}

/** "the Sniper (Very Far), the Bandit": each target, with its band when it is out of range. */
export function targetsText(targets: readonly Named[], outOfRange: readonly OutOfRange[]): string {
  const bands = new Map(outOfRange.map((o) => [o.tokenId, BAND_TEXT[o.band]]));
  return targets.map((t) => (bands.has(t.tokenId) ? `${t.name} (${bands.get(t.tokenId)})` : t.name)).join(", ");
}

/** "Sniper is Very Far." / "Sniper and Bandit are out of range." — the out-of-range card's body. */
export function outOfRangeReason(targets: readonly Named[], outOfRange: readonly OutOfRange[]): string {
  const far = outOfRange.flatMap((o) => {
    const t = targets.find((x) => x.tokenId === o.tokenId);
    return t ? [{ name: t.name, band: BAND_TEXT[o.band] }] : [];
  });
  if (far.length === 1) return `${far[0]!.name} is ${far[0]!.band}.`;
  if (far.length > 1) return `${far.map((f) => `${f.name} (${f.band})`).join(", ")} are out of range.`;
  return "A target is out of range.";
}

/** The use an out-of-range card names ("Attack", "Vicious Entangle"). */
export function sanctionUse(item: Extract<QueueItem, { kind: "attack" | "card" | "feature" }>): string {
  if (item.kind === "card") return item.row.cardName;
  if (item.kind === "feature") return item.row.featureName;
  return "Attack";
}

/** The roll a Difficulty ask makes (CB p.59 Charge: an Agility Roll; CB p.42 Cloaked: a Finesse Roll). */
export function difficultyRoll(row: Pick<DifficultyAsk, "ask">): string {
  return row.ask === "charge" ? "Agility Roll" : "Finesse Roll";
}

export function difficultyReason(row: Pick<DifficultyAsk, "ask" | "characterName" | "target" | "seers">): string {
  if (row.ask === "charge") return `${row.characterName} charges at ${row.target?.name ?? "a target"}.`;
  const seers = row.seers.map((s) => s.name).join(", ");
  return `${row.characterName} is Cloaked in dim light${seers ? `, seen by ${seers}` : ""}.`;
}

/** The Difficulty the stepper starts at (a starting point the GM steps; not a rule), and its bounds. */
export const DIFFICULTY_START = 12;
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 30;

const DAMAGE_TYPE = { physical: "physical", magic: "magic", both: "physical and magic" } as const;

/** "After the Bandit's attack" / "The Bandit attacks Mira, before the roll". */
export function windowSub(row: Pick<ReactionWindow, "attackerLabel" | "feature" | "targetName" | "preRoll">): string {
  const by = row.feature ? `${row.attackerLabel} (${row.feature})` : row.attackerLabel;
  return row.preRoll ? `${by} attacks ${row.targetName}, before the roll` : `After ${by}’s attack`;
}

/** "Hit Mira: 9 physical damage, critical." (nothing for a held attack: no damage yet). */
export function windowHit(row: Pick<ReactionWindow, "targetName" | "damage" | "damageType" | "direct" | "critical" | "preRoll">): string | null {
  if (row.preRoll) return null;
  return `Hit ${row.targetName}: ${row.damage} ${row.direct ? "direct " : ""}${DAMAGE_TYPE[row.damageType]} damage${row.critical ? ", critical" : ""}.`;
}

/** "Oriel and Vex", "Oriel, Vex and Moss". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Waiting on Oriel and Vex" / "Everyone answered." */
export function windowWaiting(row: Pick<ReactionWindow, "awaiting">): string {
  if (row.awaiting.length === 0) return "Everyone answered.";
  return `Waiting on ${namesText(row.awaiting.map((a) => a.name))}. Their screens show what they can use.`;
}

/** "Words of Discord on the Bandit". */
export function cloakSub(row: Pick<CloakAsk, "label" | "targets">): string {
  const on = row.targets.map((t) => t.name).join(", ");
  return on ? `${row.label} on ${on}` : row.label;
}

const PROMPT_KIND: Record<GmPromptAsk["prompt"], string> = {
  manual: "Apply it by hand",
  move: "Move it",
  pcSave: "A PC rolls to resist",
  summon: "Summon",
  countdown: "Countdown",
  spotlight: "Spotlight",
  choice: "Choose for the feature",
};

/** A GM prompt card's sub line: "Jagged Knife Lieutenant · Summon" (board CmpPromptsGM "Choose for the feature"). */
export function gmPromptSub(row: Pick<GmPromptAsk, "instanceLabel" | "prompt">): string {
  return `${row.instanceLabel} · ${PROMPT_KIND[row.prompt]}`;
}

/** A short name for an item, for "Already answered: …" and the result line. */
export function itemLabel(item: QueueItem): string {
  switch (item.kind) {
    case "attack":
    case "card":
    case "feature":
      return `${item.row.characterName} · ${sanctionUse(item)}`;
    case "difficulty":
      return `${item.row.characterName} · ${difficultyRoll(item.row)}`;
    case "reactions":
      return windowSub(item.row);
    case "cloak":
      return `${item.row.characterName}’s Cloaked`;
    case "keyword":
      return `${item.row.attackerLabel} → ${item.row.targetName}`;
    case "allyRoll":
      return `${item.row.rollerName} · ${item.row.featureName}`;
    case "gmPrompt":
      return `${item.row.instanceLabel} · ${item.row.feature}`;
    case "allyPick":
      return `${item.row.chooser.name} · ${item.row.row.name}`;
  }
}

// ---------------------------------------------------------------- "Waiting on you" arrivals (plan combat-hud H9.2, Q10a)

/** One thing waiting on the GM, as the closed "Waiting on you" button tracks it: its key and the toast's title. */
export type Arrival = { key: string; title: string };

/** The toast's title for a new request: "Vex: out of range", "Brannoc: set the Difficulty" (Q10a, "· Waiting on you"). */
export function arrivalTitle(item: QueueItem): string {
  switch (item.kind) {
    case "attack":
    case "card":
    case "feature":
      return `${item.row.characterName}: out of range`;
    case "difficulty":
      return `${item.row.characterName}: set the Difficulty`;
    case "reactions":
      return `${item.row.attackerLabel} → ${item.row.targetName}: reactions`;
    case "cloak":
      return `${item.row.characterName}: does Cloaked end?`;
    case "keyword":
      return `${item.row.targetName}: ${item.row.question}`;
    case "allyRoll":
      return `${item.row.rollerName}: ally roll`;
    case "gmPrompt":
      return `${item.row.instanceLabel}: ${item.row.feature}`;
    case "allyPick":
      return `${item.row.chooser.name}: ${item.row.row.name} pick`;
  }
}

/** A death move to confirm, as an arrival ("Moss: death move"); keyed on the request so a second one counts as new. */
export function deathArrival(characterId: string, name: string, requestKey: string): Arrival {
  return { key: `death:${characterId}:${requestKey}`, title: `${name}: death move` };
}

/**
 * The arrivals in `now` that `seen` did not have, in `now`'s order. `seen` null (the first loaded read) has nothing new:
 * the requests already open when the GM opens the map count, but do not toast.
 */
export function newArrivals(seen: ReadonlySet<string> | null, now: readonly Arrival[]): Arrival[] {
  if (seen === null) return [];
  return now.filter((a) => !seen.has(a.key));
}

// ---------------------------------------------------------------- withdrawals (dcm-bxp.99.32.40)

/** `combatRequestsReads.withdrawn`: a request its player took back. */
export type Withdrawal = { requestId: string; characterName: string; useName: string; withdrawnAt: number };

/** The GM's toast for a withdrawal: "Vex withdrew Bolt Beacon" (user 2026-11-02). */
export function withdrawalArrival(row: Pick<Withdrawal, "requestId" | "characterName" | "useName">): Arrival {
  return { key: `withdrawn:${row.requestId}`, title: `${row.characterName} withdrew ${row.useName}` };
}

/**
 * A refusal that means someone else already answered (another GM tab, the player's withdraw, the encounter ending):
 * the item shows "Already answered" and drops out instead of an error.
 */
export function isAlreadyAnswered(error: unknown): boolean {
  const code = errorCode(error);
  return code === "REQUEST_NOT_OPEN" || code === "DEATH_MOVE_NOT_WAITING";
}

// ---------------------------------------------------------------- Resolutions

/** Feed rows read for Resolutions (the GM's rows include every roll; the resolutions are picked out of these). */
export const RESOLUTION_SCAN = 40;
/** Resolutions shown. */
export const RESOLUTIONS_SHOWN = 6;

/** A feed row as Resolutions reads it (`feed.list`, the GM's shape). */
export type ResolutionFeedRow = {
  _id: string;
  kind: string;
  visibility: string;
  undone: boolean;
  canUndo: boolean;
  summary?: string;
  roll?: { outcome: string };
  fearDelta?: number;
};

/** A player's duality roll that came up with Fear (a `roll` row, CB p.95: the GM gains a Fear). */
export function isFearRoll(row: Pick<ResolutionFeedRow, "kind" | "roll">): boolean {
  return row.kind === "roll" && (row.roll?.outcome === "successFear" || row.roll?.outcome === "failFear");
}

/**
 * The GM's latest combat resolutions, newest first: a PC's attack or card on the map (`combat`) and an adversary's
 * attack or feature (`adversary`; Momentum's Fear rides on it, answer 7a), the GM's own rows (they carry damage,
 * severity and marks), and every roll with Fear (user answer 2026-11-02, GMDesktop "Vex rolled with Fear · +1 Fear").
 * The classic column's two lists (Resolutions and Adversary actions) in one.
 */
export function resolutionRows<R extends ResolutionFeedRow>(rows: readonly R[], shown = RESOLUTIONS_SHOWN): R[] {
  return rows.filter((r) => ((r.kind === "combat" || r.kind === "adversary") && r.visibility === "gm") || isFearRoll(r)).slice(0, shown);
}

/**
 * A roll with Fear as GMDesktop's Resolutions line: "Vex rolled with Fear" and "+1 Fear" (the Fear it gave; none at 12
 * Fear). The roller's name is the summary's lead ("Vex: Agility action roll 14, …", `dualitySummary`).
 */
export function fearRollLine(row: Pick<ResolutionFeedRow, "summary" | "fearDelta">): { lead: string; fear: string | null } {
  const summary = row.summary ?? "";
  const colon = summary.indexOf(": ");
  const name = colon > 0 ? summary.slice(0, colon) : "A player";
  const fear = row.fearDelta !== undefined && row.fearDelta > 0 ? `+${row.fearDelta} Fear` : null;
  return { lead: `${name} rolled with Fear`, fear };
}
