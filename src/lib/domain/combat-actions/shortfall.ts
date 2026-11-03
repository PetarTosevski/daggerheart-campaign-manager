import type { Cost } from "../card-effects/types";

/**
 * What a cost refusal is short of (plan combat-hud H6.1; board CmpBlocked "Messages read the shortfall from the refusal
 * (resource and amount)"). Pure and framework-free: the HUD's refusal table (src/lib/errors/refusals.ts) and every
 * before-the-click lock read it.
 *
 * Two sources, in this order:
 * 1. the server's structured shortfall on the refusal (bead dcm-bxp.99.32.2, not built yet: `AppError` widened with an
 *    optional `shortfall: { resource, need, have }`); `readShortfall` reads it when present and tolerates its absence;
 * 2. this module's client pre-compute (`shortfallOf`) from the use's SRD costs and the payer's sheet, wherever the
 *    cost is known client side (Hope, Stress, Armor Slots, tokens, Fear).
 * Today's servers send only `"Short of: hope, stress."`: `shortResourcesFromText` reads the resources (no numbers).
 *
 * Never an enemy's numbers (HANDOFF hard rule 2): a shortfall paid by an adversary loses its numbers for a player
 * (`visibleShortfall`), so a player can at most learn "not enough Stress", never how much an adversary has.
 */

/** The resources a cost can be short of (PaidCost's, plus the pooled tokens SD0 names). */
export type ShortResource = "hope" | "stress" | "hp" | "armor" | "tokens" | "fear" | "gold" | "favor" | "focus";

export const SHORT_RESOURCES: readonly ShortResource[] = ["hope", "stress", "hp", "armor", "tokens", "fear", "gold", "favor", "focus"];

/**
 * One resource a use is short of. `need` is the amount the use takes, `have` what the payer can still give: Hope /
 * tokens / Fear / gold held, or for a track (Stress, HP, Armor Slots) the slots still free to mark. `null` numbers mean
 * "unknown or hidden": the text then names the resource only.
 */
export type Shortfall = {
  resource: ShortResource;
  need: number | null;
  have: number | null;
  /** Who pays: the acting PC (default), another PC (Rune Ward's holder), the GM (Fear) or an adversary (GM side). */
  payer?: "pc" | "gm" | "adversary";
};

/** Who reads the text: a player never sees an adversary's numbers. */
export type ShortfallViewer = "player" | "gm";

const isResource = (r: unknown): r is ShortResource => typeof r === "string" && (SHORT_RESOURCES as readonly string[]).includes(r);
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * The structured shortfall of a refusal's data (`ConvexError.data`), in bead dcm-bxp.99.32.2's planned shape
 * `{ code, message?, shortfall?: { resource, need, have } }` (also accepted: an array of them). Anything malformed is
 * dropped. Empty when the server sent none (today: always).
 */
export function readShortfall(data: unknown): Shortfall[] {
  if (typeof data !== "object" || data === null) return [];
  const raw = (data as { shortfall?: unknown }).shortfall;
  const list: unknown[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: Shortfall[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { resource, need, have, payer } = item as Record<string, unknown>;
    if (!isResource(resource)) continue;
    out.push({
      resource,
      need: isCount(need) ? need : null,
      have: isCount(have) ? have : null,
      ...(payer === "pc" || payer === "gm" || payer === "adversary" ? { payer } : {}),
    });
  }
  return out;
}

/**
 * The resources today's cost refusals name in their message (`"Short of: hope, stress."` from cardRunner /
 * featureRunner / incomingHits; `"Short of: 2 Hope (Moss)."` from featurePrompts), without numbers. Empty for any
 * other text.
 */
export function shortResourcesFromText(message: string | null | undefined): Shortfall[] {
  const m = /^Short of:\s*(.+?)\.?$/i.exec(message?.trim() ?? "");
  if (!m) return [];
  const out: Shortfall[] = [];
  for (const part of m[1]!.split(",")) {
    const word = part.toLowerCase().match(/[a-z]+/g)?.find(isResource);
    if (word && !out.some((s) => s.resource === word)) out.push({ resource: word, need: null, have: null });
  }
  return out;
}

/**
 * What a payer can still give, per resource; a resource left out is not checked. Tracks are "free slots": Stress free =
 * Stress max - marked. H3.4 leaves Stress and Armor unlocked on purpose (the ring: "Stress past full marks a Hit
 * Point"); pass them only where a surface locks on them (see QUESTIONS in docs/tasks/TASK-HUD-H6.1.md).
 */
export type PayerRoom = Partial<Record<ShortResource, number>>;

/** The fixed amount of a cost, or null when it is chosen, rolled or depends on the sheet (the server checks those). */
function fixed(cost: { amount: { kind: string; value?: number } }): number | null {
  return cost.amount.kind === "fixed" && typeof cost.amount.value === "number" ? cost.amount.value : null;
}

/** The fixed amounts a cost list takes, per resource; an `either` counts only when every option is short (see below). */
function totals(costs: readonly Cost[]): Map<ShortResource, number> {
  const sum = new Map<ShortResource, number>();
  const add = (r: ShortResource, n: number) => sum.set(r, (sum.get(r) ?? 0) + n);
  for (const cost of costs) {
    if (cost.kind === "either") continue;
    if (cost.kind === "gold") {
      add("gold", cost.handfuls);
      continue;
    }
    const n = fixed(cost);
    if (n === null || n <= 0) continue;
    if (cost.kind === "tokens") add(cost.pool === "favor" ? "favor" : cost.pool === "focus" ? "focus" : "tokens", n);
    else add(cost.kind, n);
  }
  return sum;
}

function shortOf(sum: Map<ShortResource, number>, room: PayerRoom): Shortfall[] {
  const out: Shortfall[] = [];
  for (const [resource, need] of sum) {
    const have = room[resource];
    if (have !== undefined && need > have) out.push({ resource, need, have: Math.max(0, have) });
  }
  return out;
}

/**
 * The client pre-compute (CmpBlocked layer 1): what `costs` are short of with `room`, in cost order. Fixed amounts
 * only (a chosen or sheet-derived amount is the server's to check). An `either` ("spend a Hope or mark a Stress") is
 * short only when every option is; it then reports its first option's shortfall.
 */
export function shortfallOf(costs: readonly Cost[] | undefined, room: PayerRoom): Shortfall[] {
  const list = costs ?? [];
  const out = shortOf(totals(list), room);
  for (const cost of list) {
    if (cost.kind !== "either" || cost.options.length === 0) continue;
    const per = cost.options.map((option) => shortOf(totals(option), room));
    if (per.every((s) => s.length > 0)) {
      for (const s of per[0]!) if (!out.some((o) => o.resource === s.resource)) out.push(s);
    }
  }
  return out;
}

/** A shortfall as `viewer` may read it: a player loses an adversary payer's numbers (HANDOFF hard rule 2). */
export function visibleShortfall(s: Shortfall, viewer: ShortfallViewer): Shortfall {
  return viewer === "player" && s.payer === "adversary" ? { resource: s.resource, need: null, have: null, payer: s.payer } : s;
}

// ---------------------------------------------------------------- words

const NOUN: Record<ShortResource, [string, string]> = {
  hope: ["Hope", "Hope"],
  stress: ["Stress", "Stress"],
  hp: ["Hit Point", "Hit Points"],
  armor: ["Armor Slot", "Armor Slots"],
  tokens: ["token", "tokens"],
  fear: ["Fear", "Fear"],
  gold: ["handful of gold", "handfuls of gold"],
  favor: ["Favor", "Favor"],
  focus: ["Focus", "Focus"],
};

/** "1 Hope", "2 Armor Slots", "a Stress" (`article` for one: the board's "Beastform needs a Stress"). */
export function amountText(resource: ShortResource, n: number, article = false): string {
  const [one, many] = NOUN[resource];
  if (n === 1) return article ? `${/^[aeiou]/i.test(one) ? "an" : "a"} ${one}` : `1 ${one}`;
  return `${n} ${many}`;
}

/** The resource's name for a count-less text ("Hope", "Armor Slots"). */
export function resourceName(resource: ShortResource): string {
  return NOUN[resource][1];
}

const TRACKS: ReadonlySet<ShortResource> = new Set(["stress", "hp", "armor"]);

/**
 * The before-the-click form beside a disabled control (CmpBlocked layer 1): "Needs 3 Hope · you have 1",
 * "Needs a Stress · your Stress is full", "No Armor Slot left", "Needs 2 Fear · you have 1"; "Not enough Hope" when the
 * numbers are unknown or hidden.
 */
export function shortfallLabel(input: Shortfall, viewer: ShortfallViewer = "player"): string {
  const s = visibleShortfall(input, viewer);
  if (s.need === null) return `Not enough ${resourceName(s.resource)}`;
  if (s.resource === "armor" && (s.have ?? 0) === 0) return "No Armor Slot left";
  const need = `Needs ${amountText(s.resource, s.need, TRACKS.has(s.resource))}`;
  if (s.have === null) return need;
  if (s.resource === "stress") return s.have === 0 ? `${need} · your Stress is full` : `${need} · ${s.have} left to mark`;
  if (TRACKS.has(s.resource)) return `${need} · ${s.have} left to mark`;
  return `${need} · you have ${s.have}`;
}

/** The short tag form on a card or feature ("Needs 1 Hope"): the label without what you have. */
export function shortfallTag(input: Shortfall, viewer: ShortfallViewer = "player"): string {
  const s = visibleShortfall(input, viewer);
  if (s.need === null) return `Not enough ${resourceName(s.resource)}`;
  if (s.resource === "armor" && (s.have ?? 0) === 0) return "No Armor Slot left";
  return `Needs ${amountText(s.resource, s.need, TRACKS.has(s.resource))}`;
}

/**
 * The refusal sentence (CmpBlocked's message column), split into its bold lead and the rest:
 * hope  "Wall Walk needs 1 Hope." / "You have 0."; stress "Beastform needs a Stress." / "Your Stress is full.";
 * armor "No Armor Slot left to mark."; fear "This needs 2 Fear." / "You have 1.". `subject` is the card or feature
 * ("That card" when unknown). Always "needs", in refusals and before-the-click reasons alike (user answer 2026-11-02).
 */
export function shortfallSentence(
  input: Shortfall,
  options: { subject?: string | null; viewer?: ShortfallViewer } = {},
): { lead: string; rest: string | null } {
  const s = visibleShortfall(input, options.viewer ?? "player");
  const given = options.subject?.trim() || null;
  const subject = given ?? (s.resource === "fear" ? "This" : "That");
  if (s.resource === "armor" && (s.need === null || (s.have ?? 0) === 0)) return { lead: "No Armor Slot left to mark.", rest: null };
  if (s.need === null) return { lead: `Not enough ${resourceName(s.resource)} for ${given ?? "that"}.`, rest: null };
  const track = TRACKS.has(s.resource);
  const lead = `${subject} needs ${amountText(s.resource, s.need, track)}.`;
  if (s.have === null) return { lead, rest: null };
  if (s.resource === "stress") return { lead, rest: s.have === 0 ? "Your Stress is full." : `You can mark ${s.have} more.` };
  if (track) return { lead, rest: s.have === 0 ? `Your ${resourceName(s.resource)} are all marked.` : `You can mark ${s.have} more.` };
  return { lead, rest: `You have ${s.have}.` };
}

/** How to get the resource back (CmpBlocked's hint column); null when the board gives none. */
export function shortfallHint(resource: ShortResource): string | null {
  switch (resource) {
    case "hope":
      return "Roll with Hope, or rest, to gain Hope.";
    case "stress":
      return "Clear Stress on a rest or with an ally’s help.";
    case "armor":
      return "Repair armor on a rest.";
    default:
      return null;
  }
}

/** The board's title of a cost refusal ("Not enough Hope", "No Stress left to mark"). */
export function shortfallTitle(resource: ShortResource): string {
  switch (resource) {
    case "stress":
      return "No Stress left to mark";
    case "armor":
      return "No Armor Slot";
    case "fear":
      return "GM: not enough Fear";
    default:
      return `Not enough ${resourceName(resource)}`;
  }
}
