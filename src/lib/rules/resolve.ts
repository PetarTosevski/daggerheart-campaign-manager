/**
 * A campaign's rule modes, resolved (plan rule-switches RS0). Pure: bundled into Convex and the client.
 *
 * - An unset switch rule is `book`; an unset optional rule is its `default` (off, except Defined Ranges; Shared domain
 *   cards: `warn`); an unset number is its `default`.
 * - A rule of another frame is always `book` / its default, whatever is stored (the frame doesn't have it).
 * - A rule that `needs` another (X2 needs X1) is `manual` while that one is `manual`.
 * - A stored value the registry no longer knows (a dropped variant) falls back as if unset.
 */
import type { FrameId } from "../frames/index";
import {
  isChoiceRule,
  isSwitchRule,
  isToggleRule,
  RULES,
  ruleInFrame,
  type RuleDef,
  type RuleModes,
  type StoredRuleModes,
} from "./registry";

type Mutable = Record<string, string | boolean | number>;

function storedValue(stored: StoredRuleModes | null | undefined, key: string): unknown {
  return stored ? (stored as Record<string, unknown>)[key] : undefined;
}

/** Whether `value` is a legal value of the rule's field. */
export function isRuleValue(rule: RuleDef, value: unknown): boolean {
  if (isSwitchRule(rule)) return rule.modes.some((m) => m.id === value);
  if (isChoiceRule(rule)) return rule.choices.some((c) => c.id === value);
  if (isToggleRule(rule)) return typeof value === "boolean";
  return false;
}

/** Every rule's mode for a campaign of `frameId` with `stored` modes. */
export function resolveRuleModes(frameId: FrameId, stored: StoredRuleModes | null | undefined): RuleModes {
  const out: Mutable = {};
  for (const rule of RULES as readonly RuleDef[]) {
    if (rule.kind === "bookOnly") continue;
    const inFrame = ruleInFrame(rule, frameId);
    const value = storedValue(stored, rule.id);
    const fallback = isSwitchRule(rule) ? "book" : rule.default;
    out[rule.id] = inFrame && isRuleValue(rule, value) ? (value as string | boolean) : fallback;
    if ((isSwitchRule(rule) || isToggleRule(rule)) && rule.param) {
      const p = rule.param;
      const n = storedValue(stored, p.key);
      out[p.key] = inFrame && typeof n === "number" && Number.isInteger(n) && n >= p.min && n <= p.max ? n : p.default;
    }
  }
  for (const rule of RULES as readonly RuleDef[]) {
    if (isSwitchRule(rule) && rule.needs !== undefined && out[rule.needs] === "manual") out[rule.id] = "manual";
  }
  return out as unknown as RuleModes;
}

/** Whether a rule's row is read-only because the rule it needs is Manual (X2 while X1 is Manual, Q8 a). */
export function ruleBlockedBy(rule: RuleDef, modes: RuleModes): string | null {
  if (!isSwitchRule(rule) || rule.needs === undefined) return null;
  return (modes as unknown as Mutable)[rule.needs] === "manual" ? rule.needs : null;
}

