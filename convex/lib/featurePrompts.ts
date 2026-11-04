/**
 * Server-decided parts of feature uses (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md). Callers are the
 * campaign wrappers of convex/featurePrompts.ts and the feature runner (convex/lib/featureRunner.ts `resolveFeatureUse`).
 *
 * - A target count rolled before the pick (`rolledFirst`; CB p.31 Warden's Protection: "clear 2 Hit Points on 1d4 allies
 *   within Close range"; user 2026-10-29, dcm-d95): the server rolls it and stores it as an open `targetCount`
 *   `combatRequests` row; the use takes at most that many targets and resolves the row. User 2026-10-30
 *   (dcm-bxp.99.19.55 (1)): the roll stays valid until it is used or the scene ends, with no time limit. There is no
 *   scene record to point at, so the roll's scene is a mark on the roller's sheet (`countMark`: a `featureUses` entry
 *   until "scene"); every scene end (End scene, the encounter's end, the session's end) drops it through
 *   `expire(sheet, "scene" | "session")`, and the roll is checked lazily against it (`liveTargetCount`). Undoing the scene
 *   end puts the mark back, and with it the roll. One open roll per character, feature and use; a stale one (its mark
 *   gone) is declined by the next roll. Closed rows are swept by `expireCombatRequests` (convex/cleanup.ts, rule 8).
 * - A move the server makes (`intoMelee`; CB p.59 Charge): see convex/featurePrompts.ts `charge`; the square left is an
 *   open `serverMove` row (convex/lib/combatRequests.ts `openServerMove`) that undo reads.
 *
 * - A use rolled by an ally (`rolledBy`; CB p.33 Cannonball; DA13): the druid's use opens an `allyRoll` row
 *   (`openAllyRoll`); the ally's roll runs `rollerUse` as the ally's own use. A row stands while it is unexpired
 *   (`ALLY_ROLL_TTL_MS`) and the druid's use is not undone (`allyRollLive`).
 *
 * Reads go through `openRequests` (bounded, indexed by campaign and status).
 */
import { pickUse, rollTargetCount } from "../../src/lib/domain/card-effects/run";
import type { CardUse, Cost, Step } from "../../src/lib/domain/card-effects/types";
import { actorExtras, asCardEffect, featureCostShort } from "../../src/lib/domain/feature-effects/run";
import { appError } from "../../src/lib/errors/app-error";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { cardActor } from "./cardRunner";
import { saveSheet } from "./characterSheet";
import { closeRequest, openRequests } from "./combatRequests";
import { rollDie } from "./dice";
import type { AllyRollPayload } from "./validators/combatRequests";

/** The `featureUses` key prefix that ties an open rolled count to the scene it was rolled in (until "scene"). */
const COUNT_MARK = "rolledCount:";

export function countMark(requestId: Id<"combatRequests">): string {
  return `${COUNT_MARK}${requestId}`;
}

/** The sheet without the scene marks of rolled counts, except those in `keep`. The same object when nothing goes. */
export function withoutCountMarks<S extends Pick<CharacterSheet, "featureUses">>(sheet: S, keep: ReadonlySet<string> = new Set()): S {
  // A chosen number's mark (`<mark>:<choice>=<n>`, E8) goes with its roll's mark.
  const kept = sheet.featureUses.filter((u) => !u.key.startsWith(COUNT_MARK) || keep.has(u.key) || keep.has(u.key.split(":").slice(0, 2).join(":")));
  return kept.length === sheet.featureUses.length ? sheet : { ...sheet, featureUses: kept };
}

/** Whether the roll's scene still runs: its mark is on the roller's sheet. */
function sameScene(row: CountRow, sheet: Pick<CharacterSheet, "featureUses">): boolean {
  const key = countMark(row._id);
  return sheet.featureUses.some((u) => u.key === key);
}

/** Whether the use's target count is rolled by the server before the pick (`upTo.rolledFirst`, DA0). */
export function isRolledFirst(use: CardUse): boolean {
  const spec = use.targets;
  return spec !== undefined && spec.side !== "trigger" && spec.count.kind === "upTo" && spec.count.rolledFirst === true;
}

/** Whether the use holds a move the server makes (`intoMelee`, Charge), at any depth of its steps. */
export function hasServerMove(use: CardUse): boolean {
  return JSON.stringify(use.steps).includes('"mode":"intoMelee"');
}

type CountRow = Doc<"combatRequests"> & { payload: { kind: "targetCount" } };

function isCountRow(row: Doc<"combatRequests">): row is CountRow {
  return row.payload.kind === "targetCount";
}

/** The open rolled counts of this character's feature use, newest first (stale ones included). */
async function countRows(ctx: QueryCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, featureId: string, useId: string): Promise<CountRow[]> {
  const rows = (await openRequests(ctx, campaignId)).filter(isCountRow);
  return rows
    .filter((r) => r.payload.characterId === characterId && r.payload.featureId === featureId && r.payload.useId === useId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** The open rolled count of this character's feature use whose scene still runs (`sheet`: the roller's), or null. */
export async function liveTargetCount(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  characterId: Id<"characters">,
  featureId: string,
  useId: string,
  sheet: Pick<CharacterSheet, "featureUses">,
): Promise<CountRow | null> {
  return (await countRows(ctx, campaignId, characterId, featureId, useId)).find((r) => sameScene(r, sheet)) ?? null;
}

/** The feature's `rolledFirst` use (default its first action use), or INVALID. FEATURE_NOT_COMBAT without an entry. */
export function rolledFirstUse(featureId: string, useId: string | undefined): CardUse {
  const entry = featureEffect(featureId);
  if (entry === undefined) throw appError("FEATURE_NOT_COMBAT");
  const use = pickUse(asCardEffect(entry), useId);
  if (use === undefined || !isRolledFirst(use)) throw appError("INVALID", "That feature has no target count to roll first.");
  return use;
}

/**
 * Rolls the count of a `rolledFirst` use and stores it (open `targetCount` row) with its scene mark on the sheet. INVALID
 * while a roll of the same use is open in this scene; a stale one is declined here. The caller has checked ownership,
 * the limit and access. The mark is not a feed row: a roll writes none (its result shows in the drawer), except one that
 * paid its costs (E8.3, `paidAtRoll`): that roll is a public, undoable row with the sheet's `before`.
 */
export async function rollAndStoreCount(
  ctx: MutationCtx,
  input: {
    campaignId: Id<"campaigns">;
    character: Doc<"characters">;
    sheet: CharacterSheet;
    featureId: string;
    use: CardUse;
    userId: Id<"users">;
    /** Plan lanes-2 E8 (dcm-q3t1): the player's numbers the count reads (Otherworldly Ire's Favor), by choice id. */
    choices?: Readonly<Record<string, number>>;
  },
): Promise<{ requestId: Id<"combatRequests">; count: number }> {
  for (const row of await countRows(ctx, input.campaignId, input.character._id, input.featureId, input.use.id)) {
    if (sameScene(row, input.sheet)) throw appError("INVALID", "You already rolled for this use: use it first.");
    await closeRequest(ctx, row._id, "declined", input.userId);
  }
  const actor = { ...cardActor(input.character._id, input.sheet, `feat:${input.featureId}`, undefined), ...actorExtras(input.sheet) };
  const chosen = countChoices(input.use, input.choices ?? {});
  // Plan lanes-2 E8.3 (dcm-atiu, user answer 2026-10-31): the costs that read the count's chosen numbers are paid at the
  // roll, with no backing out; the use then skips them (`withoutRollCosts`). The player must hold them now.
  const rollCosts = paidAtRoll(input.use);
  let payer = input.sheet;
  if (chosen.length > 0) {
    const short = featureCostShort(actor, { ...input.use, costs: rollCosts }, input.choices ?? {});
    if (short.length > 0) throw appError("FEATURE_COST_UNPAID", `Short of: ${short.join(", ")}.`);
    payer = payRollCosts(input.sheet, rollCosts, input.choices ?? {});
  }
  const count = rollTargetCount(withChosenCount(input.use, input.choices ?? {}), { ...actor, ...actorExtras(payer) }, rollDie);
  if (count === null) throw appError("INVALID", "That feature has no target count to roll first.");
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: input.campaignId,
    kind: "targetCount",
    status: "open",
    createdBy: input.userId,
    createdAt: Date.now(),
    responses: [],
    payload: { schemaVersion: 1, kind: "targetCount", characterId: input.character._id, featureId: input.featureId, useId: input.use.id, count },
  });
  // Keep the marks of the character's other open rolls (another rolled-first feature); drop stale ones.
  const open = (await openRequests(ctx, input.campaignId)).filter((r): r is CountRow => isCountRow(r) && r.payload.characterId === input.character._id);
  const kept = withoutCountMarks(payer, new Set(open.map((r) => countMark(r._id))));
  const marks = [countMark(requestId), ...chosen.map((c) => chosenMark(requestId, c.id, c.value))].map((key) => ({ key, until: "scene" as const }));
  const after = { ...kept, featureUses: [...kept.featureUses, ...marks] };
  await saveSheet(ctx, input.character._id, after);
  // A roll that paid something is a feed row (undo gives the payment and the roll's mark back).
  if (payer !== input.sheet) {
    const paid = rollCostWords(rollCosts, input.choices ?? {});
    await logAction(ctx, {
      campaignId: input.campaignId,
      characterId: input.character._id,
      actorId: input.userId,
      kind: "feature",
      visibility: "public",
      summary: `${input.sheet.name} spends ${paid} for ${input.use.name}: ${count} target${count === 1 ? "" : "s"}`.slice(0, 1000),
      before: input.sheet,
      undoable: true,
    });
  }
  return { requestId, count };
}

// ---------------------------------------------------------------- plan lanes-2, E8.3: costs paid at the roll (dcm-atiu)

/** The choice ids a `rolledFirst` use's target count reads (Otherworldly Ire's `favor`). */
function countChoiceIds(use: CardUse): Set<string> {
  return new Set(countChoices(use, {}).map((c) => c.id));
}

/**
 * dcm-atiu (Otherworldly Ire, HF p.15: "spend any number of Favor to roll that many Patron Dice"; user answer 2026-10-31:
 * the Favor is paid at the roll, the player cannot back out). Plan lanes-2 E8.4 (dcm-szfg, user answer 2026-10-31: ALL
 * the use's costs are paid at the roll): once the rolled count reads a number the player chose, every cost of the use
 * is paid by `rollCount`, none at resolution; the use skips them (`withoutRollCosts`). Empty for any other use (Warden's
 * Protection's fixed 1d4 pays with the use).
 */
export function paidAtRoll(use: CardUse): Cost[] {
  if (!isRolledFirst(use)) return [];
  return countChoiceIds(use).size === 0 ? [] : [...(use.costs ?? [])];
}

/** The use without the costs `rollCount` paid (`paidAtRoll`); the same object when there are none. */
export function withoutRollCosts(use: CardUse): CardUse {
  const paid = paidAtRoll(use);
  if (paid.length === 0) return use;
  const { costs: _costs, ...rest } = use;
  void _costs;
  return rest;
}

/** The fixed or chosen amount of a cost paid at the roll (other number kinds are not read here: INVALID). */
function rollCostAmount(cost: Cost, choices: Readonly<Record<string, number>>): number {
  if (cost.kind === "either" || cost.kind === "gold") throw appError("INVALID", "That cost can't be paid at the roll.");
  const a = cost.amount;
  if (a.kind === "fixed") return a.value;
  if (a.kind === "chosen") return choices[a.choice] ?? 0;
  throw appError("INVALID", "That cost can't be paid at the roll.");
}

/** The sheet with the roll's costs paid: Favor, Focus, Hope, Stress or Hit Points. INVALID for another kind. */
export function payRollCosts(sheet: CharacterSheet, costs: readonly Cost[], choices: Readonly<Record<string, number>>): CharacterSheet {
  let out = sheet;
  for (const cost of costs) {
    const n = rollCostAmount(cost, choices);
    if (n <= 0) continue;
    if (cost.kind === "tokens" && cost.pool === "favor") {
      const favor = actorExtras(out).favor ?? 0;
      out = { ...out, classState: { ...out.classState, favor: Math.max(0, favor - n) } };
    } else if (cost.kind === "tokens" && cost.pool === "focus" && out.classState.martial) {
      out = { ...out, classState: { ...out.classState, martial: { ...out.classState.martial, focus: Math.max(0, out.classState.martial.focus - n) } } };
    } else if (cost.kind === "hope") out = { ...out, hope: Math.max(0, out.hope - n) };
    else if (cost.kind === "stress") out = { ...out, stress: Math.min(out.stressMax, out.stress + n) };
    else if (cost.kind === "hp") out = { ...out, hp: Math.min(out.hpMax, out.hp + n) };
    else throw appError("INVALID", "That cost can't be paid at the roll.");
  }
  return out;
}

/** "3 Favor", "1 Hope and 2 Favor": the words of the costs paid at the roll. */
function rollCostWords(costs: readonly Cost[], choices: Readonly<Record<string, number>>): string {
  const words = costs.flatMap((c) => {
    const n = rollCostAmount(c, choices);
    if (n <= 0) return [];
    const what = c.kind === "tokens" ? (c.pool === "focus" ? "Focus" : "Favor") : c.kind === "hope" ? "Hope" : c.kind === "hp" ? "Hit Point" + (n === 1 ? "" : "s") : "Stress";
    return [`${n} ${what}`];
  });
  return words.join(" and ") || "nothing";
}

// ---------------------------------------------------------------- plan lanes-2, E8: a count rolled from a chosen number

/**
 * dcm-q3t1 (Otherworldly Ire, HF p.15: "spend any number of Favor to roll that many Patron Dice and target a number of
 * creatures within Close range equal to the highest result"): the `chosen` numbers a `rolledFirst` count reads, with the
 * player's values (0 when not given). The roll stores each beside its scene mark (`chosenMark`), and the use must be made
 * with the same numbers (`spendTargetCount`), so its costs pay what the roll was made with.
 */
export function countChoices(use: CardUse, choices: Readonly<Record<string, number>>): { id: string; value: number }[] {
  const spec = use.targets;
  if (spec === undefined || spec.side === "trigger" || spec.count.kind !== "upTo") return [];
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.kind === "chosen" && typeof o.choice === "string") ids.add(o.choice);
      Object.values(o).forEach(walk);
    }
  };
  walk(spec.count.n);
  return [...ids].map((id) => ({ id, value: choices[id] ?? 0 }));
}

/** The use with the `chosen` numbers of its target count written in as fixed numbers (run.ts rolls the count without choices). */
export function withChosenCount(use: CardUse, choices: Readonly<Record<string, number>>): CardUse {
  const spec = use.targets;
  if (spec === undefined || spec.side === "trigger" || spec.count.kind !== "upTo") return use;
  const bind = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(bind);
    if (v === null || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (o.kind === "chosen" && typeof o.choice === "string") return { kind: "fixed", value: choices[o.choice] ?? 0 };
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, bind(x)]));
  };
  return { ...use, targets: { ...spec, count: { ...spec.count, n: bind(spec.count.n) as typeof spec.count.n } } };
}

/** The scene mark that keeps a chosen number of a rolled count: `rolledCount:<requestId>:<choice>=<n>`. */
export function chosenMark(requestId: Id<"combatRequests">, choice: string, value: number): string {
  const key = `${countMark(requestId)}:${choice}=${value}`;
  if (key.length > 80) throw appError("INVALID", "That choice id is too long.");
  return key;
}

/** Whether a `featureUses` key is a rolled count's mark or one of its chosen numbers. */
export function isMarkOf(key: string, requestId: Id<"combatRequests">): boolean {
  const mark = countMark(requestId);
  return key === mark || key.startsWith(`${mark}:`);
}

/**
 * The use of a `rolledFirst` feature takes its stored roll (user 2026-10-29, dcm-d95): COMBAT_TARGET_INVALID without an
 * open roll of this scene or with more targets than it shows; otherwise the row is resolved and returned (the caller
 * drops the row's scene mark from the sheet it writes). Null for any other use. Called before anything is written, so
 * a refusal changes nothing.
 */
export async function spendTargetCount(
  ctx: MutationCtx,
  input: {
    campaignId: Id<"campaigns">;
    characterId: Id<"characters">;
    sheet: CharacterSheet;
    featureId: string;
    use: CardUse;
    targets: number;
    by: Id<"users">;
    /** Plan lanes-2 E8 (dcm-q3t1): the use's numbers; a count rolled from a chosen number needs the same one. */
    choices?: Readonly<Record<string, number>>;
  },
): Promise<{ count: number; requestId: Id<"combatRequests"> } | null> {
  if (!isRolledFirst(input.use)) return null;
  const row = await liveTargetCount(ctx, input.campaignId, input.characterId, input.featureId, input.use.id, input.sheet);
  if (row === null) throw appError("COMBAT_TARGET_INVALID", "Roll the number of targets first.");
  if (input.targets > row.payload.count) throw appError("COMBAT_TARGET_INVALID", `At most ${row.payload.count} target(s).`);
  const prefix = `${countMark(row._id)}:`;
  for (const u of input.sheet.featureUses) {
    if (!u.key.startsWith(prefix)) continue;
    const [choice, value] = u.key.slice(prefix.length).split("=");
    if (choice !== undefined && Number(value) !== (input.choices?.[choice] ?? 0)) throw appError("INVALID", `Use it with the ${choice} you rolled for (${value}).`);
  }
  await closeRequest(ctx, row._id, "resolved", input.by);
  return { count: row.payload.count, requestId: row._id };
}

// ---------------------------------------------------------------- a use rolled by an ally (Cannonball, DA13)

/** How long an ally's roll waits (then it is no longer offered, and the druid's next throw declines it). */
export const ALLY_ROLL_TTL_MS = 30 * 60_000;

export type AllyRollRow = Doc<"combatRequests"> & { payload: AllyRollPayload };

export function isAllyRollRow(row: Doc<"combatRequests">): row is AllyRollRow {
  return row.payload.kind === "allyRoll";
}

/**
 * DA13 (CB p.33 Cannonball; user 2026-10-29 / 2026-10-30, dcm-bxp.99.19.21): the druid's use paid its Stress; the picked
 * ally now makes the roll from their own drawer. The druid's older open throws are declined first (one at a time).
 */
export async function openAllyRoll(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; createdBy: Id<"users">; payload: Omit<AllyRollPayload, "schemaVersion" | "kind" | "expiresAt"> },
): Promise<Id<"combatRequests">> {
  for (const row of (await openRequests(ctx, input.campaignId)).filter(isAllyRollRow)) {
    if (row.payload.characterId === input.payload.characterId) await closeRequest(ctx, row._id, "declined", input.createdBy);
  }
  const now = Date.now();
  return ctx.db.insert("combatRequests", {
    campaignId: input.campaignId,
    mapId: input.mapId,
    kind: "allyRoll",
    status: "open",
    createdBy: input.createdBy,
    createdAt: now,
    responses: [],
    payload: { schemaVersion: 1, kind: "allyRoll", ...input.payload, expiresAt: now + ALLY_ROLL_TTL_MS },
  });
}

/** Whether an open ally roll still stands: not expired, and the druid's use (its public row) not undone. */
export async function allyRollLive(ctx: QueryCtx, row: AllyRollRow, now = Date.now()): Promise<boolean> {
  if (row.payload.expiresAt <= now) return false;
  const entry = await ctx.db.get("actionLog", row.payload.entryId);
  return entry !== null && entry.undoneAt === undefined;
}

/** The campaign's open ally rolls that still stand, oldest first. */
export async function liveAllyRolls(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<AllyRollRow[]> {
  const out: AllyRollRow[] = [];
  for (const row of (await openRequests(ctx, campaignId)).filter(isAllyRollRow)) if (await allyRollLive(ctx, row)) out.push(row);
  return out;
}

function withoutCosts(steps: readonly Step[]): Step[] {
  return steps.map((s) => {
    if (s.kind !== "optional") return s;
    const { costs: _costs, ...rest } = s;
    void _costs;
    return { ...rest, steps: withoutCosts(s.steps) };
  });
}

/**
 * The ally's half of a `rolledBy` use as a use of its own, made by the ally: the roll (their trait, their Hope / Fear,
 * their critical), `rolledBy.targets` measured from them, and the steps. The druid's costs and limit were paid by the
 * druid's use; an optional step's cost (Cannonball's Hope for the second target, "You can spend a Hope") is the druid's
 * and paid by the caller, so it is taken off here. INVALID for a use without `rolledBy`.
 */
export function rollerUse(use: CardUse): CardUse {
  const rolledBy = use.rolledBy;
  if (rolledBy === undefined) throw appError("INVALID", "That use is not rolled by an ally.");
  const { costs: _costs, limit: _limit, requires: _requires, rolledBy: _rolledBy, targets: _targets, ...rest } = use;
  void _costs;
  void _limit;
  void _requires;
  void _rolledBy;
  void _targets;
  return { ...rest, targets: rolledBy.targets, steps: withoutCosts(use.steps) };
}

/** The Hope an optional step of the use costs (Cannonball's second target: 1), or 0 for none. */
export function optionalHope(use: CardUse, optionalId: string): number {
  const step = use.steps.find((s) => s.kind === "optional" && s.id === optionalId);
  if (step?.kind !== "optional") return 0;
  return (step.costs ?? []).reduce((n, c) => n + (c.kind === "hope" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);
}
