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
 * Reads go through `openRequests` (bounded, indexed by campaign and status).
 */
import { pickUse, rollTargetCount } from "../../src/lib/domain/card-effects/run";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import { asCardEffect } from "../../src/lib/domain/feature-effects/run";
import { appError } from "../../src/lib/errors/app-error";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { cardActor } from "./cardRunner";
import { closeRequest, openRequests } from "./combatRequests";
import { rollDie } from "./dice";

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
