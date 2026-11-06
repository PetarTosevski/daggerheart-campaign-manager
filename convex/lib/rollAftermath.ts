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
 * Undo puts the spotlight back (plan rule-switches CU2, bead dcm-bxp.99.32.10): a Book move stores the row before it on
 * the roll's action (`spotlightBefore`), and `undoEntry` restores it while the GM's hold is still the one the roll began.
 *
 * Spotlight Tracker (optional rule `spotlightTracker`, CB p.89, plan rule-switches RT / RFB): each PC action roll spends
 * one of the roller's action tokens (convex/lib/actionTokens.ts). A Tag Team spends one of EACH PC (user answer
 * 2026-11-06): its group holds both PCs' action rolls, so the partner is read from the group (`rollersOf`), with no
 * change in rolls.ts. A spend is recorded in the roll's group (a hidden `spotlightTracker` row), so undoing the roll gives
 * the token back; a plain roll gets a group for it as it does for a note (`planPcActionRoll` lists it in `notes`).
 * Off: nothing.
 *
 * Underwater (optional rule `underwater`, CB p.168, plan rule-switches OE, user answer Q11 b): while the live map is
 * marked Underwater (`combatScenes.setUnderwater`) and the roller has a PC token on it, each PC action roll ticks the
 * scene's breath countdown (a dashboard countdown row) once, once more on a failure and once more with Fear, through
 * `applyTick` with the group's first row as its entry, so undoing the roll takes the tick back. Once the countdown has
 * ended (0 before this roll), each roller marks 1 Stress instead (D4 `stressOverflow` respected: Manual drops the
 * overflow and notes the GM); the Stress is a row with the sheet before in the roll's group (undo restores it). A Tag
 * Team ticks once and both PCs mark the Stress. Off, or no Underwater live map: nothing. A PC whose token the GM marked
 * "breathes underwater" (`combatScenes.setBreathesUnderwater`, plan OE2) counts as off the map here: no tick, no Stress.
 *
 * ```ts
 * const hopeFear = hopeFearModeOf(campaign);
 * const effects = dualityEffects("action", roll.outcome, hopeFear);
 * // ... log the roll's rows in `groupId` ...
 * await afterPcActionRoll(ctx, campaign, { characterId, name, kind: "action", success, withFear, fearWithheld: fearWithheldBy(hopeFear, "action", roll.outcome), groupId, actorId });
 * ```
 */
import { markStress } from "../../src/lib/domain/characters/index";
import { breathEnded, breathTicks } from "../../src/lib/domain/combat-map/light";
import type { HopeFearMode } from "../../src/lib/domain/dice/index";
import type { RollOutcome } from "../../src/lib/domain/duality";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { plannedSpends, recordTokenSpends, spendActionTokens, type Spent } from "./actionTokens";
import { readSheet, saveSheet } from "./characterSheet";
import { liveCombatMap, MAX_COMBAT_TOKENS } from "./combatMaps";
import { applyTick } from "./countdownTicks";
import { ruleMode, ruleModesOf, postRuleNote } from "./ruleModes";
import { gmHoldsSpotlight, moveToGm, spotlightOf } from "./spotlight";

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

/**
 * A GM note (S1, R3 Manual), a planned Spotlight Tracker spend (`tokenOf`: recorded hidden, never shown as a note) or the
 * planned Underwater breath step (`breath`: the countdown to tick and by how much, the PCs who mark a Stress; plan OE).
 */
type Note =
  | { ruleId: "spotlightToGm" | "hopeFearFromRolls"; summary: string }
  | { ruleId: "spotlightTracker"; summary: string; tokenOf: Id<"characters"> }
  | { ruleId: "underwater"; summary: string; breath: BreathStep };

/** Underwater (plan OE): tick `countdownId` by `ticks` (0 once it has ended), and each of `stress` marks 1 Stress. */
export type BreathStep = { countdownId: Id<"countdowns">; ticks: number; stress: Id<"characters">[] };

/**
 * The live map when the Underwater optional rule is on and the GM marked it Underwater, with its breath countdown (null
 * when it was deleted), or null. Reads the campaign's live map row and one countdown.
 */
export async function liveUnderwater(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
): Promise<{ map: Doc<"combatMaps">; breath: Doc<"countdowns"> | null } | null> {
  if (!ruleMode(campaign, "underwater")) return null;
  const map = await liveCombatMap(ctx, campaign._id);
  if (map === null || map.underwater !== true) return null;
  const breath = map.breathCountdownId === undefined ? null : await ctx.db.get("countdowns", map.breathCountdownId);
  return { map, breath: breath !== null && breath.campaignId === campaign._id ? breath : null };
}

/**
 * Underwater (plan OE): what this action roll does to the breath countdown, or null (rule off, no Underwater live map,
 * none of the rollers on it, no countdown, or it is paused / cancelled). Reads only.
 */
async function planBreath(ctx: QueryCtx, campaign: Doc<"campaigns">, rollers: readonly Id<"characters">[], roll: { success: boolean; withFear: boolean }): Promise<BreathStep | null> {
  const scene = await liveUnderwater(ctx, campaign);
  if (scene === null || scene.breath === null) return null;
  const tokens = await ctx.db
    .query("combatTokens")
    .withIndex("by_map", (q) => q.eq("mapId", scene.map._id))
    .take(MAX_COMBAT_TOKENS);
  // Plan OE2 (user 2026-11-06): a PC the GM marked as breathing underwater holds no breath (no tick, no Stress).
  const onMap = new Set(tokens.flatMap((t) => (t.ref.kind === "pc" && t.breathesUnderwater !== true ? [t.ref.characterId as string] : [])));
  const underwater = rollers.filter((id) => onMap.has(id));
  if (underwater.length === 0) return null;
  const breath = scene.breath;
  if (breathEnded(breath)) return { countdownId: breath._id, ticks: 0, stress: underwater };
  if (breath.status !== "active") return null;
  return { countdownId: breath._id, ticks: breathTicks(roll), stress: [] };
}

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
  const breath = await planBreath(ctx, campaign, out.spenders, roll);
  if (breath !== null) out.notes.push({ ruleId: "underwater", summary: `${roll.name}: breath`, breath });
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
  for (const note of aftermath.notes) {
    if (note.ruleId === "underwater" && row.groupId !== undefined) await applyBreath(ctx, campaign, note.breath, { groupId: row.groupId, actorId: row.actorId });
  }
  if (aftermath.move !== null) {
    const before = await spotlightOf(ctx, campaign._id);
    if (await moveToGm(ctx, campaign, aftermath.move, aftermath.rollBy)) await recordSpotlightBefore(ctx, campaign, aftermath.rollBy, row.groupId, before);
  }
  for (const note of aftermath.notes) {
    if (note.ruleId === "spotlightTracker" || note.ruleId === "underwater") continue;
    await postRuleNote(ctx, campaign, { ruleId: note.ruleId, summary: note.summary, groupId: row.groupId, actorId: row.actorId });
  }
}

/**
 * S1 undo (plan rule-switches CU2, bead dcm-bxp.99.32.10): stores the spotlight row as it stood before the roll moved it
 * (`before`, null: the whole party) and the moved row's `since` on a row of the roll's action, so `undoEntry` puts it back
 * (convex/lib/actionLog.ts `restoreSpotlight`). The row: the group's first non-note row, or for an ungrouped plain roll
 * the roller's newest row (the roll row the path just logged; one indexed read). Nothing found: nothing stored.
 */
async function recordSpotlightBefore(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  rollBy: Id<"characters">,
  groupId: string | undefined,
  before: Doc<"combatSpotlight"> | null,
): Promise<void> {
  const moved = await spotlightOf(ctx, campaign._id);
  if (moved === null) return;
  let entryId: Id<"actionLog"> | null;
  if (groupId !== undefined) entryId = await groupEntry(ctx, campaign, groupId);
  else {
    const latest = await ctx.db
      .query("actionLog")
      .withIndex("by_character_at", (q) => q.eq("characterId", rollBy))
      .order("desc")
      .first();
    entryId = latest !== null && latest.campaignId === campaign._id && latest.kind === "roll" && latest.undoneAt === undefined ? latest._id : null;
  }
  if (entryId === null) return;
  const row =
    before === null
      ? null
      : {
          holder: before.holder,
          since: before.since,
          reason: before.reason,
          ...(before.rollBy !== undefined ? { rollBy: before.rollBy } : {}),
          ...(before.adversaryTokenId !== undefined ? { adversaryTokenId: before.adversaryTokenId } : {}),
        };
  await ctx.db.patch("actionLog", entryId, { spotlightBefore: { row, movedAt: moved.since } });
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

/** The first row of the roll's group that is not a rule note: the entry a breath tick is recorded on (undo reverts it). */
async function groupEntry(ctx: QueryCtx, campaign: Doc<"campaigns">, groupId: string): Promise<Id<"actionLog"> | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaign._id).eq("groupId", groupId))
    .take(60);
  return rows.find((r) => r.kind !== "rule")?._id ?? null;
}

/**
 * Underwater (plan OE): applies a planned breath step in the roll's group. The tick goes through `applyTick` (history,
 * trigger notice when it reaches 0, a `countdownTicks` row on the group's first row so undo takes it back). Each PC in
 * `stress` marks 1 Stress (D4 respected through `markStress`: Book overflow marks 1 HP; Manual drops it and notes the GM)
 * in a public row with the sheet before, in the group.
 */
export async function applyBreath(ctx: MutationCtx, campaign: Doc<"campaigns">, step: BreathStep, row: { groupId: string; actorId: Id<"users"> }): Promise<void> {
  if (step.ticks > 0) {
    const countdown = await ctx.db.get("countdowns", step.countdownId);
    const entryId = await groupEntry(ctx, campaign, row.groupId);
    if (countdown !== null && countdown.status === "active" && entryId !== null) {
      await applyTick(ctx, countdown, step.ticks, { source: "roll", entryId, actorId: row.actorId });
    }
  }
  if (step.stress.length === 0) return;
  const rules = ruleModesOf(campaign);
  for (const characterId of step.stress) {
    const character = await ctx.db.get("characters", characterId);
    if (character === null || character.campaignId !== campaign._id) continue;
    const sheet = readSheet(character.sheet);
    const marked = markStress(sheet, 1, rules);
    const next = { ...sheet, stress: marked.stress, hp: marked.hp };
    const changed = next.stress !== sheet.stress || next.hp !== sheet.hp;
    if (changed) await saveSheet(ctx, characterId, next, character);
    const what = next.stress !== sheet.stress ? "marks 1 Stress" : next.hp !== sheet.hp ? "has no Stress left to mark: marks 1 Hit Point" : "has no Stress left to mark";
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId,
      actorId: row.actorId,
      kind: "combat",
      visibility: "public",
      summary: `${sheet.name} is out of breath underwater: ${what}`,
      groupId: row.groupId,
      ...(changed ? { before: sheet } : {}),
      undoable: true,
    });
    if (marked.overflow === true) await postRuleNote(ctx, campaign, { ruleId: "stressOverflow", summary: `${sheet.name}: Stress full, mark 1 HP?`, groupId: row.groupId, actorId: row.actorId });
  }
}
