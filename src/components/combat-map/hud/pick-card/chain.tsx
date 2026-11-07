"use client";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { answerChoices, type CardChoice, type ChoiceAsk, type Creature } from "../../actions/hand/model";
import type { PickActor, PickContext, PickOutcome, PickSessionSpec } from "../pick";
import { chainAnswer, chainRows, type ChainLinks } from "../pick-area";
import { askText } from "../pick-feature/model";
import { AskRows } from "../pick-feature/rows";
import { cardSessionId } from "./model";

/**
 * A card's chain links in the picking panel (H3.1 wired to H3.3 at merge; CmpPicking 'Chain links'): when a card's use
 * comes back `needsChoice` with a repeating follow-up (Chain Lightning, CB p.328: "This chain continues until there are
 * no more adversaries within range"), the next link's creatures are the session's rows, the map draws the links so far
 * (`data.chain.links`, link 0 = the first targets) and the one primary reads "Next link" with picks, "Stop here" with
 * none. Other asks that come with it (a choice, a damage split) show as rows above (H3.3's `AskRows`). Asks without a
 * chain keep the classic after-the-roll dialog.
 */

export type CardChainData = { asks: readonly ChoiceAsk[]; options: Record<string, string[]>; splits: Record<string, number>; chain: ChainLinks };

/** The chain ask among a `needsChoice`'s asks, or null. */
export function chainAskOf(asks: readonly ChoiceAsk[]): Extract<ChoiceAsk, { kind: "followUp" }> | null {
  return asks.find((a): a is Extract<ChoiceAsk, { kind: "followUp" }> => a.kind === "followUp") ?? null;
}

export function cardChainSessionId(characterId: string, cardId: string): string {
  return `${cardSessionId(characterId, cardId)}:chain`;
}

export type CardChainEnv = {
  characterId: string;
  card: { cardId: string; name: string };
  asks: readonly ChoiceAsk[];
  /** The links so far (link 0: the use's first targets). */
  links: Id<"combatTokens">[][];
  creatures: readonly Creature[];
  names: ReadonlyMap<string, string>;
  actor?: PickActor;
  /** Rule switches ODR3: the campaign's Defined Ranges (`useDefinedRanges`; absent = on). Off: the rows show no band. */
  definedRanges?: boolean;
  /** Sends the answers (the use again with them); a refusal throws (the panel shows it). */
  answer: (choices: CardChoice[], links: Id<"combatTokens">[][]) => Promise<PickOutcome>;
  onCancel: () => void;
};

/** The pick session of the next chain link (null: the asks have no chain). */
export function cardChainSession(env: CardChainEnv): PickSessionSpec<CardChainData> | null {
  const ask = chainAskOf(env.asks);
  if (!ask) return null;
  const others = env.asks.filter((a) => a.kind !== "followUp");
  const lastLink = env.links[env.links.length - 1] ?? [];
  const primaryFor = (d: CardChainData): PickSessionSpec<CardChainData>["primary"] => ({
    label: (s) => (s.targetIds.length > 0 ? "Next link" : "Stop here"),
    send: (s) => {
      const links = s.targetIds.length > 0 ? [...env.links, [...s.targetIds]] : env.links;
      return env.answer([...answerChoices(others, d.options, d.splits), chainAnswer(ask.link, s.targetIds)], links);
    },
  });
  const data: CardChainData = { asks: env.asks, options: {}, splits: {}, chain: { links: env.links } };
  return {
    id: cardChainSessionId(env.characterId, env.card.cardId),
    source: { kind: "card", name: env.card.name, cardId: env.card.cardId },
    // A link of a cast already under way: the GM's spotlight (taken by its roll, perhaps) never holds it back.
    followUp: true,
    rule: { side: "any", max: null, range: "unlimited", min: 0, text: askText(env.asks) },
    rows: chainRows(ask.tokenIds, env.creatures, lastLink, env.definedRanges ?? true),
    ...(env.actor ? { actor: env.actor } : {}),
    data,
    ...(others.length > 0
      ? { extra: (ctx: PickContext<CardChainData>) => <AskRows asks={others} data={ctx.data} names={env.names} onChange={(next) => ctx.update({ data: next, primary: primaryFor(next) })} /> }
      : {}),
    primary: primaryFor(data),
    onCancel: env.onCancel,
  };
}
