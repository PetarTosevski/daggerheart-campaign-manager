/**
 * The cards a character holds (plan combat-actions, tracers CA4 / CA4b; docs/tasks/TASK-CA-CA4.md, TASK-CA-CA4b.md):
 * the Hand `combatCardsReads.hand` returns (each card's state from the sheet's `featureUses`, Q3), and the cards' timing uses
 * a rest runs (CA4b): every loadout card's `auto` use with a `timing` trigger at `afterRest` runs on every rest before
 * the rest's expiry (so Wild Surge, which needs its effect active, still sees it: "the form drops", one more Stress),
 * and those at `afterLongRest` run after a finished long rest's expiry (Inspirational Words: "Place a number of tokens
 * equal to your Presence on this card"; unspent ones are cleared by the same `set`). An interrupted long rest is a short
 * rest (CB p.105), so only `afterRest` runs.
 */

import { run, type RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import type { Rng } from "../../src/lib/domain/dice/index";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import { loadoutMax } from "../../src/lib/domain/transformations/index";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { resolveOptions } from "../../src/lib/frames/options";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { actorSheetAfter, cardActor, cardIdOfEffect, tokenKeyOf } from "./cardRunner";
import { loadCharacter, readSheet, saveSheet } from "./characterSheet";
import { assertMayAct } from "./spotlight";
import { markStressOn, unshakableText, type UnshakableRoll } from "./unshakable";
import { reductionOf } from "./cardHandView";

export {
  handCard,
  handCardValidator,
  handOf,
  handUseValidator,
  recallRiderOptionValidator,
  recallRiderOptions,
  type HandCard,
  type RecallRiderOption,
} from "./cardHandView";

// ---------------------------------------------------------------- who sees a hand (F7-H4, dcm-bxp.99.24)

/**
 * Hiding hands (user answer 2026-10-22, dcm-bxp.99.24): "BOTH - a GM campaign switch 'Players can see each other's
 * cards' (on by default) and, when allowed, each player can hide their own hand. The GM always sees every hand."
 *
 * Storage (F8-I1, dcm-bxp.99.27; docs/tasks/TASK-F8-I1.md): the GM's switch is the typed campaign field
 * `playersSeeHands` (absent = on), and a hidden hand is the character's own `handHidden: true` (absent = shared),
 * listed from the campaign's capped `by_campaign` characters. A player's switch writes only their character, never the campaign
 * document every campaign query reads (CD10). F7-H4 kept both in `campaigns.options.playersSeeHands` and a
 * `frameTrackers` `handPrivacy` blob; `migrations/handSharing` moves those over and deletes the old key and row.
 */

export { handSharedWithPlayers, hiddenHands, playersSeeHands, writeHandHidden } from "./handSharing";

// ---------------------------------------------------------------- loadout and vault

/**
 * `characters.moveCard`: moves a domain card between loadout (max 5, or a Reanimated PC's lowered maximum, HF p.153) and vault. From the vault into the loadout costs
 * the card's Recall Cost in Stress unless it happens during a rest (CB p.101, p.105: swaps are free "when you start a
 * rest"): `duringRest` counts only while the campaign has an open party rest. The character's player, or the GM for any
 * character of the campaign (CA4b user answer: the GM may play a PC's cards after turning on a switch). A move by the GM
 * for someone else's character, and a recall that cost Stress, write an undoable actionLog row (the GM as actor, the
 * character's id on the row, its sheet before).
 */
export async function moveCardFor(
  ctx: MutationCtx,
  user: Doc<"users">,
  characterId: Id<"characters">,
  cardId: string,
  to: "loadout" | "vault",
  duringRest: boolean | undefined,
  recallRiders: readonly string[] = [],
): Promise<null> {
  const { campaign, character, permission } = await loadCharacter(ctx, user, characterId, "edit", "owner");
  const s = readSheet(character.sheet);
  const refuse = (message: string) => appError("INVALID", message);
  if (!s.domainCards.owned.includes(cardId)) throw refuse("That card isn't in your deck.");
  const inLoadout = s.domainCards.loadout.includes(cardId);
  const card = getDomainCard(cardId);
  let next: CharacterSheet = { ...s };
  let paid = 0;
  let unshakable: UnshakableRoll | null = null;
  const used: string[] = [];
  if (to === "vault") {
    if (!inLoadout) return null;
    next.domainCards = { ...s.domainCards, loadout: s.domainCards.loadout.filter((c) => c !== cardId) };
  } else {
    if (inLoadout) return null;
    // S2 (plan rule-switches RS2, bead dcm-bxp.99.32.38; CB p.27 Recall Cost): a recall is an action, so it waits while
    // the GM holds the spotlight in a running encounter (Manual: it goes through with the GM's note).
    await assertMayAct({ ...ctx, user }, campaign, character, "action", s.name);
    const max = loadoutMax(s);
    if (s.domainCards.loadout.length >= max) throw refuse(`Your loadout holds at most ${max} ${max === 1 ? "card" : "cards"}; vault one first.`);
    if ((card?.level ?? 99) > s.level) throw refuse("That card is above your level.");
    next.domainCards = { ...s.domainCards, loadout: [...s.domainCards.loadout, cardId] };
    let recall = card?.recallCost ?? 0;
    const resting =
      duringRest === true &&
      (await ctx.db
        .query("rests")
        .withIndex("by_campaign_status_started", (q) => q.eq("campaignId", campaign._id).eq("status", "open"))
        .first()) !== null;
    if (!resting && recall > 0) {
      // Plan lanes, E1 (dcm-bxp.99.19.1): a recall rider lowers the Recall Cost (Perfect Recall, CB p.50).
      const lowered = recallReductions(next, campaign, recall, recallRiders);
      next = lowered.sheet;
      recall = lowered.cost;
      used.push(...lowered.names);
    }
    if (!resting && recall > 0) {
      // DA10: Unshakable (CB p.59) rolls a d6 for each Stress of the Recall Cost; a 6 skips that one.
      const marked = markStressOn(next, recall);
      next = marked.sheet;
      unshakable = marked.roll;
      paid = recall;
    }
  }
  await saveSheet(ctx, character._id, next);
  const forSomeone = permission === "owner" && character.ownerId !== user._id;
  if (forSomeone || paid > 0 || used.length > 0) {
    const uses = used.length > 0 ? `; ${used.join(", ")}` : "";
    const what = to === "vault" ? `vaults ${card?.name ?? cardId}` : `recalls ${card?.name ?? cardId}${paid > 0 || used.length > 0 ? ` (${paid} Stress${unshakable ? `; ${unshakableText(unshakable)}` : ""}${uses})` : ""}`;
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: character._id,
      actorId: user._id,
      kind: "feature",
      visibility: "public",
      summary: `${forSomeone ? "GM for " : ""}${s.name} ${what}`,
      before: s,
      undoable: true,
    });
  }
  return null;
}

/** At most this many recall riders per move. */
const MAX_RECALL_RIDERS = 5;

/**
 * Plan lanes, E1 (dcm-bxp.99.19.1): the `whenYouRecall` uses that lower a recall's cost. Perfect Recall (School of
 * Knowledge, CB p.50): "Once per rest, when you recall a domain card in your vault, you can reduce its Recall Cost by 1."
 * An `auto` use always runs; a `rider` use runs when the player took it (`riders`: `<featureId or cardId>` or
 * `<id>:<useId>`). Each runs through the runner (its limit and costs; one that can't run is skipped, a rider the player
 * took refuses with INVALID) and takes its `reduceRecallCost` amount off. Never below 0.
 */
export function recallReductions(sheet: CharacterSheet, campaign: Pick<Doc<"campaigns">, "frameId" | "options">, cost: number, riders: readonly string[]): { sheet: CharacterSheet; cost: number; names: string[] } {
  if (riders.length > MAX_RECALL_RIDERS) throw appError("INVALID", "Too many recall riders.");
  let next = sheet;
  let left = cost;
  const names: string[] = [];
  const takes = (id: string, use: CardUse): "auto" | "rider" | null => {
    const a = use.activation;
    if ((a.kind !== "auto" && a.kind !== "rider") || a.trigger.kind !== "whenYouRecall" || reductionOf(use) === 0) return null;
    if (a.kind === "auto") return "auto";
    return riders.includes(id) || riders.includes(`${id}:${use.id}`) ? "rider" : null;
  };
  const apply = (kind: "auto" | "rider", name: string, result: { ok: true; plan: RunPlan } | { ok: false; detail: string }, use: CardUse) => {
    if (!result.ok) {
      if (kind === "rider") throw appError("INVALID", `${name}: ${result.detail}`);
      return;
    }
    next = actorSheetAfter(next, result.plan, "self", name);
    left = Math.max(0, left - reductionOf(use));
    names.push(use.name);
  };
  for (const id of sheet.domainCards.loadout) {
    const effect = cardEffect(id);
    if (effect === undefined) continue;
    for (const use of effect.uses) {
      const kind = takes(id, use);
      if (kind !== null && left > 0) apply(kind, use.name, run(effect, { actor: cardActor("self", next, id, undefined), gmFear: 0, useId: use.id, targets: [], rng: () => 1 }), use);
    }
  }
  for (const held of owned(sheet, { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear })) {
    const entry = featureEffect(held.featureId);
    if (entry === undefined) continue;
    for (const use of entry.uses) {
      const kind = takes(held.featureId, use);
      if (kind !== null && left > 0) apply(kind, held.name, runFeature(entry, use.id, { actor: cardActor("self", next, tokenKeyOf(held.featureId), undefined), gmFear: 0, targets: [], rng: () => 1 }), use);
    }
  }
  return { sheet: next, cost: left, names };
}

// ---------------------------------------------------------------- timing uses at a rest

/**
 * Cards whose rest use ends the card's own effect: Wild Surge (CB p.339) "If you take a rest, the form drops", so its
 * sheet effect goes with the rest use's extra Stress.
 */
const ENDS_ON_REST = new Set(["wild-surge"]);

export type RestTiming = "afterRest" | "afterLongRest";

/**
 * Runs the loadout cards' `auto` uses timed `at` this point of a rest on the sheet (requirements unmet → skipped, e.g.
 * Wild Surge without its effect). Returns the sheet after them and one line per use that changed it, for the PC's rest
 * row. Pure: the caller saves the sheet and logs it in the rest's group (so the rest's undo takes it back).
 */
export function runRestTiming(sheet: CharacterSheet, actorId: string, at: RestTiming, rng: Rng): { sheet: CharacterSheet; lines: string[] } {
  let next = sheet;
  const lines: string[] = [];
  for (const cardId of sheet.domainCards.loadout) {
    const effect = cardEffect(cardId);
    const card = getDomainCard(cardId);
    if (effect === undefined || card === undefined) continue;
    for (const use of effect.uses) {
      const trigger = use.activation.kind === "auto" ? use.activation.trigger : undefined;
      if (trigger?.kind !== "timing" || trigger.at !== at) continue;
      const result = run(effect, { actor: cardActor(actorId, next, cardId, undefined), gmFear: 0, useId: use.id, targets: [], rng });
      if (!result.ok) continue;
      // DA10: an Unshakable PC rolls a d6 for each Stress the use marks (Wild Surge's rest Stress), with the rest's dice.
      const rolled: UnshakableRoll[] = [];
      let after = actorSheetAfter(next, result.plan, actorId, card.name, { rng, out: rolled });
      if (ENDS_ON_REST.has(cardId)) after = { ...after, effects: after.effects.filter((e) => cardIdOfEffect(e) !== cardId) };
      if (JSON.stringify(after) === JSON.stringify(next)) continue;
      next = after;
      lines.push(rolled.length > 0 ? `${use.name} (${rolled.map(unshakableText).join("; ")})` : use.name);
    }
  }
  const features = runFeatureTokenTiming(next, actorId, at, rng);
  return { sheet: features.sheet, lines: [...lines, ...features.lines] };
}

/**
 * The token housekeeping of the features a sheet holds (sheet-drawer SD8): an `auto` use timed `at` this point of a rest
 * whose steps only move tokens runs on the sheet, as each feature's text says ("When you take a long rest, clear all
 * unspent tokens": Toxic Concoctions, HF p.9; "Clear all tokens from this card when you take a rest": Enchanted Talisman,
 * HF p.16; "When you take a long rest, remove a token": Feed, HF). A timed use that does anything else (Hardy's Hit
 * Point, the rest-time moves) belongs to the rest flow (`convex/rests.ts`, SD-R) and is skipped here. Focus is not
 * cleared by a rest: HF p.12 clears it only when the Martial Artist refocuses. Pure, like `runRestTiming`.
 */
function runFeatureTokenTiming(sheet: CharacterSheet, actorId: string, at: RestTiming, rng: Rng): { sheet: CharacterSheet; lines: string[] } {
  let next = sheet;
  const lines: string[] = [];
  for (const held of owned(sheet)) {
    const entry = featureEffect(held.featureId);
    if (entry === undefined) continue;
    for (const use of entry.uses) {
      const trigger = use.activation.kind === "auto" ? use.activation.trigger : undefined;
      if (trigger?.kind !== "timing" || trigger.at !== at) continue;
      if (use.steps.length === 0 || use.steps.some((step) => step.kind !== "tokens")) continue;
      const result = runFeature(entry, use.id, { actor: cardActor(actorId, next, tokenKeyOf(held.featureId), undefined), gmFear: 0, targets: [], rng });
      if (!result.ok) continue;
      const after = actorSheetAfter(next, result.plan, actorId, held.name, { rng });
      if (JSON.stringify(after) === JSON.stringify(next)) continue;
      next = after;
      lines.push(`${held.name}: ${use.name}`);
    }
  }
  return { sheet: next, lines };
}
