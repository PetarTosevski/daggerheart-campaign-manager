"use client";

import type { CardUse } from "@/lib/domain/card-effects/types";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { DialogRequest } from "../../actions/hand/dialog";
import { areaPickOf, formFor, type AreaPick, type Creature, type HandCard, type HandUse } from "../../actions/hand/model";
import type { PickActor, PickOutcome, PickPatch, PickSessionSpec } from "../pick";
import { blockedOf, cardSessionId, payLine, primaryLabel, requestOf, riderOptions, ridersOf, ruleOf, selfRows, startData, type BlockContext, type CardPickData } from "./model";
import { CardRows, hasCardRows } from "./rows";

/**
 * A card's pick session (plan combat-hud H3.1; HANDOFF "The picking pattern"; boards CmpPicking "One target · a card",
 * Main "Picking a target"): the card's art and name in the header with its rule, the target rows and rings (H3.0), the
 * classic Use dialog's choices as panel rows (`CardRows`), the card's add-ons as rider switches with cost pills, the
 * footer's cost line and one primary naming the action. Built from the classic Hand model; nothing here decides a rule.
 */

export type CardPickEnv = {
  characterId: Id<"characters">;
  card: HandCard;
  /** The card's playable uses (`playableUses`): more than one is a grimoire's spell list. */
  uses: readonly HandUse[];
  /** The card's effect entry uses (the same table the server runs). */
  effectUses: readonly CardUse[];
  /** The creatures the hand knows (the rider's / recipients' picks list them). */
  creatures: readonly Creature[];
  /** The GM's acting PC token (Play for); the player's own character by default. */
  actor?: PickActor;
  /** Enemies picked on the map before Use: the first pick when the card targets enemies. */
  mapPicks: readonly Id<"combatTokens">[];
  block: BlockContext;
  /** Sends the use (or hands an area use to the map's point picker first) and says how the session ends. */
  play: (request: DialogRequest, area: AreaPick | null) => Promise<PickOutcome>;
};

function pickedUse(env: CardPickEnv, data: CardPickData): CardUse {
  return env.effectUses.find((u) => u.id === data.useId) ?? env.effectUses[0]!;
}

function actorToken(env: CardPickEnv): Id<"combatTokens"> | null {
  return env.actor?.tokenId ?? env.creatures.find((c) => c.side === "self")?.tokenId ?? null;
}

/** Everything of the session that follows the picked use and the answers (a new spell, a new answer). */
export function cardPatch(env: CardPickEnv, data: CardPickData): PickPatch<CardPickData> {
  const use = pickedUse(env, data);
  const form = formFor(use);
  const riders = ridersOf(use, form);
  const self = selfRows(use, form, actorToken(env));
  return {
    rule: ruleOf(use, form),
    rows: self.rows,
    options: riderOptions(riders, data),
    data,
    extra: !hasCardRows(env, use, form)
      ? undefined
      : (ctx) => <CardRows env={env} use={use} form={form} riders={riders} data={ctx.data} selection={ctx.selection} onData={(next) => ctx.update(cardPatch(env, next))} />,
    primary: {
      label: (s) => primaryLabel(env.card, use, form, s),
      pay: (s) => payLine(use, riders, s, env.block.roller?.hope ?? null),
      blocked: (s) => blockedOf(use, form, data, s, env.block),
      send: (s) => env.play(requestOf(env.card.cardId, use, form, data, s, env.block), areaPickOf(use)),
    },
  };
}

/** The session a Use opens: the card's first ready use (a grimoire starts on it), the map's enemy pick kept. */
export function cardSession(env: CardPickEnv): PickSessionSpec<CardPickData> {
  const first = env.uses.find((u) => u.ready) ?? env.uses[0];
  const use = env.effectUses.find((u) => u.id === first?.useId) ?? env.effectUses[0]!;
  const data = startData(use);
  const form = formFor(use);
  const t = form.targets;
  const fromMap = t && (t.side === "enemy" || t.side === "any") ? env.mapPicks.slice(-(t.max ?? env.mapPicks.length)) : [];
  const self = selfRows(use, form, actorToken(env));
  const patch = cardPatch(env, data);
  return {
    id: cardSessionId(env.characterId, env.card.cardId),
    source: { kind: "card", name: env.card.name, cardId: env.card.cardId },
    rule: patch.rule!,
    primary: patch.primary!,
    ...(patch.rows ? { rows: patch.rows } : {}),
    options: patch.options ?? [],
    picked: self.picked ?? fromMap,
    ...(env.actor ? { actor: env.actor } : {}),
    data,
    ...(patch.extra ? { extra: patch.extra } : {}),
  };
}
