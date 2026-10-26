/**
 * A domain card use's arguments (plan combat-actions, tracers CA4 / CA4b; docs/tasks/TASK-CA-CA4.md, TASK-CA-CA4b.md):
 * the roll options and the player's choices as `combatCards.useCard` and the GM's card sanction take them, parsed into
 * the runner's shape, and the dice kept for a choice made after the roll.
 *
 * Kept dice (CA4b, orchestrator decision): a use that comes back `needsChoice` after its roll (a `choose` step gated on
 * the roll's success, a damage split) keeps the dice it rolled, so the call that sends the choice resolves with the same
 * dice and the player can't fish for a better roll by asking again. They are kept per character, card and use (whoever
 * sends the next use of that card, the player or the GM playing for them, gets them) in an `operations` row of the
 * campaign's own `cardDice` scope (never a client idempotency scope, so no client key can collide), for
 * `KEPT_DICE_MS`; the use that resolves drops them. The rows are swept with every other operations row after 7 days
 * (convex/cleanup.ts). Nothing of them reaches the client.
 */
import { v, type Infer } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ScopeKey } from "./operations";
import { cardChoiceValidator } from "./validators/combatRequests";
import { traitIdValidator } from "./validators/characters";

/** The most targets (and picked, allies, follow-up creatures) one card use names (bounded sanctions, CD8). */
export const MAX_CARD_TARGETS = 20;
/** The most choice entries one use sends. */
export const MAX_CARD_CHOICES = 40;

// ---------------------------------------------------------------- validators

/** The card roll's dialog options: a subset of the sanction's stored roll options (AA0), replayed on approval. */
export const cardRollValidator = v.object({
  /** A trait-roll card that names several traits ("an Agility or Strength Roll"), or a "choice" weapon's trait. */
  trait: v.optional(traitIdValidator),
  modifier: v.optional(v.number()),
  /** The GM's Difficulty for a card with no number (`difficulty: gm`, CB p.157). */
  difficulty: v.optional(v.number()),
  /** Experiences used (1 Hope each, CB p.90). */
  experienceIds: v.optional(v.array(v.string())),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  help: v.optional(v.number()),
});
export type CardRoll = Infer<typeof cardRollValidator>;

export const cardChoicesValidator = v.array(cardChoiceValidator);
export type CardChoice = Infer<typeof cardChoiceValidator>;

// ---------------------------------------------------------------- choices

/** The player's picks, parsed from the flat `{id, value}` list the sanction stores (AA0's `cardChoiceValidator`). */
export type ParsedChoices = {
  numbers: Record<string, number>;
  options: Record<string, string[]>;
  optionals: Set<string>;
  /** `optional:<id>` sent as false: an optional the server would take by default (Banish) is left out. */
  declined: Set<string>;
  either: number[];
  splits: Record<string, number>;
  situations: string[];
  picked: string[];
  allies: string[];
  followUp: string[];
  triggerSource?: string;
  triggerSubject?: string;
  triggerAmount?: number;
  weapon?: "primary" | "secondary";
};

const invalid = (what: string) => appError("INVALID", what);

function asNumber(c: CardChoice): number {
  if (typeof c.value !== "number" || !Number.isFinite(c.value)) throw invalid(`${c.id} needs a number.`);
  return c.value;
}
function asList(c: CardChoice): string[] {
  if (typeof c.value === "string") return [c.value];
  if (!Array.isArray(c.value) || c.value.length > MAX_CARD_TARGETS) throw invalid(`${c.id} needs a list.`);
  return c.value;
}
function asText(c: CardChoice): string {
  if (typeof c.value !== "string") throw invalid(`${c.id} needs a value.`);
  return c.value;
}

/**
 * Reads the choice list. Ids: `n:<choice>` (a NumberChoice), `opt:<step>` (options of a choose step), `optional:<step>`
 * (true / false), `either:<i>` (the option index of the i-th "either" cost), `split:<tokenId>` (a share), `situations`,
 * `picked`, `allies`, `followUp` (token ids), `triggerSource`, `triggerSubject` (a token id), `triggerAmount`, `weapon`.
 */
export function parseChoices(list: readonly CardChoice[]): ParsedChoices {
  if (list.length > MAX_CARD_CHOICES) throw invalid("Too many choices.");
  const out: ParsedChoices = { numbers: {}, options: {}, optionals: new Set(), declined: new Set(), either: [], splits: {}, situations: [], picked: [], allies: [], followUp: [] };
  for (const c of list) {
    const [head, ...rest] = c.id.split(":");
    const tail = rest.join(":");
    switch (head) {
      case "n":
        out.numbers[tail] = asNumber(c);
        break;
      case "opt":
        out.options[tail] = asList(c);
        break;
      case "optional":
        if (typeof c.value !== "boolean") throw invalid(`${c.id} needs true or false.`);
        (c.value ? out.optionals : out.declined).add(tail);
        break;
      case "either": {
        const index = Number(tail);
        if (!Number.isInteger(index) || index < 0 || index > 10) throw invalid(`${c.id} is not a cost.`);
        out.either[index] = asNumber(c);
        break;
      }
      case "split":
        out.splits[tail] = asNumber(c);
        break;
      case "situations":
        out.situations = asList(c);
        break;
      case "picked":
      case "allies":
      case "followUp":
        out[head] = asList(c);
        break;
      case "triggerSource":
      case "triggerSubject":
        out[head] = asText(c);
        break;
      case "triggerAmount":
        out.triggerAmount = asNumber(c);
        break;
      case "weapon": {
        const w = asText(c);
        if (w !== "primary" && w !== "secondary") throw invalid("Pick the primary or secondary weapon.");
        out.weapon = w;
        break;
      }
      default:
        throw invalid(`Unknown choice ${c.id}.`);
    }
  }
  for (let i = 0; i < out.either.length; i++) out.either[i] ??= 0;
  return out;
}

/** Optional steps taken unless the player declines them (task doc "Notes for CA4": Banish, Sigil of Retribution's strike). */
export const DEFAULT_OPTIONALS: Readonly<Record<string, readonly string[]>> = { banish: ["banish"] };

// ---------------------------------------------------------------- kept dice

/** How long a use's dice wait for its choice. */
export const KEPT_DICE_MS = 15 * 60_000;
/** The most die values kept (a use rolls a few dozen at most). */
const KEPT_DICE_MAX = 200;
const KEPT_DICE_KIND = "card_dice";

/** The campaign's own scope for kept dice: `campaign:<id>:cardDice`, never equal to a client idempotency scope. */
const diceScope = (campaignId: Id<"campaigns">): ScopeKey => `campaign:${campaignId}:cardDice`;

export type DiceSlot = { campaignId: Id<"campaigns">; characterId: Id<"characters">; cardId: string; useId: string };

const diceKey = (slot: DiceSlot) => `${slot.characterId}:${slot.cardId}:${slot.useId}`;

async function diceRow(ctx: QueryCtx, slot: DiceSlot) {
  return ctx.db
    .query("operations")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", diceScope(slot.campaignId)).eq("idempotencyKey", diceKey(slot)))
    .unique();
}

function valuesOf(result: unknown): number[] | null {
  if (result === null || typeof result !== "object" || !Array.isArray((result as { values?: unknown }).values)) return null;
  const values = (result as { values: unknown[] }).values;
  return values.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1) ? (values as number[]) : null;
}

/** The dice kept for this card use, or null (none, or older than `KEPT_DICE_MS`). */
export async function keptDice(ctx: QueryCtx, slot: DiceSlot, now = Date.now()): Promise<number[] | null> {
  const row = await diceRow(ctx, slot);
  if (row === null || row.kind !== KEPT_DICE_KIND || now - row.createdAt > KEPT_DICE_MS) return null;
  return valuesOf(row.result);
}

/** Keeps the dice a use rolled until its choice comes (replaces older ones; the time runs from the first roll). */
export async function keepDice(ctx: MutationCtx, slot: DiceSlot, values: readonly number[], userId: Id<"users">): Promise<void> {
  const row = await diceRow(ctx, slot);
  const result = { values: values.slice(0, KEPT_DICE_MAX) };
  const fresh = row !== null && row.kind === KEPT_DICE_KIND && Date.now() - row.createdAt <= KEPT_DICE_MS;
  if (row !== null && fresh) {
    await ctx.db.patch("operations", row._id, { result });
    return;
  }
  if (row !== null) await ctx.db.delete("operations", row._id);
  await ctx.db.insert("operations", {
    scopeKey: diceScope(slot.campaignId),
    idempotencyKey: diceKey(slot),
    kind: KEPT_DICE_KIND,
    requestHash: "",
    result,
    campaignId: slot.campaignId,
    createdBy: userId,
    createdAt: Date.now(),
  });
}

/** Drops the kept dice once the use resolved. */
export async function dropDice(ctx: MutationCtx, slot: DiceSlot): Promise<void> {
  const row = await diceRow(ctx, slot);
  if (row !== null) await ctx.db.delete("operations", row._id);
}
