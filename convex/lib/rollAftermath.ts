/**
 * What happens after a PC's action roll (plan rule-switches RA; beads dcm-bxp.99.32.4, dcm-jh6d). Two rule switches:
 *
 * - S1 `spotlightToGm` (CB p.100: "making moves until someone fails a roll or rolls with Fear"; CB p.149: "Rolls with
 *   Fear on an action roll. / Fails an action roll."). Book: a failure or a roll with Fear moves the spotlight to the GM
 *   (`moveToGm`, reason `rollWithFear` first, else `failedRoll`); a critical always succeeds and never moves it. Manual:
 *   nothing moves; the GM gets "Mira rolled with Fear: take the spotlight?" / "Mira failed: take the spotlight?". On every
 *   PC action roll, in a fight or not (user answer 2026-11-06, plan rule-switches RA2: the spotlight row is the
 *   campaign's, `combatSpotlight`, and needs no encounter), and never when the GM already holds it (nothing to take).
 * - R3 `hopeFearFromRolls` (CB p.154: "Whenever a PC rolls with Fear, you gain a Fear"; CB p.90). The gains themselves
 *   stop in the roll paths (`dualityEffects(kind, outcome, hopeFearModeOf(campaign))`; card and feature uses through the
 *   run context's `hopeFear`, set by cardRunner `buildRun`, RA2); here the GM gets "Mira rolled with Fear: gain 1 Fear?"
 *   for the Fear the path withheld (`fearWithheld`, user answer Q2 b; unset: one Fear for a with-Fear action roll in
 *   Manual). A critical keeps its Hope and Stress clear in both modes (user answer 2026-11-06, CB p.90).
 *
 * Callers: every PC action-roll path, once per roll, after its rows are logged (rolls.duality, the Tag Team's apply with
 * the chosen roll, the movement's Cloaked roll, weapon attacks, card and feature uses). Reaction rolls and GM rolls never
 * call it. The notes join the roll's `groupId`, so undoing the roll takes them back; a path whose roll row has no group
 * (a plain roll) asks `planPcActionRoll` first and gives the row a group only when a note is due. They carry no
 * `characterId`: a note on the character would be its "latest row" for the Slayer choice and the Tag Team checks.
 * Undo does not put the spotlight back (bead dcm-bxp.99.32.10).
 *
 * Spotlight Tracker (optional rule `spotlightTracker`, CB p.89, plan rule-switches RT / RFB): each PC action roll spends
 * one of the roller's action tokens (convex/lib/actionTokens.ts). A Tag Team spends one of EACH PC (user answer
 * 2026-11-06): its group holds both PCs' action rolls, so the partner is read from the group (`rollersOf`), with no
 * change in rolls.ts. A spend is recorded in the roll's group (a hidden `spotlightTracker` row), so undoing the roll gives
 * the token back; a plain roll gets a group for it as it does for a note (`planPcActionRoll` lists it in `notes`).
 * Off: nothing.
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
import { plannedSpends, recordTokenSpends, spendActionTokens, type Spent } from "./actionTokens";
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
  /**
   * The Fear the path did not gain because R3 is Manual (`fearWithheldBy`); 0: no R3 note. Unset: one Fear for an action
   * roll with Fear in an R3-Manual campaign (a card or feature use: its run withheld it through `hopeFear`), else none.
   */
  fearWithheld?: number;
};

/** A GM note (S1, R3 Manual), or a planned Spotlight Tracker spend (`tokenOf`: recorded hidden, never shown as a note). */
type Note = { ruleId: "spotlightToGm" | "hopeFearFromRolls"; summary: string } | { ruleId: "spotlightTracker"; summary: string; tokenOf: Id<"characters"> };

/**
 * What the roll sets off: a spotlight move (S1 Book), the GM notes (S1 and R3 Manual) and, for an action roll, a
 * Spotlight Tracker token of each of `spenders` (the roller; a Tag Team: both PCs, plan RFB). `spendActionTokens` does
 * nothing while the optional rule is off. A planned spend is in `notes` too, so a plain roll gets a group for its record.
 */
export type Aftermath = { move: "rollWithFear" | "failedRoll" | null; rollBy: Id<"characters">; notes: Note[]; spenders: Id<"characters">[] };

/** The most rows a Tag Team's group holds besides rule rows (two rolls, two results). */
const TAG_TEAM_ROWS = 4;

/**
 * The PCs who made this action roll: the roller, and for a Tag Team (CB p.97) the partner too. A Tag Team's group holds
 * only the two PCs' action rolls (their rolls and results; the GM notes are `rule` rows), so a group whose other rows
 * are all action rolls of one other PC is one. Any other group (a plain roll's, an attack's, a card's) gives the roller.
 */
async function rollersOf(ctx: QueryCtx, campaign: Doc<"campaigns">, rollBy: Id<"characters">, groupId: string | undefined): Promise<Id<"characters">[]> {
  if (groupId === undefined) return [rollBy];
  const rows = (
    await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaign._id).eq("groupId", groupId))
      .take(TAG_TEAM_ROWS + 5)
  ).filter((r) => r.kind !== "rule");
  if (rows.length > TAG_TEAM_ROWS || !rows.every((r) => r.kind === "roll" && r.roll?.kind === "action" && r.characterId !== undefined)) return [rollBy];
  const ids = new Set<Id<"characters">>([rollBy, ...rows.map((r) => r.characterId!)]);
  return ids.size === 2 ? [...ids] : [rollBy];
}

/** Reads what a PC's roll sets off; writes nothing. `groupId`: the roll's group when it has one (a Tag Team's: both PCs spend). */
export async function planPcActionRoll(ctx: QueryCtx, campaign: Doc<"campaigns">, roll: PcActionRoll & { groupId?: string }): Promise<Aftermath> {
  const out: Aftermath = { move: null, rollBy: roll.characterId, notes: [], spenders: [] };
  if (roll.kind !== "action") return out;
  out.spenders = await rollersOf(ctx, campaign, roll.characterId, roll.groupId);
  for (const s of await plannedSpends(ctx, campaign, out.spenders)) {
    out.notes.push({ ruleId: "spotlightTracker", summary: `${roll.name}: an action token spent (${s.left} left)`, tokenOf: s.characterId });
  }
  const fear = roll.fearWithheld ?? (roll.withFear ? fearWithheldBy(hopeFearModeOf(campaign), roll.kind, "successFear") : 0);
  if (fear > 0) out.notes.push({ ruleId: "hopeFearFromRolls", summary: `${roll.name} rolled with Fear: gain ${fear} Fear?` });
  const reason = roll.withFear ? "rollWithFear" : !roll.success ? "failedRoll" : null;
  if (reason === null || (await gmHoldsSpotlight(ctx, campaign._id))) return out;
  if (ruleMode(campaign, "spotlightToGm") === "manual") {
    out.notes.unshift({ ruleId: "spotlightToGm", summary: `${roll.name} ${reason === "rollWithFear" ? "rolled with Fear" : "failed"}: take the spotlight?` });
  } else out.move = reason;
  return out;
}

/**
 * Applies a planned aftermath: the Spotlight Tracker tokens (optional rule, CB p.89, plan RT / RFB: off = nothing) with
 * their hidden records in the roll's group, the spotlight move, then the notes in the roll's group (none written
 * without notes).
 */
export async function applyPcActionRoll(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  aftermath: Aftermath,
  row: { groupId: string | undefined; actorId: Id<"users"> },
): Promise<void> {
  if (aftermath.notes.length > 0 && row.groupId === undefined) throw new Error("applyPcActionRoll: notes need the roll's groupId.");
  if (aftermath.spenders.length > 0) {
    const { spent } = await spendActionTokens(ctx, campaign, aftermath.spenders);
    const lines = new Map(aftermath.notes.flatMap((n) => ("tokenOf" in n ? [[n.tokenOf, n.summary] as const] : [])));
    // Only a planned spend has a group to join (the plan and the spend read the same rows, so they agree in practice).
    const recorded = spent.filter((s) => lines.has(s.characterId));
    if (row.groupId !== undefined && recorded.length > 0) {
      await recordTokenSpends(ctx, campaign, recorded, { groupId: row.groupId, actorId: row.actorId, summary: (s: Spent) => lines.get(s.characterId)!, shown: false });
    }
  }
  if (aftermath.move !== null) await moveToGm(ctx, campaign, aftermath.move, aftermath.rollBy);
  for (const note of aftermath.notes) {
    if (note.ruleId === "spotlightTracker") continue;
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
