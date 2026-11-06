// The part of the ally picks that adversaryActions needs at once: open the held allyPick request and roll the replayable
// dice. Kept apart from ./allyPicks (which imports the card, feature and attack runners) so adversaryActions imports it
// statically without an import cycle; the Convex runtime has no dynamic import().
import type { AdversaryPlan } from "../../src/lib/domain/adversary-effects/run";
import type { Rng } from "../../src/lib/domain/dice/index";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import type { ActionArgs, ActionResult } from "./adversaryActions";
import type { PartyMember } from "./adversaryHits";
import { liveCombatMap } from "./combatMaps";
import { replaying, rollDie } from "./dice";
import { MAX_ALLY_PICK_CHOOSERS, type AllyPickChooser, type HeldFeatureArgs } from "./validators/combatRequests";

/** A die source that records what it rolls (the first run), or replays those values first (the run with the picks). */
export function pickDice(replay: readonly number[] | undefined): { rng: Rng; values: number[] } {
  if (replay !== undefined) return { rng: replaying(replay, rollDie), values: [...replay] };
  const values: number[] = [];
  return {
    values,
    rng: (sides) => {
      const n = rollDie(sides);
      values.push(n);
      return n;
    },
  };
}

function heldArgs(a: ActionArgs): HeldFeatureArgs {
  return {
    instanceId: a.instanceId,
    ...(a.feature !== undefined ? { feature: a.feature } : {}),
    ...(a.useId !== undefined ? { useId: a.useId } : {}),
    targets: [...a.targets],
    ...(a.picked ? { picked: [...a.picked] } : {}),
    ...(a.allies ? { allies: [...a.allies] } : {}),
    ...(a.followUp ? { followUp: [...a.followUp] } : {}),
    ...(a.chain ? { chain: a.chain.map((l) => [...l]) } : {}),
    ...(a.raisers ? { raisers: [...a.raisers] } : {}),
    ...(a.trigger ? { trigger: { ...a.trigger } } : {}),
    ...(a.options ? { options: a.options.map((o) => ({ id: o.id, values: [...o.values] })) } : {}),
    ...(a.optionals ? { optionals: [...a.optionals] } : {}),
    ...(a.situations ? { situations: [...a.situations] } : {}),
    ...(a.eitherCosts ? { eitherCosts: [...a.eitherCosts] } : {}),
    ...(a.splits ? { splits: a.splits.map((x) => ({ id: x.id, amount: x.amount })) } : {}),
    ...(a.advantage !== undefined ? { advantage: a.advantage } : {}),
    ...(a.disadvantage !== undefined ? { disadvantage: a.disadvantage } : {}),
    ...(a.experience !== undefined ? { experience: a.experience } : {}),
    ...(a.spendFear !== undefined ? { spendFear: a.spendFear } : {}),
    ...(a.reactions ? { reactions: [...a.reactions] } : {}),
    ...(a.buyOffs ? { buyOffs: [...a.buyOffs] } : {}),
  };
}

/**
 * An adversary feature use whose plan asks PCs to pick their own option (`choose` prompts with a chooser): nothing applies
 * (no Fear, no spotlight, no damage); its picks open as an `allyPick` row and a GM feed line "waiting for …" in a new
 * group. Null when no PC chooses (the GM's prompts, as before).
 */
export async function holdForAllyPicks(
  ctx: MutationCtx,
  h: { campaign: Doc<"campaigns">; user: Doc<"users">; instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters">; party: readonly PartyMember[]; args: ActionArgs; plan: AdversaryPlan; dice: readonly number[]; groupId: string; featureName: string },
): Promise<ActionResult | null> {
  const choosers: AllyPickChooser[] = [];
  for (const s of h.plan.steps) {
    if (s.kind !== "prompt" || s.prompt !== "choose" || s.step?.kind !== "choose" || s.chooserId === undefined) continue;
    const member = h.party.find((m) => m.character._id === s.chooserId);
    choosers.push({
      stepId: s.step.id,
      chooserId: s.chooserId,
      ...(member ? { characterId: member.character._id } : {}),
      name: (member?.sheet.name ?? "a creature").slice(0, 80),
      label: s.step.label.slice(0, 200),
      options: s.step.options.map((o) => ({ id: o.id, label: o.label })),
    });
  }
  if (!choosers.some((c) => c.characterId !== undefined)) return null;
  const live = await liveCombatMap(ctx, h.campaign._id);
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: h.campaign._id,
    encounterId: h.encounter._id,
    ...(live ? { mapId: live._id } : {}),
    kind: "allyPick",
    status: "open",
    createdBy: h.user._id,
    createdAt: Date.now(),
    responses: [],
    payload: {
      schemaVersion: 1,
      kind: "allyPick",
      name: h.featureName.slice(0, 80),
      actorName: h.instance.label.slice(0, 80),
      groupId: h.groupId,
      source: { kind: "adversary", instanceId: h.instance._id, args: heldArgs(h.args), dice: h.dice.slice(0, 200) },
      choosers: choosers.slice(0, MAX_ALLY_PICK_CHOOSERS),
      answers: [],
    },
  });
  const names = [...new Set(choosers.map((c) => c.name))].join(", ");
  const entryId = await logAction(ctx, { campaignId: h.campaign._id, actorId: h.user._id, kind: "adversary", visibility: "gm", summary: `${h.instance.label} uses ${h.featureName}: waiting for ${names} to choose`.slice(0, 1000), groupId: h.groupId, undoable: true });
  return { status: "resolved", groupId: h.groupId, entryId, roll: null, success: false, targets: [], fearDelta: 0, prompts: [], offers: [], picks: requestId };
}
