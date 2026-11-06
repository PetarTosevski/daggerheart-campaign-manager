/**
 * House rules, the rule rows' pure helpers (plan rule-switches RU): which rows a frame lists and in what order, the
 * page tags, the current mode as text, which rules the engine follows yet, and the optimistic update on
 * `ruleSettings.get`. The registry (`src/lib/rules`) is the only source of rules, modes and pages.
 * Unit tests: tests/unit/config/rule-switches.test.tsx.
 */
import type { FrameId } from "@/lib/frames";
import {
  isChoiceRule,
  isSwitchRule,
  isToggleRule,
  ruleBlockedBy,
  rulesFor,
  RULES,
  type Book,
  type BookRef,
  type RuleArea,
  type RuleDef,
  type RuleModes,
} from "@/lib/rules";

/** The board's text for the rule rows. */
export const RULE_ROWS_TEXT = {
  label: "Rules the app applies",
  intro: "Book follows the rulebook. Manual stops the app applying a rule and leaves you a note in the feed instead.",
  playerIntro: "How the app applies the rules in this campaign. Your GM sets them between sessions.",
  locked: "Rule switches change between sessions. End the session to change them.",
  notInBooks: "not in the books",
  optional: "Optional rule",
  book: "Book",
  on: "On",
  off: "Off",
  comingSoon: "Coming soon: the app doesn't follow this switch yet.",
  blocked: "Needs the death move prompt",
  loading: "Loading …",
  failed: "The rule switches could not load.",
  less: "one less",
  more: "one more",
} as const;

export const BOOK_NAME: Record<Book, string> = { CB: "Core Rulebook", HF: "Hope & Fear" };

/** The 13 areas of the registry list, then the optional rules first (plan RU acceptance). */
export const AREA_LABEL: Record<RuleArea, string> = {
  optional: "Optional rules",
  rolls: "Rolls & dice",
  hopeFear: "Hope & Fear",
  damage: "Damage & thresholds",
  armor: "Armor",
  conditions: "Conditions",
  rests: "Rests & downtime",
  death: "Death & revival",
  spotlight: "Spotlight & turns",
  map: "Range, sight & movement",
  levelUp: "Level-up & advancement",
  countdowns: "Countdowns",
  adversaries: "Adversaries & environments",
  frame: "Frame rules",
};

const AREA_ORDER: readonly RuleArea[] = [
  "optional",
  "rolls",
  "hopeFear",
  "damage",
  "armor",
  "conditions",
  "rests",
  "death",
  "spotlight",
  "map",
  "levelUp",
  "countdowns",
  "adversaries",
  "frame",
];

/**
 * The settable rules whose engine wiring is merged into `rebuild`: only these get a control. Every other settable rule
 * shows its mode read-only with "Coming soon", because the engine would still play it by the book whatever the GM
 * picked. Each rule tracer adds its ids here when it merges (orchestrator): RR (F2, T2, T4), RF (W2, W4–W7), RW (W1).
 */
export const WIRED_RULES: ReadonlySet<string> = new Set([
  "fearFromRests",
  "shortRestLimit",
  "interruptedRest",
  "witherTokens",
  "horizonSanctuaryRest",
  "beastFeastFeast",
  "colossusSiphoning",
  "umbraLurkingDarkness",
  "andaluriaLycanthropy",
  // RA, RDM, RK, RX, OH (merged 2026-11-05/06).
  "hopeFearFromRolls",
  "spotlightToGm",
  "resistance",
  "stressOverflow",
  "fullStressVulnerable",
  "adversaryDefeated",
  "extraSpotlightFear",
  "massiveDamage",
  "countdownTicks",
  "deathMovePrompt",
  "deathMoveResolve",
  "horizonEncounterBonuses",
  // RM, RT, OSC, RC1, RC2 (merged 2026-11-06).
  "hiddenEnds",
  "wallsBlock",
  "darkness",
  "spotlightTracker",
  "spotlightTrackerTokens",
  "goldCoins",
  "sharedDomainCards",
  "conditionDice",
  "lineOfSight",
  "minions",
  "armorSlots",
  // OFT (2026-11-06).
  "fateRolls",
  "definedRanges",
  "fallingDamage",
  // OE (2026-11-06).
  "underwater",
  // RS2 (2026-11-06).
  "playersWait",
]);

export type RuleGroup = { area: RuleArea; label: string; rules: readonly RuleDef[] };

/**
 * The rows House rules lists for a frame: the registry's rules of that frame, by area (Optional rules first, then the
 * 13 areas), in each area the rules with a choice first and the Book-only rows after them, otherwise in registry order.
 */
export function ruleGroups(frameId: FrameId): RuleGroup[] {
  const rules = rulesFor(frameId);
  return AREA_ORDER.flatMap((area) => {
    const inArea = rules.filter((r) => r.area === area);
    const sorted = [...inArea.filter((r) => r.kind !== "bookOnly"), ...inArea.filter((r) => r.kind === "bookOnly")];
    return sorted.length > 0 ? [{ area, label: AREA_LABEL[area], rules: sorted }] : [];
  });
}

/** 'Core Rulebook p.90, p.154' / 'Hope & Fear p.176'; two books are joined with ' · '. */
export function pageTag(refs: readonly BookRef[]): string {
  const byBook = new Map<Book, number[]>();
  for (const ref of refs) byBook.set(ref.book, [...(byBook.get(ref.book) ?? []), ref.page]);
  return [...byBook].map(([book, pages]) => `${BOOK_NAME[book]} ${pages.map((p) => `p.${p}`).join(", ")}`).join(" · ");
}

/** The grey line under a row's text: 'Core Rulebook p.105', 'Optional rule · Core Rulebook p.91', 'Book · Core Rulebook p.90'. */
export function ruleTag(rule: RuleDef): string {
  if (rule.kind === "optional") return `${RULE_ROWS_TEXT.optional} · ${pageTag(rule.refs)}`;
  if (rule.kind === "bookOnly") return `${RULE_ROWS_TEXT.book} · ${pageTag(rule.refs)}`;
  return pageTag(rule.refs);
}

const modesRecord = (modes: RuleModes) => modes as unknown as Record<string, string | boolean | number>;

/** The rule's current mode as text ('Book', 'Manual', 'Extended downtime (several days)', 'On', 'Warn'). */
export function modeText(rule: RuleDef, modes: RuleModes): string {
  const value = modesRecord(modes)[rule.id];
  if (isSwitchRule(rule)) return rule.modes.find((m) => m.id === value)?.label ?? RULE_ROWS_TEXT.book;
  if (isChoiceRule(rule)) return rule.choices.find((c) => c.id === value)?.label ?? String(value);
  if (isToggleRule(rule)) return value === true ? RULE_ROWS_TEXT.on : RULE_ROWS_TEXT.off;
  return RULE_ROWS_TEXT.book;
}

/** Whether the rule's current mode is a variant the books don't print (shown 'not in the books' beside the mode text). */
export function modeNotInBooks(rule: RuleDef, modes: RuleModes): boolean {
  const value = modesRecord(modes)[rule.id];
  const list = isSwitchRule(rule) ? rule.modes : isChoiceRule(rule) ? rule.choices : [];
  return list.some((m) => m.id === value && m.notInBooks);
}

/** Whether the rule's mode is not the default (a switch off Book, an optional rule off its default). */
export function isChanged(rule: RuleDef, modes: RuleModes): boolean {
  const value = modesRecord(modes)[rule.id];
  if (isSwitchRule(rule)) return value !== "book";
  if (rule.kind === "optional") return value !== rule.default;
  return false;
}

/** The number a rule's row sets (Spotlight Tracker tokens, the darkness Difficulty), when the row shows it. */
export function shownParam(rule: RuleDef, modes: RuleModes): { key: string; label: string; min: number; max?: number; value: number } | null {
  if (!(isSwitchRule(rule) || isToggleRule(rule)) || rule.param === undefined) return null;
  const value = modesRecord(modes)[rule.id];
  const shown = isToggleRule(rule) ? value === true : value !== "book" && value !== "manual" && value !== "disadvantage";
  if (!shown) return null;
  const p = rule.param;
  return { key: p.key, label: p.label, min: p.min, ...(p.max !== undefined ? { max: p.max } : {}), value: Number(modesRecord(modes)[p.key]) };
}

/** Why a settable rule's row has no control for a GM who can edit: not wired yet, or X2 while X1 is Manual. */
export function readOnlyReason(rule: RuleDef, modes: RuleModes): string | null {
  if (rule.kind === "bookOnly") return null;
  if (!WIRED_RULES.has(rule.id)) return RULE_ROWS_TEXT.comingSoon;
  if (ruleBlockedBy(rule, modes) !== null) return RULE_ROWS_TEXT.blocked;
  return null;
}

export type RuleSettingsView = { modes: RuleModes; locked: boolean; canEdit: boolean };
export type RuleChangeIntent = { key: string; value: string | boolean | number };

/**
 * `ruleSettings.get` after one change, as the server will resolve it: the field takes the value, and a rule that needs
 * it (X2 needs X1) turns Manual with it. Going back from Manual leaves the dependant to the server's answer.
 */
export function applyRuleChange<V extends RuleSettingsView>(view: V, change: RuleChangeIntent): V {
  const modes: Record<string, string | boolean | number> = { ...modesRecord(view.modes), [change.key]: change.value };
  if (change.value === "manual") {
    for (const r of RULES as readonly RuleDef[]) if (isSwitchRule(r) && r.needs === change.key) modes[r.id] = "manual";
  }
  return { ...view, modes: modes as unknown as RuleModes };
}
