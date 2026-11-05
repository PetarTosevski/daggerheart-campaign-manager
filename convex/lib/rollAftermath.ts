/**
 * What happens after a PC's action roll (plan rule-switches RA; beads dcm-bxp.99.32.4, dcm-jh6d). Two rule switches:
 *
 * - S1 `spotlightToGm` (CB p.100: "making moves until someone fails a roll or rolls with Fear"; CB p.149: "Rolls with
 *   Fear on an action roll. / Fails an action roll."). Book: a failure or a roll with Fear moves the spotlight to the GM
 *   (`moveToGm`, reason `rollWithFear` first, else `failedRoll`); a critical always succeeds and never moves it. Manual:
 *   nothing moves; the GM gets "Mira rolled with Fear: take the spotlight?" / "Mira failed: take the spotlight?". Only
 *   while an encounter runs (combat-hud H1.S default, overnight answers 2026-11-02), and never when the GM already holds
 *   it (nothing to take).
 * - R3 `hopeFearFromRolls` (CB p.154: "Whenever a PC rolls with Fear, you gain a Fear"; CB p.90). The gains themselves
 *   stop in the roll paths (`dualityEffects(kind, outcome, hopeFearModeOf(campaign))`); here the GM gets
 *   "Mira rolled with Fear: gain 1 Fear?" for the Fear the path withheld (`fearWithheld`, user answer Q2 b).
 *
 * Callers: every PC action-roll path, once per roll, after its rows are logged (rolls.duality, the Tag Team's apply with
 * the chosen roll, the movement's Cloaked roll, weapon attacks, card and feature uses). Reaction rolls and GM rolls never
 * call it. The notes join the roll's `groupId`, so undoing the roll takes them back; a path whose roll row has no group
 * (a plain roll) asks `planPcActionRoll` first and gives the row a group only when a note is due. They carry no
 * `characterId`: a note on the character would be its "latest row" for the Slayer choice and the Tag Team checks.
 * Undo does not put the spotlight back (bead dcm-bxp.99.32.10).
 *
 * ```ts
 * const hopeFear = hopeFearModeOf(campaign);
 * const effects = dualityEffects("action", roll.outcome, hopeFear);
 * // ... log the roll's rows in `groupId` ...
 * await afterPcActionRoll(ctx, campaign, { characterId, name, kind: "action", success, withFear, fearWithheld: fearWithheldBy(hopeFear, "action", roll.outcome), groupId, actorId });
 * ```
 */
import type { HopeFearMode } from "../../src/lib/domain/dice/index";
import type { RollOutcome } from "../../src/lib/domain/duality";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ruleMode, postRuleNote } from "./ruleModes";
import { gmHoldsSpotlight, moveToGm } from "./spotlight";

/** The campaign's R3 mode, for `dualityEffects`. */
export function hopeFearModeOf(campaign: Pick<Doc<"campaigns">, "frameId" | "ruleModes">): HopeFearMode {
  return ruleMode(campaign, "hopeFearFromRolls");
}

/** Whether an outcome is with Fear (a critical never is). */
export function outcomeWithFear(outcome: RollOutcome): boolean {
  return outcome === "successFear" || outcome === "failFear";
}

/** Whether an outcome succeeds (a critical always does; a roll without a Difficulty counts as a success). */
export function outcomeSucceeds(outcome: RollOutcome): boolean {
  return outcome === "critical" || outcome === "successHope" || outcome === "successFear";
}

/** The Fear an action roll did not give the GM because R3 is Manual (`pcs`: a Tag Team gives one per PC, CB p.97). */
export function fearWithheldBy(mode: HopeFearMode, kind: "action" | "reaction", outcome: RollOutcome, pcs = 1): number {
  return mode === "manual" && kind === "action" && outcomeWithFear(outcome) ? pcs : 0;
}

export type PcActionRoll = {
  characterId: Id<"characters">;
  /** The roller's name for the notes ("Mira", "Mira and Theo" for a Tag Team). */
  name: string;
  kind: "action" | "reaction";
  /** The roll succeeded: against its Difficulty, or (an attack, a card) it hit any target. */
  success: boolean;
  withFear: boolean;
  /** The Fear the path did not gain because R3 is Manual (`fearWithheldBy`); 0 or unset: no R3 note. */
  fearWithheld?: number;
};

type Note = { ruleId: "spotlightToGm" | "hopeFearFromRolls"; summary: string };

/** What the roll sets off: a spotlight move (S1 Book) and the GM notes (S1 and R3 Manual). */
export type Aftermath = { move: "rollWithFear" | "failedRoll" | null; rollBy: Id<"characters">; notes: Note[] };

/** The campaign's running encounter, if any (S1 applies only in a fight). */
async function encounterRuns(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  const running = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .first();
  return running !== null;
}

/** Reads what a PC's roll sets off; writes nothing. */
export async function planPcActionRoll(ctx: QueryCtx, campaign: Doc<"campaigns">, roll: PcActionRoll): Promise<Aftermath> {
  const out: Aftermath = { move: null, rollBy: roll.characterId, notes: [] };
  if (roll.kind !== "action") return out;
  const fear = roll.fearWithheld ?? 0;
  if (fear > 0) out.notes.push({ ruleId: "hopeFearFromRolls", summary: `${roll.name} rolled with Fear: gain ${fear} Fear?` });
  const reason = roll.withFear ? "rollWithFear" : !roll.success ? "failedRoll" : null;
  if (reason === null || !(await encounterRuns(ctx, campaign._id)) || (await gmHoldsSpotlight(ctx, campaign._id))) return out;
  if (ruleMode(campaign, "spotlightToGm") === "manual") {
    out.notes.unshift({ ruleId: "spotlightToGm", summary: `${roll.name} ${reason === "rollWithFear" ? "rolled with Fear" : "failed"}: take the spotlight?` });
  } else out.move = reason;
  return out;
}

/** Applies a planned aftermath: the spotlight move, then the notes in the roll's group (none written without notes). */
export async function applyPcActionRoll(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  aftermath: Aftermath,
  row: { groupId: string | undefined; actorId: Id<"users"> },
): Promise<void> {
  if (aftermath.move !== null) await moveToGm(ctx, campaign, aftermath.move, aftermath.rollBy);
  if (aftermath.notes.length > 0 && row.groupId === undefined) throw new Error("applyPcActionRoll: notes need the roll's groupId.");
  for (const note of aftermath.notes) {
    await postRuleNote(ctx, campaign, { ruleId: note.ruleId, summary: note.summary, groupId: row.groupId, actorId: row.actorId });
  }
}

/** Plans and applies a PC action roll's aftermath, for a path whose rows already share `groupId`. Returns the plan. */
export async function afterPcActionRoll(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  roll: PcActionRoll & { groupId: string; actorId: Id<"users"> },
): Promise<Aftermath> {
  const aftermath = await planPcActionRoll(ctx, campaign, roll);
  await applyPcActionRoll(ctx, campaign, aftermath, roll);
  return aftermath;
}
