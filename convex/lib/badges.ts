/**
 * Costs and limits as the drawer's badges ("2 Hope", "Once per rest"). Split out of `./featureDrawer` (which re-exports
 * both, dcm-uh6r) so request views name a use's costs without loading the drawer's SRD tables.
 */
import type { Cost, Limit, NumberSource } from "../../src/lib/domain/card-effects/types";

function amountText(n: NumberSource): string {
  switch (n.kind) {
    case "fixed":
      return String(n.value);
    case "chosen":
      return "any";
    case "spellcast":
      return "Spellcast";
    case "proficiency":
      return "Proficiency";
    case "level":
      return "level";
    case "trait":
      return n.trait;
    default:
      return "X";
  }
}

const POOL_WORD: Record<string, string> = { card: "token", favor: "Favor", focus: "Focus", rally: "Rally Die", prayer: "Prayer Die", patron: "Patron Die", slayer: "Slayer Die", combo: "Combo die" };

/** One cost as a badge. */
export function costText(c: Cost): string {
  switch (c.kind) {
    case "hope":
      return `${amountText(c.amount)} Hope`;
    case "stress":
      return `${amountText(c.amount)} Stress`;
    case "hp":
      return `${amountText(c.amount)} HP`;
    case "armor":
      return `${amountText(c.amount)} Armor Slot`;
    case "tokens":
      return `${amountText(c.amount)} ${POOL_WORD[c.pool ?? "card"] ?? "token"}`;
    case "fear":
      return `${amountText(c.amount)} Fear`;
    case "gold":
      return `${c.handfuls} handfuls of gold`;
    case "either":
      return c.options.map((o) => o.map(costText).join(" + ")).join(" or ");
  }
}

const PER_WORD: Record<Limit["per"], string> = { rest: "rest", longRest: "long rest", session: "session", scene: "scene" };

/** A limit as a badge. */
export function limitText(l: Limit): string {
  const times = l.times ?? 1;
  const count = times === 1 ? "Once" : times === 2 ? "Twice" : `${times} times`;
  const on = l.consumedOn === "success" ? " on a success" : l.consumedOn === "failure" ? " on a failure" : "";
  return `${count} per ${PER_WORD[l.per]}${on}${l.perTarget ? " per target" : ""}`;
}
