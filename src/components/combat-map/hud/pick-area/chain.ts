import type { Range } from "@/lib/domain/card-effects/types";
import { rangeCheck, type Footprint } from "@/lib/domain/combat-actions/distance";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { PickRowInput } from "../pick";

/**
 * Chain links (plan combat-hud H3.3; CmpPicking 'Chain links': "After the roll, each next creature is picked from the last
 * one's reach"). The server asks for the next link of a repeating follow-up as a `needsChoice` ask
 * `{ kind: "followUp", label, link, tokenIds }` (Chain Lightning, CB p.328; Rip & Tear) and takes the answer as
 * `chain:<link>`. A picker opens a pick session whose rows are the ask's creatures and whose `data` carries
 * `chain: { links }` (the creatures of the links so far, link 0 = the first targets): the map layer then draws the
 * dashed links from the actor through each link with numbered nodes, and the current picks as the next number.
 */

export type ChainLinks = { links: Id<"combatTokens">[][] };

/** The `chain` a pick session's data carries, or null. */
export function chainOf(data: unknown): ChainLinks | null {
  if (data === null || typeof data !== "object" || !("chain" in data)) return null;
  const chain = (data as { chain: unknown }).chain;
  if (chain === null || typeof chain !== "object" || !Array.isArray((chain as ChainLinks).links)) return null;
  return chain as ChainLinks;
}

/** A creature the chain rows can name. */
export type ChainCreature = { tokenId: Id<"combatTokens">; name: string; side: PickRowInput["side"]; at?: Footprint };

/**
 * The rows of the next link: the ask's creatures (names only, U1), each with its band from the last link's first
 * creature ("within Very Close of the last"); unknown tokens drop.
 */
export function chainRows(tokenIds: readonly string[], creatures: readonly ChainCreature[], lastLink: readonly string[]): PickRowInput[] {
  const byId = new Map(creatures.map((c) => [c.tokenId as string, c]));
  const from = lastLink.map((id) => byId.get(id)?.at).find((a) => a !== undefined);
  return tokenIds.flatMap((id) => {
    const c = byId.get(id);
    if (!c) return [];
    const band: Range | null = from && c.at ? rangeCheck(from, c.at, "unlimited").band : null;
    return [{ tokenId: c.tokenId, name: c.name, side: c.side, band, reach: "in" as const }];
  });
}

/** The answer to a link: `chain:<link>` with the picked creatures (an empty list stops the chain). */
export function chainAnswer(link: number, picked: readonly string[]): { id: string; value: string[] } {
  return { id: `chain:${link}`, value: [...picked] };
}
