/**
 * Server-decided parts of feature uses (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md). Callers are the
 * campaign wrappers of convex/featurePrompts.ts and the feature runner (convex/lib/featureRunner.ts `resolveFeatureUse`).
 *
 * - A target count rolled before the pick (`rolledFirst`; CB p.31 Warden's Protection: "clear 2 Hit Points on 1d4 allies
 *   within Close range"; user 2026-10-29, dcm-d95): the server rolls it and stores it as an open `targetCount`
 *   `combatRequests` row; the use takes at most that many targets and resolves the row. One open roll per character, feature
 *   and use until it is used or expires (`TARGET_COUNT_TTL_MS`); an expired row is declined by the next roll. Closed rows
 *   are swept by `expireCombatRequests` (convex/cleanup.ts, rule 8).
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
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import { asCardEffect } from "../../src/lib/domain/feature-effects/run";
import { appError } from "../../src/lib/errors/app-error";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { cardActor } from "./cardRunner";
import { closeRequest, openRequests } from "./combatRequests";
import { rollDie } from "./dice";
import type { AllyRollPayload } from "./validators/combatRequests";

/** How long a rolled target count waits for its use (then the next roll declines it). */
export const TARGET_COUNT_TTL_MS = 30 * 60_000;

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

/** The open rolled counts of this character's feature use, newest first (expired ones included). */
async function countRows(ctx: QueryCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, featureId: string, useId: string): Promise<CountRow[]> {
  const rows = (await openRequests(ctx, campaignId)).filter(isCountRow);
  return rows
    .filter((r) => r.payload.characterId === characterId && r.payload.featureId === featureId && r.payload.useId === useId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** The open, unexpired rolled count of this character's feature use, or null. */
export async function liveTargetCount(ctx: QueryCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, featureId: string, useId: string, now = Date.now()): Promise<CountRow | null> {
  return (await countRows(ctx, campaignId, characterId, featureId, useId)).find((r) => r.payload.expiresAt > now) ?? null;
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
 * Rolls the count of a `rolledFirst` use and stores it (open `targetCount` row). INVALID while an unexpired roll of the
 * same use is open; an expired one is declined here. The caller has checked ownership, the limit and access.
 */
export async function rollAndStoreCount(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet; featureId: string; use: CardUse; userId: Id<"users"> },
): Promise<{ requestId: Id<"combatRequests">; count: number; expiresAt: number }> {
  const now = Date.now();
  for (const row of await countRows(ctx, input.campaignId, input.character._id, input.featureId, input.use.id)) {
    if (row.payload.expiresAt > now) throw appError("INVALID", "You already rolled for this use: use it first.");
    await closeRequest(ctx, row._id, "declined", input.userId);
  }
  const actor = cardActor(input.character._id, input.sheet, `feat:${input.featureId}`, undefined);
  const count = rollTargetCount(input.use, actor, rollDie);
  if (count === null) throw appError("INVALID", "That feature has no target count to roll first.");
  const expiresAt = now + TARGET_COUNT_TTL_MS;
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: input.campaignId,
    kind: "targetCount",
    status: "open",
    createdBy: input.userId,
    createdAt: now,
    responses: [],
    payload: { schemaVersion: 1, kind: "targetCount", characterId: input.character._id, featureId: input.featureId, useId: input.use.id, count, expiresAt },
  });
  return { requestId, count, expiresAt };
}

/**
 * The use of a `rolledFirst` feature takes its stored roll (user 2026-10-29, dcm-d95): COMBAT_TARGET_INVALID without an
 * open, unexpired roll or with more targets than it shows; otherwise the row is resolved and the count returned. Null for
 * any other use. Called before anything is written, so a refusal changes nothing.
 */
export async function spendTargetCount(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; characterId: Id<"characters">; featureId: string; use: CardUse; targets: number; by: Id<"users"> },
): Promise<number | null> {
  if (!isRolledFirst(input.use)) return null;
  const row = await liveTargetCount(ctx, input.campaignId, input.characterId, input.featureId, input.use.id);
  if (row === null) throw appError("COMBAT_TARGET_INVALID", "Roll the number of targets first.");
  if (input.targets > row.payload.count) throw appError("COMBAT_TARGET_INVALID", `At most ${row.payload.count} target(s).`);
  await closeRequest(ctx, row._id, "resolved", input.by);
  return row.payload.count;
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
