/**
 * The cards a character holds (plan combat-actions, tracers CA4 / CA4b; docs/tasks/TASK-CA-CA4.md, TASK-CA-CA4b.md):
 * the Hand `combatCards.hand` returns (each card's state from the sheet's `featureUses`, Q3), and the cards' timing uses
 * a rest runs (CA4b): every loadout card's `auto` use with a `timing` trigger at `afterRest` runs on every rest before
 * the rest's expiry (so Wild Surge, which needs its effect active, still sees it: "the form drops", one more Stress),
 * and those at `afterLongRest` run after a finished long rest's expiry (Inspirational Words: "Place a number of tokens
 * equal to your Presence on this card"; unspent ones are cleared by the same `set`). An interrupted long rest is a short
 * rest (CB p.105), so only `afterRest` runs.
 */
import { v, type Infer } from "convex/values";

import { cardAvailability, RESET_LABEL } from "../../src/lib/domain/card-effects/availability";
import { run } from "../../src/lib/domain/card-effects/run";
import type { CardUse, TargetSpec } from "../../src/lib/domain/card-effects/types";
import type { Rng } from "../../src/lib/domain/dice/index";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import { markStress } from "../../src/lib/domain/characters/index";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { actorSheetAfter, cardActor, cardIdOfEffect } from "./cardRunner";
import { loadCharacter, MAX_CHARACTERS_PER_CAMPAIGN, readSheet, saveSheet } from "./characterSheet";

export const handUseValidator = v.object({
  useId: v.string(),
  name: v.string(),
  activation: v.union(v.literal("action"), v.literal("reaction"), v.literal("rider"), v.literal("auto"), v.literal("passive")),
  ready: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  usesLeft: v.union(v.null(), v.number()),
  /** Whether the use rolls (the Hand shows the roll options). */
  rolls: v.boolean(),
  /** Who it targets: side, range ("weapon", "unlimited" or a band) and count kind; null for trigger targets or none. */
  targets: v.union(v.null(), v.object({ side: v.string(), range: v.string(), count: v.string() })),
  /** NumberChoices the player sets first ("spend any number of Hope"). */
  choices: v.array(v.object({ id: v.string(), label: v.string(), min: v.number() })),
});

export const handCardValidator = v.object({
  cardId: v.string(),
  name: v.string(),
  domain: v.string(),
  level: v.number(),
  type: v.string(),
  recallCost: v.number(),
  place: v.union(v.literal("loadout"), v.literal("vault")),
  usage: v.union(v.literal("combat"), v.literal("passive"), v.literal("outOfCombat")),
  /** ready / exhausted (its card key used up, CB p.101), passive (always on), outOfCombat (CARD_NOT_COMBAT on the map). */
  state: v.union(v.literal("ready"), v.literal("exhausted"), v.literal("passive"), v.literal("outOfCombat")),
  resetLabel: v.union(v.null(), v.string()),
  tokens: v.number(),
  uses: v.array(handUseValidator),
});
export type HandCard = Infer<typeof handCardValidator>;

function specOf(use: CardUse): TargetSpec | undefined {
  return use.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
}

/** One card of the Hand: its state from the sheet's `featureUses` (Q3, the same answer CA7 greys the sheet with). */
export function handCard(sheet: CharacterSheet, cardId: string, place: "loadout" | "vault"): HandCard | null {
  const card = getDomainCard(cardId);
  if (card === undefined) return null;
  const usage = cardUsage(cardId);
  const effect = cardEffect(cardId);
  const uses = (effect?.uses ?? []).map((u) => {
    const a = cardAvailability(sheet, cardId, { useId: u.id, ...(u.limit ? { limit: u.limit } : {}) });
    const spec = specOf(u);
    return {
      useId: u.id,
      name: u.name,
      activation: u.activation.kind,
      ready: a.state === "ready",
      resetLabel: a.state === "exhausted" ? a.label : null,
      usesLeft: a.state === "ready" && a.usesLeft !== undefined ? a.usesLeft : null,
      rolls: u.roll !== undefined,
      targets: spec ? { side: spec.side, range: spec.range, count: spec.count.kind } : null,
      choices: (u.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min })),
    };
  });
  const main = cardAvailability(sheet, cardId);
  const limited = (effect?.uses ?? []).filter((u) => u.activation.kind !== "passive");
  const allSpent = limited.length > 0 && limited.every((u) => u.limit !== undefined && cardAvailability(sheet, cardId, { useId: u.id, limit: u.limit }).state === "exhausted");
  let state: HandCard["state"];
  let resetLabel: string | null = null;
  if (usage === "outOfCombat") state = "outOfCombat";
  else if (main.state === "exhausted" || allSpent) {
    state = "exhausted";
    resetLabel = main.state === "exhausted" ? main.label : (uses.find((u) => u.resetLabel !== null)?.resetLabel ?? RESET_LABEL.rest);
  } else state = usage === "passive" ? "passive" : "ready";
  return {
    cardId,
    name: card.name,
    domain: card.domain,
    level: card.level,
    type: card.type,
    recallCost: card.recallCost,
    place,
    usage,
    state,
    resetLabel,
    tokens: sheet.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0,
    uses,
  };
}

/** The loadout, then the vault (`owned − loadout`), each card with its state. */
export function handOf(sheet: CharacterSheet): { loadout: HandCard[]; vault: HandCard[] } {
  const loadout = sheet.domainCards.loadout.flatMap((id) => handCard(sheet, id, "loadout") ?? []);
  const vault = sheet.domainCards.owned.filter((id) => !sheet.domainCards.loadout.includes(id)).flatMap((id) => handCard(sheet, id, "vault") ?? []);
  return { loadout, vault };
}

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

/** The GM's switch "Players can see each other's cards" (on unless the GM turned it off). */
export function playersSeeHands(campaign: Pick<Doc<"campaigns">, "playersSeeHands">): boolean {
  return campaign.playersSeeHands !== false;
}

/** The characters whose player hides their hand (at most the campaign's character cap). */
export async function hiddenHands(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Id<"characters">[]> {
  // The campaign's characters are capped; an index on `handHidden` would be a field-prefix duplicate of `by_campaign`.
  const rows = await ctx.db.query("characters").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).take(MAX_CHARACTERS_PER_CAMPAIGN);
  return rows.flatMap((row) => (row.handHidden === true ? [row._id] : []));
}

/**
 * Hides or shows one character's hand from the other players; writes only when it changes. Callers check access
 * first; a character missing or in another campaign is left alone.
 */
export async function writeHandHidden(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, hidden: boolean): Promise<void> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaignId) return;
  if ((character.handHidden === true) === hidden) return;
  await ctx.db.patch("characters", characterId, { handHidden: hidden ? true : undefined });
}

/** Whether the campaign's other players may read this character's hand: the GM's switch on and the hand not hidden. */
export function handSharedWithPlayers(campaign: Pick<Doc<"campaigns">, "playersSeeHands">, character: Pick<Doc<"characters">, "handHidden">): boolean {
  return playersSeeHands(campaign) && character.handHidden !== true;
}

// ---------------------------------------------------------------- loadout and vault

/**
 * `characters.moveCard`: moves a domain card between loadout (max 5) and vault. From the vault into the loadout costs
 * the card's Recall Cost in Stress unless it happens during a rest (CB p.101, p.105: swaps are free "when you start a
 * rest"): `duringRest` counts only while the campaign has an open party rest. The character's player, or the GM for any
 * character of the campaign (CA4b user answer: the GM may play a PC's cards after turning on a switch). A move by the GM
 * for someone else's character, and a recall that cost Stress, write an undoable actionLog row (the GM as actor, the
 * character's id on the row, its sheet before).
 */
export async function moveCardFor(ctx: MutationCtx, user: Doc<"users">, characterId: Id<"characters">, cardId: string, to: "loadout" | "vault", duringRest: boolean | undefined): Promise<null> {
  const { campaign, character, permission } = await loadCharacter(ctx, user, characterId, "edit", "owner");
  const s = readSheet(character.sheet);
  const refuse = (message: string) => appError("INVALID", message);
  if (!s.domainCards.owned.includes(cardId)) throw refuse("That card isn't in your deck.");
  const inLoadout = s.domainCards.loadout.includes(cardId);
  const card = getDomainCard(cardId);
  let next: CharacterSheet = { ...s };
  let paid = 0;
  if (to === "vault") {
    if (!inLoadout) return null;
    next.domainCards = { ...s.domainCards, loadout: s.domainCards.loadout.filter((c) => c !== cardId) };
  } else {
    if (inLoadout) return null;
    if (s.domainCards.loadout.length >= 5) throw refuse("Your loadout holds at most 5 cards; vault one first.");
    if ((card?.level ?? 99) > s.level) throw refuse("That card is above your level.");
    next.domainCards = { ...s.domainCards, loadout: [...s.domainCards.loadout, cardId] };
    const recall = card?.recallCost ?? 0;
    const resting =
      duringRest === true &&
      (await ctx.db
        .query("rests")
        .withIndex("by_campaign_status_started", (q) => q.eq("campaignId", campaign._id).eq("status", "open"))
        .first()) !== null;
    if (!resting && recall > 0) {
      const { stress, hp } = markStress(next, recall);
      next = { ...next, stress, hp };
      paid = recall;
    }
  }
  await saveSheet(ctx, character._id, next);
  const forSomeone = permission === "owner" && character.ownerId !== user._id;
  if (forSomeone || paid > 0) {
    const what = to === "vault" ? `vaults ${card?.name ?? cardId}` : `recalls ${card?.name ?? cardId}${paid > 0 ? ` (${paid} Stress)` : ""}`;
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
      let after = actorSheetAfter(next, result.plan, actorId, card.name);
      if (ENDS_ON_REST.has(cardId)) after = { ...after, effects: after.effects.filter((e) => cardIdOfEffect(e) !== cardId) };
      if (JSON.stringify(after) === JSON.stringify(next)) continue;
      next = after;
      lines.push(use.name);
    }
  }
  return { sheet: next, lines };
}
